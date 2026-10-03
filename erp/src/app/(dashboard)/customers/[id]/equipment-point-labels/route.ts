import { NextResponse, type NextRequest } from 'next/server'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { convertHtmlToPdf } from '@/lib/pdf'
import { siteOrigin } from '@/lib/share-links'
import { renderLabelSheetHtml, LABELS_PER_REQUEST, type LabelItem } from '@/lib/equipment-tag'

/** 지점(책갈피) QR 라벨 (통합 실행계획 C4 — QR 절 3단계, 2026-10-03)
 *
 *  equipment-labels(개체)와 같은 거울: 세션·권한 직접 검사·240장 상한·?ids= 재인쇄·?format=html.
 *  지점은 코드가 생성 때 발급되므로 tag_printed_at 같은 기록 열이 없다 — 재인쇄 이력은 두지 않는다. */
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
  let q = admin.from('equipment_points').select('id, tag_code, label, floor, room, building_id')
    .eq('customer_id', id).not('tag_code', 'is', null)
  if (ids.length) q = q.in('id', ids)
  const { data, error } = await q.order('sort_order').order('label')
  if (error) return NextResponse.json({ error: '지점을 읽지 못했습니다.' }, { status: 500 })
  const rows = (data ?? []) as Array<{ id: string; tag_code: string; label: string; floor: string | null; room: string | null; building_id: string | null }>
  if (rows.length === 0) return NextResponse.json({ error: '라벨로 만들 지점이 없습니다 — [공통] 1.4 지점 QR에서 먼저 추가하세요.' }, { status: 404 })
  if (rows.length > LABELS_PER_REQUEST) return NextResponse.json({ error: `한 번에 ${LABELS_PER_REQUEST}장까지 인쇄합니다 — 행을 골라 나눠 주세요.` }, { status: 413 })

  const bIds = [...new Set(rows.map(r => r.building_id).filter((v): v is string => !!v))]
  const { data: bs } = bIds.length ? await admin.from('buildings').select('id, building_name').in('id', bIds) : { data: [] }
  const bName = new Map(((bs ?? []) as Array<{ id: string; building_name: string }>).map(b => [b.id, b.building_name]))
  const items: LabelItem[] = rows.map(r => ({
    tagCode: r.tag_code, category: null, kindLabel: r.label, subType: null,
    location: [r.floor && `${r.floor}층`, r.room].filter(Boolean).join(' ') || null,
    buildingName: r.building_id ? bName.get(r.building_id) ?? null : null, manufacturedOn: null,
  }))
  const html = await renderLabelSheetHtml(items, siteOrigin(req.headers), { title: '지점 QR 라벨' })
  if (asHtml) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

  try {
    const pdf = await convertHtmlToPdf(html, [], { marginMode: 'none', timeoutMs: 120_000 })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="point-labels.pdf"; filename*=UTF-8''${encodeURIComponent(`지점QR라벨_${rows.length}장.pdf`)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
