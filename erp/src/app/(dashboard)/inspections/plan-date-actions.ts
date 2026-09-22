'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { startInspectionCore, syncInspectionStepDates, syncInspectionVisitDate, isStepOneCompleted } from '@/lib/inspection-start'
import { resolveStepDates } from '@/lib/plan-step-dates'
import { recalcStepDueDates } from '@/lib/inspection-step-sync'
import { dateChangeVerdict } from '@/lib/inspection-date-change'

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
    // 🚨 2026-09-22 — 종전 문구는 「날짜는 **점검 상세에서** 변경해주세요」였는데 **그런 경로가 없었다**.
    //   제품이 없는 곳을 가리켜, 실제 정정은 스크립트로 해 왔다(2026-09-20 「해오름 9/12→9/18」).
    //   이제 그 자리가 생겼다 → `changeInspectionDateAction`(점검달력 회차 패널 [점검일자 고치기]).
    return { error: '이미 점검일(1단계)이 완료된 점검입니다 — 점검달력에서 그 회차를 열고 [점검일자 고치기]로 변경해주세요.' }
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

  // 산식은 lib/plan-step-dates.ts가 정본이다 — 여기 인라인으로만 두면 `'use server'` 밖에서
  // 부를 수 없어(세션 없는 크론이 선다) 당일 자동 시작 경로가 같은 마감일을 만들지 못한다
  const { dates, error: stepErr } = await resolveStepDates(admin, confirmedDate)
  if (stepErr || !dates) return { error: stepErr ?? '공휴일 조회에 실패했습니다.' }
  const [step1, step2, step3, step4, step5, step6] = dates

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

// ── 시작된 점검의 점검일자 변경 (2026-09-22 사용자 요청 — 점검달력 한 바퀴) ──────────────
//
// 🚨 **이 경로는 여태 없었다.** 위 `confirmPlanItemStageOneAction`은 1단계가 완료되면 거부하면서
//   「날짜는 점검 상세에서 변경해주세요」라고 안내하는데, **점검 상세에 그런 경로가 없다**.
//   그래서 실제 정정은 스크립트로 해 왔다(2026-09-20 「해오름 9/12→9/18」). 그 안내가 가리키던
//   자리를 여기서 만든다 — 그리고 위 문구도 이 함수를 가리키도록 고친다.
//
// 산식은 **다시 짜지 않는다**: `resolveStepDates`(마감일) · `syncInspectionStepDates`(단계 반영) ·
// `syncInspectionVisitDate`(방문일·종료일 보정)를 그대로 쓴다. 재확정 경로와 같은 정본이라
// 「계획에서 옮긴 날짜」와 「점검에서 옮긴 날짜」가 다른 마감일을 낳지 않는다.

/** 변경 가부 + 재계산 미리보기 — 화면이 저장 전에 「무엇이 바뀌는지」를 보여주기 위한 조회 전용. */
export async function previewInspectionDateChangeAction(
  inspectionId: string,
  newDate: string,
): Promise<{
  error?: string
  allowed?: boolean
  reason?: string
  blockedBy?: number
  /** 1~6단계 현재 마감일 · 새 마감일 (표시 축이 아니라 **의무 축 전 단계**) */
  rows?: Array<{ stepNum: number; nameKo: string; from: string | null; to: string | null; done: boolean }>
}> {
  await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  const { data: stepsRaw } = await admin
    .from('inspection_steps')
    .select('step_num, name_ko, status, due_date')
    .eq('inspection_id', inspectionId)
    .order('step_num')
  const steps = (stepsRaw ?? []) as Array<{ step_num: number; name_ko: string; status: string; due_date: string | null }>

  const verdict = dateChangeVerdict(steps)
  if (!verdict.allowed) return { allowed: false, reason: verdict.reason, blockedBy: verdict.blockedBy }

  const { dates, error: stepErr } = await resolveStepDates(admin, newDate)
  if (stepErr || !dates) return { error: stepErr ?? '공휴일 조회에 실패했습니다.' }

  return {
    allowed: true,
    rows: steps.map(s => ({
      stepNum: s.step_num,
      nameKo: s.name_ko,
      from: s.due_date,
      to: dates[s.step_num - 1] ?? null,
      done: s.status === 'completed',
    })),
  }
}

/** 점검일자 변경 적용 — 1단계만 완료면 허용, 2단계 이상 완료면 거부(사용자 확정 2026-09-22).
 *
 *  ⚠ 완료된 1단계의 `completed_at`은 **건드리지 않는다**. 점검을 한 사실은 남는다 —
 *    우리가 고치는 것은 「언제 했다고 적었는가」이지 「했는가」가 아니다. */
export async function changeInspectionDateAction(
  inspectionId: string,
  newDate: string,
): Promise<{ error?: string; blockedBy?: number }> {
  await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { error: '날짜 형식이 올바르지 않습니다.' }

  // 🚨 판정은 **의무 축 전 단계**로 한다 — 표시 축(불량 0이면 ⑤⑥ 숨김)으로 세면
  //    숨겨진 단계의 완료를 못 보고 통과시킨다.
  const { data: stepsRaw } = await admin
    .from('inspection_steps')
    .select('step_num, name_ko, status')
    .eq('inspection_id', inspectionId)
  const steps = (stepsRaw ?? []) as Array<{ step_num: number; name_ko: string; status: string }>

  const verdict = dateChangeVerdict(steps)
  if (!verdict.allowed) return { error: verdict.reason, blockedBy: verdict.blockedBy }

  const { dates, error: stepErr } = await resolveStepDates(admin, newDate)
  if (stepErr || !dates) return { error: stepErr ?? '공휴일 조회에 실패했습니다.' }

  // 계획 항목도 같이 민다 — 달력의 계획 칩·문자 화면이 그 값을 읽으므로, 여기만 고치면
  // 「점검은 새 날짜, 계획은 옛 날짜」로 갈라진다(syncInspectionVisitDate가 생긴 것과 같은 이유).
  const { data: itemRaw } = await admin
    .from('inspection_plan_items')
    .select('id')
    .eq('inspection_id', inspectionId)
    .maybeSingle()
  const planItemId = (itemRaw as { id: string } | null)?.id
  if (planItemId) {
    const [s1, s2, s3, s4, s5, s6] = dates
    await admin.from('inspection_plan_items').update({
      scheduled_date: newDate,
      step1_date: s1, step2_date: s2, step3_date: s3, step4_date: s4, step5_date: s5, step6_date: s6,
    } as Record<string, unknown>).eq('id', planItemId)
  }

  /* 🚨 **마감일의 기준일은 「종료일이 있으면 종료일, 없으면 시작일」**이다(2026-09-22 실측으로 잡음).
     다일 점검은 `updateInspectionMultidayAction`이 **종료일 기준**으로 마감을 깔아 둔다
     (`recalcStepDueDates` — 32건 중 4건이 그 상태였다). 여기서 시작일 기준으로만 다시 깔면
     그 조정이 조용히 지워진다. 그래서 종료일을 **같은 일수만큼 함께 밀고**, 기준일도 종료일로 잡는다.
     ⚠ 재계산은 DB 정본(`recalc_inspection_steps`, p_include_completed=TRUE)을 쓴다 —
       완료 행을 건너뛰면 한 점검 안에서 단계마다 기준일이 갈린다. */
  const { data: curRaw } = await admin
    .from('inspections')
    .select('inspection_start_date, inspection_end_date')
    .eq('id', inspectionId)
    .single()
  const cur = curRaw as { inspection_start_date: string | null; inspection_end_date: string | null } | null
  const oldStart = cur?.inspection_start_date ?? null
  const oldEnd = cur?.inspection_end_date ?? null

  await syncInspectionVisitDate(admin, inspectionId, newDate)

  let baseDate = newDate
  if (oldEnd && oldStart) {
    // 일수를 보존한 채 종료일을 함께 민다 (종료일 - 시작일 간격 유지)
    const gap = Math.round(
      (Date.parse(`${oldEnd}T00:00:00Z`) - Date.parse(`${oldStart}T00:00:00Z`)) / 86_400_000)
    if (gap > 0) {
      const shifted = new Date(Date.parse(`${newDate}T00:00:00Z`) + gap * 86_400_000)
        .toISOString().slice(0, 10)
      await admin.from('inspections')
        .update({ inspection_end_date: shifted } as Record<string, unknown>).eq('id', inspectionId)
      baseDate = shifted
    }
  }

  if (baseDate !== newDate) {
    await recalcStepDueDates(admin, inspectionId, baseDate)
  } else {
    // 1일 점검 — 계획 항목에 깔아 둔 산식값(위 dates)과 같은 축으로 맞춘다
    await syncInspectionStepDates(admin, inspectionId, dates)
  }

  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspections/sms')
  return {}
}
