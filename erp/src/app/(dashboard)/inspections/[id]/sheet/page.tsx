import { redirect, notFound } from 'next/navigation'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSheetOverviews } from '@/lib/sheet-overview'
import { pickAutoOpenSheet } from '@/lib/inspection-step-links'
import { sheetMatchesFacilities } from '@/lib/sheet-facility-map'
import { SheetEntryClient } from '@/components/inspections/sheet-entry-client'

/** 점검표 입력 전용 화면 (소방계획서_28) — **입력의 정본**.
 *
 *  왜 만들었나: 같은 데이터를 입력하는 화면이 4개로 늘고 저장 규칙이 셋으로 갈리면서
 *  "어디서 채우나"가 사라졌다. 2026-08-24 승리주유소 별지 4호에서 물분무소화설비 결과칸이
 *  공란으로 인쇄됐는데(STD-06 응답 0건), 사용자가 채울 자리를 찾지 못한 것이 계기다.
 *  좌 목록이 **설치 설비와 진행률을 한 화면에 다 보여주는 것**이 이 페이지의 존재 이유다.
 *
 *  딥링크 계약 — 값이 이상하면 전부 조용히 무시하고 목록만 연다(링크가 썩어도 페이지는 열려야 한다):
 *    ?sheet=STD-06          시트 코드 (대소문자 무시)
 *    ?sheet=auto            첫 미완성 시트 — pickAutoOpenSheet 재사용(보드·스텝 링크와 같은 판정)
 *    ?facility=물분무소화설비  설비명 → sheetMatchesFacilities로 해석.
 *                           설비→시트 매핑을 링크 생성부에서 다시 하면 규칙이 두 벌이 되므로 여기서만 푼다.
 *    ?group=2-F             열린 시트 안 중분류로 점프
 *    ?month=7               외관(EX-4) 월 축 초기값 — 자체점검 건에서는 무시된다
 */
export default async function SheetEntryPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ sheet?: string; facility?: string; group?: string; month?: string }>
}) {
  const { id } = await params
  const sp = (await searchParams) ?? {}

  // 권한 게이트는 print-bundle/page.tsx와 같은 축 — 라우트 진입이라 throw가 아니라 redirect
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role as UserRole, 'inspection_register')) redirect('/dashboard')

  const admin = createAdminClient()
  const { data: inspRaw } = await admin.from('inspections')
    .select('id, year, sequence_num, customer_id, plan_type, customers:customer_id (customer_name)')
    .eq('id', id).maybeSingle()
  if (!inspRaw) notFound()
  const insp = inspRaw as unknown as {
    id: string; year: number; sequence_num: number; customer_id: string
    plan_type: string | null; customers: { customer_name: string } | null
  }

  // 진행률·설비 축 단일 원천 — 시트 카탈로그를 따로 조회하지 않는다(SheetProgress가 이미 다 들고 있다)
  const { overviews, error } = await buildSheetOverviews(
    admin, [id], { id: profile.id, role: profile.role as UserRole },
    { withGroups: true, withFacilityAxis: true },
  )
  const overview = overviews[id]
  if (!overview) notFound()

  // ── 딥링크 해석 (서버에서 — 목록이 이미 여기 있어 왕복 0회고 클라이언트 플래시가 없다) ──
  const shown = overview.sheets
  let initialSheetId: string | null = null
  const sheetParam = sp.sheet?.trim()
  if (sheetParam === 'auto') {
    initialSheetId = pickAutoOpenSheet(shown)?.sheetId ?? null
  } else if (sheetParam) {
    const want = sheetParam.toUpperCase()
    initialSheetId = shown.find(s => s.sheetCode.toUpperCase() === want)?.sheetId ?? null
  } else if (sp.facility?.trim()) {
    const code = sp.facility.trim()
    initialSheetId = shown.find(s => sheetMatchesFacilities(s.sheetName, [code]))?.sheetId ?? null
  }

  const monthRaw = Number(sp.month)
  const initialMonth = Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null

  return (
    <SheetEntryClient
      inspectionId={id}
      customerName={insp.customers?.customer_name ?? '—'}
      roundLabel={`${insp.year}년 ${insp.sequence_num}차`}
      overview={overview}
      canEdit={overview.canEdit}
      initialSheetId={initialSheetId}
      initialGroupCode={sp.group?.trim() || null}
      initialMonth={initialMonth}
      loadError={error ?? null}
    />
  )
}
