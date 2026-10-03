import { NextResponse, type NextRequest } from 'next/server'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { convertHtmlToPdf } from '@/lib/pdf'
import { siteOrigin } from '@/lib/share-links'
import { renderLabelSheetHtml, LABELS_PER_REQUEST, type LabelItem } from '@/lib/equipment-tag'
import type { EquipmentCategory } from '@/lib/equipment-lifespan'

/** 설비 QR 라벨 (통합계획 C3 3단계 = 설비 QR 절 1단계, 2026-10-03)
 *
 *  A4 라벨지 격자 PDF. 라우트 핸들러 = 공개 엔드포인트라 세션·권한을 여기서 직접 검사한다(fire-plan/pdf와 같은 거울).
 *  Gotenberg가 동기 변환이라 서버 액션에 태우지 않는다. 1요청 상한 240장(A4 10매).
 *   ?ids=a,b,…   그 행만(1장 재발행 포함). 없으면 이 고객의 코드 있는 사용 중 개체 전부
 *   ?format=html  변환 없이 HTML 그대로(미리보기·시험 — tag_printed_at을 찍지 않는다)
 *  PDF를 내보낸 행은 tag_printed_at = now (재발행 이력). 코드는 발급하지 않는다 — 발급은 대장 패널의 액션이 한다. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'customer_manage')) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })
  const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (ids.some(x => !/^[0-9a-f-]{36}$/i.test(x))) return NextResponse.json({ error: '잘못된 행 id가 있습니다.' }, { status: 400 })
  const asHtml = req.nextUrl.searchParams.get('format') === 'html'

  const admin = createAdminClient()
  let q = admin.from('equipment_assets').select('id, tag_code, category, location, sub_type, manufactured_on, building_id')
    .eq('customer_id', id).eq('status', 'in_use').not('tag_code', 'is', null)
  if (ids.length) q = q.in('id', ids)
  const { data, error } = await q.order('location', { nullsFirst: false }).order('tag_code')
  if (error) return NextResponse.json({ error: '대장을 읽지 못했습니다.' }, { status: 500 })
  const rows = (data ?? []) as Array<{ id: string; tag_code: string; category: EquipmentCategory; location: string | null; sub_type: string | null; manufactured_on: string | null; building_id: string | null }>
  if (rows.length === 0) return NextResponse.json({ error: 'QR 코드가 발급된 설비가 없습니다 — 설비 대장에서 [QR 코드 발급]을 먼저 누르세요.' }, { status: 404 })
  if (rows.length > LABELS_PER_REQUEST) return NextResponse.json({ error: `한 번에 ${LABELS_PER_REQUEST}장까지 인쇄합니다 — 행을 골라 나눠 주세요.` }, { status: 413 })

  const bIds = [...new Set(rows.map(r => r.building_id).filter((v): v is string => !!v))]
  const { data: bs } = bIds.length ? await admin.from('buildings').select('id, building_name').in('id', bIds) : { data: [] }
  const bName = new Map(((bs ?? []) as Array<{ id: string; building_name: string }>).map(b => [b.id, b.building_name]))
  const items: LabelItem[] = rows.map(r => ({
    tagCode: r.tag_code, category: r.category, location: r.location, subType: r.sub_type,
    buildingName: r.building_id ? bName.get(r.building_id) ?? null : null, manufacturedOn: r.manufactured_on,
  }))
  const html = await renderLabelSheetHtml(items, siteOrigin(req.headers))
  if (asHtml) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

  try {
    const pdf = await convertHtmlToPdf(html, [], { marginMode: 'none', timeoutMs: 120_000 })
    const { error: upErr } = await admin.from('equipment_assets').update({ tag_printed_at: new Date().toISOString() }).in('id', rows.map(r => r.id))
    if (upErr) console.error('[equipment-labels] tag_printed_at 기록 실패(PDF는 나감):', upErr.message)
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="equipment-labels.pdf"; filename*=UTF-8''${encodeURIComponent(`설비QR라벨_${rows.length}장.pdf`)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
