'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth'
import type { PlanStatus, PlanItemStatus, InspectionType } from '@/types'

// ── 점검 시작 — plan_item → inspections 생성 ────────────────
export async function startInspectionAction(
  itemId: string
): Promise<{ error?: string; inspectionId?: string }> {
  const profile = await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  // plan_item 조회
  const { data: itemRaw } = await admin
    .from('inspection_plan_items')
    .select('id, customer_id, inspection_type, sequence_num, scheduled_date, assigned_employee_id, contact_id, inspection_id, status')
    .eq('id', itemId)
    .single()

  const item = itemRaw as {
    id: string; customer_id: string; inspection_type: InspectionType
    sequence_num: 1 | 2; scheduled_date: string | null
    assigned_employee_id: string | null; contact_id: string | null
    inspection_id: string | null; status: string
  } | null

  if (!item) return { error: '계획 항목을 찾을 수 없습니다.' }
  if (item.inspection_id) return { error: '이미 점검이 시작된 항목입니다.' }
  if (!item.assigned_employee_id) return { error: '담당직원을 배정 후 점검을 시작해주세요.' }
  if (!item.scheduled_date) return { error: '점검 예정일을 입력 후 점검을 시작해주세요.' }

  // inspections 레코드 생성 (DB 트리거가 inspection_steps 6단계 자동 생성)
  const { data: inspRaw, error: inspErr } = await admin
    .from('inspections')
    .insert({
      customer_id:          item.customer_id,
      assigned_employee_id: item.assigned_employee_id,
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

  // plan_item에 inspection_id 연결, status → completed
  await admin
    .from('inspection_plan_items')
    .update({ inspection_id: inspectionId, status: 'completed' } as Record<string, unknown>)
    .eq('id', itemId)

  await admin.from('activity_logs').insert({
    actor_id:    profile.id,
    action:      'inspection_started',
    entity_type: 'inspection',
    entity_id:   inspectionId,
    metadata:    { plan_item_id: itemId, customer_id: item.customer_id },
  } as Record<string, unknown>)

  revalidatePath('/inspection-plans')
  revalidatePath('/inspections')
  return { inspectionId }
}

// ── 월간 계획 생성 ──────────────────────────────────────────
export async function createInspectionPlanAction(input: {
  year: number
  month: number
  notes?: string
}): Promise<{ error?: string; planId?: string }> {
  const profile = await requireRole(['manager', 'admin'])
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
  await requireRole(['manager', 'admin'])
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
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const patch: Record<string, unknown> = {}
  if (input.scheduledDate !== undefined)       patch.scheduled_date        = input.scheduledDate
  if (input.assignedEmployeeId !== undefined)  patch.assigned_employee_id  = input.assignedEmployeeId
  if (input.status !== undefined)              patch.status                = input.status
  if (input.notes !== undefined)               patch.notes                 = input.notes

  const { error } = await admin
    .from('inspection_plan_items')
    .update(patch)
    .eq('id', input.itemId)

  if (error) return { error: '항목 수정에 실패했습니다.' }
  revalidatePath('/inspection-plans')
  return {}
}

// ── 계획 항목 삭제 ───────────────────────────────────────────
export async function deletePlanItemAction(itemId: string): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
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
  await requireRole(['manager', 'admin'])
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
  const profile = await requireRole(['manager', 'admin'])
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

  // 전월 항목 복사 (사용승인일 기준 영업일 자동 계산)
  let itemCount = 0
  if (refPlanId) {
    const { data: refItems } = await admin
      .from('inspection_plan_items')
      .select('customer_id, inspection_type, sequence_num, assigned_employee_id, contact_id')
      .eq('plan_id', refPlanId)
      .neq('status', 'cancelled')

    if (refItems && refItems.length > 0) {
      // 고객 사용승인일 조회
      const customerIds = [...new Set(refItems.map(i => (i as Record<string, unknown>).customer_id as string))]
      const { data: custData } = await admin
        .from('customers').select('id, use_approval_date').in('id', customerIds)
      const custMap: Record<string, string | null> = {}
      for (const c of custData ?? []) {
        custMap[(c as Record<string, unknown>).id as string] = (c as Record<string, unknown>).use_approval_date as string | null
      }

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
        return _toDateStr(_nextWorkday(base))
      }

      const newItems = refItems.map((item) => {
        const custId = (item as Record<string, unknown>).customer_id as string
        const useApprovalDate = custMap[custId]
        return {
          plan_id: newPlanId,
          customer_id: custId,
          inspection_type: (item as Record<string, unknown>).inspection_type,
          sequence_num: (item as Record<string, unknown>).sequence_num,
          assigned_employee_id: (item as Record<string, unknown>).assigned_employee_id,
          contact_id: (item as Record<string, unknown>).contact_id,
          scheduled_date: useApprovalDate ? _calcDate(useApprovalDate) : null,
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

// ── 사용승인일 기반 점검 항목 제안 ──────────────────────────
export async function getSuggestedItemsAction(
  year: number,
  month: number,
  existingPlanId?: string | null,
): Promise<{
  suggestions: Array<{
    id: string; customer_name: string; customer_code: string
    inspection_type: InspectionType; use_approval_date: string
    assigned_employee_id: string | null; sequence_num: 1 | 2; reason: string
  }>
}> {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  // 2차 점검 월 = 사용승인일 월 + 6개월
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

  const { data: customers } = await admin
    .from('customers')
    .select('id, customer_name, customer_code, inspection_type, use_approval_date, assigned_employee_id')
    .eq('is_active', true)
    .not('use_approval_date', 'is', null)
    .order('customer_name')

  if (!customers) return { suggestions: [] }

  const suggestions: Array<{
    id: string; customer_name: string; customer_code: string
    inspection_type: InspectionType; use_approval_date: string
    assigned_employee_id: string | null; sequence_num: 1 | 2; reason: string
  }> = []

  for (const c of customers) {
    const approvalDate = new Date(c.use_approval_date as string)
    const approvalMonth = approvalDate.getMonth() + 1
    const dateLabel = `${approvalDate.getFullYear()}년 ${approvalMonth}월 ${approvalDate.getDate()}일`

    if (approvalMonth === month && !existingKeys.has(`${c.id}-1`)) {
      suggestions.push({
        id: c.id as string,
        customer_name: c.customer_name as string,
        customer_code: (c.customer_code ?? '') as string,
        inspection_type: c.inspection_type as InspectionType,
        use_approval_date: c.use_approval_date as string,
        assigned_employee_id: (c.assigned_employee_id ?? null) as string | null,
        sequence_num: 1,
        reason: `사용승인일 ${dateLabel} → 1차 점검`,
      })
    }

    if (approvalMonth === secondMonth && !existingKeys.has(`${c.id}-2`)) {
      suggestions.push({
        id: c.id as string,
        customer_name: c.customer_name as string,
        customer_code: (c.customer_code ?? '') as string,
        inspection_type: c.inspection_type as InspectionType,
        use_approval_date: c.use_approval_date as string,
        assigned_employee_id: (c.assigned_employee_id ?? null) as string | null,
        sequence_num: 2,
        reason: `사용승인일 ${dateLabel} → 2차 점검 (+6개월)`,
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
  const profile = await requireRole(['manager', 'admin'])
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
  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('inspection_plans')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .single()

  if (!plan) return { plan: null, items: [] }

  const { data: items } = await admin
    .from('inspection_plan_items')
    .select(`
      *,
      customers:customer_id ( customer_name, customer_code ),
      profiles:assigned_employee_id ( name )
    `)
    .eq('plan_id', (plan as { id: string }).id)
    .order('scheduled_date', { ascending: true, nullsFirst: false })

  return { plan, items: items ?? [] }
}
