'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { startInspectionCore, syncInspectionStepDates, syncInspectionVisitDate, isStepOneCompleted } from '@/lib/inspection-start'

// ── 점검일 적용·이동 액션 (구 inspection-plans/actions.ts에서 이관, 2026-09-12) ──
//
// 점검확정 화면 폐지 때 그 화면 전용 액션들과 함께 죽지 않도록 여기로 옮겼다 —
// 이 두 함수는 화면이 아니라 **날짜 규칙의 정본**이다:
//  · confirmPlanItemStageOneAction — 점검일을 바꾸는 유일한 통로. 1~6단계 마감일 계산,
//    inspection_steps.due_date·inspections.inspection_start_date 동기화, 자체점검 자동 시작까지
//    한 함수가 묶는다. 호출부: 별지 회차 카드 [작성 시작](plan-annex-section), 문자 화면
//    일괄 이동(sms-actions bulkMovePlanDatesAction), 점검 달력 드래그(moveMonthlyPlanItemAction 경유).
//  · moveMonthlyPlanItemAction — 정기(monthly) 전용 「같은 달 안에서만」 규칙. 호출부:
//    점검 달력 드래그(inspection-calendar-client), 문자 화면 일괄 이동.
//
// 이름의 「confirm」은 확정 절차가 있던 시절의 흔적이다 — 지금 확정은 생성 시 자동이고
// (inspection-plan-generator), 이 함수는 「이미 확정된 날짜를 옮기는」 재확정 경로로만 쓰인다.
// 이름을 바꾸면 소비처·검사·로그 문구가 한꺼번에 움직여야 해서 유지한다.

/** 점검일 적용(재확정) — 날짜 저장 + 1~6단계 마감일 재계산 + 점검 동기화.
 *  정기(monthly)·레거시 event는 6단계 없이 확정일만 저장 — 법정 6단계는 자체점검(special_*) 전용.
 *  일반관리 자체점검도 6단계 대상 (소방계획서_6 W-10) */
export async function confirmPlanItemStageOneAction(
  planItemId: string,
  confirmedDate: string,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  const { data: itemInfoRaw } = await admin
    .from('inspection_plan_items')
    .select('plan_type, inspection_type, inspection_id, inspection_plans!inner(year, month)')
    .eq('id', planItemId)
    .single()
  const itemInfo = itemInfoRaw as unknown as {
    plan_type: string | null; inspection_type: string; inspection_id: string | null
    inspection_plans: { year: number; month: number }
  } | null
  if (!itemInfo) return { error: '계획 항목을 찾을 수 없습니다.' }

  // 1단계 완료 후 날짜 변경 금지 — 종전에는 updatePlanItemAction에만 있어서
  // 인라인 달력(canManage만 검사)이 우회했다. 확정 함수가 막아야 전 경로가 막힌다 (S12-3)
  if (itemInfo.inspection_id && await isStepOneCompleted(admin, itemInfo.inspection_id)) {
    return { error: '이미 점검일(1단계)이 완료된 점검입니다 — 날짜는 점검 상세에서 변경해주세요.' }
  }

  // 정기(monthly)는 **그 달 안에서만** 옮긴다 — 월 단위 의무라 다른 달로 넘기면 그 달이 비고
  // 옮겨간 달은 2회가 된다. 종전엔 이 가드가 moveMonthlyPlanItemAction에만 있어서
  // **지역 일괄 이동(bulkMovePlanDatesAction)이 우회**했다(S11-9 E2E가 잡아냄 — moved:2, failed:[]).
  // 1단계 가드를 S12-3에서 여기로 옮긴 것과 같은 이유로, 확정 함수가 막아야 전 경로가 막힌다.
  if (itemInfo.plan_type === 'monthly') {
    const { year, month } = itemInfo.inspection_plans
    if (!confirmedDate.startsWith(`${year}-${String(month).padStart(2, '0')}-`)) {
      return { error: '같은 달 안에서만 이동할 수 있습니다.' }
    }
  }

  const isEvent = itemInfo.plan_type === 'event' || itemInfo.plan_type === 'monthly'
  if (isEvent) {
    const { error } = await admin
      .from('inspection_plan_items')
      .update({ scheduled_date: confirmedDate, status: 'confirmed' } as Record<string, unknown>)
      .eq('id', planItemId)
    if (error) return { error: error.message }
    // 정기도 당일 크론으로 점검이 시작되면 inspections를 갖는다 — 이동 시 함께 민다
    if (itemInfo.inspection_id) await syncInspectionVisitDate(admin, itemInfo.inspection_id, confirmedDate)
    revalidatePath('/inspections/sms')
    revalidatePath('/inspections')
    revalidatePath('/inspections/calendar')
    revalidatePath('/customers')
    return {}
  }

  // 공휴일 조회 — 확정일 기준 ±7개월 범위
  // 주의: 종료일을 '-31' 하드코딩하면 2·4·6·9·11월에서 무효 날짜(예: 2027-02-31)가 되어
  //       쿼리가 실패하고 공휴일이 전부 무시됐음 (실증: 2026-07-09, 제헌절 미제외) — 말일을 정확히 계산
  const base  = new Date(confirmedDate)
  const rangeStart = new Date(base); rangeStart.setMonth(rangeStart.getMonth() - 1)
  const rangeEnd   = new Date(base); rangeEnd.setMonth(rangeEnd.getMonth() + 7)
  const startStr = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth()+1).padStart(2,'0')}-01`
  const rangeEndLast = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 0)
  const endStr = `${rangeEndLast.getFullYear()}-${String(rangeEndLast.getMonth()+1).padStart(2,'0')}-${String(rangeEndLast.getDate()).padStart(2,'0')}`

  const { data: holidayData, error: holidayErr } = await admin
    .from('holidays').select('date')
    .gte('date', startStr).lte('date', endStr)
  // 공휴일 없이 계산하면 마감일이 조용히 틀어지므로 조회 실패는 명시적으로 중단
  if (holidayErr) return { error: '공휴일 조회에 실패했습니다. 잠시 후 다시 시도해주세요.' }
  const holidaySet = new Set((holidayData ?? []).map(h => (h as Record<string, unknown>).date as string))

  function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  function addWorkingDays(from: Date, n: number): string {
    const d = new Date(from)
    let count = 0
    while (count < n) {
      d.setDate(d.getDate() + 1)
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6 && !holidaySet.has(toDateStr(d))) count++
    }
    return toDateStr(d)
  }

  const step1 = confirmedDate
  const step2 = addWorkingDays(new Date(step1), 5)
  const step3 = addWorkingDays(new Date(step1), 10)
  const step4 = addWorkingDays(new Date(step1), 15)
  // step5: step4 당일을 1일째로 포함한 절대일 10일째 (= +9일, 주말·공휴일 포함)
  // 2026-07-09 사용자 확정: step4 08-18 → step5 08-27. DB 트리거·recalc도 050에서 동일 규칙으로 통일
  const step4Date = new Date(step4); step4Date.setDate(step4Date.getDate() + 9)
  const step5 = toDateStr(step4Date)
  const step6 = addWorkingDays(new Date(step5), 10)

  const { error } = await admin
    .from('inspection_plan_items')
    .update({
      scheduled_date: confirmedDate,
      status: 'confirmed',
      step1_date: step1,
      step2_date: step2,
      step3_date: step3,
      step4_date: step4,
      step5_date: step5,
      step6_date: step6,
    } as Record<string, unknown>)
    .eq('id', planItemId)

  if (error) return { error: error.message }

  // 이미 점검이 시작된 항목이면 업무체크리스트(inspection_steps) 마감일도 재확정일 기준으로 갱신
  if (itemInfo.inspection_id) {
    await syncInspectionStepDates(admin, itemInfo.inspection_id, [step1, step2, step3, step4, step5, step6])
    // 방문일 자체도 함께 — 별지 9호 점검기간·작업대 기간 카드의 원천 (S12-1 / P-19)
    await syncInspectionVisitDate(admin, itemInfo.inspection_id, confirmedDate)
  }

  revalidatePath('/inspections/sms')
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')

  // 점검일 입력(재확정) = 점검 시작과 동일 효과 (2026-07-23 사용자 확정) —
  // 자체점검(special_* — 일반관리 포함)은 날짜 적용 즉시 inspections 자동 생성 → 점검달력·점검 업무·보고서 반영.
  // 정기(monthly)는 생성 시 자동 확정·당일 크론 시작 별도 경로 (event는 소방계획서_6로 폐지).
  if (!itemInfo.inspection_id) {
    const started = await startInspectionCore(admin, profile.id, planItemId)
    if (started.error) return { error: `점검일은 저장됐지만 점검 자동 시작에 실패했습니다: ${started.error}` }
  }
  return {}
}

// ── 정기점검 드래그 이동: 같은 달 내 재확정 ─────────────────────
/** 점검달력에서 정기(monthly) 칩 드래그 이동 시 호출 (2026-07-13 확정 설계)
 *  - 드롭 = 즉시 적용 (1~6단계 마감일 재계산)
 *  - 같은 달 안에서만, 횟수 제한 없이 반복 이동 가능
 *  - 특별·일반관리 항목, 점검 시작·완료·취소 항목은 거부 */
export async function moveMonthlyPlanItemAction(
  planItemId: string,
  newDate: string,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  const { data: raw } = await admin
    .from('inspection_plan_items')
    .select('plan_type, status, inspection_id, customer_id, scheduled_date, planned_date, inspection_plans!inner(year, month)')
    .eq('id', planItemId)
    .single()
  const item = raw as {
    plan_type: string | null; status: string; inspection_id: string | null
    customer_id: string; scheduled_date: string | null; planned_date: string | null
    inspection_plans: { year: number; month: number }
  } | null
  if (!item) return { error: '계획 항목을 찾을 수 없습니다.' }
  if (item.plan_type !== 'monthly') return { error: '정기점검 항목만 이동할 수 있습니다.' }
  if (item.inspection_id) return { error: '이미 점검이 시작된 항목은 이동할 수 없습니다.' }
  if (item.status !== 'planned' && item.status !== 'confirmed') return { error: '완료·취소된 항목은 이동할 수 없습니다.' }

  const { year, month } = item.inspection_plans
  if (!newDate.startsWith(`${year}-${String(month).padStart(2, '0')}-`)) {
    return { error: '같은 달 안에서만 이동할 수 있습니다.' }
  }

  const fromDate = item.scheduled_date ?? item.planned_date
  const res = await confirmPlanItemStageOneAction(planItemId, newDate)
  if (res.error) return res

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'plan_item_moved',
    entity_type: 'inspection_plan_item',
    entity_id: planItemId,
    metadata: { customer_id: item.customer_id, from: fromDate, to: newDate },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${item.customer_id}`)
  return {}
}
