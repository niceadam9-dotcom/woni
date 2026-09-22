'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'
import { extractRegionFromAddress, extractRoadName, addressDupKey } from '@/lib/address-parser'
import { customerNameDupKey } from '@/lib/customer-dup'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { resolveFireStation } from '@/lib/fire-station'
import { generateRollingPlanItems, loadAnchorDates, loadAnchorManualFlag, loadHolidaySet } from '@/lib/inspection-plan-generator'
import { applyPastAnchorInspection } from '@/lib/inspection-start'
import { todayKst } from '@/lib/kst-date'
// `anchorChanged`는 이 파일의 지역 변수명과 겹쳐 별칭으로 들여온다(변수를 함수로 덮으면 조용히 항상-false가 된다)
import { anchorChanged as anchorChangedFn } from '@/lib/plan-anchor'
import { recalcIsInitialForCustomer } from '@/lib/inspection-initial'
import { getCompanyProfile } from '@/lib/company-profile'
import { listBuildingPurposes } from '@/lib/building-purposes'
import { syncStartedRowSubTypes } from '@/lib/inspection-row-sync'
import { reconcileSpecialSlots, planReconcile } from '@/lib/reconcile-special-slots'
import { anchorSourceLabel, resolveAnchor, plannedDateFor, desiredSlotsFor, desiredSlotsInYear, anchorDayOf } from '@/lib/plan-anchor'
import { rowInspectionType, rowSubType, INITIAL_INSPECTION_DAYS } from '@/lib/inspection-round'
import { notifyIfEnabled, allowsNotification } from '@/lib/notify'
import { formatTel } from '@/lib/format-contact'
import { shouldFillDefaultAssignee, defaultAssigneeTargets, type AssignSource } from '@/lib/default-assignee'
import { COMPANY_PROFILE_ORDER } from '@/lib/company-profile'
import type { ContactRole, InspectionType } from '@/types'

const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  customer_name: '고객명', inspection_type: '점검유형', contract_date: '계약일',
  use_approval_date: '사용승인일', plan_anchor_date: '점검일자', address: '주소', assigned_employee_id: '담당직원',
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
  /** 법정 축(사용승인일)을 벗어나 **입력한 점검일자**를 기산점으로 쓰겠다는 예외.
   *  등록 화면 미리보기의 체크박스가 켠다(2026-09-14 — 전 직원 허용). 기본은 false = 법정 축. */
  plan_anchor_manual?: boolean
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
  /** 점검일자가 과거·오늘이라 **1차 점검이 즉시 시작됐는가**(= 1~4단계가 달력에 생겼는가).
   *  미래 날짜면 false — 계획 항목만 생기고 단계는 점검 당일에 열린다.
   *  🚨 화면이 이 값으로 안내를 가른다. 없으면 「단계가 생겼다」를 지어내게 된다(2026-09-22). */
  anchorApplied?: boolean
  /** 즉시 시작된 경우의 점검 id — 달력이 **화면을 떠나지 않고** 그 회차 패널을 연다 */
  startedInspectionId?: string
}> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 대표 관계인 1명 필수 (V9 §9)
  const hasRep = (input.contacts ?? []).some(c => c.role === '대표' && c.name?.trim())
  if (!hasRep) return { error: '대표 관계인 이름을 입력해주세요. (대표 1명 필수)' }

  // 점검일자(구 점검계획일→점검확정일, 2026-09-12 용어 확정) 필수 — 연간 점검계획의 기산점 (수동 최우선)
  if (!input.plan_anchor_date) return { error: '점검일자를 입력해주세요.' }

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

  /* 🎯 기본 담당자 — 「일반관리」 고객이 담당 미선택으로 저장되면 설정된 직원으로 채운다
   *   (2026-09-15 사용자 확정). 규칙은 `lib/default-assignee` 한 곳이고 일괄 적용도 같은 함수를 쓴다.
   * ⚠ 설정이 비어 있으면 **아무 일도 하지 않는다** — 종전대로 미배정으로 저장된다.
   * ⚠ 자동으로 채운 건 `assigned_source: 'default'`로 남긴다. 그 표식이 없으면 미배정을
   *   고치는 게 아니라 **숨기는 것**이 된다(빨간 「미배정」이 지금 유일한 신호다). */
  /* 🚨 정렬을 고정한다 — 이 테이블은 '단일 행' 전제지만 **실제로 2행**이다(스테이징 실측).
   *   정렬이 없으면 읽는 쪽과 쓰는 쪽이 다른 행을 잡아, 저장은 성공했는데 화면엔 옛 값이
   *   남는 조용한 실패가 된다. `company/actions.ts`가 같은 이유로 이미 그렇게 해 두었다. */
  const { data: cpRow } = await admin.from('company_profile').select('default_assignee_id').order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle()
  const defaultAssigneeId = (cpRow as { default_assignee_id: string | null } | null)?.default_assignee_id ?? null
  const fillDefault = shouldFillDefaultAssignee(
    { inspection_type: input.inspection_type, assigned_employee_id: input.assigned_employee_id || null },
    defaultAssigneeId,
  )
  const effectiveAssignee = input.assigned_employee_id || (fillDefault ? defaultAssigneeId : null)
  const assignSource: AssignSource | null = effectiveAssignee ? (fillDefault ? 'default' : 'manual') : null

  const baseFields = {
    customer_code: input.customer_code,
    customer_name: input.customer_name,
    contract_date: input.contract_date || null,
    use_approval_date: input.use_approval_date || null,
    plan_anchor_date: input.plan_anchor_date,
    // 155 컬럼 — 값이 없으면 DB DEFAULT(false)가 같은 답을 준다
    plan_anchor_manual: input.plan_anchor_manual === true,
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
    assigned_employee_id: effectiveAssignee,
    assigned_source: assignSource,
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

  /** buildings 테이블에 자동 생성 (V9-3: 건물 기본정보 포함)
   *
   *  🚨 2026-09-11 — **조건을 없앴다**(소방계획서_49 §10-2 ①). 종전 조건은
   *    `customer_name && (address || zipcode || building_purpose || building_floors_above)`
   *  였고, 그래서 **주소·용도·층수를 안 적으면 건물이 한 동도 안 생겼다.**
   *
   *  그게 왜 결함인가: `fire_facilities.building_id`가 NOT NULL이라(067) 건물 0동 고객은
   *  **1.4 소방시설 대장을 저장할 수조차 없다**. 1.4는 점검표의 설치 축이므로 그 고객은
   *  점검표·별지 9호·소방계획서가 연쇄로 막힌다. 화면은 크래시 대신 안내만 띄운다
   *  (`plan-form14.tsx:559` "등록된 활성 건물이 없습니다").
   *
   *  📏 스테이징 실측(2026-09-11, `scripts/_probe-49-buildings.mjs`): 활성 고객 304명 중
   *    **16명이 건물 행 0건**이었다 — 55사단 6곳·민박점검·와락·명품관 등. 가설이 아니라 관측이다.
   *    (기존 16명은 이 변경으로 낫지 않는다 — 백필이 따로 필요하다.)
   *
   *  ⚠ `customer_name` 가드만 남긴다 — `buildings.building_name`이 NOT NULL이고 그 값의
   *    원천이 고객명이다. 이름이 없으면 애초에 고객 생성 자체가 성립하지 않는다.
   *  ⚠ 값이 없는 칸은 그대로 비워 둔다(빈 건물 행). 「정보가 없는 1동」이
   *    「동이 없음」보다 낫다 — 전자는 채울 수 있고 후자는 저장 경로가 막힌다. */
  const buildingTask = (async () => {
  if (input.customer_name) {
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
      // ⚠ 고객과 **같은 값**이라야 한다 — 여기만 입력값을 쓰면 고객은 기본 담당자로 채워졌는데
      //   계획 항목은 미배정이 되어 담당 전파 불변식(INV-D14)이 깨진다.
      assigned_employee_id: effectiveAssignee,
    },
    profile.id,
  )

  // 하나라도 실패하면 등록 자체를 실패로 보고해야 한다 — 조용히 반쪽 등록되는 것이 더 나쁘다
  const [, , , planResult] = await Promise.all([contactsTask, logTask, buildingTask, planTask])

  revalidatePath('/customers')
  return {
    customerId,
    anchorApplied: planResult.anchorApplied,
    startedInspectionId: planResult.startedInspectionId,
  }
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
): Promise<{ anchorApplied: boolean; startedInspectionId?: string }> {
  const anchorDate = new Date(info.plan_anchor_date)
  const now        = new Date()
  const targetYear = anchorDate.getFullYear() >= now.getFullYear()
    ? anchorDate.getFullYear()
    : now.getFullYear()

  // 롤링: 등록 즉시 올해+내년 생성 — 이후 연도는 매월 크론이 이어받는다
  await generateRollingPlanItems(admin, { id: customerId, ...info }, targetYear, createdBy)

  // 🚨 과거·오늘 점검일자 = 점검 사실 (2026-09-20 사용자 확정 — 하늘촌 신고).
  // 종전엔 생성기의 영업일 보정이 입력값을 덮고(09-18 → 09-21) 시작은 당일 크론에만 맡겨져,
  // 사용자가 입력한 날짜가 달력에도 점검업무에도 없었다. 입력값 그대로 1차를 즉시 시작한다.
  const applied = await applyPastAnchorInspection(admin, customerId, info.plan_anchor_date, createdBy)
  if (applied.error) {
    // 등록 자체는 성립했으므로 실패로 되돌리지 않는다 — 다만 조용히 삼키면 같은 신고가
    // 재발하므로 서버 로그에 남긴다(이 경우 회차는 법정 자리로 남고 크론 창 안이면 자동 시작).
    console.error('[신규등록] 과거 점검일자 즉시 시작 실패:', applied.error)
  }
  /* 🚨 2026-09-22 — 종전엔 `applied.applied === false`를 **버렸다**. 달력에서 등록하면
     사용자가 미래 날짜를 고를 수 있고, 그때는 계획 항목만 생기고 단계는 안 생긴다.
     화면이 「1~4단계가 생겼다」와 「계획만 잡혔다」를 가르려면 이 사실이 올라와야 한다.
     ⚠ revalidate는 **양쪽 다** 돈다 — 미래 등록도 계획 칩으로 달력에 실리는데,
       종전엔 applied일 때만 돌아 그 칩이 바로 안 보였다(그 구멍도 여기서 메운다). */
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspections/sms')
  return { anchorApplied: applied.applied, startedInspectionId: applied.inspectionId }
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
      // 'planned' 제거(2026-09-12) — 전건 확정 체계. enum에서 값이 빠져 문자열로 남기면 쿼리가 죽는다
      .eq('status', 'confirmed'),
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

  /* ⚠ 출처를 **함께** 쓴다 — 사람이 고른 순간 `manual`로 승격된다(2026-09-15).
   *   이걸 빠뜨리면 기본 배정된 고객을 손으로 다시 골라도 화면에 「(기본)」이 남아,
   *   "아직 아무도 안 정했다"는 거짓 표식이 굳는다. 해제(null)면 출처도 함께 지운다 —
   *   없는 배정에 출처를 남기지 않는다. */
  const { error } = await admin
    .from('customers')
    .update({
      assigned_employee_id: employeeId,
      assigned_source: employeeId ? 'manual' : null,
    } as Record<string, unknown>)
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

// 확정 보호 팝업(B안, 2026-07-14)의 requiresConfirmedDecision/confirmedItems 계약과
// _getUnconfirmablePlanItems는 2026-09-12 폐지 — 확정은 기계 계산값(점검계획일=점검확정일)이라
// 보호할 사람 결정이 없다. 기산일이 움직이면 _resetPlanItemsForCustomer가 미시작 전건을 옮긴다.
export type UpdateCustomerResult = {
  error?: string
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
  // 미시작 = confirmed + inspection_id null (2026-09-12 전건 확정 체계 — planned는 enum에서 빠졌다.
  // 종전 「planned 전체 + confirmed monthly」 필터는 확정을 사람 결정으로 보호하던 규약)

  // 레거시 event(미시작)는 어느 유형에서도 신규 체계와 무관 — 삭제
  await admin.from('inspection_plan_items').delete()
    .eq('customer_id', customerId).eq('status', 'confirmed')
    .eq('plan_type', 'event').is('inspection_id', null)

  // 일반관리 전환: 정기(monthly)는 대상 아님 — 미시작 정기 삭제
  if (newCategory === '일반관리') {
    await admin.from('inspection_plan_items').delete()
      .eq('customer_id', customerId).eq('plan_type', 'monthly')
      .is('inspection_id', null).eq('status', 'confirmed')
  }

  // sequence_num을 함께 읽는다 — 이게 없으면 아래 루프가 2차 행까지 고객 축 값으로 덮어써서
  // **고객 정보를 다시 저장하기만 해도 2차가 종합으로 원복된다**(소방계획서_33 S2-4의 조용한 회귀).
  const { data: items } = await admin
    .from('inspection_plan_items')
    .select('id, plan_type, sequence_num')
    .eq('customer_id', customerId)
    .is('inspection_id', null)
    .eq('status', 'confirmed')
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
    // 작동 전환 = 연 1회 — 미시작 2차 삭제. 종전 필터 status='planned'는 「사람이 확정한
    // 2차는 보호」 규약이었는데, 전건 확정 체계에선 미시작(confirmed+미연결)이 그 자리다
    await admin.from('inspection_plan_items').delete()
      .eq('customer_id', customerId).eq('status', 'confirmed')
      .is('inspection_id', null).eq('sequence_num', 2)
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
): Promise<UpdateCustomerResult> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 점검계획일은 필수값 — 비우기 불허 (2026-07-14: "지우면 폴백 복귀" 설계 폐기)
  if (input.plan_anchor_date !== undefined && !input.plan_anchor_date) {
    return { error: '점검일자는 필수값입니다 — 비울 수 없습니다.' }
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

  // 확정 보호 팝업(B안, 2026-07-14) 폐지(2026-09-12) — 확정은 기계 계산값이라 보호할
  // 사람 결정이 없다. 기산일이 움직이면 아래 _resetPlanItemsForCustomer가 미시작 전건을 옮긴다.
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

  // 기준일이 변경된 경우: 미시작 plan_items 전건 재계산 (2026-09-12 — 확정해제 선택지 폐지)
  if (anchorChanged) {
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
  return {}
}

async function _resetPlanItemsForCustomer(
  admin: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  customerId: string,
  newDates: { plan_anchor_date: string | null },
) {
  // 재계산 대상: 미확정(planned) + 자동 확정 정기(confirmed monthly, 미시작 — 2026-07-14 자동 확정 도입).
  // 사람이 확정한 특별점검(confirmed special)·완료·취소 항목은 재계획하지 않음 (2026-07-12 결정)
  const { data: items, error: itemsErr } = await admin
    .from('inspection_plan_items')
    .select('id, status, plan_type, inspection_plans!inner(year, month)')
    .eq('customer_id', customerId)
    .is('inspection_id', null)
    // 미시작 전건 — 점검계획일=점검확정일(2026-09-12)이라 특별점검도 확정 상태로 태어난다.
    // 종전의 「planned 또는 정기-confirmed」 필터는 확정을 사람 결정으로 보호하던 규약인데,
    // 이제 확정은 기계 계산값이라 기산일이 움직이면 전건이 함께 움직여야 한다.
    // ⚠ 2026-09-13 수리 — 여기에 `'planned'`가 **남아 있었다**. 주석은 이미 「미시작 전건」이라고
    //   적혀 있었는데 필터만 옛 값을 들고 있었고, 마이그 162가 enum에서 그 값을 지운 뒤로 이 질의는
    //   **22P02로 통째로 거절**됐다(실측: invalid input value for enum plan_item_status: "planned").
    //   error를 안 받아서 `items`가 null이 되고 아래 early return으로 빠져 — **점검계획일을 바꿔도
    //   계획 항목이 한 건도 재계산되지 않았다.** 미리보기는 다른 함수(planReconcile)라 「이렇게
    //   바뀝니다」를 정확히 보여줬으므로, 사용자는 보여준 대로 된 줄 알았다. 같은 파일 :408에
    //   같은 함정을 고쳐 둔 자리가 있는데 이 한 곳이 남았다.
    .in('status', ['confirmed'])

  // 조회 실패를 '대상 없음'으로 접지 않는다 — 그 침묵이 위 결함을 배포까지 데려갔다
  if (itemsErr) {
    console.error(`[plan-reset] 재계산 대상 조회 실패 — 계획을 갱신하지 못했습니다 (customer ${customerId}):`, itemsErr)
    return
  }
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

    // 전 유형: 확정 유지 + 확정일도 새 기준일로 동행 — 점검계획일=점검확정일 (2026-09-12).
    // 종전엔 특별점검(planned)만 「관리자 재확정 필요」로 확정일을 비웠는데, 확정 절차가
    // 폐지돼 비워 두면 다시 채울 사람이 없다. 단계 마감일은 시작 시 재계산되므로 비운다.
    await admin
      .from('inspection_plan_items')
      .update({
        status: 'confirmed',
        scheduled_date: newPlannedDate,
        planned_date: newPlannedDate,
        ...stepResetFields,
      } as Record<string, unknown>)
      .eq('id', (item as Record<string, unknown>).id as string)
  }
}

/** 고객 **등록 화면** 미리보기 — 아직 고객 행이 없으므로 `planReconcile`을 못 쓴다.
 *
 *  왜 필요한가(2026-09-14 실측): 등록 폼은 점검일자를 **필수로 받으면서** "이 날짜의 월·일
 *  기준으로 일정이 확정됩니다"라고 안내하는데, 사용승인일도 필수라 신규 고객은 `manual=false`로
 *  태어나 **항상 사용승인일이 이긴다**. 즉 그 안내가 거짓이고, 입력한 날짜는 한 칸도 안 쓰인다.
 *  스테이징 실측에서 법정 축 고객 162명 중 **158명**이 입력값과 다른 날짜로 일정이 서 있었다.
 *
 *  ⚠ 달 산식(`desiredSlotsFor`)·영업일 보정(`plannedDateFor`)·기산점 해석(`resolveAnchor`)은
 *    전부 **실행이 쓰는 그 함수**다. 화면이 따로 계산하면 "보여준 것과 다른 일이 벌어진다".
 *  아무것도 쓰지 않는다(읽기 전용). */
export type NewScheduleRow = {
  year: number; month: number; planType: string; date: string
  /** 영업일 보정으로 밀렸는가 — 밀렸다면 원래 날짜(사용자에게 이유를 보여주기 위함) */
  shiftedFrom: string | null
}
export type NewSchedulePreview = {
  anchorDate: string | null
  anchorSource: string
  /** 기산점이 사용승인일인가 — 아니면 점검일자(또는 없음) */
  anchorIsApproval: boolean
  /** 입력했지만 **쓰이지 않는** 점검일자. null이면 입력값이 실제로 쓰인다 */
  ignoredAnchorDate: string | null
  /** 과거·오늘 점검일자 — 등록 즉시 이 날짜로 1차 자체점검이 시작된다(2026-09-20 사용자 확정).
   *  이때 입력값은 「쓰이지 않는」 게 아니라 1차 점검일로 그대로 쓰이므로 ignoredAnchorDate와
   *  동시에 설 수 없다(서버가 배타로 계산한다). */
  pastAnchorStart: string | null
  rows: NewScheduleRow[]
  /** 최초점검 기한(사용승인일+60일) — 아직 안 지났을 때만 */
  initialDue: string | null
}
export async function previewNewCustomerScheduleAction(input: {
  use_approval_date: string | null
  plan_anchor_date: string | null
  plan_anchor_manual: boolean
  inspection_sub_type: '종합' | '작동'
}): Promise<{ error?: string; preview?: NewSchedulePreview }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const anchor = resolveAnchor({
    use_approval_date: input.use_approval_date,
    plan_anchor_date: input.plan_anchor_date,
    plan_anchor_manual: input.plan_anchor_manual,
  })
  const anchorIsApproval = anchor.source === 'approval'
  // 과거·오늘 점검일자는 등록 즉시 1차 점검일로 **그대로 쓰인다**(applyPastAnchorInspection) —
  // 이때 「안 쓰인다」 고지를 함께 띄우면 화면이 거짓말이 된다. 배타로 계산한다.
  const pastAnchorStart = input.plan_anchor_date && input.plan_anchor_date <= todayKst()
    ? input.plan_anchor_date : null
  // 「입력했는데 안 쓰인다」는 **기산점이 다른 날짜일 때만** 성립한다
  const ignoredAnchorDate = (pastAnchorStart || !anchorIsApproval || !input.plan_anchor_date) ? null
    : (input.plan_anchor_date !== anchor.date ? input.plan_anchor_date : null)
  const base: NewSchedulePreview = {
    anchorDate: anchor.date, anchorSource: anchorSourceLabel(anchor.source),
    anchorIsApproval, ignoredAnchorDate, pastAnchorStart, rows: [], initialDue: null,
  }
  if (!anchor.date) return { preview: base }

  const y = new Date(Date.now() + 9 * 3600_000).getFullYear()
  const years = [y, y + 1]
  const hd = await loadHolidaySet(admin, years[0])
  const anchorDay = anchorDayOf(anchor.date)
  const slots = desiredSlotsFor(anchor.date, input.inspection_sub_type)
  const rows: NewScheduleRow[] = []
  for (const year of years) {
    // 해를 넘긴 2차는 **전 해 주기의 것**이라 계획 첫 해에는 없다 — 실행(생성기·재배치)과 같은
    // 규칙을 써야 한다. 여기서 그냥 펴면 미리보기가 **생기지도 않을 일정**을 약속한다.
    for (const s of desiredSlotsInYear(slots, year, years[0])) {
      const date = plannedDateFor(year, s.month, anchorDay, hd)
      const daysInMo = new Date(year, s.month, 0).getDate()
      const naive = `${year}-${String(s.month).padStart(2, '0')}-${String(Math.min(anchorDay, daysInMo)).padStart(2, '0')}`
      rows.push({ year, month: s.month, planType: s.planType, date, shiftedFrom: date === naive ? null : naive })
    }
  }
  rows.sort((a, b) => a.date < b.date ? -1 : 1)
  // 과거·오늘 점검일자는 1차(가장 이른 회차)를 그 날짜로 즉시 시작한다 — 미리보기 행도 같은
  // 날짜를 말해야 한다(applyPastAnchorInspection이 고르는 「planned가 가장 이른 미시작 회차」와
  // 정렬 첫 행이 같은 대상이다). 법정 자리 안내는 shiftedFrom으로 남긴다.
  if (pastAnchorStart && rows.length > 0 && rows[0].date !== pastAnchorStart) {
    rows[0] = { ...rows[0], shiftedFrom: null, date: pastAnchorStart }
  }
  // 최초점검 창은 **종합 대상 + 사용승인일이 있을 때만** 의미가 있다(planFrom과 같은 규칙)
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  let initialDue: string | null = null
  if (input.inspection_sub_type === '종합' && input.use_approval_date) {
    const t = Date.UTC(+input.use_approval_date.slice(0, 4), +input.use_approval_date.slice(5, 7) - 1,
      +input.use_approval_date.slice(8, 10)) + INITIAL_INSPECTION_DAYS * 86_400_000
    const due = new Date(t).toISOString().slice(0, 10)
    if (due >= today) initialDue = due
  }
  return { preview: { ...base, rows, initialDue } }
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
}> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const y = new Date().getFullYear()
  const [b, a] = await Promise.all([
    planReconcile(admin, customerId, [y, y + 1]),
    planReconcile(admin, customerId, [y, y + 1], proposed),
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
  return { before: shape(b), after: shape(a) }
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
    /* ⚠ 출처도 함께 — 지역별 일괄 배정은 **사람이 고른 것**이라 `manual`이다(2026-09-15).
     *   빠뜨리면 출처가 null로 남아 「사람이 고름」과 「출처 미상」을 나중에 가를 수 없다.
     *   표시는 둘 다 이름만이라 화면으로는 안 드러난다 — 그래서 더 조용히 어긋난다. */
    .update({
      assigned_employee_id: employeeId,
      assigned_source: employeeId ? 'manual' : null,
    } as Record<string, unknown>)
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
// 원상태를 notes 마커(⟦자동취소:상태⟧)로 보존해 재활성화 시 그대로 복원.
// 정규식의 planned는 **과거 마커 읽기 전용** — planned 시절(2026-09-12 이전) 취소된 행의
// 마커가 notes에 남아 있다. 복원할 때는 confirmed로 승격한다(enum에서 planned가 빠졌다, 162).
const AUTO_CANCEL_MARKER = /⟦자동취소:(planned|confirmed)⟧/

async function _autoCancelPlansForCustomer(admin: ReturnType<typeof createAdminClient>, customerId: string) {
  const { data } = await admin
    .from('inspection_plan_items')
    .select('id, status, notes')
    .eq('customer_id', customerId)
    .eq('status', 'confirmed')
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
        // 과거 마커의 planned는 confirmed로 승격 — enum에서 planned가 빠졌다(162)
        status: m[1] === 'planned' ? 'confirmed' : m[1],
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

/** 물리 삭제 뒤 남는 스토리지 고아 정리 (소방계획서_32 DEF-2 · S8-3).
 *  fire-plans 버킷의 고객 파일은 전부 `{customerId}/` 아래에 있고, 불량 사진과 제출 보고서는
 *  inspection-defects·inspection-reports 버킷의 `{inspectionId}/` 아래에 있다 —
 *  표지·위치도(`assets/`)는 **DB 행이 아예 없어** 어떤 FK로도 따라갈 수 없다.
 *  접두사째 비우는 이유가 이것.
 *  list()는 재귀하지 않으므로(폴더는 id=null로 온다) 직접 훑는다.
 *
 *  ⚠ 버킷을 새로 만들면 여기 추가할 것 — 빠뜨려도 아무 오류가 안 나고 파일만 조용히 남는다.
 *    실측(2026-09-08) 당시 5개 버킷 중 inspection-reports가 빠져 있었고 그 버킷은
 *    보유 파일 전부가 고아였다. 현재 대상: fire-plans · inspection-defects ·
 *    inspection-reports · reports(경로가 generated_reports.xlsx_path라 별도 처리).
 *    log-archives는 고객 축이 아니다. */
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
  for (const id of inspIds) {
    purges.push(await _purgeStoragePrefix(admin, 'inspection-defects', id))
    // inspection-reports(2026-09-08, S8-3): 156이 `inspection_reports` **DB 행은 첫 번째로
    // 지우면서** 그 행이 가리키던 파일은 남겨 두고 있었다. 실측으로 드러났다 — 이 버킷의
    // 파일 전부(1/1)가 사라진 점검을 가리키는 고아였다. 경로 규약은 defects와 같은
    // `{inspectionId}/{reportType}/…`(report-actions.ts:63)라 같은 방식으로 접두사째 비운다.
    purges.push(await _purgeStoragePrefix(admin, 'inspection-reports', id))
  }
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
): Promise<UpdateCustomerResult> {
  // 담당자 필드는 배정 권한(매니저 이상), 그 외 필드는 고객 수정 권한
  const profile = field === 'assigned_employee_id'
    ? await requirePermission('customer_assign')
    : await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 점검계획일은 필수값 — 비우기 불허 (2026-07-14: "지우면 폴백 복귀" 설계 폐기)
  if (field === 'plan_anchor_date' && !value) {
    return { error: '점검일자는 필수값입니다 — 비울 수 없습니다.' }
  }

  // 이전 값 조회 (변경 감지 + 이력 기록용)
  const { data: prevData } = await admin
    .from('customers')
    .select('customer_name, inspection_type, inspection_sub_type, contract_date, use_approval_date, plan_anchor_date, assigned_employee_id')
    .eq('id', customerId).single()
  const prevRow = prevData as Record<string, string | null> | null
  const oldValue = prevRow?.[field] ?? null

  // 기산점이 실제로 움직였는지 판정 — 아래 재계산·자리 재배치의 방아쇠
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
  // 확정 보호 팝업(B안) 폐지(2026-09-12) — 기산점이 움직이면 아래에서 미시작 전건을 조건 없이 재계산한다
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

  // 기산점이 **실제로 움직였을 때만** 미시작 항목 전건 재계산 (2026-09-12 — 확정해제 선택지 폐지)
  if (anchorMoved) {
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
    revalidatePath('/inspections/calendar')
  }

  // 점검유형 변경 → 미확정(planned) 계획 항목 유형 동기화 (변경전파맵 1-11)
  if (field === 'inspection_type' && value && value !== oldValue) {
    const patchedSub = patchFields.inspection_sub_type === '종합' ? '종합' : '작동'
    await _syncInspectionTypeToPlanItems(admin, customerId, value as InspectionType, patchedSub, profile.id)
    await syncStartedRowSubTypes(admin, customerId)   // 시작된 행 종류도 (2026-09-02)
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

/* ── 기본 담당자 (2026-09-15 사용자 확정) ─────────────────────────────────────────
 *
 * 「일반관리」 고객이 담당 미선택으로 저장될 때 채울 직원. 설정은 회사 단위라
 * `company_profile`에 둔다(같은 테이블의 `default_region_si`가 선례다).
 *
 * ⚠ `company_profile.representative`를 쓰지 않는다 — 그건 **이름 문자열**이라 profiles와
 *   이어져 있지 않고, 「대표자」와 「기본 담당자」는 원래 다른 개념이다(사용자가 직접 고른다).
 * ⚠ **설정 저장과 일괄 적용을 가른다.** 드롭다운 한 번에 수십 명의 데이터가 바뀌면
 *   잘못 고른 순간 되돌릴 방법이 마땅찮다. 적용은 버튼을 눌러야 하고, 그 전에 대상 수를 보여준다.
 */

/** 기본 담당자 설정 — **저장만** 한다(고객 데이터는 건드리지 않는다). */
export async function setDefaultAssigneeAction(
  profileId: string | null,
): Promise<{ error?: string }> {
  await requirePermission('customer_assign')
  const admin = createAdminClient()
  const { data: row } = await admin.from('company_profile').select('id').order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle()
  const id = (row as { id: string } | null)?.id
  if (!id) return { error: '회사 정보가 없습니다 — 회사 정보를 먼저 저장해주세요.' }
  const { error } = await admin.from('company_profile')
    .update({ default_assignee_id: profileId || null } as Record<string, unknown>)
    .eq('id', id)
  if (error) return { error: `설정 저장에 실패했습니다: ${error.message}` }
  revalidatePath('/admin/users')
  return {}
}

/** 일괄 적용 — 「일반관리」 미배정 고객을 기본 담당자로 채운다.
 *
 *  ⚠ 대상 판정은 `lib/default-assignee`의 `defaultAssigneeTargets` 하나다 — 화면이 보여준
 *    미리보기 수와 실제로 바뀌는 집합이 **같은 함수**에서 나와야 "2명"이라 말하고 3명을
 *    바꾸는 일이 없다.
 *  ⚠ **알림을 보내지 않는다.** 기본 배정은 사람이 정한 일이 아니라 빈칸을 메운 것이다 —
 *    36명을 채우며 알림 36개를 보내면 그게 더 나쁘다(정식 배정만 알린다).
 */
export async function applyDefaultAssigneeAction(): Promise<{ applied?: number; error?: string }> {
  await requirePermission('customer_assign')
  const admin = createAdminClient()
  const { data: cp } = await admin.from('company_profile').select('default_assignee_id').order(COMPANY_PROFILE_ORDER, { ascending: true }).limit(1).maybeSingle()
  const defaultId = (cp as { default_assignee_id: string | null } | null)?.default_assignee_id ?? null
  if (!defaultId) return { error: '기본 담당자를 먼저 선택해주세요.' }

  const { data: rows, error: readErr } = await admin.from('customers')
    .select('id, inspection_type, assigned_employee_id, is_active')
  if (readErr) return { error: `고객 조회에 실패했습니다: ${readErr.message}` }
  const targets = defaultAssigneeTargets(
    ((rows ?? []) as Array<{ id: string; inspection_type: string | null; assigned_employee_id: string | null; is_active: boolean | null }>)
      .filter(c => c.is_active !== false),
    defaultId,
  )
  if (targets.length === 0) return { applied: 0 }

  const { error } = await admin.from('customers')
    .update({ assigned_employee_id: defaultId, assigned_source: 'default' } as Record<string, unknown>)
    .in('id', targets.map(t => t.id))
  if (error) return { error: `일괄 적용에 실패했습니다: ${error.message}` }

  // 담당 전파 — 미완료 계획·진행중 점검까지(지역별 일괄 배정과 같은 규약, INV-D14)
  for (const t of targets) await _syncEmployeeToRelated(admin, t.id, defaultId)

  revalidatePath('/admin/users')
  revalidatePath('/customers')
  revalidatePath('/customers/regional-assign')
  return { applied: targets.length }
}

// ── 점검달력에서 고객 등록 (2026-09-22 사용자 요청 — 달력 한 바퀴) ─────────────────
/** 등록 폼이 요구하는 서버 데이터 3종 — **모달이 열릴 때** 부른다.
 *
 *  ⚠ 달력 초기 로드에 얹지 않는다. 달력은 이미 7개 조회(점검·단계·고객·건물·직원·공휴일·계획)를
 *    돌리는 무거운 화면이고, 등록을 하지 않는 대다수 방문에도 비용이 붙는다.
 *    폼 컴포넌트 자체도 `next/dynamic`으로 지연 로드하므로 **달력 초기 번들·쿼리 증가가 0**이다.
 *
 *  ⚠ 값의 출처는 `/customers/new` 페이지와 **같은 함수들**이다(getCompanyProfile·listBuildingPurposes).
 *    여기서 따로 조회하면 두 등록 화면이 다른 기본 지역·다른 용도 목록을 보게 된다. */
export async function getCustomerNewFormDataAction(): Promise<{
  error?: string
  employees?: Array<{ id: string; name: string; position: string | null }>
  defaultRegionSi?: string
  purposes?: string[]
}> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const [{ data: employeesRaw }, company, purposes] = await Promise.all([
    admin.from('profiles').select('id, name, position')
      .eq('is_active', true).eq('is_system', false).order('name'),
    getCompanyProfile(),
    listBuildingPurposes(),
  ])
  return {
    employees: (employeesRaw ?? []) as Array<{ id: string; name: string; position: string | null }>,
    // 폼의 region_si는 시/군/구 단위(예: 양평군) — company_profile.default_region_myeon이 그 값
    defaultRegionSi: company?.default_region_myeon ?? '',
    purposes,
  }
}
