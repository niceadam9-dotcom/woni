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

  // 전월 항목 복사 (담당직원·고객·유형 유지, 날짜는 null)
  let itemCount = 0
  if (refPlanId) {
    const { data: refItems } = await admin
      .from('inspection_plan_items')
      .select('customer_id, inspection_type, sequence_num, assigned_employee_id, contact_id')
      .eq('plan_id', refPlanId)
      .neq('status', 'cancelled')

    if (refItems && refItems.length > 0) {
      const newItems = refItems.map((item) => ({
        plan_id: newPlanId,
        customer_id: (item as Record<string, unknown>).customer_id,
        inspection_type: (item as Record<string, unknown>).inspection_type,
        sequence_num: (item as Record<string, unknown>).sequence_num,
        assigned_employee_id: (item as Record<string, unknown>).assigned_employee_id,
        contact_id: (item as Record<string, unknown>).contact_id,
        scheduled_date: null,
        status: 'planned',
      }))

      const { error: itemsErr } = await admin
        .from('inspection_plan_items')
        .insert(newItems as Record<string, unknown>[])

      if (!itemsErr) itemCount = newItems.length
    }
  }

  revalidatePath('/inspection-plans')
  return { planId: newPlanId, itemCount }
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
