'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'
import { extractRegionFromAddress } from '@/lib/address-parser'
import type { ContactRole, InspectionType } from '@/types'

const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  customer_name: '고객명', inspection_type: '점검유형', contract_date: '계약일',
  use_approval_date: '사용승인일', address: '주소', assigned_employee_id: '담당직원',
}

export type ContactInput = {
  role: ContactRole
  name: string
  phone?: string
  email?: string
}

export type CreateCustomerInput = {
  customer_code: string
  customer_name: string
  contract_date: string
  use_approval_date?: string
  zipcode?: string
  region_si?: string
  region_myeon?: string
  region_ri?: string
  inspection_type: InspectionType
  address?: string
  notes?: string
  assigned_employee_id?: string
  contacts: ContactInput[]
  // 건물 기본정보 (V9-3)
  building_purpose?: string
  building_total_area?: number
  building_floors_above?: number
  building_floors_below?: number
  building_year_built?: number
  // 건축물대장 소방안전 자료 (migration 037/038)
  building_height?: number
  building_main_structure?: string
  building_elevator_count?: number
  building_households?: number
  building_emergency_elevator_count?: number
  building_roof_structure?: string
  building_etc_purpose?: string
  building_ho_count?: number
  building_attached_count?: number
  building_seismic_design?: string
}

/** 건물 숫자 필드 유효성 (IMP-10) — 음수·비상식 값 차단. 문제 시 에러 문구, 정상 시 null */
function validateBuildingNumbers(
  b: { total_area?: number; floors_above?: number; floors_below?: number; year_built?: number },
  nowYear: number,
): string | null {
  if (b.total_area != null && (isNaN(b.total_area) || b.total_area < 0))
    return '연면적은 0 이상의 숫자여야 합니다.'
  if (b.floors_above != null && (isNaN(b.floors_above) || b.floors_above < 0 || b.floors_above > 200))
    return '지상층수는 0~200 사이여야 합니다.'
  if (b.floors_below != null && (isNaN(b.floors_below) || b.floors_below < 0 || b.floors_below > 20))
    return '지하층수는 0~20 사이여야 합니다.'
  if (b.year_built != null && (isNaN(b.year_built) || b.year_built < 1900 || b.year_built > nowYear))
    return `준공연도는 1900~${nowYear} 사이여야 합니다.`
  return null
}

export async function createCustomerAction(
  input: CreateCustomerInput
): Promise<{ error?: string; customerId?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 대표 관계인 1명 필수 (V9 §9)
  const hasRep = (input.contacts ?? []).some(c => c.role === '대표' && c.name?.trim())
  if (!hasRep) return { error: '대표 관계인 이름을 입력해주세요. (대표 1명 필수)' }

  // 건물 숫자 필드 검증 (IMP-10) — 음수/비상식 값 차단
  const nowYear = new Date().getFullYear()
  const numErr = validateBuildingNumbers({
    total_area: input.building_total_area,
    floors_above: input.building_floors_above,
    floors_below: input.building_floors_below,
    year_built: input.building_year_built,
  }, nowYear)
  if (numErr) return { error: numErr }

  const { data: existing } = await admin
    .from('customers')
    .select('id')
    .eq('customer_code', input.customer_code)
    .single()
  if (existing) return { error: `고객코드 "${input.customer_code}" 는 이미 사용 중입니다.` }

  const baseFields = {
    customer_code: input.customer_code,
    customer_name: input.customer_name,
    contract_date: input.contract_date,
    use_approval_date: input.use_approval_date || null,
    region_si: input.region_si || null,
    region_myeon: input.region_myeon || null,
    region_ri: input.region_ri || null,
    inspection_type: input.inspection_type,
    inspection_category: input.inspection_type === '일반관리' ? '일반관리' : '소방안전관리',
    inspection_sub_type: input.inspection_type === '종합' ? '종합' : input.inspection_type === '작동' ? '작동' : null,
    address: input.address || null,
    notes: input.notes || null,
    assigned_employee_id: input.assigned_employee_id || null,
    created_by: profile.id,
  }

  let { data: customerRaw, error: insertErr } = await admin
    .from('customers')
    .insert({ ...baseFields, zipcode: input.zipcode || null } as Record<string, unknown>)
    .select('id')
    .single()

  // zipcode 컬럼 미적용 시 재시도
  if (insertErr?.message?.includes('zipcode')) {
    const retry = await admin
      .from('customers')
      .insert(baseFields as Record<string, unknown>)
      .select('id')
      .single()
    customerRaw = retry.data
    insertErr = retry.error
  }

  if (insertErr || !customerRaw) return { error: '고객 등록에 실패했습니다.' }
  const customerId = (customerRaw as { id: string }).id

  const validContacts = input.contacts.filter(c => c.name.trim())
  if (validContacts.length > 0) {
    await admin.from('customer_contacts').insert(
      validContacts.map(c => ({
        customer_id: customerId,
        role: c.role,
        name: c.name.trim(),
        phone: c.phone?.trim() || null,
        email: c.email?.trim() || null,
      })) as Record<string, unknown>[]
    )
  }

  let assignedEmpName: string | null = null
  if (input.assigned_employee_id) {
    const { data: empRaw } = await admin
      .from('profiles')
      .select('name')
      .eq('id', input.assigned_employee_id)
      .single()
    assignedEmpName = (empRaw as { name: string } | null)?.name ?? '담당자'

    await admin.from('notifications').insert({
      recipient_id: input.assigned_employee_id,
      title: '고객 담당자 배정',
      message: `"${input.customer_name}" 고객의 담당자로 배정되었습니다.`,
      type: 'inspection_assigned',
      reference_id: customerId,
      reference_type: 'inspection',
    } as Record<string, unknown>)
    // ADD-6: 등록 시점의 담당자 배정은 별도 이력을 남기지 않음 (등록 이력에 포함) — 등록 시 이력 2건 중복 방지
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'customer_created',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: {
      customer_code: input.customer_code,
      customer_name: input.customer_name,
      ...(assignedEmpName ? { employee_name: assignedEmpName } : {}),
    },
  } as Record<string, unknown>)

  // buildings 테이블에 자동 생성 (V9-3: 건물 기본정보 포함)
  if (input.customer_name && (input.address || input.zipcode || input.building_purpose || input.building_floors_above)) {
    const buildingBase: Record<string, unknown> = {
      customer_id: customerId,
      building_name: input.customer_name,
      address: input.address || null,
      created_by: profile.id,
    }
    if (input.building_purpose)    buildingBase.purpose      = input.building_purpose
    if (input.building_total_area) buildingBase.total_area   = input.building_total_area
    if (input.building_floors_above) buildingBase.floors_above = input.building_floors_above
    if (input.building_floors_below) buildingBase.floors_below = input.building_floors_below
    if (input.building_year_built) buildingBase.year_built   = input.building_year_built

    // 건축물대장 소방안전 자료 (migration 037/038 — 미적용 DB에서는 42703으로 감지 후 제외 재시도)
    const ledgerFields: Record<string, unknown> = {}
    if (input.building_height != null)         ledgerFields.height = input.building_height
    if (input.building_main_structure)         ledgerFields.main_structure = input.building_main_structure
    if (input.building_elevator_count != null) ledgerFields.elevator_count = input.building_elevator_count
    if (input.building_households != null)     ledgerFields.households = input.building_households
    if (input.building_emergency_elevator_count != null) ledgerFields.emergency_elevator_count = input.building_emergency_elevator_count
    if (input.building_roof_structure)         ledgerFields.roof_structure = input.building_roof_structure
    if (input.building_etc_purpose)            ledgerFields.etc_purpose = input.building_etc_purpose
    if (input.building_ho_count != null)       ledgerFields.ho_count = input.building_ho_count
    if (input.building_attached_count != null) ledgerFields.attached_building_count = input.building_attached_count
    if (input.building_seismic_design)         ledgerFields.seismic_design = input.building_seismic_design
    if (Object.keys(ledgerFields).length > 0)  ledgerFields.ledger_synced_at = new Date().toISOString()

    // 단계적 폴백: 전체 → 037 필드만(038 미적용) → 기본 필드만(037 미적용)
    const FIELDS_037 = ['height', 'main_structure', 'elevator_count', 'households', 'ledger_synced_at']
    const ledger037: Record<string, unknown> = Object.fromEntries(
      Object.entries(ledgerFields).filter(([k]) => FIELDS_037.includes(k))
    )
    const attempts: Record<string, unknown>[] = [
      { ...buildingBase, ...ledgerFields, zipcode: input.zipcode || null },
      { ...buildingBase, ...ledger037, zipcode: input.zipcode || null },
      { ...buildingBase, zipcode: input.zipcode || null },
      buildingBase,
    ]
    for (const payload of attempts) {
      const { error: bErr } = await admin.from('buildings').insert(payload)
      if (!bErr) break
      if (bErr.code !== '42703' && !bErr.message?.includes('column') && !bErr.message?.includes('zipcode')) break
    }
    revalidatePath('/buildings')
  }

  // 사용승인일이 있으면 해당 연/월 점검계획 항목 자동 생성 (V9-9)
  if (input.use_approval_date) {
    await _autoCreatePlanItemsForNewCustomer(
      admin, customerId,
      { inspection_type: input.inspection_type, use_approval_date: input.use_approval_date, assigned_employee_id: input.assigned_employee_id || null },
      profile.id,
    )
  }

  revalidatePath('/customers')
  revalidatePath('/inspection-plans')
  return { customerId }
}

/** V9-1/V9-9: 신규 고객 등록 시 사용승인일 기반 연간 점검계획 항목 자동 생성
 *  - 소방안전관리: 특별점검달(special_종합/special_작동) + 나머지 11/10개월(monthly) = 12회/년
 *  - 일반관리: 수동 생성이므로 자동 생성 없음 */
async function _autoCreatePlanItemsForNewCustomer(
  admin: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  customerId: string,
  info: { inspection_type: InspectionType; use_approval_date: string; assigned_employee_id: string | null },
  createdBy: string,
) {
  const { inspection_type, use_approval_date, assigned_employee_id } = info
  if (inspection_type === '일반관리') return

  const inspection_category = '소방안전관리'
  const inspection_sub_type = inspection_type === '종합' ? '종합' : '작동'

  const approvalDate  = new Date(use_approval_date)
  const approvalMonth = approvalDate.getMonth() + 1
  const approvalDay   = approvalDate.getDate()
  const now           = new Date()
  const targetYear    = approvalDate.getFullYear() >= now.getFullYear()
    ? approvalDate.getFullYear()
    : now.getFullYear()

  // 공휴일 조회
  const { data: hdData } = await admin.from('holidays').select('date')
    .gte('date', `${targetYear}-01-01`).lte('date', `${targetYear + 1}-12-31`)
  const hdSet = new Set((hdData ?? []).map(h => (h as Record<string, unknown>).date as string))

  function toStr(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  function calcPlanned(year: number, month: number): string {
    const daysInMo = new Date(year, month, 0).getDate()
    const base = new Date(year, month - 1, Math.min(approvalDay, daysInMo))
    const d = base.getDay()
    if (d === 0 || d === 6 || hdSet.has(toStr(base))) {
      const next = new Date(base)
      next.setDate(next.getDate() + 1)
      while (next.getDay() === 0 || next.getDay() === 6 || hdSet.has(toStr(next))) next.setDate(next.getDate() + 1)
      return toStr(next)
    }
    return toStr(base)
  }

  // 특별점검 월 정의
  const specialKey = new Set<string>()
  const toCreate: Array<{ year: number; month: number; sequence_num: 1 | 2; planType: string }> = []

  // 1차 특별점검 (사용승인월)
  specialKey.add(`${targetYear}-${approvalMonth}`)
  toCreate.push({
    year: targetYear, month: approvalMonth, sequence_num: 1,
    planType: inspection_type === '종합' ? 'special_종합' : 'special_작동',
  })

  // 종합: +6개월 2차 특별점검 — 연도를 넘겨도 targetYear 월로 배치하여 연 12건 유지
  // (12개월 회전 기준. 사용승인월 후반이면 2차가 이론상 익년이지만, 연간 계획은 targetYear 12칸으로 고정)
  if (inspection_type === '종합') {
    const mo2 = ((approvalMonth - 1 + 6) % 12) + 1
    specialKey.add(`${targetYear}-${mo2}`)
    toCreate.push({ year: targetYear, month: mo2, sequence_num: 2, planType: 'special_종합' })
  }

  // targetYear 나머지 월: 모두 monthly 정기점검 → 항상 연 12건
  for (let m = 1; m <= 12; m++) {
    if (!specialKey.has(`${targetYear}-${m}`)) {
      toCreate.push({ year: targetYear, month: m, sequence_num: 1, planType: 'monthly' })
    }
  }

  for (const { year, month, sequence_num, planType } of toCreate) {
    let planId: string | null = null
    const { data: ep } = await admin.from('inspection_plans').select('id').eq('year', year).eq('month', month).single()
    if (ep) {
      planId = (ep as { id: string }).id
    } else {
      const { data: np } = await admin.from('inspection_plans')
        .insert({ year, month, status: 'draft', auto_generated: true, created_by: createdBy } as Record<string, unknown>)
        .select('id').single()
      if (np) {
        planId = (np as { id: string }).id
      } else {
        const { data: dp } = await admin.from('inspection_plans').select('id').eq('year', year).eq('month', month).single()
        if (dp) planId = (dp as { id: string }).id
      }
    }
    if (!planId) continue

    await admin.from('inspection_plan_items').insert({
      plan_id: planId,
      customer_id: customerId,
      inspection_type,
      inspection_category,
      inspection_sub_type,
      sequence_num,
      assigned_employee_id: assigned_employee_id || null,
      planned_date: calcPlanned(year, month),
      scheduled_date: null,
      status: 'planned',
      plan_type: planType,
    } as Record<string, unknown>)
    // 23505 중복 에러는 무시
  }
}

/** 담당자 변경 시 미완료 plan_items + 진행중 inspections 일괄 동기화 */
async function _syncEmployeeToRelated(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
  employeeId: string | null
) {
  await Promise.all([
    admin.from('inspection_plan_items')
      .update({ assigned_employee_id: employeeId } as Record<string, unknown>)
      .eq('customer_id', customerId)
      .in('status', ['planned', 'confirmed']),
    admin.from('inspections')
      .update({ assigned_employee_id: employeeId } as Record<string, unknown>)
      .eq('customer_id', customerId)
      .not('status', 'in', '("completed","cancelled")'),
  ])
  revalidatePath('/inspection-plans')
  revalidatePath('/inspections')
}

export async function assignEmployeeAction(
  customerId: string,
  employeeId: string | null
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_assign')
  const admin = createAdminClient()

  const { data: customerRaw } = await admin
    .from('customers')
    .select('customer_name, assigned_employee_id')
    .eq('id', customerId)
    .single()
  const customer = customerRaw as { customer_name: string; assigned_employee_id: string | null } | null
  if (!customer) return { error: '고객을 찾을 수 없습니다.' }

  const { error } = await admin
    .from('customers')
    .update({ assigned_employee_id: employeeId } as Record<string, unknown>)
    .eq('id', customerId)
  if (error) return { error: '담당자 변경에 실패했습니다.' }

  // ADD-5: 변경 전/후 담당자 이름으로 changes 형식 이력 기록 (상세 점검이력에 내용 표시)
  const prevEmpId = customer.assigned_employee_id
  async function empNameOf(id: string | null): Promise<string | null> {
    if (!id) return null
    const { data } = await admin.from('profiles').select('name').eq('id', id).single()
    return (data as { name: string } | null)?.name ?? null
  }
  const [oldName, newName] = await Promise.all([empNameOf(prevEmpId), empNameOf(employeeId)])

  if (employeeId) {
    await admin.from('notifications').insert({
      recipient_id: employeeId,
      title: '고객 담당자 배정',
      message: `"${customer.customer_name}" 고객의 담당자로 배정되었습니다.`,
      type: 'inspection_assigned',
      reference_id: customerId,
      reference_type: 'inspection',
    } as Record<string, unknown>)
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'customer_field_changed',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: {
      changes: [{ field: 'assigned_employee_id', field_label: '담당직원', old_value: oldName, new_value: newName }],
    },
  } as Record<string, unknown>)

  await _syncEmployeeToRelated(admin, customerId, employeeId)

  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/customers')
  return {}
}

export async function updateCustomerAction(
  customerId: string,
  input: Partial<Omit<CreateCustomerInput, 'contacts' | 'assigned_employee_id'>> & { zipcode?: string }
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 변경 감지를 위해 이전 값 조회
  const { data: prevCustomer } = await admin
    .from('customers')
    .select('customer_name, inspection_type, contract_date, use_approval_date, address')
    .eq('id', customerId).single()
  const prev = prevCustomer as {
    customer_name: string; inspection_type: string; contract_date: string
    use_approval_date: string | null; address: string | null
  } | null
  const prevApprovalDate = prev?.use_approval_date ?? null

  const updateFields: Record<string, unknown> = {
    customer_name: input.customer_name,
    contract_date: input.contract_date,
    use_approval_date: input.use_approval_date ?? null,
    region_si: input.region_si ?? null,
    region_myeon: input.region_myeon ?? null,
    region_ri: input.region_ri ?? null,
    inspection_type: input.inspection_type,
    address: input.address ?? null,
    notes: input.notes ?? null,
  }
  if (input.inspection_type !== undefined) {
    updateFields.inspection_category = input.inspection_type === '일반관리' ? '일반관리' : '소방안전관리'
    updateFields.inspection_sub_type = input.inspection_type === '종합' ? '종합' : input.inspection_type === '작동' ? '작동' : null
  }
  if ('zipcode' in input) updateFields.zipcode = (input as { zipcode?: string }).zipcode ?? null

  let { error } = await admin
    .from('customers')
    .update(updateFields)
    .eq('id', customerId)

  // zipcode 컬럼 미적용 시 재시도
  if (error?.message?.includes('zipcode')) {
    const { zipcode: _z, ...withoutZipcode } = updateFields
    void _z
    const retry = await admin.from('customers').update(withoutZipcode).eq('id', customerId)
    error = retry.error
  }

  if (error) return { error: '고객 정보 수정에 실패했습니다.' }

  // 사용승인일이 변경된 경우: 미확정 plan_items 리셋 + scheduled_date 재계산
  const newApprovalDate = input.use_approval_date ?? null
  if (input.use_approval_date !== undefined && newApprovalDate !== prevApprovalDate) {
    await _resetPlanItemsForCustomer(admin, customerId, newApprovalDate)
  }

  // 건물명/주소 변경 시 연결된 buildings 레코드 1건 동기화
  if (input.customer_name !== undefined || input.address !== undefined) {
    const { data: firstBuilding } = await admin
      .from('buildings').select('id').eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1).single()
    if (firstBuilding) {
      const bPatch: Record<string, unknown> = {}
      if (input.customer_name !== undefined) bPatch.building_name = input.customer_name
      if (input.address !== undefined)       bPatch.address       = input.address ?? null
      await admin.from('buildings').update(bPatch).eq('id', (firstBuilding as { id: string }).id)
    }
    revalidatePath('/buildings')
  }

  // 변경된 필드 activity_logs 기록
  const trackedFields = ['customer_name', 'inspection_type', 'contract_date', 'use_approval_date', 'address'] as const
  const changes: Array<{ field: string; field_label: string; old_value: string | null; new_value: string | null }> = []
  for (const f of trackedFields) {
    const newVal = (updateFields[f] as string | null | undefined) ?? null
    const oldVal = (prev?.[f] as string | null | undefined) ?? null
    if (newVal !== oldVal) changes.push({ field: f, field_label: CUSTOMER_FIELD_LABELS[f], old_value: oldVal, new_value: newVal })
  }
  if (changes.length > 0) {
    await admin.from('activity_logs').insert({
      actor_id: profile.id,
      action: 'customer_field_changed',
      entity_type: 'customer',
      entity_id: customerId,
      metadata: { changes },
    } as Record<string, unknown>)
  }

  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/customers')
  revalidatePath('/inspection-plans')
  return {}
}

async function _resetPlanItemsForCustomer(
  admin: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  customerId: string,
  newApprovalDate: string | null,
) {
  // 완료/취소 제외한 활성 plan_items + 소속 plan의 year/month 조회
  const { data: items } = await admin
    .from('inspection_plan_items')
    .select('id, inspection_plans!inner(year, month)')
    .eq('customer_id', customerId)
    .in('status', ['planned', 'confirmed'])

  if (!items || items.length === 0) return

  // 영업일 계산 헬퍼
  function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }

  // 영향 범위 내 공휴일 일괄 조회 (현재 이후 ~8개월)
  const now = new Date()
  const endDate = new Date(now); endDate.setMonth(endDate.getMonth() + 8)
  const startStr = toDateStr(now)
  const endStr = toDateStr(endDate)
  const { data: holidayData } = await admin
    .from('holidays').select('date')
    .gte('date', startStr).lte('date', endStr)
  const holidaySet = new Set((holidayData ?? []).map(h => (h as Record<string, unknown>).date as string))

  function nextWorkday(base: Date): string {
    const d = new Date(base)
    d.setDate(d.getDate() + 1)
    while (true) {
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6 && !holidaySet.has(toDateStr(d))) break
      d.setDate(d.getDate() + 1)
    }
    return toDateStr(d)
  }

  const resetFields: Record<string, unknown> = {
    status: 'planned',
    scheduled_date: null,       // 관리자 재확정 필요
    step1_date: null, step2_date: null, step3_date: null,
    step4_date: null, step5_date: null, step6_date: null,
  }

  for (const item of items) {
    const plan = (item as Record<string, unknown>).inspection_plans as { year: number; month: number } | null
    if (!plan) continue

    // planned_date 재계산 (새 use_approval_date 기준, 다음 영업일 조정)
    let newPlannedDate: string | null = null
    if (newApprovalDate) {
      const approvalDay = new Date(newApprovalDate).getDate()
      const daysInMonth = new Date(plan.year, plan.month, 0).getDate()
      const base = new Date(plan.year, plan.month - 1, Math.min(approvalDay, daysInMonth))
      const dow = base.getDay()
      if (dow === 0 || dow === 6 || holidaySet.has(toDateStr(base))) {
        newPlannedDate = nextWorkday(base)
      } else {
        newPlannedDate = toDateStr(base)
      }
    }

    await admin
      .from('inspection_plan_items')
      .update({ ...resetFields, planned_date: newPlannedDate } as Record<string, unknown>)
      .eq('id', (item as Record<string, unknown>).id as string)
  }
}

export async function upsertContactAction(
  customerId: string,
  contact: ContactInput
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('customer_contacts')
    .select('id')
    .eq('customer_id', customerId)
    .eq('role', contact.role)
    .single()

  if (existing) {
    const { error } = await admin
      .from('customer_contacts')
      .update({
        name: contact.name.trim(),
        phone: contact.phone?.trim() || null,
        email: contact.email?.trim() || null,
      } as Record<string, unknown>)
      .eq('id', (existing as { id: string }).id)
    if (error) return { error: '관계인 정보 수정에 실패했습니다.' }
  } else {
    const { error } = await admin
      .from('customer_contacts')
      .insert({
        customer_id: customerId,
        role: contact.role,
        name: contact.name.trim(),
        phone: contact.phone?.trim() || null,
        email: contact.email?.trim() || null,
      } as Record<string, unknown>)
    if (error) return { error: '관계인 등록에 실패했습니다.' }
  }

  revalidatePath(`/customers/${customerId}`)
  return {}
}

export async function bulkAssignEmployeeAction(
  customerIds: string[],
  employeeId: string | null
): Promise<{ error?: string; updatedCount?: number }> {
  const profile = await requirePermission('customer_assign')
  const admin = createAdminClient()

  if (customerIds.length === 0) return { updatedCount: 0 }

  const { error, count } = await admin
    .from('customers')
    .update({ assigned_employee_id: employeeId } as Record<string, unknown>)
    .in('id', customerIds)

  if (error) return { error: '일괄 배정에 실패했습니다.' }

  if (employeeId) {
    const { data: empRaw } = await admin
      .from('profiles')
      .select('name')
      .eq('id', employeeId)
      .single()
    const empName = (empRaw as { name: string } | null)?.name ?? '담당자'

    await admin.from('notifications').insert(
      customerIds.map(cid => ({
        recipient_id: employeeId,
        title: '고객 담당자 배정',
        message: `지역별 일괄 배정으로 담당 고객이 추가되었습니다.`,
        type: 'inspection_assigned',
        reference_id: cid,
        reference_type: 'inspection',
      })) as Record<string, unknown>[]
    )

    // ADD-5: 고객별 개별 이력 기록 (entity_id=고객ID — 고객 상세 점검이력에 표시되도록)
    await admin.from('activity_logs').insert(
      customerIds.map(cid => ({
        actor_id: profile.id,
        action: 'customer_field_changed',
        entity_type: 'customer',
        entity_id: cid,
        metadata: {
          changes: [{ field: 'assigned_employee_id', field_label: '담당직원', old_value: null, new_value: empName }],
          source: '지역별 일괄 배정',
        },
      })) as Record<string, unknown>[]
    )
  }

  // ADD-5/V9-20: 담당자 변경 전파 — 미완료 계획/진행중 점검에 동기화
  for (const cid of customerIds) {
    await _syncEmployeeToRelated(admin, cid, employeeId)
  }

  revalidatePath('/customers')
  revalidatePath('/customers/regional-assign')
  revalidatePath('/inspection-plans')
  revalidatePath('/inspections')
  return { updatedCount: count ?? customerIds.length }
}

/** 고객 지역 정보(region_si/myeon/ri)만 단독 수정 */
export async function updateCustomerRegionAction(
  customerId: string,
  region: { region_si: string; region_myeon: string; region_ri: string }
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('customers')
    .update({
      region_si: region.region_si.trim() || null,
      region_myeon: region.region_myeon.trim() || null,
      region_ri: region.region_ri.trim() || null,
    } as Record<string, unknown>)
    .eq('id', customerId)

  if (error) return { error: '지역 정보 수정에 실패했습니다.' }

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/customers/regional-assign')
  return {}
}

/**
 * 접두어 기반으로 다음 고객코드를 생성합니다.
 * 예: prefix='YP' → DB에서 YP001~YP050 확인 후 'YP051' 반환
 */
export async function generateCustomerCodeAction(prefix: string = 'C'): Promise<{ code?: string; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  const cleanPrefix = prefix.trim().toUpperCase()
  if (!cleanPrefix) return { error: '접두어를 입력해주세요.' }

  const { data, error } = await admin
    .from('customers')
    .select('customer_code')
    .ilike('customer_code', `${cleanPrefix}%`)
    .limit(200)

  if (error) return { error: '코드 조회에 실패했습니다.' }

  // 접두어 뒤에 숫자만 오는 패턴에서 최대값 추출
  const escapedPrefix = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escapedPrefix}(\\d+)$`, 'i')
  let maxNum = 0
  for (const row of (data ?? []) as { customer_code: string }[]) {
    const match = row.customer_code.match(pattern)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxNum) maxNum = num
    }
  }

  const nextNum = maxNum + 1
  const code = `${cleanPrefix}${String(nextNum).padStart(3, '0')}`
  return { code }
}

// ── 비활성 전환 시 미완료 계획 자동 취소 / 재활성 시 복원 ──
// 원상태를 notes 마커(⟦자동취소:상태⟧)로 보존해 재활성화 시 그대로 복원
const AUTO_CANCEL_MARKER = /⟦자동취소:(planned|confirmed)⟧/

async function _autoCancelPlansForCustomer(admin: ReturnType<typeof createAdminClient>, customerId: string) {
  const { data } = await admin
    .from('inspection_plan_items')
    .select('id, status, notes')
    .eq('customer_id', customerId)
    .in('status', ['planned', 'confirmed'])
  for (const row of (data ?? []) as { id: string; status: string; notes: string | null }[]) {
    await admin
      .from('inspection_plan_items')
      .update({
        status: 'cancelled',
        notes: `${row.notes ?? ''}⟦자동취소:${row.status}⟧`,
      } as Record<string, unknown>)
      .eq('id', row.id)
  }
  return (data ?? []).length
}

async function _restorePlansForCustomer(admin: ReturnType<typeof createAdminClient>, customerId: string) {
  const { data } = await admin
    .from('inspection_plan_items')
    .select('id, notes')
    .eq('customer_id', customerId)
    .eq('status', 'cancelled')
    .like('notes', '%⟦자동취소:%')
  for (const row of (data ?? []) as { id: string; notes: string | null }[]) {
    const m = row.notes?.match(AUTO_CANCEL_MARKER)
    if (!m) continue
    await admin
      .from('inspection_plan_items')
      .update({
        status: m[1],
        notes: (row.notes ?? '').replace(AUTO_CANCEL_MARKER, '') || null,
      } as Record<string, unknown>)
      .eq('id', row.id)
  }
  return (data ?? []).length
}

/** 고객 활성/비활성 즉시 전환 — 비활성 시 미완료 계획 자동 취소, 재활성 시 복원 */
export async function toggleCustomerActiveAction(
  customerId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('customers')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', customerId)

  if (error) return { error: error.message }

  if (isActive) await _restorePlansForCustomer(admin, customerId)
  else          await _autoCancelPlansForCustomer(admin, customerId)

  revalidatePath('/customers')
  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/calendar')
  return {}
}

/** 고객 삭제 (소프트 삭제) — 미완료 계획은 자동 취소 처리 (재활성화 시 복원) */
export async function deleteCustomerAction(
  customerId: string
): Promise<{ error?: string }> {
  await requirePermission('customer_delete')
  const admin = createAdminClient()

  const { error } = await admin
    .from('customers')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', customerId)

  if (error) return { error: error.message }

  await _autoCancelPlansForCustomer(admin, customerId)

  revalidatePath('/customers')
  revalidatePath('/buildings')
  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/calendar')
  return {}
}

/** 일반관리 고객 점검일 수동 등록 (V10 §6-C) — plan_item(event) 생성 → 점검달력 반영 */
export async function registerGeneralInspectionAction(input: {
  customerId: string
  plannedDate: string          // YYYY-MM-DD
  assignedEmployeeId?: string
  memo?: string
}): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: custRaw } = await admin
    .from('customers')
    .select('inspection_type, customer_name')
    .eq('id', input.customerId)
    .single()
  const cust = custRaw as { inspection_type: string; customer_name: string } | null
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }
  if (cust.inspection_type !== '일반관리') {
    return { error: '일반관리 고객만 점검일을 직접 등록할 수 있습니다. (소방안전관리는 사용승인일 기준 자동 생성)' }
  }

  const d = new Date(input.plannedDate)
  if (isNaN(d.getTime())) return { error: '점검 예정일이 올바르지 않습니다.' }
  const year = d.getFullYear()
  const month = d.getMonth() + 1

  // 해당 년/월 계획 헤더 확보 (없으면 생성 — UNIQUE(year,month) 충돌 시 기존 행 사용)
  let planId: string | null = null
  const { data: plan } = await admin
    .from('inspection_plans')
    .select('id')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle()
  if (plan) {
    planId = (plan as { id: string }).id
  } else {
    const { data: created, error: planErr } = await admin
      .from('inspection_plans')
      .insert({ year, month, status: 'draft', auto_generated: false, created_by: profile.id } as Record<string, unknown>)
      .select('id')
      .single()
    if (planErr?.code === '23505') {
      const { data: dup } = await admin
        .from('inspection_plans').select('id').eq('year', year).eq('month', month).single()
      planId = (dup as { id: string } | null)?.id ?? null
    } else if (created) {
      planId = (created as { id: string }).id
    }
  }
  if (!planId) return { error: '월간 계획 생성에 실패했습니다.' }

  const { error } = await admin
    .from('inspection_plan_items')
    .insert({
      plan_id: planId,
      customer_id: input.customerId,
      inspection_type: '일반관리',
      inspection_category: '일반관리',
      sequence_num: 1,
      plan_type: 'event',
      planned_date: input.plannedDate,
      scheduled_date: null,
      status: 'planned',
      assigned_employee_id: input.assignedEmployeeId || null,
      notes: input.memo?.trim() || null,
    } as Record<string, unknown>)
  if (error) return { error: `점검일 등록 실패: ${error.message}` }

  // 점검이력 기록
  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'general_inspection_registered',
    entity_type: 'customer',
    entity_id: input.customerId,
    metadata: { planned_date: input.plannedDate, memo: input.memo ?? null },
  } as Record<string, unknown>)

  revalidatePath('/customers')
  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/calendar')
  return {}
}

/** ADD-2/ADD-4: 주소 선택 시 중복 고객 확인 + 기존 건물정보 자동 로드 */
export async function checkAddressAction(address: string): Promise<{
  duplicate?: { id: string; customer_name: string; inspection_type: string; employee_name: string | null }
  building?: { purpose: string | null; total_area: number | null; floors_above: number | null; floors_below: number | null; year_built: number | null }
}> {
  const addr = address.trim()
  if (!addr) return {}
  const admin = createAdminClient()

  const [custRes, bldRes] = await Promise.all([
    admin.from('customers')
      .select('id, customer_name, inspection_type, assigned_employee_id, profiles:assigned_employee_id(name)')
      .eq('address', addr).eq('is_active', true).limit(1).maybeSingle(),
    admin.from('buildings')
      .select('purpose, total_area, floors_above, floors_below, year_built')
      .eq('address', addr).eq('is_active', true).limit(1).maybeSingle(),
  ])

  const cust = custRes.data as {
    id: string; customer_name: string; inspection_type: string
    profiles: { name: string } | null
  } | null
  const bld = bldRes.data as {
    purpose: string | null; total_area: number | null
    floors_above: number | null; floors_below: number | null; year_built: number | null
  } | null

  return {
    ...(cust ? {
      duplicate: {
        id: cust.id,
        customer_name: cust.customer_name,
        inspection_type: cust.inspection_type,
        employee_name: cust.profiles?.name ?? null,
      },
    } : {}),
    ...(bld ? { building: bld } : {}),
  }
}

/** 국토부 건축물대장 표제부 조회 — 소방안전 관련 항목 한정 (BldRgstHubService/getBrTitleInfo)
 *  환경변수 BUILDING_LEDGER_API_KEY(공공데이터포털 인증키) 필요. 미설정 시 unavailable 반환 */
export type BuildingLedgerInfo = {
  purpose: string | null          // 주용도
  total_area: number | null       // 연면적(㎡)
  floors_above: number | null     // 지상층수
  floors_below: number | null     // 지하층수
  use_approval_date: string | null // 사용승인일 YYYY-MM-DD
  height: number | null           // 높이(m) — 고층건축물 판정
  main_structure: string | null   // 주구조 — 내화구조 여부
  elevator_count: number | null   // 승용승강기 수 — 피난
  households: number | null       // 세대수 — 특정소방대상물 분류
  // 038 확장 — 소방안전 자료
  emergency_elevator_count: number | null // 비상용승강기 수 — 소방활동
  roof_structure: string | null   // 지붕 구조 — 화재 확산
  etc_purpose: string | null      // 기타 용도 상세
  ho_count: number | null         // 호수 — 수용인원
  attached_building_count: number | null // 부속건축물 수
  seismic_design: string | null   // 내진설계 적용 여부
}

export async function fetchBuildingLedgerAction(
  bcode: string,           // 법정동코드 10자리 (Daum 우편번호 bcode)
  jibunAddress: string,    // 지번주소 — 번지 파싱용
): Promise<{ info?: BuildingLedgerInfo; unavailable?: boolean; error?: string }> {
  const key = process.env.BUILDING_LEDGER_API_KEY
  if (!key) return { unavailable: true }
  if (!bcode || bcode.length !== 10) return { error: '법정동코드가 없습니다.' }

  // 지번주소 끝 번지 파싱: "158" / "158-3"
  const m = jibunAddress.trim().match(/(\d+)(?:-(\d+))?$/)
  if (!m) return { error: '번지를 추출할 수 없습니다.' }
  const bun = m[1].padStart(4, '0')
  const ji  = (m[2] ?? '0').padStart(4, '0')

  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo')
  url.searchParams.set('serviceKey', key)
  url.searchParams.set('sigunguCd', bcode.slice(0, 5))
  url.searchParams.set('bjdongCd', bcode.slice(5))
  url.searchParams.set('bun', bun)
  url.searchParams.set('ji', ji)
  url.searchParams.set('numOfRows', '10')
  url.searchParams.set('_type', 'json')

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) return { error: `건축물대장 API 오류 (HTTP ${res.status})` }
    const json = await res.json() as {
      response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: unknown } } }
    }
    if (json.response?.header?.resultCode !== '00') {
      return { error: `건축물대장 API: ${json.response?.header?.resultMsg ?? '응답 오류'}` }
    }
    const raw = json.response?.body?.items?.item
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[]
    if (list.length === 0) return { error: '해당 지번의 건축물대장이 없습니다.' }

    // 주건축물(연면적 최대) 우선
    const num = (v: unknown): number | null => {
      const n = parseFloat(String(v ?? ''))
      return isNaN(n) || n === 0 ? null : n
    }
    const item = list.reduce((a, b) => (num(a.totArea) ?? 0) >= (num(b.totArea) ?? 0) ? a : b)
    const apr = String(item.useAprDay ?? '')
    return {
      info: {
        purpose: (item.mainPurpsCdNm as string) || null,
        total_area: num(item.totArea),
        floors_above: num(item.grndFlrCnt),
        floors_below: num(item.ugrndFlrCnt),
        use_approval_date: /^\d{8}$/.test(apr) ? `${apr.slice(0, 4)}-${apr.slice(4, 6)}-${apr.slice(6)}` : null,
        height: num(item.heit),
        main_structure: (item.strctCdNm as string) || null,
        elevator_count: num(item.rideUseElvtCnt),
        households: num(item.hhldCnt),
        emergency_elevator_count: num(item.emgenUseElvtCnt),
        roof_structure: (item.roofCdNm as string) || null,
        etc_purpose: (item.etcPurps as string) || null,
        ho_count: num(item.hoCnt),
        attached_building_count: num(item.atchBldCnt),
        seismic_design: (item.rserthqkDsgnApplyYn as string) || null,
      },
    }
  } catch (e) {
    return { error: `건축물대장 조회 실패: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 통합검색 자동완성 제안 (건물명/주소/담당자) */
export async function searchSuggestionsAction(q: string): Promise<{
  buildings: string[]
  addresses: string[]
  employees: { name: string; count: number }[]
}> {
  const empty = { buildings: [], addresses: [], employees: [] }
  const query = q.trim()
  if (query.length < 1) return empty
  const admin = createAdminClient()

  const [byName, byAddr, empRes] = await Promise.all([
    admin.from('customers').select('customer_name').ilike('customer_name', `%${query}%`).eq('is_active', true).limit(5),
    admin.from('customers').select('address').ilike('address', `%${query}%`).eq('is_active', true).limit(5),
    admin.from('profiles').select('id, name').ilike('name', `%${query}%`).eq('is_active', true).limit(3),
  ])

  const employees: { name: string; count: number }[] = []
  for (const e of (empRes.data ?? []) as { id: string; name: string }[]) {
    const { count } = await admin
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_employee_id', e.id)
      .eq('is_active', true)
    employees.push({ name: e.name, count: count ?? 0 })
  }

  return {
    buildings: [...new Set(((byName.data ?? []) as { customer_name: string }[]).map(r => r.customer_name))],
    addresses: [...new Set(((byAddr.data ?? []) as { address: string | null }[]).map(r => r.address).filter(Boolean) as string[])],
    employees,
  }
}

/** 고객 단일 필드 인라인 수정 */
export async function patchCustomerFieldAction(
  customerId: string,
  field: 'customer_name' | 'inspection_type' | 'contract_date' | 'use_approval_date' | 'assigned_employee_id',
  value: string | null
): Promise<{ error?: string }> {
  // 담당자 필드는 배정 권한(매니저 이상), 그 외 필드는 고객 수정 권한
  const profile = field === 'assigned_employee_id'
    ? await requirePermission('customer_assign')
    : await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 이전 값 조회 (변경 감지 + 이력 기록용)
  const { data: prevData } = await admin
    .from('customers')
    .select('customer_name, inspection_type, contract_date, use_approval_date, assigned_employee_id')
    .eq('id', customerId).single()
  const oldValue = (prevData as Record<string, string | null> | null)?.[field] ?? null

  const { error } = await admin
    .from('customers')
    .update({ [field]: value || null, updated_at: new Date().toISOString() })
    .eq('id', customerId)

  if (error) return { error: '수정에 실패했습니다.' }

  if (field === 'use_approval_date' && value !== oldValue) {
    await _resetPlanItemsForCustomer(admin, customerId, value)
  }

  // 담당자 변경 시 미완료 plan_items + 진행중 inspections 동기화
  if (field === 'assigned_employee_id' && value !== oldValue) {
    await _syncEmployeeToRelated(admin, customerId, value)
  }

  // 고객명 변경 시 연결된 buildings.building_name 동기화
  if (field === 'customer_name' && value) {
    const { data: firstBuilding } = await admin
      .from('buildings').select('id').eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1).single()
    if (firstBuilding) {
      await admin.from('buildings')
        .update({ building_name: value })
        .eq('id', (firstBuilding as { id: string }).id)
      revalidatePath('/buildings')
    }
  }

  // activity_logs 변경 이력 기록
  if (value !== oldValue) {
    await admin.from('activity_logs').insert({
      actor_id: profile.id,
      action: 'customer_field_changed',
      entity_type: 'customer',
      entity_id: customerId,
      metadata: {
        changes: [{ field, field_label: CUSTOMER_FIELD_LABELS[field] ?? field, old_value: oldValue, new_value: value }],
      },
    } as Record<string, unknown>)
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
  if (field === 'use_approval_date') revalidatePath('/inspection-plans')
  return {}
}

/** 주소 필드에서 지역 정보(region_si/myeon/ri)를 자동 추출하여 일괄 업데이트 */
export async function bulkExtractRegionsAction(): Promise<{ count?: number; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  // region 컬럼 존재 여부 확인
  const { error: colErr } = await admin.from('customers').select('region_si').limit(1)
  if (colErr) {
    return { error: '지역 컬럼이 DB에 없습니다. Supabase SQL Editor에서 018_region.sql을 먼저 실행해주세요.' }
  }

  // 주소는 있지만 시/군/구가 없는 활성 고객 조회
  const { data: rows } = await admin
    .from('customers')
    .select('id, address')
    .eq('is_active', true)
    .not('address', 'is', null)
    .is('region_si', null)

  if (!rows?.length) return { count: 0 }

  let updated = 0
  for (const row of rows as { id: string; address: string }[]) {
    const { region_si, region_myeon, region_ri } = extractRegionFromAddress(row.address)
    if (!region_si) continue

    const { error } = await admin
      .from('customers')
      .update({
        region_si,
        region_myeon: region_myeon || null,
        region_ri: region_ri || null,
      } as Record<string, unknown>)
      .eq('id', row.id)

    if (!error) updated++
  }

  revalidatePath('/customers')
  revalidatePath('/customers/regional-assign')
  return { count: updated }
}
