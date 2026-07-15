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
      // 워커 큐·결과(_queue/_results 등 밑줄 시작)는 운영 데이터가 아니므로 백업 제외
      if (!prefix && item.name.startsWith('_')) continue
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

  // ── 사람이 읽을 수 있는 이름으로 변환 (2026-07-15) ─────────
  // 폴더: 고객 UUID → 고객명, 파일: generated_*.pdf → "{제목}_개정N.pdf" (fire_plans 매핑)
  const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim()

  const customerName = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('customers').select('id, customer_name').range(from, from + 999)
    const rows = (data ?? []) as Array<{ id: string; customer_name: string }>
    rows.forEach(r => customerName.set(r.id, sanitize(r.customer_name)))
    if (rows.length < 1000) break
  }

  const planFileName = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('fire_plans')
      .select('year, title, revision, pdf_path, pdf_name, hwp_path, hwp_name').range(from, from + 999)
    const rows = (data ?? []) as Array<{ year: number; title: string | null; revision: number | null; pdf_path: string; pdf_name: string; hwp_path: string | null; hwp_name: string | null }>
    for (const p of rows) {
      const base = sanitize(p.title ?? `${p.year}년 소방계획서`) + (p.revision && p.revision > 1 ? `_개정${p.revision}` : '')
      planFileName.set(p.pdf_path, `${base}.pdf`)
      if (p.hwp_path) planFileName.set(p.hwp_path, `${base}.hwp`)
    }
    if (rows.length < 1000) break
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  function drivePathOf(bucket: string, path: string): { segments: string[]; fileName: string } {
    const segments = path.split('/')
    let fileName = segments.pop()!
    const mapped = segments.map(seg =>
      UUID_RE.test(seg) ? (customerName.get(seg) ?? seg) : seg)
    if (bucket === 'fire-plans') fileName = planFileName.get(path) ?? fileName
    return { segments: mapped, fileName }
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
      const { segments, fileName } = drivePathOf(bucket, path)
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
