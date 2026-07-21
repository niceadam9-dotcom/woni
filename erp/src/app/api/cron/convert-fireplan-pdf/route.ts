import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { convertOdtToPdf } from '@/lib/pdf'

// 소방계획서 PDF 후속 변환 (095 2단계 등록의 폴백) — 워커의 로컬 LibreOffice 변환이 실패했거나
// 워커가 변환 전에 중단된 계획서(pdf_status=converting, odt_path 보유)를 Gotenberg로 변환해 채운다.
// 트리거: 워커가 실패 시 즉시 호출 + 주기 크론(안전망). Authorization: Bearer {CRON_SECRET} 헤더 필수
// 수동 테스트: GET /api/cron/convert-fireplan-pdf

const BUCKET = 'fire-plans'
const BATCH = 5 // 1회 실행당 최대 변환 건수 (Gotenberg 타임아웃 여유)

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: rows } = await admin.from('fire_plans')
    .select('id, year, odt_path')
    .eq('pdf_status', 'converting')
    .not('odt_path', 'is', null)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const row of (rows ?? []) as Array<{ id: string; year: number; odt_path: string }>) {
    try {
      const { data: odt, error: dlErr } = await admin.storage.from(BUCKET).download(row.odt_path)
      if (dlErr || !odt) throw new Error(`ODT 다운로드 실패: ${dlErr?.message ?? '파일 없음'}`)
      const pdf = await convertOdtToPdf(new Uint8Array(await odt.arrayBuffer()))

      const pdfPath = row.odt_path.replace(/\.odt$/, '.pdf')
      const { error: upErr } = await admin.storage.from(BUCKET)
        .upload(pdfPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error(`PDF 업로드 실패: ${upErr.message}`)

      await admin.from('fire_plans').update({
        pdf_name: `${row.year}년 소방계획서(HWP양식).pdf`,
        pdf_path: pdfPath,
        pdf_status: 'ready',
        pdf_error: null,
        odt_path: null,
      } as Record<string, unknown>).eq('id', row.id)
      await admin.storage.from(BUCKET).remove([row.odt_path])
      results.push({ id: row.id, ok: true })
    } catch (e) {
      // 실패 기록만 남기고 converting 유지 — 다음 실행에서 재시도 (ODT 보존)
      await admin.from('fire_plans').update({
        pdf_error: (e as Error).message.slice(0, 300),
      } as Record<string, unknown>).eq('id', row.id)
      results.push({ id: row.id, ok: false, error: (e as Error).message.slice(0, 200) })
    }
  }

  return NextResponse.json({ converted: results.filter(r => r.ok).length, results })
}
