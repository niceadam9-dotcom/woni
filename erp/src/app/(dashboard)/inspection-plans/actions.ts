'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile } from '@/lib/auth'
import { loadAnchorDates } from '@/lib/inspection-plan-generator'
import { startInspectionCore, syncInspectionStepDates, syncInspectionVisitDate, isStepOneCompleted } from '@/lib/inspection-start'
import type { PlanStatus, PlanItemStatus, InspectionType } from '@/types'

// ── 점검 시작 — plan_item → inspections 생성 (코어는 src/lib/inspection-start.ts — 크론·자동 시작과 공용) ──
export async function startInspectionAction(
  itemId: string
): Promise<{ error?: string; inspectionId?: string }> {
  const profile = await requirePermission('inspection_plan_manage')
  return startInspectionCore(createAdminClient(), profile.id, itemId)
}

// ── 월간 계획 생성 ──────────────────────────────────────────
export async function createInspectionPlanAction(input: {
  year: number
  month: number
  notes?: string
}): Promise<{ error?: string; planId?: string }> {
  const profile = await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('inspection_plans')
    .select('id')
    .eq('year', input.year)
    .eq('month', input.month)
    .single()

  if (existing) return { error: `${input.year}년 ${input.month}월 계획이 이미 존재합니다.` }

  const { data, error } = await admin
    .from('inspection_plans')
    .insert({
      year: input.year,
      month: input.month,
      status: 'draft',
      auto_generated: false,
      notes: input.notes || null,
      created_by: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) {
    // UNIQUE 충돌 (동시 요청 등) → 이미 존재하는 계획 ID 반환
    if (error.code === '23505') {
      const { data: dup } = await admin
        .from('inspection_plans')
        .select('id')
        .eq('year', input.year)
        .eq('month', input.month)
        .single()
      if (dup) return { planId: (dup as { id: string }).id }
    }
    return { error: error.message || '계획 생성에 실패했습니다.' }
  }
  if (!data) return { error: '계획 생성에 실패했습니다.' }
  revalidatePath('/inspection-plans')
  return { planId: (data as { id: string }).id }
}

// ── 계획 항목 추가 (수동) ────────────────────────────────────
export async function addPlanItemAction(input: {
  planId: string
  customerId: string
  inspectionType: InspectionType
  sequenceNum: 1 | 2
  scheduledDate?: string
  assignedEmployeeId?: string
  contactId?: string
  notes?: string
}): Promise<{ error?: string; itemId?: string }> {
  await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  // 수동 추가도 자체점검(special_*) — 일반관리 포함 전 유형 공통 (소방계획서_6 W-10, event 특례 삭제).
  // 종류: 소방안전관리는 inspectionType에서, 일반관리는 고객 sub_type(110 백필로 항상 존재)에서 유도
  const { data: custSubRaw } = await admin.from('customers')
    .select('inspection_sub_type').eq('id', input.customerId).single()
  const custSub = (custSubRaw as { inspection_sub_type: string | null } | null)?.inspection_sub_type
  const subType: '종합' | '작동' = input.inspectionType === '종합' ? '종합'
    : input.inspectionType === '작동' ? '작동'
    : custSub === '종합' ? '종합' : '작동'

  const { data, error } = await admin
    .from('inspection_plan_items')
    .insert({
      plan_id: input.planId,
      customer_id: input.customerId,
      inspection_type: input.inspectionType,
      inspection_category: input.inspectionType === '일반관리' ? '일반관리' : '소방안전관리',
      inspection_sub_type: subType,
      sequence_num: input.sequenceNum,
      scheduled_date: input.scheduledDate || null,
      assigned_employee_id: input.assignedEmployeeId || null,
      contact_id: input.contactId || null,
      notes: input.notes || null,
      status: 'planned',
      // 유형 필터가 plan_type 기준이므로 반드시 저장
      plan_type: `special_${subType}`,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) {
    // UNIQUE 충돌 (plan_id, customer_id, sequence_num) → 기존 항목 ID 반환
    if (error.code === '23505') {
      const { data: dup } = await admin
        .from('inspection_plan_items')
        .select('id')
        .eq('plan_id', input.planId)
        .eq('customer_id', input.customerId)
        .eq('sequence_num', input.sequenceNum)
        .single()
      if (dup) return { itemId: (dup as { id: string }).id }
    }
    return { error: error.message || '항목 추가에 실패했습니다.' }
  }
  if (!data) return { error: '항목 추가에 실패했습니다.' }
  revalidatePath(`/inspection-plans`)
  revalidatePath(`/inspection-plans/${String(input.planId)}`)
  return { itemId: (data as { id: string }).id }
}

// ── 계획 항목 수정 ───────────────────────────────────────────
/** 계획 항목 수정 (패널 저장·목록 인라인) — 변경전파맵 1-6b
 *  - 예정일 변경/확정: 재확정 경로(confirmPlanItemStageOneAction)로 통일 —
 *    자동 확정 + 6단계 재계산 + (시작된 점검) 체크리스트 마감·시작일 동기화.
 *    1단계(점검일) 완료된 점검은 날짜 변경 불가 (사실 기록 — 점검 상세에서만)
 *  - 상태: 계획↔확정만. 완료는 점검 6단계 완료 시 자동(P-19), 취소는 전용 플로우
 *  - 담당직원은 여기서 수정 불가(2026-07-14 편집 제거) — 고객관리에서만 변경(1-2 전파)
 *  - 활동 로그 + 점검확정·모니터링·점검업무·점검달력 갱신 */
export async function updatePlanItemAction(input: {
  itemId: string
  scheduledDate?: string | null
  status?: PlanItemStatus
  notes?: string | null
}): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_plan_item_update')
  const admin = createAdminClient()

  // 완료·취소는 직접 변경 불가 — 실제 점검 상태와 어긋난 유령 완료/취소 방지
  if (input.status === 'completed' || input.status === 'cancelled') {
    return { error: '완료·취소 상태는 직접 변경할 수 없습니다. (완료는 점검 6단계 완료 시 자동 전환)' }
  }

  // 변경 감지·전파 판단용 현재 값 조회
  const { data: curRaw } = await admin
    .from('inspection_plan_items')
    .select('customer_id, scheduled_date, status, inspection_id')
    .eq('id', input.itemId)
    .single()
  const cur = curRaw as {
    customer_id: string; scheduled_date: string | null; status: PlanItemStatus
    inspection_id: string | null
  } | null
  if (!cur) return { error: '계획 항목을 찾을 수 없습니다.' }

  const dateChanged   = input.scheduledDate !== undefined && input.scheduledDate !== cur.scheduled_date
  const statusChanged = input.status !== undefined && input.status !== cur.status

  // 완료·취소 항목은 일정 변경 불가 (메모·담당 정리는 허용)
  if (dateChanged && (cur.status === 'completed' || cur.status === 'cancelled')) {
    return { error: '완료·취소된 항목은 예정일을 변경할 수 없습니다.' }
  }

  // 시작된 점검의 날짜 변경 가드 — 1단계(점검일) 완료 후는 사실 기록이라 계획에서 변경 불가
  if (cur.inspection_id && dateChanged) {
    if (input.scheduledDate === null) return { error: '점검이 시작된 항목은 점검일을 비울 수 없습니다.' }
    const { data: s1 } = await admin.from('inspection_steps')
      .select('status').eq('inspection_id', cur.inspection_id).eq('step_num', 1).single()
    if ((s1 as { status: string } | null)?.status === 'completed') {
      return { error: '이미 점검일(1단계)이 완료된 점검입니다 — 날짜는 점검 상세에서 변경해주세요.' }
    }
  }

  // ── 예정일 변경 또는 계획→확정: 재확정 경로로 통일 (자동 확정 + 6단계 재계산, 1-6과 동일)
  const wantConfirm = ((dateChanged && !!input.scheduledDate) && (cur.status === 'planned' || cur.status === 'confirmed'))
    || (input.status === 'confirmed' && cur.status === 'planned')
  if (wantConfirm) {
    const confirmDate = dateChanged ? input.scheduledDate! : cur.scheduled_date
    if (!confirmDate) return { error: '확정하려면 점검일을 입력해주세요.' }
    const res = await confirmPlanItemStageOneAction(input.itemId, confirmDate)
    if (res.error) return res
    // inspections.inspection_start_date 동기화는 confirmPlanItemStageOneAction 안으로 이관됐다
    // (소방계획서_24 S12-1 / P-19) — 여기서 또 갱신하면 경로별로 규칙이 갈라진다
  }

  // ── 확정 해제(확정→계획): 점검 미시작만, 6단계 일정 초기화 (예정일은 유지)
  const patch: Record<string, unknown> = {}
  if (!wantConfirm && input.status === 'planned' && cur.status === 'confirmed') {
    if (cur.inspection_id) return { error: '점검이 시작된 항목은 계획 상태로 되돌릴 수 없습니다.' }
    patch.status = 'planned'
    patch.step1_date = null; patch.step2_date = null; patch.step3_date = null
    patch.step4_date = null; patch.step5_date = null; patch.step6_date = null
  }
  // 날짜 비우기: 확정 상태·6단계 일정 초기화 (시작된 항목은 위에서 거부됨)
  if (input.scheduledDate === null && cur.scheduled_date !== null) {
    patch.scheduled_date = null
    patch.status = 'planned'
    patch.step1_date = null; patch.step2_date = null; patch.step3_date = null
    patch.step4_date = null; patch.step5_date = null; patch.step6_date = null
  }
  if (input.notes !== undefined)    patch.notes                = input.notes

  if (Object.keys(patch).length > 0) {
    const { error } = await admin
      .from('inspection_plan_items')
      .update(patch)
      .eq('id', input.itemId)
    if (error) return { error: '항목 수정에 실패했습니다.' }
  }

  // ── 활동 로그 (실변경만)
  if (dateChanged || statusChanged) {
    const changes: Array<{ field: string; old_value: string | null; new_value: string | null }> = []
    if (dateChanged)   changes.push({ field: 'scheduled_date', old_value: cur.scheduled_date, new_value: input.scheduledDate ?? null })
    if (statusChanged) changes.push({ field: 'status', old_value: cur.status, new_value: input.status ?? null })
    await admin.from('activity_logs').insert({
      actor_id: profile.id,
      action: 'plan_item_updated',
      entity_type: 'inspection_plan_item',
      entity_id: input.itemId,
      metadata: { customer_id: cur.customer_id, changes },
    } as Record<string, unknown>)
  }

  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/sms')
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  return {}
}

// ── 1단계 점검일 확정 + step1~6 자동계산 ─────────────────────
/** 점검일 확정의 **단일 경로** (소방계획서_24 S12-1 / P-19).
 *  호출처 5곳 — 점검확정 인라인 달력·슬라이드 패널(updatePlanItemAction)·달력 드래그
 *  (moveMonthlyPlanItemAction)·별지 회차 확정 모달·일괄 확정(bulkConfirmPlanItemsAction).
 *  네 축(plan_items.scheduled_date / step1~6_date / inspection_steps.due_date /
 *  inspections.inspection_start_date)을 **이 함수가 책임진다** — 호출처가 각자 갱신하면
 *  한 경로만 빠져도 서류 날짜가 갈라진다(P-19가 정확히 그 사고였다). */
export async function confirmPlanItemStageOneAction(
  planItemId: string,
  confirmedDate: string,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  // 정기(monthly)·레거시 event 항목은 6단계 없이 확정일만 저장 —
  // 법정 6단계는 자체점검(special_*) 전용. 일반관리 자체점검도 6단계 대상 (소방계획서_6 W-10)
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
  // MUTATION-TEST-TEMP: 가드 무력화
  if (false && itemInfo.inspection_id && await isStepOneCompleted(admin, itemInfo.inspection_id)) {
    return { error: '이미 점검일(1단계)이 완료된 점검입니다 — 날짜는 점검 상세에서 변경해주세요.' }
  }

  // 정기(monthly)는 **그 달 안에서만** 옮긴다 — 월 단위 의무라 다른 달로 넘기면 그 달이 비고
  // 옮겨간 달은 2회가 된다. 종전엔 이 가드가 moveMonthlyPlanItemAction에만 있어서
  // **지역 일괄 이동(bulkMovePlanDatesAction)이 우회**했다(S11-9 E2E가 잡아냄 — moved:2, failed:[]).
  // 1단계 가드를 S12-3에서 여기로 옮긴 것과 같은 이유로, 확정 함수가 막아야 전 경로가 막힌다.
  // 안전 확인(2026-08-19 실측): 이 가드에 걸릴 수 있는 'planned + 날짜 없는 정기'는 운영·스테이징 모두 0건 —
  // bulkConfirmPlanItemsAction의 `scheduled_date ?? today` 폴백이 정기에 발동하지 않는다.
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
    revalidatePath('/inspection-plans')
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

  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/sms')
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')

  // 점검일 입력(확정) = 점검 시작과 동일 효과 (2026-07-23 사용자 확정) —
  // 자체점검(special_* — 일반관리 포함)은 확정 즉시 inspections 자동 생성 → 점검달력·점검 업무·보고서 반영.
  // 정기(monthly)는 생성 시 자동 확정·당일 크론 시작 별도 경로 (event는 소방계획서_6로 폐지).
  if (!itemInfo.inspection_id) {
    const started = await startInspectionCore(admin, profile.id, planItemId)
    if (started.error) return { error: `점검일은 확정됐지만 점검 자동 시작에 실패했습니다: ${started.error}` }
  }
  return {}
}

// ── 정기점검 드래그 이동: 같은 달 내 재확정 ─────────────────────
/** 달력(점검확정·점검달력)에서 정기(monthly) 칩 드래그 이동 시 호출 (2026-07-13 확정 설계)
 *  - 드롭 = 즉시 확정 (planned도 confirmed로 전환, 1~6단계 마감일 재계산)
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

// ── 계획 항목 삭제 ───────────────────────────────────────────
export async function deletePlanItemAction(itemId: string): Promise<{ error?: string }> {
  await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()
  const { error } = await admin.from('inspection_plan_items').delete().eq('id', itemId)
  if (error) return { error: '항목 삭제에 실패했습니다.' }
  revalidatePath('/inspection-plans')
  return {}
}

// ── 계획 상태 변경 (draft→confirmed) ────────────────────────
export async function updatePlanStatusAction(
  planId: string,
  status: PlanStatus
): Promise<{ error?: string }> {
  await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  const patch: Record<string, unknown> = { status }
  if (status === 'confirmed') patch.confirmed_at = new Date().toISOString()

  const { error } = await admin
    .from('inspection_plans')
    .update(patch)
    .eq('id', planId)

  if (error) return { error: '상태 변경에 실패했습니다.' }
  revalidatePath('/inspection-plans')
  return {}
}

// ── 자동 생성: 전월 계획 기반 신규 계획 초안 생성 ───────────
export async function autoGeneratePlanAction(input: {
  year: number
  month: number
  refPlanId?: string
}): Promise<{ error?: string; planId?: string; itemCount?: number }> {
  const profile = await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  // 중복 확인
  const { data: existing } = await admin
    .from('inspection_plans')
    .select('id')
    .eq('year', input.year)
    .eq('month', input.month)
    .single()
  if (existing) return { error: `${input.year}년 ${input.month}월 계획이 이미 존재합니다.` }

  // 전월 계획 찾기 (refPlanId 없으면 자동 검색)
  let refPlanId = input.refPlanId
  if (!refPlanId) {
    const prevYear  = input.month === 1 ? input.year - 1 : input.year
    const prevMonth = input.month === 1 ? 12 : input.month - 1
    const { data: prev } = await admin
      .from('inspection_plans')
      .select('id')
      .eq('year', prevYear)
      .eq('month', prevMonth)
      .single()
    refPlanId = prev?.id ?? undefined
  }

  // 신규 계획 헤더 생성
  const { data: newPlan, error: planErr } = await admin
    .from('inspection_plans')
    .insert({
      year: input.year,
      month: input.month,
      status: 'draft',
      auto_generated: true,
      ref_plan_id: refPlanId || null,
      created_by: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (planErr) {
    if (planErr.code === '23505') {
      const { data: dup } = await admin
        .from('inspection_plans')
        .select('id')
        .eq('year', input.year)
        .eq('month', input.month)
        .single()
      if (dup) return { error: `${input.year}년 ${input.month}월 계획이 이미 존재합니다.` }
    }
    return { error: planErr.message || '계획 생성에 실패했습니다.' }
  }
  if (!newPlan) return { error: '계획 생성에 실패했습니다.' }
  const newPlanId = (newPlan as { id: string }).id

  // 전월 항목 복사 (기준일 기준 영업일 자동 계산)
  let itemCount = 0
  if (refPlanId) {
    const { data: refItemsRaw } = await admin
      .from('inspection_plan_items')
      .select('customer_id, inspection_type, sequence_num, assigned_employee_id, contact_id, plan_type')
      .eq('plan_id', refPlanId)
      .neq('status', 'cancelled')

    // 일반관리 event는 점검계획일 당일 1회성 — 다음 달로 복제하지 않음
    const refItems = (refItemsRaw ?? []).filter(
      i => (i as Record<string, unknown>).plan_type !== 'event'
    )

    if (refItems && refItems.length > 0) {
      // 고객 기준일 조회 (점검계획일 → 최초 점검시작일)
      const customerIds = [...new Set(refItems.map(i => (i as Record<string, unknown>).customer_id as string))]
      const { data: custData } = await admin
        .from('customers').select('id, plan_anchor_date').in('id', customerIds)
      const anchorMap = await loadAnchorDates(admin, (custData ?? []) as Array<{ id: string; plan_anchor_date: string | null }>)

      // 해당 월 공휴일 조회
      const monthStr = String(input.month).padStart(2, '0')
      const { data: holidayData } = await admin
        .from('holidays').select('date')
        .gte('date', `${input.year}-${monthStr}-01`)
        .lte('date', `${input.year}-${monthStr}-31`)
      const holidaySet = new Set((holidayData ?? []).map(h => (h as Record<string, unknown>).date as string))

      function _toDateStr(d: Date) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      }
      function _nextWorkday(base: Date): Date {
        const d = new Date(base)
        d.setDate(d.getDate() + 1)
        while (true) {
          const dow = d.getDay()
          if (dow !== 0 && dow !== 6 && !holidaySet.has(_toDateStr(d))) break
          d.setDate(d.getDate() + 1)
        }
        return d
      }
      function _calcDate(useApprovalDate: string): string {
        const approvalDay = new Date(useApprovalDate).getDate()
        const daysInMonth = new Date(input.year, input.month, 0).getDate()
        const base = new Date(input.year, input.month - 1, Math.min(approvalDay, daysInMonth))
        // 당일이 영업일이면 그대로, 주말/공휴일이면 다음 영업일
        const dow = base.getDay()
        if (dow === 0 || dow === 6 || holidaySet.has(_toDateStr(base))) {
          return _toDateStr(_nextWorkday(base))
        }
        return _toDateStr(base)
      }

      const newItems = refItems.map((item) => {
        const custId = (item as Record<string, unknown>).customer_id as string
        const useApprovalDate = anchorMap.get(custId)
        const planType = ((item as Record<string, unknown>).plan_type ?? null) as string | null
        const planned = useApprovalDate ? _calcDate(useApprovalDate) : null
        // 정기(monthly)는 자동 확정 (2026-07-14) — 특별점검만 관리자 확정 대기
        const autoConfirm = planType === 'monthly' && !!planned
        return {
          plan_id: newPlanId,
          customer_id: custId,
          inspection_type: (item as Record<string, unknown>).inspection_type,
          sequence_num: (item as Record<string, unknown>).sequence_num,
          assigned_employee_id: (item as Record<string, unknown>).assigned_employee_id,
          contact_id: (item as Record<string, unknown>).contact_id,
          plan_type: planType,
          planned_date: planned,
          scheduled_date: autoConfirm ? planned : null,
          status: autoConfirm ? 'confirmed' : 'planned',
        }
      })

      const { error: itemsErr } = await admin
        .from('inspection_plan_items')
        .insert(newItems as Record<string, unknown>[])

      if (!itemsErr) itemCount = newItems.length
    }
  }

  revalidatePath('/inspection-plans')
  return { planId: newPlanId, itemCount }
}

// ── 기준일(점검계획일→점검시작일) 기반 점검 항목 제안 ──────────
export async function getSuggestedItemsAction(
  year: number,
  month: number,
  existingPlanId?: string | null,
): Promise<{
  suggestions: Array<{
    id: string; customer_name: string; customer_code: string
    inspection_type: InspectionType; anchor_date: string
    assigned_employee_id: string | null; sequence_num: 1 | 2; reason: string
  }>
}> {
  await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  // 2차 점검 월 = 기준일 월 + 6개월
  const secondMonth = ((month - 1 + 6) % 12) + 1

  // 이미 이달 계획에 등록된 (customer_id, sequence_num) 쌍
  const existingKeys = new Set<string>()
  if (existingPlanId) {
    const { data: existing } = await admin
      .from('inspection_plan_items')
      .select('customer_id, sequence_num')
      .eq('plan_id', existingPlanId)
      .neq('status', 'cancelled')
    existing?.forEach(item =>
      existingKeys.add(`${(item as Record<string, unknown>).customer_id}-${(item as Record<string, unknown>).sequence_num}`)
    )
  }

  // 기준일: 점검계획일 → 최초 점검시작일 (사용승인일 폴백 제거).
  // 일반관리도 자체점검 제안 대상 (소방계획서_6 W-10 — 종류는 sub_type으로 판정)
  const { data: customers } = await admin
    .from('customers')
    .select('id, customer_name, customer_code, inspection_type, inspection_sub_type, plan_anchor_date, assigned_employee_id')
    .eq('is_active', true)
    .order('customer_name')

  if (!customers) return { suggestions: [] }

  const anchorMap = await loadAnchorDates(admin, customers as Array<{ id: string; plan_anchor_date: string | null }>)

  const suggestions: Array<{
    id: string; customer_name: string; customer_code: string
    inspection_type: InspectionType; anchor_date: string
    assigned_employee_id: string | null; sequence_num: 1 | 2; reason: string
  }> = []

  for (const c of customers) {
    const anchor = anchorMap.get(c.id as string)
    if (!anchor) continue
    // 종합 여부 = 소방안전관리는 inspection_type, 일반관리는 sub_type (W-10)
    const isComp = c.inspection_type === '종합' || (c as Record<string, unknown>).inspection_sub_type === '종합'
    const anchorLabel = anchor === (c as Record<string, unknown>).plan_anchor_date ? '점검계획일' : '점검시작일'
    const approvalDate = new Date(anchor)
    const approvalMonth = approvalDate.getMonth() + 1
    const dateLabel = `${approvalDate.getFullYear()}년 ${approvalMonth}월 ${approvalDate.getDate()}일`

    if (approvalMonth === month && !existingKeys.has(`${c.id}-1`)) {
      suggestions.push({
        id: c.id as string,
        customer_name: c.customer_name as string,
        customer_code: (c.customer_code ?? '') as string,
        inspection_type: c.inspection_type as InspectionType,
        anchor_date: anchor,
        assigned_employee_id: (c.assigned_employee_id ?? null) as string | null,
        sequence_num: 1,
        reason: `${anchorLabel} ${dateLabel} → ${isComp ? '1차 점검' : '연 1회 점검'}`,
      })
    }

    if (
      isComp &&
      approvalMonth === secondMonth &&
      !existingKeys.has(`${c.id}-2`)
    ) {
      suggestions.push({
        id: c.id as string,
        customer_name: c.customer_name as string,
        customer_code: (c.customer_code ?? '') as string,
        inspection_type: c.inspection_type as InspectionType,
        anchor_date: anchor,
        assigned_employee_id: (c.assigned_employee_id ?? null) as string | null,
        sequence_num: 2,
        reason: `${anchorLabel} ${dateLabel} → 2차 점검 (+6개월)`,
      })
    }
  }

  return { suggestions }
}

// ── 초과 점검 일괄 등록 (계획 자동 생성 + 항목 삽입) ──────────
export async function resolveOverdueItemsAction(
  year: number,
  items: Array<{
    customer_id: string
    sequence_num: 1 | 2
    due_month: number
    inspection_type: string
    assigned_employee_id: string | null
  }>
): Promise<{ results: Array<{ month: number; added: number; error?: string }> }> {
  const profile = await requirePermission('inspection_plan_manage')
  const admin   = createAdminClient()

  // 일반관리 고객의 자체점검 종류(sub_type) 일괄 조회 — plan_type special_* 유도용 (소방계획서_6 W-10)
  const custIds = [...new Set(items.map(i => i.customer_id))]
  const { data: subRaw } = custIds.length
    ? await admin.from('customers').select('id, inspection_sub_type').in('id', custIds)
    : { data: [] }
  const subById = new Map(((subRaw ?? []) as Array<{ id: string; inspection_sub_type: string | null }>)
    .map(c => [c.id, c.inspection_sub_type]))

  // 월별 그룹화
  const byMonth: Record<number, typeof items> = {}
  for (const item of items) {
    byMonth[item.due_month] = [...(byMonth[item.due_month] ?? []), item]
  }

  const results: Array<{ month: number; added: number; error?: string }> = []

  for (const monthStr of Object.keys(byMonth).sort()) {
    const month = Number(monthStr)
    const monthItems = byMonth[month]

    // 기존 계획 조회 또는 신규 생성
    let planId: string | null = null
    const { data: existing } = await admin
      .from('inspection_plans').select('id')
      .eq('year', year).eq('month', month).single()

    if (existing) {
      planId = (existing as { id: string }).id
    } else {
      const { data: newPlan, error: planErr } = await admin
        .from('inspection_plans')
        .insert({
          year, month, status: 'draft',
          auto_generated: false, notes: null,
          created_by: profile.id,
        } as Record<string, unknown>)
        .select('id').single()

      if (planErr || !newPlan) {
        // 동시 생성 충돌 시 재조회
        const { data: dup } = await admin
          .from('inspection_plans').select('id')
          .eq('year', year).eq('month', month).single()
        planId = dup ? (dup as { id: string }).id : null
      } else {
        planId = (newPlan as { id: string }).id
      }
    }

    if (!planId) { results.push({ month, added: 0, error: '계획 생성 실패' }); continue }

    // 항목 삽입 (UNIQUE 충돌은 이미 등록된 것으로 처리)
    let added = 0
    for (const item of monthItems) {
      // 초과 해결 항목도 자체점검(special_*) — 일반관리는 고객 sub_type으로 종류 유도 (W-10, event 특례 삭제)
      const subType: '종합' | '작동' = item.inspection_type === '종합' ? '종합'
        : item.inspection_type === '작동' ? '작동'
        : subById.get(item.customer_id) === '종합' ? '종합' : '작동'
      const { error } = await admin
        .from('inspection_plan_items')
        .insert({
          plan_id: planId,
          customer_id: item.customer_id,
          inspection_type: item.inspection_type,
          inspection_category: item.inspection_type === '일반관리' ? '일반관리' : '소방안전관리',
          inspection_sub_type: subType,
          sequence_num: item.sequence_num,
          assigned_employee_id: item.assigned_employee_id || null,
          status: 'planned',
          scheduled_date: null,
          plan_type: `special_${subType}`,
        } as Record<string, unknown>)
      if (!error || error.code === '23505') added++
    }

    revalidatePath('/inspection-plans')
    results.push({ month, added })
  }

  return { results }
}

// ── 월 계획 + 항목 조회 ──────────────────────────────────────
export async function getInspectionPlanWithItems(year: number, month: number) {
  const profile = await getProfile()
  if (!profile) return { plan: null, items: [] }

  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('inspection_plans')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .single()

  if (!plan) return { plan: null, items: [] }

  const query = admin
    .from('inspection_plan_items')
    .select(`
      *,
      customers:customer_id ( customer_name, customer_code, is_active ),
      profiles:assigned_employee_id ( name )
    `)
    .eq('plan_id', (plan as { id: string }).id)

  // B안(2026-07-08): 일반직원도 전체 계획 항목 조회
  const { data: items } = await query
    .order('scheduled_date', { ascending: true, nullsFirst: false })

  return { plan, items: items ?? [] }
}

// P-18: 슬라이드 패널에서 점검 단계 조회 (점검계획 + 점검업무 통합)
export async function getInspectionStepsForItemAction(inspectionId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('inspection_steps')
    .select('id, step_num, name_ko, due_date, status, completed_at')
    .eq('inspection_id', inspectionId)
    .order('step_num')
  return { steps: (data ?? []) as Array<{
    id: string; step_num: number; name_ko: string
    due_date: string | null; status: string; completed_at: string | null
  }> }
}

// ── 일괄 확정 ────────────────────────────────────────────────
/** 선택한 '계획' 항목을 한 번에 확정한다 (2026-08-13 사용자 확정).
 *
 *  종전에는 클라이언트가 항목마다 updatePlanItemAction을 부르고 **반환된 오류를 버렸다.**
 *  점검일이 없는 항목은 서버가 '확정하려면 점검일을 입력해주세요'로 거부하는데 화면은
 *  성공한 것처럼 선택을 풀고 새로고침만 해서, 확정을 눌러도 '계획 N건'이 그대로 남았다.
 *
 *  규칙: ① 점검일이 비었으면 오늘(한국 시간)로 채워 확정한다 ② 담당이 비었으면 확정한 직원을
 *  담당으로 배정한다(점검 [시작]과 같은 규칙 — lib/inspection-start.ts, 기존 담당은 건드리지 않는다)
 *  ③ 항목별 실패 사유를 돌려준다. */
export async function bulkConfirmPlanItemsAction(itemIds: string[]): Promise<{
  confirmed: number
  assigned: number
  failed: Array<{ name: string; reason: string }>
  error?: string
}> {
  const profile = await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  const ids = Array.isArray(itemIds) ? itemIds.filter(id => typeof id === 'string') : []
  if (ids.length === 0) return { confirmed: 0, assigned: 0, failed: [] }
  if (ids.length > 500) return { confirmed: 0, assigned: 0, failed: [], error: '한 번에 500건까지 확정할 수 있습니다.' }

  // 확정일 = 한국 시간 기준 오늘. 클라이언트 값을 믿지 않는다(시계·시간대가 제각각).
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

  const { data: rowsRaw } = await admin
    .from('inspection_plan_items')
    .select('id, scheduled_date, status, assigned_employee_id, customers:customer_id(customer_name)')
    .in('id', ids)
  const rows = (rowsRaw ?? []) as unknown as Array<{
    id: string; scheduled_date: string | null; status: string
    assigned_employee_id: string | null
    customers: { customer_name: string } | null
  }>

  const failed: Array<{ name: string; reason: string }> = []
  let confirmed = 0
  let assigned = 0

  for (const r of rows) {
    const name = r.customers?.customer_name ?? '(고객 미상)'
    if (r.status !== 'planned') { failed.push({ name, reason: `이미 ${r.status} 상태입니다` }); continue }

    // 담당 미배정이면 확정한 직원을 담당으로 — 확정 실패 시 되돌릴 수 있게 성공 여부를 따로 센다
    let justAssigned = false
    if (!r.assigned_employee_id) {
      const { error: aErr } = await admin.from('inspection_plan_items')
        .update({ assigned_employee_id: profile.id } as Record<string, unknown>)
        .eq('id', r.id)
      if (!aErr) justAssigned = true
    }

    const res = await confirmPlanItemStageOneAction(r.id, r.scheduled_date ?? today)
    if (res.error) { failed.push({ name, reason: res.error }); continue }
    confirmed++
    if (justAssigned) assigned++
  }

  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/sms')
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  return { confirmed, assigned, failed }
}
