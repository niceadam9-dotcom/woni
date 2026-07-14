'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'
import { extractRegionFromAddress } from '@/lib/address-parser'
import { generateYearlyPlanItems, loadHolidaySet, loadAnchorDates } from '@/lib/inspection-plan-generator'
import { notifyIfEnabled, allowsNotification } from '@/lib/notify'
import type { ContactRole, InspectionType } from '@/types'

const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  customer_name: '고객명', inspection_type: '점검유형', contract_date: '계약일',
  use_approval_date: '사용승인일', plan_anchor_date: '점검계획일', address: '주소', assigned_employee_id: '담당직원',
}

export type ContactInput = {
  role: ContactRole
  name: string
  phone?: string
  email?: string
  position?: string    // 직위 (보고서 공문·위임장)
  birth_date?: string  // 생년월일 (위임장)
}

export type CreateCustomerInput = {
  customer_code: string
  customer_name: string
  contract_date?: string
  use_approval_date?: string
  plan_anchor_date: string // 점검계획일 — 계획 기산점(유일한 필수 날짜)
  zipcode?: string
  region_si?: string
  region_myeon?: string
  region_ri?: string
  inspection_type: InspectionType
  address?: string
  notes?: string
  fire_station?: string   // 관할 소방서 (보고서 개요·공문)
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

  // 점검계획일 필수 — 연간 점검계획의 기산점 (수동 최우선)
  if (!input.plan_anchor_date) return { error: '점검계획일을 입력해주세요.' }

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
    contract_date: input.contract_date || null,
    use_approval_date: input.use_approval_date || null,
    plan_anchor_date: input.plan_anchor_date,
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

    await notifyIfEnabled(admin, input.assigned_employee_id, 'assignment', {
      title: '고객 담당자 배정',
      message: `"${input.customer_name}" 고객의 담당자로 배정되었습니다.`,
      type: 'inspection_assigned',
      reference_id: customerId,
      reference_type: 'inspection',
    })
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

  // 점검계획일(필수) 기준 연/월 점검계획 항목 자동 생성 (V9-9)
  await _autoCreatePlanItemsForNewCustomer(
    admin, customerId,
    {
      inspection_type: input.inspection_type,
      plan_anchor_date: input.plan_anchor_date,
      assigned_employee_id: input.assigned_employee_id || null,
    },
    profile.id,
  )

  revalidatePath('/customers')
  revalidatePath('/inspection-plans')
  return { customerId }
}

/** V9-1/V9-9: 신규 고객 등록 시 점검계획일(수동 최우선) 기반 점검계획 항목 자동 생성
 *  - 소방안전관리: 특별점검달(special_종합/special_작동) + 나머지 11/10개월(monthly) = 12회/년
 *  - 일반관리: 점검계획일 당일 1회성 event 1건, 등록 즉시 자동 확정 (연간 반복·크론 무관) */
async function _autoCreatePlanItemsForNewCustomer(
  admin: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  customerId: string,
  info: { inspection_type: InspectionType; plan_anchor_date: string; assigned_employee_id: string | null },
  createdBy: string,
) {
  if (info.inspection_type === '일반관리') {
    await _createGeneralEventItem(admin, customerId, info.plan_anchor_date, info.assigned_employee_id, createdBy)
    return
  }

  const anchorDate = new Date(info.plan_anchor_date)
  const now        = new Date()
  const targetYear = anchorDate.getFullYear() >= now.getFullYear()
    ? anchorDate.getFullYear()
    : now.getFullYear()

  // 이후 연도는 크론(/api/cron/generate-yearly-plans)이 매년 반복 생성
  const hdSet = await loadHolidaySet(admin, targetYear)
  await generateYearlyPlanItems(admin, { id: customerId, ...info }, targetYear, createdBy, hdSet)
}

/** 일반관리 고객 event 계획항목 1건 생성 — planned_date·scheduled_date는 점검계획일 그대로(영업일 보정·'일' 재계산 없음).
 *  점검계획일 = 사용자가 직접 고른 방문일이므로 등록 즉시 자동 확정(confirmed) — 별도 확정 단계 없음 (B안, 2026-07-14)
 *  해당 년/월 계획 헤더가 없으면 생성. 동일 (plan, customer, sequence) 항목이 있으면 UNIQUE 충돌로 건너뜀(멱등) */
async function _createGeneralEventItem(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
  plannedDate: string,
  assignedEmployeeId: string | null,
  createdBy: string,
) {
  const d = new Date(plannedDate)
  if (isNaN(d.getTime())) return
  const year  = d.getFullYear()
  const month = d.getMonth() + 1

  let planId: string | null = null
  const { data: plan } = await admin
    .from('inspection_plans').select('id').eq('year', year).eq('month', month).maybeSingle()
  if (plan) {
    planId = (plan as { id: string }).id
  } else {
    const { data: created, error: planErr } = await admin
      .from('inspection_plans')
      .insert({ year, month, status: 'draft', auto_generated: true, created_by: createdBy } as Record<string, unknown>)
      .select('id').single()
    if (planErr?.code === '23505') {
      const { data: dup } = await admin
        .from('inspection_plans').select('id').eq('year', year).eq('month', month).single()
      planId = (dup as { id: string } | null)?.id ?? null
    } else if (created) {
      planId = (created as { id: string }).id
    }
  }
  if (!planId) return

  // 23505(중복)는 무시 — 유형·점검계획일 동시 변경 등 중복 호출에도 안전
  await admin.from('inspection_plan_items').insert({
    plan_id: planId,
    customer_id: customerId,
    inspection_type: '일반관리',
    inspection_category: '일반관리',
    inspection_sub_type: null,
    sequence_num: 1,
    plan_type: 'event',
    planned_date: plannedDate,
    scheduled_date: plannedDate,
    status: 'confirmed',
    assigned_employee_id: assignedEmployeeId,
  } as Record<string, unknown>)
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

  // 점검이 시작된 항목은 status가 completed로 바뀌어 위 동기화에서 빠지지만,
  // 점검이 아직 진행 중이면 모니터링·점검확정이 이 항목의 담당을 계속 표시함 —
  // 진행중 점검에 연결된 항목도 함께 동기화 (수정사항리스트 10번: 탑텐 담당 불일치)
  const { data: activeInsp } = await admin
    .from('inspections').select('id')
    .eq('customer_id', customerId)
    .not('status', 'in', '("completed","cancelled")')
  const activeIds = ((activeInsp ?? []) as { id: string }[]).map(r => r.id)
  if (activeIds.length > 0) {
    await admin.from('inspection_plan_items')
      .update({ assigned_employee_id: employeeId } as Record<string, unknown>)
      .in('inspection_id', activeIds)
  }

  revalidatePath('/inspection-plans')
  revalidatePath('/inspection-plans/monitor')
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
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
    await notifyIfEnabled(admin, employeeId, 'assignment', {
      title: '고객 담당자 배정',
      message: `"${customer.customer_name}" 고객의 담당자로 배정되었습니다.`,
      type: 'inspection_assigned',
      reference_id: customerId,
      reference_type: 'inspection',
    })
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
  revalidatePath('/customers/regional-assign')
  return {}
}

/** 기준일 변경 팝업(B안)에서 사용자에게 보여줄 확정(confirmed) 항목 요약 */
export type ConfirmedPlanItemInfo = {
  id: string; year: number; month: number
  scheduled_date: string | null; sequence_num: number; plan_type: string | null
}

export type UpdateCustomerInput = {
  customer_name?: string
  inspection_type?: InspectionType
  contract_date?: string | null
  use_approval_date?: string | null
  plan_anchor_date?: string   // 필수값 — 비우기(null) 불허
  zipcode?: string | null
  region_si?: string | null
  region_myeon?: string | null
  region_ri?: string | null
  address?: string | null
  notes?: string | null
  fire_station?: string | null
}

export type UpdateCustomerResult = {
  error?: string
  /** 기준일 변경 대상 고객에 확정 일정이 있음 — confirmedDecision과 함께 재호출 필요 (아무것도 저장 안 됨) */
  requiresConfirmedDecision?: boolean
  confirmedItems?: ConfirmedPlanItemInfo[]
}

/** 기준일 변경 시 재계산에서 제외되는 확정(confirmed) 항목 조회 — 점검 미시작(미연결) 건만 해지 대상
 *  일반관리 event는 제외 — 점검계획일 자체가 확정일(자동 확정)이라 계획일 변경 = 확정일 변경이며,
 *  삭제·재생성으로 즉시 따라가므로 확정보호 팝업 대상이 아님 (B안, 2026-07-14) */
async function _getUnconfirmablePlanItems(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
): Promise<ConfirmedPlanItemInfo[]> {
  const { data } = await admin
    .from('inspection_plan_items')
    .select('id, scheduled_date, sequence_num, plan_type, inspection_plans!inner(year, month)')
    .eq('customer_id', customerId)
    .eq('status', 'confirmed')
    .is('inspection_id', null)
  return ((data ?? []) as Array<Record<string, unknown>>)
    // legacy 항목의 plan_type null은 소방 — neq 쿼리는 null까지 걸러내므로 JS에서 event만 제외
    .filter(r => (r.plan_type as string | null) !== 'event')
    .map(r => {
      const plan = r.inspection_plans as { year: number; month: number }
      return {
        id: r.id as string, year: plan.year, month: plan.month,
        scheduled_date: (r.scheduled_date as string | null) ?? null,
        sequence_num: (r.sequence_num as number | null) ?? 1,
        plan_type: (r.plan_type as string | null) ?? null,
      }
    })
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
}

/** 점검유형 변경 시 미확정(planned) 계획 항목 동기화 — 확정·완료·취소는 불변 (변경전파맵 1-11)
 *  - 종합/작동 간 전환: inspection_type·sub_type·plan_type(special_종합↔special_작동) 갱신
 *  - 작동 전환: 미확정 2차 특별점검 삭제 (연 1회) / 종합 전환: 연간 항목 보충 생성(멱등, 2차 포함)
 *  - 일반관리 전환: 소방안전관리 자동 계획(planned) 삭제 + 점검계획일 event 1건 생성(자동 확정)
 *  - 일반관리 → 소방 전환: event(자동 확정 포함, 미시작) 삭제 후 연간 생성으로 대체 */
async function _syncInspectionTypeToPlanItems(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
  newType: InspectionType,
  actorId: string,
) {
  if (newType === '일반관리') {
    await admin.from('inspection_plan_items').delete()
      .eq('customer_id', customerId).eq('status', 'planned').eq('inspection_category', '소방안전관리')
    const { data: genRaw } = await admin.from('customers')
      .select('plan_anchor_date, assigned_employee_id').eq('id', customerId).single()
    const gen = genRaw as { plan_anchor_date: string | null; assigned_employee_id: string | null } | null
    if (gen?.plan_anchor_date) {
      await _createGeneralEventItem(admin, customerId, gen.plan_anchor_date, gen.assigned_employee_id, actorId)
    }
    return
  }
  // 일반관리 → 소방 전환: 1회성 event(자동 확정 포함)는 소방 계획 체계와 무관 — 삭제 후 아래 연간 생성으로 대체
  await admin.from('inspection_plan_items').delete()
    .eq('customer_id', customerId).in('status', ['planned', 'confirmed'])
    .eq('plan_type', 'event').is('inspection_id', null)
  const subType: '종합' | '작동' = newType === '종합' ? '종합' : '작동'
  const { data: items } = await admin
    .from('inspection_plan_items')
    .select('id, plan_type')
    .eq('customer_id', customerId)
    .eq('status', 'planned')
  for (const it of (items ?? []) as Array<{ id: string; plan_type: string | null }>) {
    const newPlanType = it.plan_type?.startsWith('special_') ? `special_${subType}` : it.plan_type
    await admin.from('inspection_plan_items')
      .update({
        inspection_type: newType,
        inspection_category: '소방안전관리',
        inspection_sub_type: subType,
        plan_type: newPlanType,
      } as Record<string, unknown>)
      .eq('id', it.id)
  }
  if (newType === '작동') {
    await admin.from('inspection_plan_items').delete()
      .eq('customer_id', customerId).eq('status', 'planned').eq('sequence_num', 2)
  }
  // 누락 항목 보충 생성 — 일반관리→소방 전환의 연간 생성, 작동→종합의 2차 특별점검 포함.
  // 기존 (plan, customer, sequence) 항목은 UNIQUE 충돌로 건너뜀(멱등)
  const { data: custRaw } = await admin.from('customers')
    .select('plan_anchor_date, assigned_employee_id')
    .eq('id', customerId).single()
  if (custRaw) {
    const cust = custRaw as { plan_anchor_date: string | null; assigned_employee_id: string | null }
    const targetYear = new Date().getFullYear()
    const hdSet = await loadHolidaySet(admin, targetYear)
    await generateYearlyPlanItems(admin, { id: customerId, inspection_type: newType, ...cust }, targetYear, actorId, hdSet)
  }
}

export async function updateCustomerAction(
  customerId: string,
  input: UpdateCustomerInput,
  opts?: { confirmedDecision?: 'unconfirm' | 'keep' },
): Promise<UpdateCustomerResult> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 점검계획일은 필수값 — 비우기 불허 (2026-07-14: "지우면 폴백 복귀" 설계 폐기)
  if (input.plan_anchor_date !== undefined && !input.plan_anchor_date) {
    return { error: '점검계획일은 필수값입니다 — 비울 수 없습니다.' }
  }

  // 변경 감지를 위해 이전 값 조회
  const { data: prevCustomer } = await admin
    .from('customers')
    .select('customer_name, inspection_type, contract_date, use_approval_date, plan_anchor_date, address')
    .eq('id', customerId).single()
  const prev = prevCustomer as {
    customer_name: string; inspection_type: string; contract_date: string | null
    use_approval_date: string | null; plan_anchor_date: string | null; address: string | null
  } | null
  const prevAnchorDate = prev?.plan_anchor_date ?? null

  // 보내진 필드만 갱신 — 안 보낸 필드(undefined)를 null로 쓰면 부분 호출(예: 점검유형 변경 모달)에서
  // 날짜·주소가 통째로 지워진다 (2026-07-14 수정). 비우기는 명시적 null/빈 문자열로만.
  const updateFields: Record<string, unknown> = {}
  if (input.customer_name !== undefined)     updateFields.customer_name     = input.customer_name
  if (input.contract_date !== undefined)     updateFields.contract_date     = input.contract_date || null
  if (input.use_approval_date !== undefined) updateFields.use_approval_date = input.use_approval_date || null
  if (input.plan_anchor_date !== undefined)  updateFields.plan_anchor_date  = input.plan_anchor_date
  if (input.region_si !== undefined)         updateFields.region_si         = input.region_si || null
  if (input.region_myeon !== undefined)      updateFields.region_myeon      = input.region_myeon || null
  if (input.region_ri !== undefined)         updateFields.region_ri         = input.region_ri || null
  if (input.address !== undefined)           updateFields.address           = input.address || null
  if (input.notes !== undefined)             updateFields.notes             = input.notes || null
  if (input.fire_station !== undefined)      updateFields.fire_station      = input.fire_station || null
  if (input.zipcode !== undefined)           updateFields.zipcode           = input.zipcode || null
  if (input.inspection_type !== undefined) {
    updateFields.inspection_type     = input.inspection_type
    updateFields.inspection_category = input.inspection_type === '일반관리' ? '일반관리' : '소방안전관리'
    updateFields.inspection_sub_type = input.inspection_type === '종합' ? '종합' : input.inspection_type === '작동' ? '작동' : null
  }
  if (Object.keys(updateFields).length === 0) return {}

  // 기준일(점검계획일) 변경 판정 — 사용승인일은 기준일이 아니므로 계획 재계산과 무관 (2026-07-14 폴백 제거)
  const newAnchorDate = input.plan_anchor_date !== undefined ? input.plan_anchor_date : prevAnchorDate
  const anchorChanged = newAnchorDate !== prevAnchorDate

  // 기준일 변경 + 확정 일정 존재 시(B안): 사용자 선택 전에는 아무것도 저장하지 않고 목록 반환
  let confirmedItems: ConfirmedPlanItemInfo[] = []
  if (anchorChanged) {
    confirmedItems = await _getUnconfirmablePlanItems(admin, customerId)
    if (confirmedItems.length > 0 && !opts?.confirmedDecision) {
      return { requiresConfirmedDecision: true, confirmedItems }
    }
  }

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

  // 기준일이 변경된 경우: 미확정(planned) plan_items 재계산.
  // 확정(confirmed)은 기본 유지 — 사용자가 '확정해지 후 재계산'을 선택한 경우만 planned로 복귀시켜 포함
  if (anchorChanged) {
    if (opts?.confirmedDecision === 'unconfirm' && confirmedItems.length > 0) {
      await admin.from('inspection_plan_items')
        .update({ status: 'planned' } as Record<string, unknown>)
        .in('id', confirmedItems.map(i => i.id))
    }
    const effectiveType = input.inspection_type ?? prev?.inspection_type
    if (effectiveType === '일반관리') {
      // 일반관리: 1회성 event를 새 점검계획일로 삭제 후 재생성(자동 확정) — 달이 바뀌어도 해당 월 계획으로 정확히 이동
      // 자동 확정 상태(confirmed)도 계획일이 곧 확정일이므로 함께 교체 — 점검 시작된 항목만 불변
      await admin.from('inspection_plan_items').delete()
        .eq('customer_id', customerId).in('status', ['planned', 'confirmed'])
        .eq('plan_type', 'event').is('inspection_id', null)
      if (newAnchorDate) {
        const { data: empRaw } = await admin.from('customers')
          .select('assigned_employee_id').eq('id', customerId).single()
        const emp = empRaw as { assigned_employee_id: string | null } | null
        await _createGeneralEventItem(admin, customerId, newAnchorDate, emp?.assigned_employee_id ?? null, profile.id)
      }
    } else {
      await _resetPlanItemsForCustomer(admin, customerId, { plan_anchor_date: newAnchorDate })
    }
  }

  // 점검유형 변경 → 미확정(planned) 계획 항목 유형 동기화 (변경전파맵 1-11)
  if (input.inspection_type !== undefined && prev && input.inspection_type !== prev.inspection_type) {
    await _syncInspectionTypeToPlanItems(admin, customerId, input.inspection_type, profile.id)
    revalidatePath('/inspections/calendar')
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
  const trackedFields = ['customer_name', 'inspection_type', 'contract_date', 'use_approval_date', 'plan_anchor_date', 'address'] as const
  const changes: Array<{ field: string; field_label: string; old_value: string | null; new_value: string | null }> = []
  for (const f of trackedFields) {
    // 폼이 보내지 않은 필드(undefined)는 직렬화 시 제외되어 DB도 그대로 — 변경으로 기록하면 허위 이력
    // (예: 수정 폼은 점검유형을 안 보내는데 "종합→null"로 남던 버그, 2026-07-13)
    if (updateFields[f] === undefined) continue
    const newVal = (updateFields[f] as string | null) ?? null
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
  newDates: { plan_anchor_date: string | null },
) {
  // 미확정(planned) plan_items만 재계산 — 확정(confirmed)·완료·취소 항목은 재계획하지 않음 (2026-07-12 결정)
  const { data: items } = await admin
    .from('inspection_plan_items')
    .select('id, inspection_plans!inner(year, month)')
    .eq('customer_id', customerId)
    .eq('status', 'planned')

  if (!items || items.length === 0) return

  // 기준일: 점검계획일(수동) → 최초 점검시작일 (모두 없으면 planned_date null)
  const anchorDate = (await loadAnchorDates(admin, [{ id: customerId, ...newDates }])).get(customerId) ?? null

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

    // planned_date 재계산 (기준일 기준, 다음 영업일 조정)
    let newPlannedDate: string | null = null
    if (anchorDate) {
      const approvalDay = new Date(anchorDate).getDate()
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
        position: contact.position?.trim() || null,
        birth_date: contact.birth_date || null,
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
        position: contact.position?.trim() || null,
        birth_date: contact.birth_date || null,
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

  // 변경 전 담당자 조회 — 실제로 바뀌는 고객만 알림·이력 대상 (재실행 시 같은 내용이 중복 기록되던 문제 방지)
  const { data: beforeRaw } = await admin
    .from('customers')
    .select('id, assigned_employee_id')
    .in('id', customerIds)
  const beforeMap = new Map(
    ((beforeRaw ?? []) as Array<{ id: string; assigned_employee_id: string | null }>)
      .map(c => [c.id, c.assigned_employee_id])
  )
  const changedIds = customerIds.filter(cid => beforeMap.get(cid) !== employeeId)

  const { error, count } = await admin
    .from('customers')
    .update({ assigned_employee_id: employeeId } as Record<string, unknown>)
    .in('id', customerIds)

  if (error) return { error: '일괄 배정에 실패했습니다.' }

  if (changedIds.length > 0) {
    // 신규·이전 담당자 이름 맵 (old_value에 실제 이전 담당자를 기록)
    const nameIds = [
      ...new Set([employeeId, ...changedIds.map(cid => beforeMap.get(cid))].filter(Boolean)),
    ] as string[]
    const { data: namesRaw } = nameIds.length
      ? await admin.from('profiles').select('id, name').in('id', nameIds)
      : { data: [] }
    const nameMap = new Map(
      ((namesRaw ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p.name])
    )
    const empName = employeeId ? nameMap.get(employeeId) ?? '담당자' : null

    if (employeeId && await allowsNotification(admin, employeeId, 'assignment')) {
      await admin.from('notifications').insert(
        changedIds.map(cid => ({
          recipient_id: employeeId,
          title: '고객 담당자 배정',
          message: `지역별 일괄 배정으로 담당 고객이 추가되었습니다.`,
          type: 'inspection_assigned',
          reference_id: cid,
          reference_type: 'inspection',
        })) as Record<string, unknown>[]
      )
    }

    // ADD-5: 고객별 개별 이력 기록 (entity_id=고객ID — 고객 상세 점검이력에 표시되도록)
    await admin.from('activity_logs').insert(
      changedIds.map(cid => {
        const oldId = beforeMap.get(cid)
        return {
          actor_id: profile.id,
          action: 'customer_field_changed',
          entity_type: 'customer',
          entity_id: cid,
          metadata: {
            changes: [{
              field: 'assigned_employee_id',
              field_label: '담당직원',
              old_value: oldId ? nameMap.get(oldId) ?? '이전 담당자' : null,
              new_value: empName,
            }],
            source: '지역별 일괄 배정',
          },
        }
      }) as Record<string, unknown>[]
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
  for (const cid of customerIds) revalidatePath(`/customers/${cid}`)
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

  // 접두어 일치 코드 전량 조회 — 정렬 없는 limit(200)은 200건 초과 시 최대값을 놓쳐
  // 이미 쓰는 코드를 다시 제안했음 (C223 중복 사건, 2026-07-14).
  // 혼합 패딩(C223/C0319) 탓에 문자열 정렬로는 숫자 최대값을 못 구하므로 페이지 순회로 전부 읽는다
  const pageSize = 1000
  const codes: string[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from('customers')
      .select('customer_code')
      .ilike('customer_code', `${cleanPrefix}%`)
      .range(from, from + pageSize - 1)
    if (error) return { error: '코드 조회에 실패했습니다.' }
    const rows = (data ?? []) as { customer_code: string }[]
    codes.push(...rows.map(r => r.customer_code))
    if (rows.length < pageSize) break
  }

  // 접두어 뒤에 숫자만 오는 패턴에서 최대값 추출 (비활성 고객 포함 — 코드는 재사용하지 않음)
  const escapedPrefix = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escapedPrefix}(\\d+)$`, 'i')
  let maxNum = 0
  for (const code of codes) {
    const match = code.match(pattern)
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

  // GAP-1: 비활성 기간에 담당이 바뀌었으면 취소 항목은 담당 동기화에서 빠져 있으므로
  // 복원 시 고객의 현재 담당으로 맞춰준다 (미배정이면 미배정으로)
  const { data: custRaw } = await admin
    .from('customers').select('assigned_employee_id').eq('id', customerId).single()
  const currentAssignee = (custRaw as { assigned_employee_id: string | null } | null)?.assigned_employee_id ?? null

  for (const row of (data ?? []) as { id: string; notes: string | null }[]) {
    const m = row.notes?.match(AUTO_CANCEL_MARKER)
    if (!m) continue
    await admin
      .from('inspection_plan_items')
      .update({
        status: m[1],
        notes: (row.notes ?? '').replace(AUTO_CANCEL_MARKER, '') || null,
        assigned_employee_id: currentAssignee,
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
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('customers')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', customerId)

  if (error) return { error: error.message }

  if (isActive) await _restorePlansForCustomer(admin, customerId)
  else          await _autoCancelPlansForCustomer(admin, customerId)

  // 활성/비활성 전환은 계획 자동취소·복원을 유발하는 핵심 이벤트 — 변경 이력에 기록
  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'customer_field_changed',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: {
      changes: [{
        field: 'is_active', field_label: '상태',
        old_value: isActive ? '비활성' : '활성',
        new_value: isActive ? '활성' : '비활성',
      }],
    },
  } as Record<string, unknown>)

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
    admin.from('profiles').select('id, name').ilike('name', `%${query}%`).eq('is_active', true).eq('is_system', false).limit(3),
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
  field: 'customer_name' | 'inspection_type' | 'contract_date' | 'use_approval_date' | 'plan_anchor_date' | 'assigned_employee_id',
  value: string | null,
  opts?: { confirmedDecision?: 'unconfirm' | 'keep' },
): Promise<UpdateCustomerResult> {
  // 담당자 필드는 배정 권한(매니저 이상), 그 외 필드는 고객 수정 권한
  const profile = field === 'assigned_employee_id'
    ? await requirePermission('customer_assign')
    : await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 점검계획일은 필수값 — 비우기 불허 (2026-07-14: "지우면 폴백 복귀" 설계 폐기)
  if (field === 'plan_anchor_date' && !value) {
    return { error: '점검계획일은 필수값입니다 — 비울 수 없습니다.' }
  }

  // 이전 값 조회 (변경 감지 + 이력 기록용)
  const { data: prevData } = await admin
    .from('customers')
    .select('customer_name, inspection_type, contract_date, use_approval_date, plan_anchor_date, assigned_employee_id')
    .eq('id', customerId).single()
  const prevRow = prevData as Record<string, string | null> | null
  const oldValue = prevRow?.[field] ?? null

  // 기준일 변경 + 확정 일정 존재 시(B안): 사용자 선택 전에는 저장하지 않고 목록 반환
  // 사용승인일은 기준일이 아니므로 재계산 트리거 아님 (2026-07-14 폴백 제거)
  const isAnchorField = field === 'plan_anchor_date'
  let confirmedItems: ConfirmedPlanItemInfo[] = []
  if (isAnchorField && (value || null) !== oldValue) {
    confirmedItems = await _getUnconfirmablePlanItems(admin, customerId)
    if (confirmedItems.length > 0 && !opts?.confirmedDecision) {
      return { requiresConfirmedDecision: true, confirmedItems }
    }
  }

  const patchFields: Record<string, unknown> = { [field]: value || null, updated_at: new Date().toISOString() }
  if (field === 'inspection_type' && value) {
    patchFields.inspection_category = value === '일반관리' ? '일반관리' : '소방안전관리'
    patchFields.inspection_sub_type = value === '종합' ? '종합' : value === '작동' ? '작동' : null
  }
  const { error } = await admin
    .from('customers')
    .update(patchFields)
    .eq('id', customerId)

  if (error) return { error: '수정에 실패했습니다.' }

  // 기준일 관련 필드 변경 시 미확정(planned) 항목 재계산 — 변경 안 된 쪽은 기존 값 유지.
  // 확정(confirmed)은 기본 유지 — '확정해지 후 재계산' 선택 시만 planned 복귀 후 포함
  if (isAnchorField && (value || null) !== oldValue) {
    if (opts?.confirmedDecision === 'unconfirm' && confirmedItems.length > 0) {
      await admin.from('inspection_plan_items')
        .update({ status: 'planned' } as Record<string, unknown>)
        .in('id', confirmedItems.map(i => i.id))
    }
    if (prevRow?.inspection_type === '일반관리') {
      // 일반관리: 1회성 event를 새 점검계획일로 삭제 후 재생성(자동 확정) — 달이 바뀌어도 해당 월 계획으로 정확히 이동
      // 자동 확정 상태(confirmed)도 계획일이 곧 확정일이므로 함께 교체 — 점검 시작된 항목만 불변
      await admin.from('inspection_plan_items').delete()
        .eq('customer_id', customerId).in('status', ['planned', 'confirmed'])
        .eq('plan_type', 'event').is('inspection_id', null)
      if (value) {
        await _createGeneralEventItem(admin, customerId, value, prevRow?.assigned_employee_id ?? null, profile.id)
      }
    } else {
      await _resetPlanItemsForCustomer(admin, customerId, {
        plan_anchor_date: field === 'plan_anchor_date' ? (value || null) : (prevRow?.plan_anchor_date ?? null),
      })
    }
  }

  // 점검유형 변경 → 미확정(planned) 계획 항목 유형 동기화 (변경전파맵 1-11)
  if (field === 'inspection_type' && value && value !== oldValue) {
    await _syncInspectionTypeToPlanItems(admin, customerId, value as InspectionType, profile.id)
    revalidatePath('/inspection-plans')
    revalidatePath('/inspections/calendar')
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

  // activity_logs 변경 이력 기록 — 담당직원은 UUID가 아닌 이름으로 기록
  if (value !== oldValue) {
    let logOld: string | null = oldValue
    let logNew: string | null = value
    if (field === 'assigned_employee_id') {
      const ids = [oldValue, value].filter(Boolean) as string[]
      const { data: namesRaw } = ids.length
        ? await admin.from('profiles').select('id, name').in('id', ids)
        : { data: [] }
      const nameMap = new Map(((namesRaw ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p.name]))
      logOld = oldValue ? nameMap.get(oldValue) ?? oldValue : null
      logNew = value ? nameMap.get(value) ?? value : null
    }
    await admin.from('activity_logs').insert({
      actor_id: profile.id,
      action: 'customer_field_changed',
      entity_type: 'customer',
      entity_id: customerId,
      metadata: {
        changes: [{ field, field_label: CUSTOMER_FIELD_LABELS[field] ?? field, old_value: logOld, new_value: logNew }],
      },
    } as Record<string, unknown>)
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
  if (field === 'plan_anchor_date') revalidatePath('/inspection-plans')
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
