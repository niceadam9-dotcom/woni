import { redirect, notFound } from 'next/navigation'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSheetOverviews } from '@/lib/sheet-overview'
import { pickAutoOpenSheet } from '@/lib/inspection-step-links'
import { sheetMatchesFacilities } from '@/lib/sheet-facility-map'
import { SheetEntryClient } from '@/components/inspections/sheet-entry-client'
import { facilityVerifyState } from '@/lib/facility-verify-gate'
import { findPrevRoundSource } from '@/lib/prev-round-source'

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
 *    ?from=/customers/…     뒤로가기 복귀 경로 — 진입점이 여럿이라(소방계획서 1.4·별지 트리·점검 상세)
 *                           고정 목적지로는 소방계획서에서 온 사용자가 점검 상세로 떨어진다.
 *                           내부 경로만 허용('/' 시작·'//' 금지 — open redirect 차단), 아니면 버린다.
 */
export default async function SheetEntryPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ sheet?: string; facility?: string; group?: string; month?: string; from?: string }>
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

  const fromRaw = sp.from?.trim() ?? ''
  const backHref = fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : null

  /** 지난 회차 불러오기 제안(2026-09-07) — 새 회차는 항상 빈 상태로 시작한다(자동 승계 없음:
   *  점검 없이 작성된 값이 기본값이 되면 허위 기재를 조장한다, 소방계획서_20 §6-6). 그래서
   *  반복 입력을 줄이는 길이 [지난 회차 결과 불러오기]인데 **버튼을 모르면 605항목을 처음부터 찍는다**.
   *  아직 한 칸도 안 채운 회차에서만 출처를 조회해 배너로 알린다 —
   *  · 조회 조건을 responded===0으로 묶어 입력 중 회차는 왕복 0회(비용이 붙지 않는다)
   *  · 판정은 복사 액션과 같은 findPrevRoundSource — 권해놓고 실패하는 배너가 될 수 없다
   *  · responseCount 0(회차는 있으나 응답이 없는 껍데기)이면 배너 없음 */
  const prevSrc = overview.canEdit && overview.totals.responded === 0
    ? await findPrevRoundSource(admin, id)
    : null
  const prevRoundLabel = prevSrc && prevSrc.responseCount > 0 ? prevSrc.label : null

  /** 1.4 소방시설 확인 여부(소방계획서_49 §6) — 관문은 **경고만**이다(2026-09-11 사용자 확정).
   *  막지 않는 이유: 점검표는 현장에서 쓰고 1.4는 사무실에서 정리하는 성격이라, 막으면
   *  그 자리에서 할 수 없는 일을 요구받는다. 대신 ① 알리고 ② 대장이 응답을 따라잡고
   *  ③ 완료를 보류한다(세 층).
   *  ⚠ 판정식은 `lib/facility-verify-gate` 단일 원천 — 완료 보류와 **같은 술어**를 써야
   *    「배너는 떴는데 완료는 됐다」가 안 생긴다. */
  const { data: bldRaw } = await admin.from('buildings')
    .select('id, facilities_verified_at').eq('customer_id', insp.customer_id).eq('is_active', true)
  const bldRows = (bldRaw ?? []) as Array<{ id: string; facilities_verified_at: string | null }>
  const facilityVerify = {
    ...facilityVerifyState(bldRows),
    // 「확인만 하기」가 쓸 대상 — 1동일 때만 한 번에 끝낼 수 있다(다동은 각 동을 1.4에서 확인)
    soleBuildingId: bldRows.length === 1 ? bldRows[0].id : null,
    customerId: insp.customer_id,
  }

  return (
    <SheetEntryClient
      facilityVerify={facilityVerify}
      inspectionId={id}
      customerName={insp.customers?.customer_name ?? '—'}
      roundLabel={`${insp.year}년 ${insp.sequence_num}차`}
      overview={overview}
      canEdit={overview.canEdit}
      initialSheetId={initialSheetId}
      initialGroupCode={sp.group?.trim() || null}
      initialMonth={initialMonth}
      backHref={backHref}
      prevRoundLabel={prevRoundLabel}
      loadError={error ?? null}
    />
  )
}
