'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'
import { extractRegionFromAddress, extractRoadName, addressDupKey } from '@/lib/address-parser'
import { customerNameDupKey } from '@/lib/customer-dup'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { resolveFireStation } from '@/lib/fire-station'
import { generateRollingPlanItems, loadAnchorDates, loadAnchorManualFlag } from '@/lib/inspection-plan-generator'
// `anchorChanged`는 이 파일의 지역 변수명과 겹쳐 별칭으로 들여온다(변수를 함수로 덮으면 조용히 항상-false가 된다)
import { anchorChanged as anchorChangedFn } from '@/lib/plan-anchor'
import { recalcIsInitialForCustomer } from '@/lib/inspection-initial'
import { syncStartedRowSubTypes } from '@/lib/inspection-row-sync'
import { reconcileSpecialSlots, planReconcile } from '@/lib/reconcile-special-slots'
import { anchorSourceLabel } from '@/lib/plan-anchor'
import { rowInspectionType, rowSubType } from '@/lib/inspection-round'
import { notifyIfEnabled, allowsNotification } from '@/lib/notify'
import { formatTel } from '@/lib/format-contact'
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
  /** 일반관리 고객의 자체점검 종류 (소방계획서_6 W-2 — 일반관리도 종합/작동 필수).
   *  소방안전관리는 inspection_type('종합'|'작동')에서 유도하므로 생략 가능 */
  inspection_sub_type?: '종합' | '작동'
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
  /** 소방안전관리등급 = customers.building_grade (별표4 **대상물** 급수).
   *  선택 입력 — 2·3급은 설비 설치 여부로 갈리는데 등록 시점엔 설비 대장이 없다(2026-08-20 확정). */
  building_grade?: string
  // 092: 법정동코드·지번주소 (건축물대장 재조회 원클릭화 — 탭개편 설계 §5-A-5)
  building_bcode?: string
  building_address_jibun?: string
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
  // 098 확장 — 건축허가일·건축면적·건물동수·주차장. 대장이 준 값을 등록 단계가 버려
  // 갑지 엑셀·별지 9호 2쪽이 공란으로 나가던 것 보완(2026-09-05)
  building_permit_date?: string
  building_area?: number          // 건축면적(㎡) — building_total_area(연면적)와 다른 축
  building_count?: number         // 건물동수
  building_parking_summary?: string
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
): Promise<{
  error?: string
  customerId?: string
  /** 중복으로 막혔을 때의 기존 고객 — 화면이 [기존 고객 보기]로 안내한다 */
  duplicateCustomer?: NameDuplicateCustomer
  duplicateCustomerId?: string
}> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 대표 관계인 1명 필수 (V9 §9)
  const hasRep = (input.contacts ?? []).some(c => c.role === '대표' && c.name?.trim())
  if (!hasRep) return { error: '대표 관계인 이름을 입력해주세요. (대표 1명 필수)' }

  // 점검계획일 필수 — 연간 점검계획의 기산점 (수동 최우선)
  if (!input.plan_anchor_date) return { error: '점검계획일을 입력해주세요.' }

  // 사용승인일 필수 — **신규 등록만**. 법정 점검 시기(종합=사용승인월, 작동=+6개월)와
  // 최초점검(사용승인일+60일) 판정이 전부 이 값에서 나온다.
  // ⚠ `updateCustomerAction`에는 일부러 걸지 않는다 — 값이 비어 있는 기존 고객
  //   (스테이징 실측 55/301)이 수정 자체를 못 하게 되면 업무가 멈춘다. 그쪽은 경고 배지로 유도한다.
  if (!input.use_approval_date) return { error: '사용승인일을 입력해주세요.' }

  // 일반관리도 종합/작동 필수 (소방계획서_6 W-2 — sub_type null 매핑 제거)
  if (input.inspection_type === '일반관리' && !input.inspection_sub_type) {
    return { error: '일반관리 고객도 점검 종류(종합/작동)를 선택해주세요.' }
  }

  // 소방안전관리등급 — 미선택은 허용(선택 입력), 값이 왔다면 규약 안이어야 한다.
  // 별지 9호 2쪽 체크는 화이트리스트로 거르므로, 규약 밖 값이 들어오면 조용히 공란으로 인쇄될 뿐이다 — 저장 때 막는다.
  if (input.building_grade && !['특급', '1급', '2급', '3급'].includes(input.building_grade)) {
    return { error: '소방안전관리등급 값을 확인해주세요.' }
  }

  // 건물 숫자 필드 검증 (IMP-10) — 음수/비상식 값 차단
  const nowYear = new Date().getFullYear()
  const numErr = validateBuildingNumbers({
    total_area: input.building_total_area,
    floors_above: input.building_floors_above,
    floors_below: input.building_floors_below,
    year_built: input.building_year_built,
  }, nowYear)
  if (numErr) return { error: numErr }

  // 고객코드 충돌 — 등록 버튼 연타의 두 번째 제출이 여기서 막힌다(코드는 폼이 미리 받아 둔 값이라 같다).
  // 종전 메시지는 코드만 알려 줘서 **무엇이 이미 등록됐는지** 알 수 없었다. 이름을 함께 싣는다.
  const { data: existing } = await admin
    .from('customers')
    .select('id, customer_name')
    .eq('customer_code', input.customer_code)
    .single()
  if (existing) {
    const e = existing as { id: string; customer_name: string }
    return {
      error: `고객코드 "${input.customer_code}"는 이미 「${e.customer_name}」에 사용 중입니다. 방금 등록이 완료된 건일 수 있으니 고객 목록에서 확인해주세요.`,
      duplicateCustomerId: e.id,
    }
  }

  // 고객명 중복 — 차단. 같은 이름이 이미 있으면 새로 만들지 않고 기존 고객으로 안내한다.
  // ⚠ 조회 실패(`failed`)는 '중복 없음'이 아니다. 다만 인프라 일시 오류로 **등록 자체를 막지는
  //   않는다** — 이 가드는 안전 불변식이 아니라 실수 방지 장치이고, DB에 유니크 제약도 없다.
  //   대신 로그를 남겨 조용히 꺼진 것을 나중에 알아볼 수 있게 한다.
  const nameDup = await findCustomerByName(input.customer_name.trim())
  if (nameDup.failed) {
    console.error(`[customer-dup] 중복 판정 없이 등록 진행: ${input.customer_name}`)
  } else if (nameDup.dup) {
    return {
      error: `「${nameDup.dup.customer_name}」은(는) 이미 등록된 고객입니다. (고객코드 ${nameDup.dup.customer_code}) 새로 등록하지 말고 기존 고객을 확인해주세요.`,
      duplicateCustomer: nameDup.dup,
      duplicateCustomerId: nameDup.dup.id,
    }
  }

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
    // 일반관리도 종합/작동 저장 (소방계획서_6 W-2) — null 매핑 제거
    inspection_sub_type: input.inspection_type === '종합' ? '종합'
      : input.inspection_type === '작동' ? '작동'
      : input.inspection_sub_type!,
    address: input.address || null,
    notes: input.notes || null,
    assigned_employee_id: input.assigned_employee_id || null,
    // 소방안전관리등급(별표4 대상물 급수) — 선택 입력이라 미선택은 null (등록을 막지 않는다)
    building_grade: input.building_grade || null,
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

  // 이 뒤의 후속 작업은 서로를 기다릴 이유가 없다 — 원격 DB 왕복이 200ms대라 직렬로 두면
  // 등록 버튼 체감이 그만큼 늘어난다. 관계인·담당자 알림·이력·건물·연간계획을 병렬로 돌린다.
  // (고객 행은 위에서 이미 만들어졌으므로 순서 의존이 없다)
  const validContacts = input.contacts.filter(c => c.name.trim())
  const contactsTask = validContacts.length > 0
    ? admin.from('customer_contacts').insert(
      validContacts.map(c => ({
        customer_id: customerId,
        role: c.role,
        name: c.name.trim(),
        phone: c.phone?.trim() || null,
        email: c.email?.trim() || null,
        // 대표만 기본 수신(2026-08-19 사용자 확정) — 전원을 켜면 정기 고객은 연 12회 × 인원수로
        // 문자량이 몇 배가 된다. 대표 1명은 종전 폴백과 결과가 같아 비용이 늘지 않는다.
        ...(c.role === '대표' ? { sms_recipient: true } : {}),
      })) as Record<string, unknown>[])
    : Promise.resolve()

  // 담당자 이름은 **활동이력 문구에만** 쓰이므로 이 갈래만 순서를 지킨다(조회 → 알림 → 이력)
  const logTask = (async () => {
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
  })()

  // buildings 테이블에 자동 생성 (V9-3: 건물 기본정보 포함)
  const buildingTask = (async () => {
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
    // 098 확장 — refreshLedgerAction(:207-210)과 같은 4종. 42703 폴백은 아래 attempts가 담당
    if (input.building_permit_date)            ledgerFields.permit_date = input.building_permit_date
    if (input.building_area != null)           ledgerFields.building_area = input.building_area
    if (input.building_count != null)          ledgerFields.building_count = input.building_count
    if (input.building_parking_summary)        ledgerFields.parking_summary = input.building_parking_summary
    if (Object.keys(ledgerFields).length > 0)  ledgerFields.ledger_synced_at = new Date().toISOString()

    // 092: bcode·지번주소 (있을 때만)
    const fields092: Record<string, unknown> = {}
    if (input.building_bcode) fields092.bcode = input.building_bcode
    if (input.building_address_jibun) fields092.address_jibun = input.building_address_jibun

    // 단계적 폴백: 전체(092 포함) → 092 제외 → 037 필드만(038 미적용) → 기본 필드만(037 미적용)
    const FIELDS_037 = ['height', 'main_structure', 'elevator_count', 'households', 'ledger_synced_at']
    const ledger037: Record<string, unknown> = Object.fromEntries(
      Object.entries(ledgerFields).filter(([k]) => FIELDS_037.includes(k))
    )
    const attempts: Record<string, unknown>[] = [
      { ...buildingBase, ...ledgerFields, ...fields092, zipcode: input.zipcode || null },
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
  })()

  // 점검계획일(필수) 기준 연간 점검계획 항목 자동 생성 (V9-9)
  const planTask = _autoCreatePlanItemsForNewCustomer(
    admin, customerId,
    {
      inspection_type: input.inspection_type,
      inspection_sub_type: input.inspection_type === '종합' ? '종합'
        : input.inspection_type === '작동' ? '작동'
        : input.inspection_sub_type ?? '작동',
      plan_anchor_date: input.plan_anchor_date,
      assigned_employee_id: input.assigned_employee_id || null,
    },
    profile.id,
  )

  // 하나라도 실패하면 등록 자체를 실패로 보고해야 한다 — 조용히 반쪽 등록되는 것이 더 나쁘다
  await Promise.all([contactsTask, logTask, buildingTask, planTask])

  revalidatePath('/customers')
  revalidatePath('/inspection-plans')
  return { customerId }
}

/** V9-1/V9-9: 신규 고객 등록 시 점검계획일(수동 최우선) 기반 점검계획 항목 자동 생성
 *  - 소방안전관리: 특별점검달(special_종합/special_작동) + 나머지 11/10개월(monthly) = 12회/년
 *  - 일반관리: 소방안전관리와 동일 파이프라인, 정기(monthly)만 미생성 (소방계획서_6 W-9 — event 폐지) */
async function _autoCreatePlanItemsForNewCustomer(
  admin: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  customerId: string,
  info: {
    inspection_type: InspectionType; inspection_sub_type: '종합' | '작동'
    plan_anchor_date: string; assigned_employee_id: string | null
  },
  createdBy: string,
) {
  const anchorDate = new Date(info.plan_anchor_date)
  const now        = new Date()
  const targetYear = anchorDate.getFullYear() >= now.getFullYear()
    ? anchorDate.getFullYear()
    : now.getFullYear()

  // 롤링: 등록 즉시 올해+내년 생성 — 이후 연도는 매월 크론이 이어받는다
  await generateRollingPlanItems(admin, { id: customerId, ...info }, targetYear, createdBy)
}

// (소방계획서_6 W-26) 일반관리 event 생성·동기화 헬퍼(_ensureMonthPlan·_createGeneralEventItem·
// _syncStartedGeneralEvent) 제거 — 일반관리도 특별(special_*) 파이프라인으로 통일, event는 신규 생성 중단.
// 기존 완료 event 건은 읽기 전용 보존(D-4), 미시작·진행 중 건은 소급 스크립트(W-12)가 정리.

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
  revalidatePath('/inspections/sms')
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
  /** 자체점검 종류 (소방계획서_6 W-1·W-2) — 일반관리 고객의 종합/작동 지정·변경.
   *  미지정 시: 소방안전관리는 inspection_type에서 유도, 일반관리는 기존 값 유지(없으면 '작동') */
  inspection_sub_type?: '종합' | '작동'
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
 *  일반관리 event·정기(monthly)는 제외 — 자동 확정 항목이라 기준일 변경 시 재생성/재계산으로
 *  즉시 따라가며 확정보호 팝업 대상이 아님 (B안 + 정기 자동확정, 2026-07-14) */
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
    // legacy 항목의 plan_type null은 소방 특별 — neq 쿼리는 null까지 걸러내므로 JS에서 제외
    .filter(r => !['event', 'monthly'].includes((r.plan_type as string | null) ?? ''))
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

/** 점검유형 변경 시 계획 항목 동기화 — 대상: planned + 자동 확정 정기(confirmed monthly, 미시작).
 *  사람이 확정한 특별점검(confirmed special)·완료·취소는 불변 (변경전파맵 1-11)
 *  소방계획서_6: 일반관리도 특별(special_*) 파이프라인 — 전 유형 공통 로직으로 통일.
 *  - 종합/작동 간 전환: inspection_type·sub_type·plan_type(special_종합↔special_작동) 갱신.
 *    단 **행 축으로 내려서** 적용한다 — 2차 행은 고객이 종합이어도 작동이다 (소방계획서_33 D33-1)
 *  - 작동 전환: 미확정 2차 특별점검 삭제 (연 1회) / 종합 전환: 연간 항목 보충 생성(멱등, 2차 포함)
 *    ※ 이 2차 삭제·보충 판정은 **고객 축**(newSubType)이 맞다 — 2차가 존재해야 하는지는 고객이 정한다
 *  - 일반관리 전환: 미시작 정기(monthly) 삭제 (일반관리는 정기 미생성 — 유일한 차이)
 *  - 레거시 event(미시작)는 새 체계와 무관 — 항상 삭제 (완료 건은 보존) */
async function _syncInspectionTypeToPlanItems(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
  newType: InspectionType,
  newSubType: '종합' | '작동',
  actorId: string,
) {
  const newCategory = newType === '일반관리' ? '일반관리' : '소방안전관리'
  // 자동 확정 정기 포함 미시작 항목 필터 (planned 전체 + confirmed monthly)
  const UNSTARTED_OR = 'status.eq.planned,and(status.eq.confirmed,plan_type.eq.monthly)'

  // 레거시 event(자동 확정 포함, 미시작)는 어느 유형에서도 신규 체계와 무관 — 삭제
  await admin.from('inspection_plan_items').delete()
    .eq('customer_id', customerId).in('status', ['planned', 'confirmed'])
    .eq('plan_type', 'event').is('inspection_id', null)

  // 일반관리 전환: 정기(monthly)는 대상 아님 — 미시작 정기 삭제
  if (newCategory === '일반관리') {
    await admin.from('inspection_plan_items').delete()
      .eq('customer_id', customerId).eq('plan_type', 'monthly')
      .is('inspection_id', null).in('status', ['planned', 'confirmed'])
  }

  // sequence_num을 함께 읽는다 — 이게 없으면 아래 루프가 2차 행까지 고객 축 값으로 덮어써서
  // **고객 정보를 다시 저장하기만 해도 2차가 종합으로 원복된다**(소방계획서_33 S2-4의 조용한 회귀).
  const { data: items } = await admin
    .from('inspection_plan_items')
    .select('id, plan_type, sequence_num')
    .eq('customer_id', customerId)
    .is('inspection_id', null)
    .or(UNSTARTED_OR)
  for (const it of (items ?? []) as Array<{ id: string; plan_type: string | null; sequence_num: number }>) {
    // 행 축으로 내려 적용 — 2차는 고객이 종합이어도 작동이다
    const rowSub = rowSubType(newSubType, it.sequence_num)
    // plan_type null 레거시는 특별점검 — special_*와 함께 새 서브로 이관
    const newPlanType = (!it.plan_type || it.plan_type.startsWith('special_')) ? `special_${rowSub}` : it.plan_type
    await admin.from('inspection_plan_items')
      .update({
        inspection_type: rowInspectionType(newType, newSubType, it.sequence_num),
        inspection_category: newCategory,
        inspection_sub_type: rowSub,
        plan_type: newPlanType,
      } as Record<string, unknown>)
      .eq('id', it.id)
  }
  if (newSubType === '작동') {
    await admin.from('inspection_plan_items').delete()
      .eq('customer_id', customerId).eq('status', 'planned').eq('sequence_num', 2)
  }
  // 누락 항목 보충 생성 — 작동→종합의 2차 특별점검, 소방 전환의 정기 등.
  // 기존 (plan, customer, sequence) 항목은 UNIQUE 충돌로 건너뜀(멱등)
  const { data: custRaw } = await admin.from('customers')
    .select('plan_anchor_date, assigned_employee_id')
    .eq('id', customerId).single()
  if (custRaw) {
    const cust = custRaw as { plan_anchor_date: string | null; assigned_employee_id: string | null }
    // 롤링: 내년분이 이미 생성돼 있으므로 보충도 올해+내년 양쪽에 — 올해만 보충하면
    // 작동→종합 전환 시 내년 2차 특별점검이 빠진 채 남는다
    await generateRollingPlanItems(
      admin,
      { id: customerId, inspection_type: newType, inspection_category: newCategory, inspection_sub_type: newSubType, ...cust },
      new Date().getFullYear(), actorId,
    )
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
    .select('customer_name, inspection_type, inspection_sub_type, contract_date, use_approval_date, plan_anchor_date, address, fire_station')
    .eq('id', customerId).single()
  const prev = prevCustomer as {
    customer_name: string; inspection_type: string; inspection_sub_type: string | null; contract_date: string | null
    use_approval_date: string | null; plan_anchor_date: string | null; address: string | null; fire_station: string | null
  } | null
  const prevAnchorDate = prev?.plan_anchor_date ?? null

  // 고객명 중복 — 등록만 막으면 **이름을 고쳐서** 같은 이름을 만들 수 있다(인라인 필드 편집 포함).
  // 값이 실제로 바뀔 때만 검사한다 — 다른 필드만 고치는 호출에서 매번 전량 조회를 돌 이유가 없고,
  // 자기 이름을 그대로 다시 저장하는 것도 막히면 안 된다.
  if (input.customer_name !== undefined
      && input.customer_name.trim()
      && customerNameDupKey(input.customer_name) !== customerNameDupKey(prev?.customer_name ?? '')) {
    const nameDup = await findCustomerByName(input.customer_name.trim(), customerId)
    if (nameDup.failed) {
      console.error(`[customer-dup] 중복 판정 없이 수정 진행: ${input.customer_name}`)
    } else if (nameDup.dup) {
      return {
        error: `「${nameDup.dup.customer_name}」은(는) 이미 등록된 고객입니다. (고객코드 ${nameDup.dup.customer_code}) 다른 이름을 쓰거나 기존 고객을 확인해주세요.`,
      }
    }
  }

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
    // 일반관리도 종합/작동 유지 (소방계획서_6 W-2) — 명시값 > 기존값 > '작동'(백필 기본과 동일)
    updateFields.inspection_sub_type = input.inspection_type === '종합' ? '종합'
      : input.inspection_type === '작동' ? '작동'
      : input.inspection_sub_type ?? (prev?.inspection_sub_type === '종합' ? '종합' : '작동')
  } else if (input.inspection_sub_type !== undefined) {
    // 유형은 그대로, 종류만 변경 (일반관리 종합↔작동 지정 — D-2 개별 수정 경로)
    updateFields.inspection_sub_type = input.inspection_sub_type
  }
  if (Object.keys(updateFields).length === 0) return {}

  // D-3(2026-08-07): 주소를 저장하는데 관할 소방서가 비어 있으면 자동 지정 — 수기 도로명 보정 등
  // 주소 원클릭(quickAddressApplyAction)을 거치지 않는 경로에서도 공란이 남지 않게 한다.
  // 사용자가 명시적으로 보낸 fire_station은 건드리지 않는다(수동 입력 우선).
  const addrSaved = input.address !== undefined && !!input.address
  const stationEmpty = input.fire_station !== undefined
    ? !input.fire_station
    : !prev?.fire_station
  if (addrSaved && stationEmpty) {
    const resolved = await resolveFireStation(admin, {
      regionMyeon: input.region_myeon, regionSi: input.region_si, address: input.address,
    })
    if (resolved) {
      updateFields.fire_station = resolved.station
      updateFields.fire_station_source = resolved.source   // C-1 추정 배지 판정용
    }
  } else if (input.fire_station && input.fire_station !== prev?.fire_station) {
    // 사용자가 소방서를 **바꿔서** 보낸 경우만 '추정'이 아니게 된다 — 배지가 남지 않도록 출처를 지운다.
    // BLK-1(독립검증): 종전엔 `input.fire_station`만 보고 판단했는데, 기본정보 폼은 dirty-diff 없이
    // 전 필드를 항상 전송하므로 **비고만 고쳐 저장해도** 출처가 지워지고(배지 영구 소멸),
    // 마이그레이션 115 미적용 환경에서는 이 컬럼 때문에 저장 자체가 실패했다.
    updateFields.fire_station_source = null
  }

  // 관할 소방서는 필수값 (2026-08-20 사용자 확정) — 위 자동 지정까지 끝난 **최종 값**으로 판정한다.
  // 자동 지정 앞에 두면 '주소는 있고 소방서만 빈' 저장이 매핑 기회를 잃는다(실측: 그런 17건이 17/17 성공).
  // 소방서를 아예 안 보내는 부분 호출(점검유형 변경 모달 등)은 대상이 아니다 — 건드리지도 않은 값 때문에
  // 기존 공란 고객이 무관한 수정에서까지 막히면 안 된다([[feedback_guard_blast_radius]]).
  if (input.fire_station !== undefined && !String(updateFields.fire_station ?? '').trim()) {
    return { error: '관할 소방서는 필수값입니다 — 주소 검색으로 자동 입력하거나 직접 입력해주세요.' }
  }

  // 기산점 변경 판정 — **해석 결과**를 비교한다(필드 하나가 아니라).
  //
  // ⚠ 종전엔 `plan_anchor_date`만 봤고 주석도 '사용승인일은 기준일이 아니다'라 적혀 있었다.
  //   기산점이 사용승인일 축으로 옮겨간 뒤 그 판정은 **사용승인일 변경을 통째로 놓쳤다** —
  //   기존 월이 안 고쳐지고, 확정 일정 보호 팝업이 안 뜨고, `plan_id`가 (연,월) 단위라
  //   다음 생성 때 새 월에 회차가 하나 더 생긴다. 반대로 manual=true 고객의 사용승인일 변경은
  //   기산점을 안 움직이므로 **재계산도 팝업도 뜨면 안 된다**. 둘 다 anchorChanged가 가른다.
  const anchorManual = await loadAnchorManualFlag(admin, customerId)
  const nextUseApproval = input.use_approval_date !== undefined
    ? (input.use_approval_date || null) : (prev?.use_approval_date ?? null)
  const nextPlanAnchor = input.plan_anchor_date !== undefined ? input.plan_anchor_date : prevAnchorDate
  const anchorChanged = anchorChangedFn(
    { use_approval_date: prev?.use_approval_date ?? null, plan_anchor_date: prevAnchorDate, plan_anchor_manual: anchorManual },
    { use_approval_date: nextUseApproval, plan_anchor_date: nextPlanAnchor, plan_anchor_manual: anchorManual },
  )
  // 사용승인일이 실제로 바뀌었는가 — 최초점검(사용승인일+60일) 재판정의 방아쇠.
  // 기산점 변경과 **별개 축**이다: manual=true 고객은 기산점이 안 움직여도 최초점검 판정은 바뀐다.
  const approvalChanged = nextUseApproval !== (prev?.use_approval_date ?? null)
  const newAnchorDate = nextPlanAnchor

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

  // 미적용 컬럼 재시도 — 마이그레이션이 아직 안 간 환경(운영 선배포 등)에서 저장 전체가 죽지 않게 한다.
  // BLK-1(독립검증): 종전에는 zipcode만 봐서, 115 미적용 상태에 코드가 먼저 배포되면
  // fire_station_source 때문에 고객 저장·주소검색이 전면 실패했다.
  const OPTIONAL_COLUMNS = ['zipcode', 'fire_station_source'] as const
  for (const col of OPTIONAL_COLUMNS) {
    if (!error?.message?.includes(col)) continue
    const { [col]: _drop, ...withoutCol } = updateFields
    void _drop
    const retry = await admin.from('customers').update(withoutCol).eq('id', customerId)
    error = retry.error
    delete updateFields[col]
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
    // 일반관리 포함 전 유형 동일 재계산 (소방계획서_6 — event 특례 제거)
    await _resetPlanItemsForCustomer(admin, customerId, { plan_anchor_date: newAnchorDate })
  }

  // 사용승인일이 바뀌면 최초점검(사용승인일+60일)을 다시 판정한다 — 생성 시점에 굳은 값이
  // 날짜 정정을 안 따라오면 별지 9호의 [√]최초점검이 사실과 어긋난 채 인쇄된다.
  // 수동 지정분은 보존하고, 출처 컬럼이 없으면 아예 건너뛴다(구별 못 하면 덮지 않는다).
  if (approvalChanged) {
    await recalcIsInitialForCustomer(admin, customerId)
    // 시작·완료된 올해 이후 행의 종합/작동 축도 현재 고객 축으로 동기화 (2026-09-02 —
    // 미시작만 재배치하면 이미 시작된 행이 옛 종류로 남아 엑셀·별지가 낡은 값을 인쇄한다)
    await syncStartedRowSubTypes(admin, customerId)
  }

  // 점검유형·종류 변경 → 미확정(planned) 계획 항목 유형 동기화 (변경전파맵 1-11)
  const effType = (updateFields.inspection_type as InspectionType | undefined) ?? (prev?.inspection_type as InspectionType | undefined)
  const effSub  = (updateFields.inspection_sub_type as '종합' | '작동' | undefined)
    ?? (prev?.inspection_sub_type === '종합' ? '종합' : '작동')
  const typeChanged = input.inspection_type !== undefined && prev && input.inspection_type !== prev.inspection_type
  const subChanged  = updateFields.inspection_sub_type !== undefined && prev && updateFields.inspection_sub_type !== prev.inspection_sub_type
  if ((typeChanged || subChanged) && effType) {
    await _syncInspectionTypeToPlanItems(admin, customerId, effType, effSub, profile.id)
    await syncStartedRowSubTypes(admin, customerId)   // 시작된 행도 (2026-09-02)
    revalidatePath('/inspections/calendar')
  }

  // **변동 = 재계산**(사용자 결정 2026-09-01) — 기산점이나 점검종류가 바뀌면 특별점검이
  // 법정 달에 앉도록 자리를 다시 맞춘다. 위 두 블록만으로는 **달이 안 옮겨진다**:
  // 재계산은 plan_id를 안 건드리고(일자만), 생성기는 정기가 seq=1로 자리를 점유하면
  // UNIQUE 충돌로 조용히 건너뛴다. 그 구멍을 여기서 닫는다.
  // ⚠ 유형 동기화 **뒤에** 둔다 — 그쪽이 종류를 바꾼 결과 위에서 자리를 잡아야 한다.
  if (anchorChanged || typeChanged || subChanged) {
    const y = new Date().getFullYear()
    await reconcileSpecialSlots(admin, customerId, [y, y + 1], profile.id)
    revalidatePath('/inspection-plans')
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
  // 재계산 대상: 미확정(planned) + 자동 확정 정기(confirmed monthly, 미시작 — 2026-07-14 자동 확정 도입).
  // 사람이 확정한 특별점검(confirmed special)·완료·취소 항목은 재계획하지 않음 (2026-07-12 결정)
  const { data: items } = await admin
    .from('inspection_plan_items')
    .select('id, status, plan_type, inspection_plans!inner(year, month)')
    .eq('customer_id', customerId)
    .is('inspection_id', null)
    .or('status.eq.planned,and(status.eq.confirmed,plan_type.eq.monthly)')

  if (!items || items.length === 0) return

  // 기준일: 점검계획일(수동) → 최초 점검시작일 (모두 없으면 planned_date null)
  const anchorDate = (await loadAnchorDates(admin, [{ id: customerId, ...newDates }])).get(customerId) ?? null

  // 영업일 계산 헬퍼
  function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }

  // 영향 범위 내 공휴일 일괄 조회 — 롤링 생성으로 내년 12월 항목까지 존재하므로
  // 항목이 걸친 마지막 연도 말까지 커버 (종전 +8개월 창은 내년 후반 항목이 공휴일을 놓쳤다)
  const now = new Date()
  const maxItemYear = Math.max(
    now.getFullYear(),
    ...items.map(it => ((it as Record<string, unknown>).inspection_plans as { year: number } | null)?.year ?? 0),
  )
  const startStr = toDateStr(now)
  const endStr = `${maxItemYear}-12-31`
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

  const stepResetFields = {
    step1_date: null, step2_date: null, step3_date: null,
    step4_date: null, step5_date: null, step6_date: null,
  }
  // 특별점검(planned): 관리자 재확정 필요 — 확정일 초기화
  const resetFields: Record<string, unknown> = {
    status: 'planned',
    scheduled_date: null,
    ...stepResetFields,
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

    // 자동 확정 정기: 확정 유지 + 확정일도 새 기준일로 동행 (수동 재확정 불필요)
    const it = item as Record<string, unknown>
    const isAutoMonthly = it.plan_type === 'monthly' && it.status === 'confirmed'
    const patch: Record<string, unknown> = isAutoMonthly
      ? { status: 'confirmed', scheduled_date: newPlannedDate, ...stepResetFields }
      : resetFields

    await admin
      .from('inspection_plan_items')
      .update({ ...patch, planned_date: newPlannedDate } as Record<string, unknown>)
      .eq('id', (item as Record<string, unknown>).id as string)
  }
}

/** 저장 **전** 미리보기 — 사용승인일·점검계획일·점검종류를 바꾸면 계획이 어떻게 되는지.
 *
 *  ⚠ **실행과 같은 함수를 쓴다**(`planReconcile`). 미리보기를 따로 짜면 "보여준 것과 다른 일이
 *  벌어지는" 최악이 된다 — 이 저장소가 PDF와 엑셀을 같은 조립에 묶어 둔 이유와 같다(D-7).
 *  아무것도 쓰지 않는다(읽기 전용). */
export async function previewAnchorChangeAction(
  customerId: string,
  proposed: { use_approval_date?: string | null; plan_anchor_date?: string | null; inspection_sub_type?: string | null },
): Promise<{
  error?: string
  before?: AnchorPreview
  after?: AnchorPreview
  /** 기준일이 바뀌어도 자동으로 안 바뀌는 확정 일정 — 미리보기와 **한 화면**에서 함께 묻는다.
   *  종전엔 저장 → 확정팝업으로 **두 번 멈췄다**. 사용자는 한 번만 결정하면 된다. */
  confirmedItems?: ConfirmedPlanItemInfo[]
}> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const y = new Date().getFullYear()
  const [b, a, confirmedItems] = await Promise.all([
    planReconcile(admin, customerId, [y, y + 1]),
    planReconcile(admin, customerId, [y, y + 1], proposed),
    _getUnconfirmablePlanItems(admin, customerId),
  ])
  if (!b || !a) return { error: '고객을 찾을 수 없습니다.' }
  const shape = (p: NonNullable<typeof b>): AnchorPreview => ({
    anchorDate: p.anchor.date,
    anchorSource: anchorSourceLabel(p.anchor.source),
    divergent: p.anchor.divergent,
    months: p.desired.map(d => ({ seq: d.sequence_num, month: d.month, planType: d.planType })),
    initialWindow: p.initialWindow,
    // 화면은 op 종류별로 나눠 보여준다 — '무엇이 생기고 사라지고 옮겨지는가'
    creates: p.ops.flatMap(o => o.kind === 'create' ? [{ year: o.year, month: o.month, seq: o.sequence_num, planType: o.planType }] : []),
    promotes: p.ops.flatMap(o => o.kind === 'toSpecial' ? [{ year: o.year, month: o.month, from: o.from, planType: o.planType }] : []),
    demotes: p.ops.flatMap(o => o.kind === 'toMonthly' ? [{ year: o.year, month: o.month, from: o.from }] : []),
    removes: p.ops.flatMap(o => o.kind === 'remove' ? [{ year: o.year, month: o.month, from: o.from }] : []),
    keptStarted: p.keptStarted.map(k => ({ year: k.year, month: k.month, planType: k.plan_type })),
  })
  return { before: shape(b), after: shape(a), confirmedItems }
}

export type AnchorPreview = {
  anchorDate: string | null
  anchorSource: string
  divergent: boolean
  months: Array<{ seq: number; month: number; planType: string }>
  initialWindow: { from: string; to: string } | null
  creates: Array<{ year: number; month: number; seq: number; planType: string }>
  promotes: Array<{ year: number; month: number; from: string | null; planType: string }>
  demotes: Array<{ year: number; month: number; from: string | null }>
  removes: Array<{ year: number; month: number; from: string | null }>
  keptStarted: Array<{ year: number; month: number; planType: string | null }>
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
        phone: contact.phone?.trim() ? formatTel(contact.phone) : null,
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
        phone: contact.phone?.trim() ? formatTel(contact.phone) : null,
        email: contact.email?.trim() || null,
        position: contact.position?.trim() || null,
        birth_date: contact.birth_date || null,
        // 대표는 기본 수신(2026-08-19 사용자 확정). 나머지는 미지정(NULL)으로 두어
        // 필요할 때만 켜게 한다 — 전원 기본 체크는 문자량이 인원수만큼 곱해진다.
        ...(contact.role === '대표' ? { sms_recipient: true } : {}),
      } as Record<string, unknown>)
    if (error) return { error: '관계인 등록에 실패했습니다.' }
  }

  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 관계인별 '문자 받음' 지정 (소방계획서_24 S5-b / Q-10)
 *
 *  이 고객의 관계인 중 하나라도 체크돼 있으면 **체크된 사람들에게만** 사전 안내 문자가 간다.
 *  전원 미지정(NULL)이면 종전과 같이 우선순위 1명(대표 등)에게만 간다 —
 *  폴백이 있어야 기존 고객 수백 곳을 일괄 설정하지 않아도 되고, 도입만으로
 *  문자량이 몇 배가 되는 사고도 없다.
 *
 *  편집 폼이 아니라 전용 토글로 둔 이유: 수신 지정은 연락처 '내용' 수정이 아니라
 *  발송 대상 선택이고, 카드에서 바로 켜고 끄는 편이 실수가 적다. */
export async function setContactSmsRecipientAction(
  customerId: string,
  contactId: string,
  value: boolean,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { error } = await admin
    .from('customer_contacts')
    // 해제는 **false**로 남긴다(2026-08-19 사용자 확정) — 종전엔 null로 되돌려 폴백이 대표를
    // 도로 집어넣었고, 그래서 체크를 꺼도 문자가 나갔다(끄는 수단이 없는 것과 같았다).
    // NULL은 '아직 아무도 정하지 않음'(폴백 1명)이라는 뜻으로만 남는다 — pickContacts 참조.
    .update({ sms_recipient: value } as Record<string, unknown>)
    .eq('id', contactId)
    .eq('customer_id', customerId)
  if (error) return { error: '문자 수신 설정에 실패했습니다.' }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 대표자 구분(소유자/관리자/점유자) — 관계인 카드 세그먼트의 클릭 즉시 저장 창구 (2026-09-03 A안).
 *  [소방안전관리] 구역(saveFireSafetyManagerAction)과 **같은 컬럼**(customers.rep_role, 104)을 쓴다 —
 *  창구가 둘, 저장소는 하나. 거기는 [저장]을 눌러야 해서 선택만 하고 이탈하면 조용히 유실됐다
 *  (강순건물 사고 — 관리자를 골랐는데 문서엔 소유자 √). 여기는 클릭이 곧 저장이다. */
export async function setRepRoleAction(
  customerId: string,
  repRole: string,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  // 빈 문자열 = 해제(null) — 문서는 종전 폴백(대표 존재 시 '소유자', report9-assemble:479)으로 돌아간다
  if (repRole && !['소유자', '관리자', '점유자'].includes(repRole)) {
    return { error: '대표자 구분 값을 확인해주세요.' }
  }
  const admin = createAdminClient()
  const { error } = await admin.from('customers')
    .update({ rep_role: repRole || null } as Record<string, unknown>)
    .eq('id', customerId)
  if (error) return { error: `저장 실패: ${error.message}` }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** [대표로 지정] — 그 관계인이 role='대표'가 되고 기존 대표는 그 사람의 이전 슬롯을 물려받는다(교대).
 *  UNIQUE(customer_id, role)가 세 슬롯 만석에서 순차 UPDATE를 거부하므로 DB 함수(157,
 *  DEFERRABLE + set_primary_contact)가 트랜잭션 하나로 교대한다 — 앱에서 두 번 쓰면 중간에 깨진다.
 *  문자 수신(sms_recipient)·소방안전관리자 지목(manager_contact_id)은 **사람(id)에 붙어** 그대로 따라간다. */
export async function setPrimaryContactAction(
  customerId: string,
  contactId: string,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { error } = await admin.rpc('set_primary_contact', {
    p_customer_id: customerId,
    p_contact_id: contactId,
  })
  if (error) return { error: `대표 지정 실패: ${error.message}` }
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
  revalidatePath('/inspections')          // 점검업무 목록도 즉시 반영 (D-8 — 종전 누락)
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
  revalidatePath('/inspections')          // 점검업무 목록도 즉시 반영 (D-8 — 종전 누락)
  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/calendar')
  return {}
}

// ── 무조건 hard delete (소방계획서_30 S3 조건부 → 156에서 무조건 전환, 2026-09-03 사용자 결정) ──
// '실이력' 축 — 마이그레이션 156 hard_delete_customer()의 카운트 목록·순서와 반드시 일치시킬 것.
// 156부터 이 축은 차단하지 않는다 — 삭제 모달의 「함께 삭제됩니다」 고지와 감사 로그에만 쓰인다.
// 축의 유래(customers 참조 FK 전수에서 뺄셈)는 152 주석 '축을 어떻게 골랐나' 참조.
//
// 계획 항목 전부가 아니라 '완료됐거나 점검에 연결된 것'만 세는 이유: 등록 시 연간 계획이
// 자동 생성되므로(generateRollingPlanItems) 전부를 세면 전 고객이 '이력 있음'으로 보인다 —
// 자동 생성 비계는 고지 대상이 아니다.
const HISTORY_AXES: Array<{ key: string; label: string; table: string; real?: boolean; ledger?: boolean }> = [
  { key: 'inspections', label: '점검', table: 'inspections' },
  { key: 'plan_items_real', label: '완료·점검연결 계획', table: 'inspection_plan_items', real: true },
  { key: 'bills', label: '청구서', table: 'bills' },
  { key: 'quotes', label: '견적', table: 'quotes' },
  { key: 'orders', label: '수주', table: 'orders' },
  { key: 'inquiries', label: '문의', table: 'inquiries' },
  { key: 'fire_plans', label: '소방계획서', table: 'fire_plans' },
  { key: 'fire_plan_forms', label: '소방계획서 서식', table: 'fire_plan_forms' },
  { key: 'fire_plan_gen_jobs', label: '문서 생성', table: 'fire_plan_gen_jobs' },
  { key: 'fire_plan_revisions', label: '개정이력', table: 'fire_plan_revisions' },
  { key: 'fire_brigade_members', label: '자위소방대', table: 'fire_brigade_members' },
  { key: 'customer_facility_specs', label: '세부현황', table: 'customer_facility_specs' },
  { key: 'plan_text_applied', label: '공통문구 적용', table: 'plan_text_applied' },
  // 설비 대장 — buildings 경유(자식에 customer_id가 없다). 건물 자체는 비계라 세지 않고,
  // 사용자가 직접 저장한 설비/층별 값이 하나라도 있는 건물만 센다(152의 EXISTS와 같은 술어).
  { key: 'facility_ledger', label: '설비 대장', table: 'buildings', ledger: true },
  { key: 'billing_profiles', label: '청구 프로필', table: 'billing_profiles' },
  { key: 'billing_autopay', label: '자동이체', table: 'billing_autopay' },
  { key: 'report_deliveries', label: '보고서 발송', table: 'report_deliveries' },
  { key: 'sms_send_log', label: '문자 발송', table: 'sms_send_log' },
  { key: 'mobile_documents', label: '모바일 문서', table: 'mobile_documents' },
  { key: 'account_access_log', label: '계좌 접근', table: 'account_access_log' },
]

/** 설비 대장 축 — buildings!inner 임베드로 '설비 또는 층별 값을 가진 건물'을 센다.
 *  두 갈래를 따로 세고 합치는 이유: PostgREST 임베드는 서로 다른 자식 두 개를 OR로 묶지 못한다
 *  (하나의 select에 둘 다 !inner를 걸면 AND가 된다 — 층별만 있는 건물을 놓친다). */
async function _countFacilityLedger(
  admin: ReturnType<typeof createAdminClient>, customerId: string,
): Promise<number> {
  const one = async (child: string) => {
    const { count, error } = await admin
      .from(child).select('building_id, buildings!inner(customer_id)', { count: 'exact', head: true })
      .eq('buildings.customer_id', customerId)
    if (error) throw new Error(`${child} 조회 실패: ${error.message}`)
    return count ?? 0
  }
  const [fac, flr] = await Promise.all([one('fire_facilities'), one('fire_facility_floors')])
  return fac + flr
}

/** 물리 삭제 뒤 남는 스토리지 고아 정리 (소방계획서_32 DEF-2).
 *  fire-plans 버킷의 고객 파일은 전부 `{customerId}/` 아래에 있고, 불량 사진은
 *  inspection-defects 버킷의 `{inspectionId}/` 아래에 있다 — 표지·위치도(`assets/`)는
 *  **DB 행이 아예 없어** 어떤 FK로도 따라갈 수 없다. 접두사째 비우는 이유가 이것.
 *  list()는 재귀하지 않으므로(폴더는 id=null로 온다) 직접 훑는다. */
async function _purgeStoragePrefix(
  admin: ReturnType<typeof createAdminClient>, bucket: string, prefix: string,
): Promise<{ removed: number; error?: string }> {
  const files: string[] = []
  const queue = [prefix]
  while (queue.length) {
    const p = queue.shift()!
    const { data, error } = await admin.storage.from(bucket).list(p, { limit: 1000 })
    // 조회 실패를 빈 목록으로 오인하면 '지울 게 없었다'와 구별되지 않는다
    if (error) return { removed: files.length, error: `${bucket}/${p} 목록 조회 실패: ${error.message}` }
    for (const o of data ?? []) {
      if (o.id === null) queue.push(`${p}/${o.name}`)   // 폴더
      else files.push(`${p}/${o.name}`)
    }
  }
  if (files.length === 0) return { removed: 0 }
  const { error } = await admin.storage.from(bucket).remove(files)
  if (error) return { removed: 0, error: `${bucket} 파일 삭제 실패: ${error.message}` }
  return { removed: files.length }
}

export type CustomerDeleteCheck = {
  name: string
  /** 0건 축은 제외 — 「함께 삭제됩니다」 고지에 보일 것만. 156부터 차단 판정이 아니다. */
  history: Array<{ label: string; count: number }>
  error?: string
}

/** 함께 삭제될 업무 이력 사전 집계 (모달 고지용) — 확정 카운트는 RPC가 트랜잭션 안에서 다시 센다 */
export async function checkCustomerDeleteAction(customerId: string): Promise<CustomerDeleteCheck> {
  await requirePermission('customer_delete')
  const admin = createAdminClient()

  const { data: cust, error: cErr } = await admin
    .from('customers').select('customer_name').eq('id', customerId).single()
  if (cErr || !cust) return { name: '', history: [], error: '고객을 찾을 수 없습니다.' }

  const counts = await Promise.all(HISTORY_AXES.map(async ax => {
    if (ax.ledger) return { label: ax.label, count: await _countFacilityLedger(admin, customerId) }
    // select('*'): fire_plan_forms는 id 컬럼이 없다(PK=customer_id) — head:true count는 컬럼 목록이 필요 없다
    let q = admin.from(ax.table).select('*', { count: 'exact', head: true }).eq('customer_id', customerId)
    if (ax.real) q = q.or('status.eq.completed,inspection_id.not.is.null')
    const { count, error } = await q
    // error를 함께 본다 — 임베드·컬럼 오류가 '조용한 0행'으로 둔갑하면 삭제 가능으로 오판한다
    if (error) throw new Error(`${ax.table} 조회 실패: ${error.message}`)
    return { label: ax.label, count: count ?? 0 }
  })).catch((e: Error) => e)
  if (counts instanceof Error) return { name: (cust as { customer_name: string }).customer_name, history: [], error: counts.message }

  const nonzero = counts.filter(c => c.count > 0)
  return { name: (cust as { customer_name: string }).customer_name, history: nonzero }
}

/** 완전 삭제(물리 DELETE) — 156부터 업무 이력이 있어도 전부 함께 지운다(2026-09-03 사용자 결정).
 *  삭제는 DB 함수 한 트랜잭션(156 — RESTRICT 사슬 명시 삭제 + CASCADE 연쇄, 순서는 그쪽 주석).
 *  warning: 행은 지워졌으나 스토리지 정리가 남은 경우 — 실패가 아니므로 error와 구분한다. */
export async function hardDeleteCustomerAction(customerId: string): Promise<{ error?: string; warning?: string }> {
  const profile = await requirePermission('customer_delete')
  const admin = createAdminClient()

  // 스토리지 좌표는 RPC **앞**에서 읽어 둔다(읽기만이라 RPC가 실패해도 무해) —
  // 불량 사진(inspection-defects/{점검id}/…)과 보고서 엑셀(reports/{xlsx_path})은
  // 행이 사라지면 따라갈 길이 없다. fire-plans는 경로가 customerId만으로 정해져 뒤에 훑어도 된다.
  const insp = await fetchAllRows<{ id: string }>((from, to) =>
    admin.from('inspections').select('id').eq('customer_id', customerId).order('id')
      .range(from, to) as unknown as Promise<{ data: { id: string }[] | null; error: { message: string } | null }>)
  const inspIds = insp.error ? [] : insp.rows.map(r => r.id)
  let reportPaths: string[] = []
  if (inspIds.length > 0) {
    const reps = await fetchAllRows<{ xlsx_path: string | null }>((from, to) =>
      admin.from('generated_reports').select('xlsx_path').in('inspection_id', inspIds).order('id')
        .range(from, to) as unknown as Promise<{ data: { xlsx_path: string | null }[] | null; error: { message: string } | null }>)
    if (!reps.error) reportPaths = reps.rows.map(r => r.xlsx_path).filter((p): p is string => !!p)
  }

  const { data, error } = await admin.rpc('hard_delete_customer', { p_customer_id: customerId })
  if (error) return { error: error.message }

  const res = data as { ok: boolean; reason?: string; name?: string; code?: string; history?: Record<string, number> }
  if (!res.ok) {
    return {
      error: res.reason === 'not_found'
        ? '고객을 찾을 수 없습니다.'
        // has_history는 156 적용 전 구버전 DB 함수만 돌려준다 — 코드가 아니라 DB가 낡았다는 신호
        : '삭제 함수가 구버전입니다(마이그레이션 156 미적용) — 관리자에게 알려주세요.',
    }
  }

  // 파일 정리는 RPC **뒤**에 한다 — 삭제가 성립한 다음에만 파일을 파괴한다.
  const purges: Array<{ removed: number; error?: string }> = []
  purges.push(await _purgeStoragePrefix(admin, 'fire-plans', customerId))
  for (const id of inspIds) purges.push(await _purgeStoragePrefix(admin, 'inspection-defects', id))
  if (reportPaths.length > 0) {
    const { error: rErr } = await admin.storage.from('reports').remove(reportPaths)
    purges.push(rErr ? { removed: 0, error: `reports 파일 삭제 실패: ${rErr.message}` } : { removed: reportPaths.length })
  }
  // 좌표 수집이 실패했으면 그 몫의 파일이 고아로 남는다 — 조용히 넘기지 않는다
  if (insp.error) purges.push({ removed: 0, error: `점검 목록 조회 실패로 불량 사진·보고서 정리를 건너뜀: ${insp.error}` })
  const storageRemoved = purges.reduce((n, p) => n + p.removed, 0)
  const purgeErrors = purges.map(p => p.error).filter((e): e is string => !!e)

  // 고객 행이 사라진 뒤에도 누가 무엇을 지웠는지는 남긴다 (activity_logs는 FK가 아니라 남는다)
  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'customer_hard_deleted',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: {
      customer_name: res.name, customer_code: res.code,
      deleted_history: res.history,
      storage_removed: storageRemoved,
      ...(purgeErrors.length ? { storage_error: purgeErrors.join(' / ') } : {}),
    },
  } as Record<string, unknown>)

  revalidatePath('/customers')
  revalidatePath('/buildings')
  revalidatePath('/inspections')
  revalidatePath('/inspection-plans')
  revalidatePath('/inspections/calendar')
  return purgeErrors.length
    ? { warning: `고객은 삭제됐으나 첨부 파일 정리가 일부 실패했습니다 — 관리자에게 알려주세요. (${purgeErrors.join(' / ')})` }
    : {}
}

export type NameDuplicateCustomer = {
  id: string
  customer_name: string
  customer_code: string
  address: string | null
  inspection_type: string
  employee_name: string | null
}

type NameDupRow = {
  id: string; customer_name: string; customer_code: string
  address: string | null; inspection_type: string
  profiles: { name: string } | null
}

/** 고객명 중복 조회 — 활성 고객만, 공백·대소문자 무시(`customerNameDupKey`). 자기 자신은 제외.
 *
 *  정규화 키는 DB 인덱스로 표현돼 있지 않다. `ilike` 패턴으로 흉내 내면 **공백 위치가 다른 이름을
 *  놓친다**(`강순기 건물` vs `강순기건물`) — 그래서 활성 고객명을 전량 읽어 같은 키로 비교한다.
 *  select가 좁아 왕복 한 번으로 끝난다.
 *
 *  ⚠ `.limit()` 없는 조회는 1000행에서 **조용히 잘린다**. 잘린 채로 비교하면 중복을 '없음'으로
 *    오판해 가드가 꺼진 것과 같아지므로 반드시 `fetchAllRows`로 전량을 읽는다.
 *
 *  `failed`는 '판정 못 함'이다 — 호출부가 이것을 '중복 없음'과 섞으면 조회 실패가 곧 가드 해제가 된다. */
async function findCustomerByName(
  name: string,
  excludeCustomerId?: string,
): Promise<{ dup: NameDuplicateCustomer | null; failed: boolean }> {
  const key = customerNameDupKey(name)
  if (!key) return { dup: null, failed: false }
  const admin = createAdminClient()

  const { rows, error, truncated } = await fetchAllRows<NameDupRow>((from, to) =>
    admin.from('customers')
      .select('id, customer_name, customer_code, address, inspection_type, profiles:assigned_employee_id(name)')
      .eq('is_active', true)
      .range(from, to) as unknown as Promise<{ data: NameDupRow[] | null; error: { message: string } | null }>)

  if (error) {
    console.error(`[customer-dup] 고객명 중복 조회 실패: ${error}`)
    return { dup: null, failed: true }
  }
  if (truncated) console.error('[customer-dup] 고객명 조회가 상한에서 잘렸다 — 중복 판정이 불완전하다')

  const hit = rows.find(r =>
    r.id !== excludeCustomerId && customerNameDupKey(r.customer_name ?? '') === key)
  if (!hit) return { dup: null, failed: false }

  return {
    dup: {
      id: hit.id,
      customer_name: hit.customer_name,
      customer_code: hit.customer_code,
      address: hit.address,
      inspection_type: hit.inspection_type,
      employee_name: hit.profiles?.name ?? null,
    },
    failed: false,
  }
}

/** 등록 폼에서 저장 전에 미리 묻는 창구 — 서버의 차단(`createCustomerAction`)과 **같은 함수**를 쓴다.
 *  화면 경고와 실제 차단이 다른 규칙을 쓰면 "경고는 안 떴는데 저장이 막히는" 상태가 생긴다. */
export async function checkCustomerNameAction(name: string, opts?: {
  excludeCustomerId?: string
}): Promise<{ duplicate?: NameDuplicateCustomer }> {
  await requirePermission('customer_manage')
  const { dup } = await findCustomerByName(name.trim(), opts?.excludeCustomerId)
  return dup ? { duplicate: dup } : {}
}

export type AddressDuplicateCustomer = {
  id: string
  customer_name: string
  inspection_type: string
  employee_name: string | null
  address: string
  /** 저장된 주소가 글자까지 같은지 — false면 동/호수 등 상세주소만 다른 '같은 건물' 추정 */
  exact: boolean
}
export type AddressDuplicateBuilding = {
  id: string
  building_name: string
  address: string
  customer_id: string
  customer_name: string | null
  exact: boolean
}

/**
 * ADD-2/ADD-4: 주소 선택 시 중복 고객·건물 확인 + 기존 건물정보 자동 로드.
 *
 * 완전일치만 보면 '주소 검색 후 동/호수 추가 입력' 안내 때문에 같은 건물이 서로 다른 문자열로
 * 저장돼 중복을 놓친다. 그래서 완전일치를 먼저 보고, 없으면 **도로명이 같은 후보만 좁혀 온 뒤**
 * `addressDupKey`(건물번호까지만 남긴 키)로 비교한다. 도로명을 못 뽑는 주소는 완전일치만 판정한다.
 *
 * `excludeCustomerId`는 그 고객과 그 고객의 건물을 판정에서 통째로 뺀다. 자기 주소를 고칠 때 자신이
 * 잡히는 것을 막고, 한 고객이 **같은 주소에 여러 동**을 등록하는 정상 사용(아파트 단지 등)에서
 * 매번 팝업이 뜨는 것도 막는다. 즉 남는 신호는 '다른 계약과 겹친다' 하나뿐이다.
 */
export async function checkAddressAction(address: string, opts?: {
  excludeCustomerId?: string
}): Promise<{
  duplicate?: AddressDuplicateCustomer
  duplicateBuilding?: AddressDuplicateBuilding
  building?: { purpose: string | null; total_area: number | null; floors_above: number | null; floors_below: number | null; year_built: number | null }
}> {
  const addr = address.trim()
  if (!addr) return {}
  const admin = createAdminClient()

  const key = addressDupKey(addr)
  // 후보 축소용 도로명 — 인덱스 없는 전량 스캔을 피한다. 지번주소 등 도로명이 없으면 완전일치만.
  const road = extractRoadName(addr)?.road ?? null

  const custSel = 'id, customer_name, inspection_type, address, assigned_employee_id, profiles:assigned_employee_id(name)'
  const bldSel = 'id, building_name, address, customer_id, purpose, total_area, floors_above, floors_below, year_built, customers:customer_id(customer_name)'

  // 후보는 도로명으로 좁히되 상한을 둔다. 다만 상한에 걸려 **완전일치가 잘려나가면** 가장 중요한
  // 판정을 조용히 놓치므로, 완전일치는 후보 스캔과 별개로 반드시 한 번 직접 조회한다.
  const CAND_LIMIT = 200

  const custBase = () => {
    const q = admin.from('customers').select(custSel).eq('is_active', true)
    if (opts?.excludeCustomerId) q.neq('id', opts.excludeCustomerId)
    return q
  }
  const bldBase = () => {
    const q = admin.from('buildings').select(bldSel).eq('is_active', true)
    if (opts?.excludeCustomerId) q.neq('customer_id', opts.excludeCustomerId)
    return q
  }

  const [custExact, bldExact, custCand, bldCand] = await Promise.all([
    custBase().eq('address', addr).limit(1),
    bldBase().eq('address', addr).limit(1),
    road ? custBase().ilike('address', `%${road}%`).limit(CAND_LIMIT) : Promise.resolve({ data: [] }),
    road ? bldBase().ilike('address', `%${road}%`).limit(CAND_LIMIT) : Promise.resolve({ data: [] }),
  ])

  type CustRow = {
    id: string; customer_name: string; inspection_type: string; address: string | null
    profiles: { name: string } | null
  }
  type BldRow = {
    id: string; building_name: string; address: string | null; customer_id: string
    purpose: string | null; total_area: number | null
    floors_above: number | null; floors_below: number | null; year_built: number | null
    customers: { customer_name: string } | null
  }

  // 완전일치를 유사일치보다 우선 — 같은 건물에 여러 건이 걸리면 정확한 쪽을 보여준다
  const pick = <T extends { address: string | null }>(exactRows: T[], candRows: T[]): { row: T; exact: boolean } | null => {
    if (exactRows.length > 0) return { row: exactRows[0], exact: true }
    if (!key) return null
    const similar = candRows.find(r => addressDupKey(r.address ?? '') === key)
    return similar ? { row: similar, exact: false } : null
  }

  const cust = pick(
    (custExact.data ?? []) as unknown as CustRow[],
    (custCand.data ?? []) as unknown as CustRow[])
  const bld = pick(
    (bldExact.data ?? []) as unknown as BldRow[],
    (bldCand.data ?? []) as unknown as BldRow[])

  return {
    ...(cust ? {
      duplicate: {
        id: cust.row.id,
        customer_name: cust.row.customer_name,
        inspection_type: cust.row.inspection_type,
        employee_name: cust.row.profiles?.name ?? null,
        address: cust.row.address ?? '',
        exact: cust.exact,
      },
    } : {}),
    ...(bld ? {
      duplicateBuilding: {
        id: bld.row.id,
        building_name: bld.row.building_name,
        address: bld.row.address ?? '',
        customer_id: bld.row.customer_id,
        customer_name: bld.row.customers?.customer_name ?? null,
        exact: bld.exact,
      },
      // 기존 건물정보 자동 로드 (ADD-4) — 중복 여부와 무관하게 빈 칸 채움용으로 계속 제공
      building: {
        purpose: bld.row.purpose, total_area: bld.row.total_area,
        floors_above: bld.row.floors_above, floors_below: bld.row.floors_below,
        year_built: bld.row.year_built,
      },
    } : {}),
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
  // 098 확장 — 별지 9호 2쪽 잔여 항목 (소방계획서_4.md §11-1)
  permit_date: string | null      // 건축허가일 YYYY-MM-DD
  building_area: number | null    // 건축면적(㎡)
  building_count: number | null   // 건물 동수 — 같은 지번 표제부 행 수
  parking_summary: string | null  // 주차장 요약 (옥내/옥외 기계식·자주식 대수)
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
    const pms = String(item.pmsDay ?? '')
    const day8 = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null)
    // 주차장 요약 — 옥내/옥외 × 기계식/자주식 대수 중 값이 있는 것만 합성
    const parking = ([
      ['옥내 기계식', num(item.indrMechUtcnt)], ['옥외 기계식', num(item.oudrMechUtcnt)],
      ['옥내 자주식', num(item.indrAutoUtcnt)], ['옥외 자주식', num(item.oudrAutoUtcnt)],
    ] as Array<[string, number | null]>)
      .filter(([, n]) => n != null && n > 0)
      .map(([label, n]) => `${label} ${n}대`)
      .join(' · ')
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
        permit_date: day8(pms),
        building_area: num(item.archArea),
        building_count: list.length,
        parking_summary: parking || null,
      },
    }
  } catch (e) {
    return { error: `건축물대장 조회 실패: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 주소 → 법정동코드(bcode)·지번주소 역산 (B안, 2026-08-05) — 저장된 주소만 있고 bcode가 없는
 *  구 고객도 Daum 주소창 없이 서버에서 대장 조회가 되도록. Juso.go.kr 도로명주소 API(admCd=법정동코드 10자리·jibunAddr).
 *  환경변수 JUSO_CONFM_KEY 필요 — 미설정 시 unavailable(조용히 폴백), 매칭 실패 시 error. */
export async function geocodeAddressToBcodeAction(address: string): Promise<{
  bcode?: string; jibunAddress?: string; roadAddress?: string; unavailable?: boolean; error?: string
}> {
  const key = process.env.JUSO_CONFM_KEY
  if (!key) return { unavailable: true }
  const keyword = (address ?? '').trim()
  if (!keyword) return { error: '주소가 비어 있습니다.' }

  const url = new URL('https://business.juso.go.kr/addrlink/addrLinkApi.do')
  url.searchParams.set('confmKey', key)
  url.searchParams.set('currentPage', '1')
  url.searchParams.set('countPerPage', '1')
  url.searchParams.set('keyword', keyword)
  url.searchParams.set('resultType', 'json')

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) return { error: `주소 API 오류 (HTTP ${res.status})` }
    const json = await res.json() as {
      results?: { common?: { errorCode?: string; errorMessage?: string }; juso?: Array<Record<string, string>> }
    }
    const common = json.results?.common
    if (common?.errorCode && common.errorCode !== '0') {
      return { error: `주소 API: ${common.errorMessage ?? common.errorCode}` }
    }
    const juso = json.results?.juso?.[0]
    if (!juso) return { error: '해당 주소를 찾지 못했습니다.' }
    const admCd = String(juso.admCd ?? '')
    if (admCd.length !== 10) return { error: '법정동코드를 확보하지 못했습니다.' }
    // 지번주소는 fetchBuildingLedgerAction이 '끝의 번지'를 파싱 → 항상 번지로 끝나도록 구조화 필드로 합성.
    // (jibunAddr는 "…31 서울특별시청"처럼 건물명이 붙어 번지 파싱이 실패할 수 있어 폴백으로만)
    const mt = juso.mtYn === '1' ? '산 ' : ''
    const bunji = `${mt}${juso.lnbrMnnm ?? ''}${juso.lnbrSlno && juso.lnbrSlno !== '0' ? `-${juso.lnbrSlno}` : ''}`.trim()
    const built = [juso.siNm, juso.sggNm, juso.emdNm, juso.liNm].filter(Boolean).join(' ')
    const jibun = (bunji && built) ? `${built} ${bunji}` : (juso.jibunAddr || '').trim()
    return { bcode: admCd, jibunAddress: jibun.trim(), roadAddress: juso.roadAddr || undefined }
  } catch (e) {
    return { error: `주소 조회 실패: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 통합검색 자동완성 제안 (고객 바로가기/주소/담당자) —
 *  §6-B-B4: 고객명 제안은 id를 포함해 선택 시 상세로 직행 */
export async function searchSuggestionsAction(q: string): Promise<{
  customers: { id: string; name: string }[]
  buildings: string[]
  addresses: string[]
  employees: { name: string; count: number }[]
}> {
  const empty = { customers: [], buildings: [], addresses: [], employees: [] }
  const query = q.trim()
  if (query.length < 1) return empty
  const admin = createAdminClient()

  const [byName, byAddr, empRes] = await Promise.all([
    admin.from('customers').select('id, customer_name').ilike('customer_name', `%${query}%`).eq('is_active', true).limit(5),
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

  const custRows = (byName.data ?? []) as { id: string; customer_name: string }[]
  return {
    customers: custRows.map(r => ({ id: r.id, name: r.customer_name })),
    buildings: [...new Set(custRows.map(r => r.customer_name))],
    addresses: [...new Set(((byAddr.data ?? []) as { address: string | null }[]).map(r => r.address).filter(Boolean) as string[])],
    employees,
  }
}

/** 내 주소록 연락처 (§6-E 관계인 [주소록에서 가져오기]) — 읽기 전용 */
export async function getMyAddressContactsAction(): Promise<{
  contacts: Array<{ name: string; phone: string; email: string; position: string }>
}> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data } = await admin.from('address_contacts')
    .select('name, phone, email, position')
    .eq('owner_id', profile.id)
    .order('name').limit(50)
  const s = (v: unknown) => (v == null ? '' : String(v))
  return {
    contacts: ((data ?? []) as Array<Record<string, unknown>>).map(c => ({
      name: s(c.name), phone: s(c.phone), email: s(c.email), position: s(c.position),
    })),
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
    .select('customer_name, inspection_type, inspection_sub_type, contract_date, use_approval_date, plan_anchor_date, assigned_employee_id')
    .eq('id', customerId).single()
  const prevRow = prevData as Record<string, string | null> | null
  const oldValue = prevRow?.[field] ?? null

  // 기산점 변경 + 확정 일정 존재 시(B안): 사용자 선택 전에는 저장하지 않고 목록 반환
  //
  // ⚠ 종전엔 `plan_anchor_date`만 기산점 필드로 봤다. 사용승인일이 기산점 축이 된 뒤로는
  //   그 판정이 사용승인일 인라인 수정을 놓쳐 확정 일정이 말없이 어긋난다(위 updateCustomerAction과 같은 결함).
  //   두 필드 모두 후보로 두고, **실제로 기산점이 움직였는지**는 해석기가 가른다.
  const isAnchorField = field === 'plan_anchor_date' || field === 'use_approval_date'
  const anchorManual = isAnchorField ? await loadAnchorManualFlag(admin, customerId) : undefined
  const anchorMoved = isAnchorField && anchorChangedFn(
    {
      use_approval_date: prevRow?.use_approval_date ?? null,
      plan_anchor_date: prevRow?.plan_anchor_date ?? null,
      plan_anchor_manual: anchorManual,
    },
    {
      use_approval_date: field === 'use_approval_date' ? (value || null) : (prevRow?.use_approval_date ?? null),
      plan_anchor_date: field === 'plan_anchor_date' ? (value || null) : (prevRow?.plan_anchor_date ?? null),
      plan_anchor_manual: anchorManual,
    },
  )
  let confirmedItems: ConfirmedPlanItemInfo[] = []
  if (anchorMoved) {
    confirmedItems = await _getUnconfirmablePlanItems(admin, customerId)
    if (confirmedItems.length > 0 && !opts?.confirmedDecision) {
      return { requiresConfirmedDecision: true, confirmedItems }
    }
  }

  const patchFields: Record<string, unknown> = { [field]: value || null, updated_at: new Date().toISOString() }
  if (field === 'inspection_type' && value) {
    patchFields.inspection_category = value === '일반관리' ? '일반관리' : '소방안전관리'
    // 일반관리 전환도 종합/작동 유지 (소방계획서_6 W-2) — 기존 값 유지, 없으면 '작동'(백필 기본).
    // 종합 지정은 고객 상세의 유형 변경 팝업에서 (D-2 개별 수정 경로)
    patchFields.inspection_sub_type = value === '종합' ? '종합' : value === '작동' ? '작동'
      : (prevRow?.inspection_sub_type === '종합' ? '종합' : '작동')
  }
  const { error } = await admin
    .from('customers')
    .update(patchFields)
    .eq('id', customerId)

  if (error) return { error: '수정에 실패했습니다.' }

  // 기산점이 **실제로 움직였을 때만** 미확정(planned) 항목 재계산 — 위 팝업과 같은 조건이어야 한다.
  // 확정(confirmed)은 기본 유지 — '확정해지 후 재계산' 선택 시만 planned 복귀 후 포함
  if (anchorMoved) {
    if (opts?.confirmedDecision === 'unconfirm' && confirmedItems.length > 0) {
      await admin.from('inspection_plan_items')
        .update({ status: 'planned' } as Record<string, unknown>)
        .in('id', confirmedItems.map(i => i.id))
    }
    // 일반관리 포함 전 유형 동일 재계산 (소방계획서_6 — event 특례 제거).
    // plan_anchor_date만 넘긴다 — 사용승인일·manual 플래그는 loadAnchorDates가 DB에서 보강한다
    // (여기서 갱신된 값이 이미 저장돼 있다).
    await _resetPlanItemsForCustomer(admin, customerId, {
      plan_anchor_date: field === 'plan_anchor_date' ? (value || null) : (prevRow?.plan_anchor_date ?? null),
    })
  }

  // 사용승인일 인라인 수정 → 최초점검(사용승인일+60일) 재판정.
  // ⚠ anchorMoved와 **다른 조건**이다 — manual=true 고객은 기산점이 안 움직여도 최초점검은 바뀐다.
  if (field === 'use_approval_date' && (value || null) !== oldValue) {
    await recalcIsInitialForCustomer(admin, customerId)
    await syncStartedRowSubTypes(admin, customerId)   // 시작된 행 종류도 (2026-09-02, 전체 폼과 동일 규칙)
  }

  // **변동 = 재계산** — 인라인 경로도 같은 규칙을 탄다(전체 수정 폼과 갈라지면 어느 화면으로
  // 고쳤느냐에 따라 일정이 달라진다). 유형 인라인 변경은 위 _syncInspectionTypeToPlanItems 뒤다.
  if (anchorMoved || (field === 'inspection_type' && value && value !== oldValue)) {
    const y = new Date().getFullYear()
    await reconcileSpecialSlots(admin, customerId, [y, y + 1], profile.id)
    revalidatePath('/inspection-plans')
    revalidatePath('/inspections/calendar')
  }

  // 점검유형 변경 → 미확정(planned) 계획 항목 유형 동기화 (변경전파맵 1-11)
  if (field === 'inspection_type' && value && value !== oldValue) {
    const patchedSub = patchFields.inspection_sub_type === '종합' ? '종합' : '작동'
    await _syncInspectionTypeToPlanItems(admin, customerId, value as InspectionType, patchedSub, profile.id)
    await syncStartedRowSubTypes(admin, customerId)   // 시작된 행 종류도 (2026-09-02)
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

/** 요약 화면 주소 원클릭 입력 + 전파 (2026-08-04 사용자 요청 — "입력하면 다른 곳에 다 입력되게").
 *  한 번의 주소 선택으로: ① customers 주소·지역 ② 관할소방서 자동 매핑(비어있을 때만, region_fire_stations)
 *  ③ 건물(buildings) 주소·지번·법정동코드(비어있는 건물만 — 기존 값 덮어쓰지 않음). */
export async function quickAddressApplyAction(
  customerId: string,
  d: {
    zonecode: string; roadAddress: string; jibunAddress: string
    bcode?: string; sigungu: string; bname1?: string; bname2?: string; bname?: string
  },
): Promise<{ error?: string; applied?: { fireStation?: string; buildings: number } }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const regionMyeon = (d.bname1 || d.bname || '').trim()
  const regionRi = (d.bname2 || '').trim()

  // ② 관할소방서 자동 매핑 — 읍/면/동 접미사 제거 후 region_fire_stations 조회, 고객 값이 비어있을 때만
  const { data: cur } = await admin.from('customers')
    .select('fire_station').eq('id', customerId).single()
  if (!cur) return { error: '고객을 찾을 수 없습니다.' }
  let fireStation: string | undefined
  let fireStationSource: string | undefined
  if (!(cur as { fire_station: string | null }).fire_station) {
    // D-3(2026-08-07): 매핑 실패 시 공란으로 두지 않는다 — 시/군 차용·명명 규칙 추정까지 내려간다
    const resolved = await resolveFireStation(admin, {
      regionMyeon, regionSi: d.sigungu, address: d.roadAddress,
    })
    fireStation = resolved?.station
    fireStationSource = resolved?.source   // C-1: estimate면 화면에서 '확인 필요' 배지
  }

  // ① customers 주소·지역(+매핑된 소방서)
  const patch: Record<string, unknown> = {
    zipcode: d.zonecode || null,
    address: d.roadAddress || null,
    region_si: d.sigungu || null,
    region_myeon: regionMyeon || null,
    region_ri: regionRi || null,
    updated_at: new Date().toISOString(),
  }
  if (fireStation) {
    patch.fire_station = fireStation
    patch.fire_station_source = fireStationSource ?? null
  }
  let { error: custErr } = await admin.from('customers').update(patch).eq('id', customerId)
  // 115 미적용 환경 폴백(BLK-1) — 소방서명은 살리고 출처 컬럼만 떨어뜨린다
  if (custErr?.message?.includes('fire_station_source')) {
    const { fire_station_source: _s, ...withoutSource } = patch
    void _s
    const retry = await admin.from('customers').update(withoutSource).eq('id', customerId)
    custErr = retry.error
  }
  if (custErr) return { error: '주소 저장에 실패했습니다.' }

  // ③ 건물 전파 — 주소가 비어있는 건물만 채움 (기존 입력 보존)
  const { data: blds } = await admin.from('buildings')
    .select('id, address').eq('customer_id', customerId)
  let filled = 0
  for (const b of (blds ?? []) as Array<{ id: string; address: string | null }>) {
    if (b.address && b.address.trim()) continue
    const { error: bErr } = await admin.from('buildings').update({
      address: d.roadAddress || null,
      address_jibun: d.jibunAddress || null,
      bcode: d.bcode || null,
    } as Record<string, unknown>).eq('id', b.id)
    if (!bErr) filled += 1
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'customer_updated',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: { quick_address: true, address: d.roadAddress, fire_station: fireStation ?? null, buildings_filled: filled },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/customers')
  return { applied: { fireStation, buildings: filled } }
}
