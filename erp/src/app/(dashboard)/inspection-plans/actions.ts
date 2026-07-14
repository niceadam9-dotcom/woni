'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile } from '@/lib/auth'
import { loadAnchorDates } from '@/lib/inspection-plan-generator'
import type { PlanStatus, PlanItemStatus, InspectionType } from '@/types'

// ── 6단계 마감일 동기화: inspection_steps.due_date ← plan_item.step1~6_date ──
async function syncInspectionStepDates(
  admin: ReturnType<typeof createAdminClient>,
  inspectionId: string,
  stepDates: (string | null)[],
) {
  for (let i = 0; i < 6; i++) {
    if (!stepDates[i]) continue
    await admin
      .from('inspection_steps')
      .update({ due_date: stepDates[i] } as Record<string, unknown>)
      .eq('inspection_id', inspectionId)
      .eq('step_num', i + 1)
  }
}

// ── 점검 시작 — plan_item → inspections 생성 ────────────────
export async function startInspectionAction(
  itemId: string
): Promise<{ error?: string; inspectionId?: string }> {
  const profile = await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  // plan_item 조회
  const { data: itemRaw } = await admin
    .from('inspection_plan_items')
    .select('id, customer_id, inspection_type, sequence_num, scheduled_date, assigned_employee_id, contact_id, inspection_id, status, step1_date, step2_date, step3_date, step4_date, step5_date, step6_date')
    .eq('id', itemId)
    .single()

  const item = itemRaw as {
    id: string; customer_id: string; inspection_type: InspectionType
    sequence_num: 1 | 2; scheduled_date: string | null
    assigned_employee_id: string | null; contact_id: string | null
    inspection_id: string | null; status: string
    step1_date: string | null; step2_date: string | null; step3_date: string | null
    step4_date: string | null; step5_date: string | null; step6_date: string | null
  } | null

  if (!item) return { error: '계획 항목을 찾을 수 없습니다.' }
  if (item.inspection_id) return { error: '이미 점검이 시작된 항목입니다.' }
  if (!item.scheduled_date) return { error: '점검 예정일을 입력 후 점검을 시작해주세요.' }

  // 담당 미배정 항목은 점검을 시작한 직원을 담당으로 자동 배정 (모바일 점검시작과 동일 규칙)
  const autoAssigned = !item.assigned_employee_id
  const assigneeId = item.assigned_employee_id ?? profile.id

  // inspections 레코드 생성 (DB 트리거가 inspection_steps 6단계 자동 생성)
  const { data: inspRaw, error: inspErr } = await admin
    .from('inspections')
    .insert({
      customer_id:          item.customer_id,
      assigned_employee_id: assigneeId,
      contact_id:           item.contact_id,
      inspection_type:      item.inspection_type,
      sequence_num:         item.sequence_num,
      inspection_start_date: item.scheduled_date,
      status:               'in_progress',
      created_by:           profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (inspErr || !inspRaw) return { error: '점검 생성에 실패했습니다.' }
  const inspectionId = (inspRaw as { id: string }).id

  // plan_item에 inspection_id 연결, status → completed (자동 배정 시 담당도 함께 기록)
  await admin
    .from('inspection_plan_items')
    .update({
      inspection_id: inspectionId,
      status: 'completed',
      ...(autoAssigned ? { assigned_employee_id: assigneeId } : {}),
    } as Record<string, unknown>)
    .eq('id', itemId)

  // 6단계 마감일을 확정일 기준(plan_item.step1~6_date)으로 동기화 —
  // DB 트리거는 use_approval_date 기준으로 due_date를 생성하므로 확정일과 어긋남 (Victory9: 기준일 = 1단계 확정일)
  await syncInspectionStepDates(admin, inspectionId, [
    item.step1_date, item.step2_date, item.step3_date,
    item.step4_date, item.step5_date, item.step6_date,
  ])

  await admin.from('activity_logs').insert({
    actor_id:    profile.id,
    action:      'inspection_started',
    entity_type: 'inspection',
    entity_id:   inspectionId,
    metadata:    { plan_item_id: itemId, customer_id: item.customer_id, ...(autoAssigned ? { auto_assigned_to: assigneeId } : {}) },
  } as Record<string, unknown>)

  revalidatePath('/inspection-plans')
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspection-plans/monitor')
  return { inspectionId }
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

  const { data, error } = await admin
    .from('inspection_plan_items')
    .insert({
      plan_id: input.planId,
      customer_id: input.customerId,
      inspection_type: input.inspectionType,
      sequence_num: input.sequenceNum,
      scheduled_date: input.scheduledDate || null,
      assigned_employee_id: input.assignedEmployeeId || null,
      contact_id: input.contactId || null,
      notes: input.notes || null,
      status: 'planned',
      // 수동 추가는 특별점검(차수 지정) — 유형 필터가 plan_type 기준이므로 반드시 저장
      plan_type: input.inspectionType === '종합' ? 'special_종합'
        : input.inspectionType === '작동' ? 'special_작동'
        : 'event',
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
export async function updatePlanItemAction(input: {
  itemId: string
  scheduledDate?: string | null
  assignedEmployeeId?: string | null
  status?: PlanItemStatus
  notes?: string | null
}): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_plan_item_update')
  const admin = createAdminClient()
  // B안(2026-07-08): 일반직원도 전체 계획 항목 수정 가능 — 담당직원 변경만 매니저 이상
  const isEmployee = profile.role === 'employee'

  const patch: Record<string, unknown> = {}
  if (input.scheduledDate !== undefined)      patch.scheduled_date       = input.scheduledDate
  // 날짜 삭제 시 6단계 일정 및 확정 상태 초기화
  if (input.scheduledDate === null) {
    patch.status    = 'planned'
    patch.step1_date = null; patch.step2_date = null; patch.step3_date = null
    patch.step4_date = null; patch.step5_date = null; patch.step6_date = null
  }
  // 담당직원 변경은 관리자/매니저만
  if (!isEmployee && input.assignedEmployeeId !== undefined)
                                              patch.assigned_employee_id = input.assignedEmployeeId
  if (input.status !== undefined)             patch.status               = input.status
  if (input.notes !== undefined)              patch.notes                = input.notes

  const { error } = await admin
    .from('inspection_plan_items')
    .update(patch)
    .eq('id', input.itemId)

  if (error) return { error: '항목 수정에 실패했습니다.' }
  revalidatePath('/inspection-plans')
  return {}
}

// ── 1단계 점검일 확정 + step1~6 자동계산 ─────────────────────
export async function confirmPlanItemStageOneAction(
  planItemId: string,
  confirmedDate: string,
): Promise<{ error?: string }> {
  await requirePermission('inspection_plan_manage')
  const admin = createAdminClient()

  // 일반관리(이벤트) 항목은 6단계 없이 확정일만 저장 (V10 §6-C)
  const { data: itemInfoRaw } = await admin
    .from('inspection_plan_items')
    .select('plan_type, inspection_type, inspection_id')
    .eq('id', planItemId)
    .single()
  const itemInfo = itemInfoRaw as { plan_type: string | null; inspection_type: string; inspection_id: string | null } | null
  if (!itemInfo) return { error: '계획 항목을 찾을 수 없습니다.' }
  const isEvent = itemInfo.plan_type === 'event' || itemInfo.inspection_type === '일반관리'
  if (isEvent) {
    const { error } = await admin
      .from('inspection_plan_items')
      .update({ scheduled_date: confirmedDate, status: 'confirmed' } as Record<string, unknown>)
      .eq('id', planItemId)
    if (error) return { error: error.message }
    revalidatePath('/inspection-plans')
    revalidatePath('/inspection-plans/monitor')
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
  }

  revalidatePath('/inspection-plans')
  revalidatePath('/inspection-plans/monitor')
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
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
    const { data: refItems } = await admin
      .from('inspection_plan_items')
      .select('customer_id, inspection_type, sequence_num, assigned_employee_id, contact_id, plan_type')
      .eq('plan_id', refPlanId)
      .neq('status', 'cancelled')

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
        return {
          plan_id: newPlanId,
          customer_id: custId,
          inspection_type: (item as Record<string, unknown>).inspection_type,
          sequence_num: (item as Record<string, unknown>).sequence_num,
          assigned_employee_id: (item as Record<string, unknown>).assigned_employee_id,
          contact_id: (item as Record<string, unknown>).contact_id,
          plan_type: (item as Record<string, unknown>).plan_type ?? null,
          planned_date: useApprovalDate ? _calcDate(useApprovalDate) : null,
          scheduled_date: null,   // 관리자 점검일 확정 전까지 NULL
          status: 'planned',
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

  // 기준일: 점검계획일 → 최초 점검시작일 (사용승인일 폴백 제거)
  const { data: customers } = await admin
    .from('customers')
    .select('id, customer_name, customer_code, inspection_type, plan_anchor_date, assigned_employee_id')
    .eq('is_active', true)
    .neq('inspection_type', '일반관리')
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
        reason: `${anchorLabel} ${dateLabel} → ${c.inspection_type === '종합' ? '1차 점검' : '연 1회 점검'}`,
      })
    }

    if (
      c.inspection_type === '종합' &&
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
      const { error } = await admin
        .from('inspection_plan_items')
        .insert({
          plan_id: planId,
          customer_id: item.customer_id,
          inspection_type: item.inspection_type,
          sequence_num: item.sequence_num,
          assigned_employee_id: item.assigned_employee_id || null,
          status: 'planned',
          scheduled_date: null,
          // 초과 해결 항목은 점검계획일(기준일) 기준 특별점검
          plan_type: item.inspection_type === '종합' ? 'special_종합'
            : item.inspection_type === '작동' ? 'special_작동'
            : 'event',
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
