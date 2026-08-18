import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { mergePdfs } from '@/lib/pdf'

/** 회차 별지 묶음 PDF (소방계획서_18 S1 — 종이 보관용 일괄 출력).
 *  이 회차에 생성돼 있는 별지 산출물(reportType별 최신 PDF)을 9호→4호→10호→11호→외관 순으로
 *  즉석 병합해 반환한다. 저장하지 않는다(D-4 — 저장하면 그 자체가 새 가비지).
 *
 *  `?types=report11` (쉼표 다중) = 개별·부분 인쇄 — 목록만 거르고 최신본 선별·순서·권한은
 *  전체 인쇄와 **같은 코드**를 탄다. 별도 인쇄 라우트를 두면 "전체는 최신인데 개별은 구본"처럼
 *  갈라지므로 필터 한 겹으로만 나눈다.
 *
 *  라우트 핸들러 = 공개 엔드포인트(소방계획서_17 교훈) — proxy 게이트와 별개로 여기서
 *  세션·권한(inspection_register, 문서 조회 액션과 동일 축)을 직접 검사한다. */

const BUCKET = 'fire-plans'
// 병합 순서(소방계획서_22 S7-3·S8) — 공문이 최선두(통상 공문이 문서 앞장), 위임장(제출용 행정 서류),
// 표지, 이어서 보고서(9호)·점검표(4호)·계획서(10호)·이행계획(11호)·외관. 앞장류 미생성 회차는 종전대로 본문부터.
const TYPE_ORDER = ['official', 'delegation', 'cover', 'report9', 'report4', 'report10', 'report11', 'exterior'] as const

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'inspection_register')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })

  // ?types= 필터 — 모르는 이름이 섞이면 조용히 버리지 않고 거부한다(오타로 엉뚱한 묶음이 나가는 것보다 낫다)
  const raw = req.nextUrl.searchParams.get('types')
  const want = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : null
  const bad = want?.filter(t => !(TYPE_ORDER as readonly string[]).includes(t)) ?? []
  if (bad.length > 0) {
    return NextResponse.json({ error: `알 수 없는 문서 종류: ${bad.join(', ')}` }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('id, customer_id').eq('id', id).maybeSingle()
  if (!insp) return NextResponse.json({ error: '점검 건을 찾을 수 없습니다.' }, { status: 404 })

  const prefix = `${(insp as { customer_id: string }).customer_id}/inspections/${id}`
  const { data: files, error: listErr } = await admin.storage.from(BUCKET)
    .list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  if (listErr) return NextResponse.json({ error: '산출물 목록 조회 실패' }, { status: 500 })

  // reportType별 최신 PDF 1개 — 파일명 규약 {reportType}_{timestamp}.pdf (타임스탬프 구본은 제외)
  const latest = new Map<string, string>()
  for (const f of files ?? []) {
    const m = /^([a-z0-9]+)_(\d+)\.pdf$/i.exec(f.name)
    if (!m) continue
    const cur = latest.get(m[1])
    if (!cur || cur < f.name) latest.set(m[1], f.name)
  }

  const ordered = TYPE_ORDER
    .filter(t => latest.has(t) && (!want || want.includes(t)))
    .map(t => `${prefix}/${latest.get(t)!}`)
  if (ordered.length === 0) {
    return NextResponse.json({
      error: want
        ? '이 문서는 아직 생성되지 않았습니다. 먼저 [생성]을 눌러 주세요.'
        : '이 회차에 생성된 별지 PDF가 없습니다. 먼저 문서를 생성해 주세요.',
    }, { status: 404 })
  }

  const pdfs: Uint8Array[] = []
  for (const path of ordered) {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(path)
    if (error || !blob) return NextResponse.json({ error: `파일 다운로드 실패: ${path}` }, { status: 500 })
    pdfs.push(new Uint8Array(await blob.arrayBuffer()))
  }

  try {
    const merged = await mergePdfs(pdfs)
    return new NextResponse(Buffer.from(merged), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent('자체점검 서류 일괄.pdf')}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
