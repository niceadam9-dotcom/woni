import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isGoogleConfigured, driveEnsureFolder, driveFileExists, driveUpload } from '@/lib/google'

/** ERP 스토리지 → Google Drive 야간 미러 백업 (2026-07-15)
 *  대상 버킷: fire-plans(소방계획서), reports(점검 보고서) → Drive `ERP백업/{버킷}/{경로}` 미러
 *  멱등: Drive에 같은 이름이 있으면 건너뜀. 실행당 최대 MAX_FILES개 신규 업로드(시간 예산).
 *  VPS 크론: 매일 03:30 KST — Authorization: Bearer {CRON_SECRET}
 *  수동: GET /api/cron/drive-backup?bucket=fire-plans */
export const maxDuration = 300

const BUCKETS = ['fire-plans', 'reports']
const MAX_FILES = 150

type StorageEntry = { name: string; id: string | null }

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isGoogleConfigured()) {
    return NextResponse.json({ ok: false, error: 'Google 연동 미설정 (GOOGLE_* 환경변수)' })
  }

  const admin = createAdminClient()
  const onlyBucket = req.nextUrl.searchParams.get('bucket')
  const buckets = onlyBucket ? [onlyBucket] : BUCKETS

  // 스토리지 재귀 목록
  async function walk(bucket: string, prefix: string, out: string[]): Promise<void> {
    const { data, error } = await admin.storage.from(bucket)
      .list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`${bucket}/${prefix} 목록 실패: ${error.message}`)
    for (const item of (data ?? []) as StorageEntry[]) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) await walk(bucket, path, out)  // 폴더
      else out.push(path)
    }
  }

  const folderCache = new Map<string, string>()
  async function ensurePath(segments: string[]): Promise<string> {
    let parent: string | null = null
    let key = ''
    for (const seg of segments) {
      key += `/${seg}`
      if (folderCache.has(key)) {
        parent = folderCache.get(key)!
        continue
      }
      parent = await driveEnsureFolder(seg, parent)
      folderCache.set(key, parent)
    }
    return parent!
  }

  const results: Array<{ bucket: string; total: number; uploaded: number; skipped: number; errors: string[] }> = []
  let budget = MAX_FILES

  for (const bucket of buckets) {
    const files: string[] = []
    const errors: string[] = []
    let uploaded = 0
    let skipped = 0
    try {
      await walk(bucket, '', files)
    } catch (e) {
      results.push({ bucket, total: 0, uploaded: 0, skipped: 0, errors: [(e as Error).message] })
      continue
    }

    for (const path of files) {
      if (budget <= 0) break
      const segments = path.split('/')
      const fileName = segments.pop()!
      try {
        const folderId = await ensurePath(['ERP백업', bucket, ...segments])
        if (await driveFileExists(fileName, folderId)) { skipped++; continue }
        const { data: blob, error } = await admin.storage.from(bucket).download(path)
        if (error || !blob) { errors.push(`${path}: 다운로드 실패`); continue }
        await driveUpload(fileName, folderId, new Uint8Array(await blob.arrayBuffer()),
          blob.type || 'application/octet-stream')
        uploaded++
        budget--
      } catch (e) {
        errors.push(`${path}: ${(e as Error).message}`)
        if (errors.length > 20) break
      }
    }
    results.push({ bucket, total: files.length, uploaded, skipped, errors })
  }

  const hasError = results.some(r => r.errors.length > 0)
  return NextResponse.json({ ok: !hasError, budgetLeft: budget, results, timestamp: new Date().toISOString() })
}
