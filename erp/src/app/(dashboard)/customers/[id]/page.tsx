import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, UserCheck, ClipboardList, History } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AssignEmployeeInline } from '@/components/customers/assign-employee-inline'
import { EditContactsClient } from '@/components/customers/edit-contacts-client'
import { EditInspectionTypeClient } from '@/components/customers/edit-inspection-type-client'
import { EditCustomerInfoClient } from '@/components/customers/edit-customer-info-client'
import { FirePlansClient, type FirePlanRow } from '@/components/customers/fire-plans-client'
import { FirePlanInfoPanel } from '@/components/customers/fire-plan-info-panel'
import { PlanTabView, type RevisionRow } from '@/components/customers/plan-tab-view'
import { PlanForm12, type ZoneRow, type HazardRow } from '@/components/customers/plan-form12'
import { PlanForm13, type LocationSection, type FireAccessSection } from '@/components/customers/plan-form13'
import { PlanForm14 } from '@/components/customers/plan-form14'
import { PlanForm15, EMPTY_EVAC_FIRE, type EvacFireSection, type EvacMapRow } from '@/components/customers/plan-form15'
import { PlanForm16, EMPTY_ETC_FACILITY, type EtcFacilitySection } from '@/components/customers/plan-form16'
import { PlanForm17, type ManagerRow } from '@/components/customers/plan-form17'
import { PlanForm110, type InspectionPlanSection, type MultiUseSection, type FireHistoryRow } from '@/components/customers/plan-form110'
import { PlanForm111, type TrainingSection } from '@/components/customers/plan-form111'
import { PlanCh2 } from '@/components/customers/plan-ch2'
import { recommendPresetType } from '@/lib/fire-plan-presets'
import { BillingClient, type BillingProfile, type Autopay } from '@/components/customers/billing-client'
import { CustomerTabs, type CustomerTabDef } from '@/components/customers/customer-tabs'
import { BuildingListPanel, type BuildingPanelRow } from '@/components/customers/building-inline-panel'
import { CustomerSummaryPanel } from '@/components/customers/customer-summary-panel'
import { CustomerPrevNext } from '@/components/customers/customer-prev-next'
import { RecommendAssignClient } from '@/components/customers/recommend-assign-client'
import { computeFirePlanReadiness } from '@/lib/fire-plan-readiness'
import { requiredDocs, isGeneralManagement, computeQuickReadiness } from '@/lib/doc-requirements'
import { fetchCustomerList, parseListFilter } from '@/lib/customer-list'
import type { Customer, CustomerContact, Inspection, InspectionStatus, InspectionType, UserRole } from '@/types'
import { inspectionTypeLabel } from '@/types'

type ActivityLog = {
  id: string
  action: string
  actor_id: string | null
  metadata: {
    changes?: Array<{ field: string; field_label: string; old_value: string | null; new_value: string | null }>
  } | null
  created_at: string
}

const TYPE_COLORS: Record<InspectionType, string> = {
  '종합':   'bg-[#f5f4ff] text-[#7b68ee]',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

const STATUS_LABELS: Record<InspectionStatus, string> = {
  scheduled: '예정',
  in_progress: '진행중',
  completed: '완료',
  overdue: '기한초과',
}

const STATUS_COLORS: Record<InspectionStatus, string> = {
  scheduled: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-[#f5f4ff] text-[#7b68ee]',
  completed: 'bg-green-50 text-green-700',
  overdue: 'bg-red-50 text-red-600',
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; b?: string; new?: string; lq?: string; hy?: string; hk?: string; created?: string; sub?: string }>
}) {
  const { id } = await params
  const { tab: initialTab, b: initialBuildingId, new: initialNewBuilding, lq, hy, hk, created, sub } = await searchParams
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  const [customerRes, contactsRes, employeesRes, allProfilesRes, inspectionsRes, buildingsRes, activityLogsRes, firePlansRes, billingProfileRes, autopayRes, ownersRes, brigadeRes] = await Promise.all([
    admin.from('customers').select('*').eq('id', id).single(),
    admin.from('customer_contacts').select('*').eq('customer_id', id).order('role'),
    admin.from('profiles').select('id, name, position').eq('is_active', true).eq('is_system', false).order('name'),
    // 변경 이력의 담당직원 UUID → 이름 변환용 (퇴사·시스템 계정 포함 전체)
    admin.from('profiles').select('id, name'),
    admin.from('inspections')
      .select('id, year, sequence_num, inspection_type, inspection_start_date, status, assigned_employee_id')
      .eq('customer_id', id)
      .order('year', { ascending: false })
      .order('sequence_num'),
    admin.from('buildings')
      .select('*')  // 092(bcode·address_jibun) 적용 전에도 안전 — 존재하는 컬럼만 반환
      .eq('customer_id', id)
      .order('building_name'),
    admin.from('activity_logs')
      .select('id, action, actor_id, metadata, created_at')
      .eq('entity_type', 'customer')
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('fire_plans')
      .select('id, year, title, pdf_name, pdf_path, pdf_status, html_path, hwp_name, hwp_path, note, revision, submitted_at, fire_station, created_at, uploaded_by, fire_plan_attachments(id, kind, file_name)')
      .eq('customer_id', id)
      .order('year', { ascending: false })
      .order('created_at', { ascending: false }),
    admin.from('billing_profiles')
      .select('business_no, company_name, rep_name, address, business_type, business_item, tax_email, note')
      .eq('customer_id', id).maybeSingle(),
    admin.from('billing_autopay')
      .select('bank_name, account_holder, account_no_last4, withdraw_day, note')
      .eq('customer_id', id).maybeSingle(),
    admin.from('owners').select('id, name, contact').order('name'),
    admin.from('fire_brigade_members')
      .select('team, name, duty, phone').eq('customer_id', id).order('sort_order'),
  ])

  if (!customerRes.data) notFound()

  const customer = customerRes.data as Customer
  const contacts = (contactsRes.data ?? []) as CustomerContact[]
  const employees = (employeesRes.data ?? []) as Array<{ id: string; name: string; position: string | null }>
  const buildings = (buildingsRes.data ?? []) as Array<{
    id: string; building_name: string; address: string | null
    total_area: number | null; floors_above: number | null; floors_below: number | null
    purpose: string | null; year_built: number | null; is_active: boolean
    facilities_verified_at: string | null
  }>

  // 소방시설 현황 (건물별) — P33
  const buildingIds = buildings.map(b => b.id)
  const [facRes, floorRes] = buildingIds.length > 0 ? await Promise.all([
    admin.from('fire_facilities').select('building_id, facility_code, installed, detail').in('building_id', buildingIds),
    admin.from('fire_facility_floors').select('building_id, floor_label, counts').in('building_id', buildingIds).order('sort_order'),
  ]) : [{ data: [] }, { data: [] }]
  const facByBuilding = new Map<string, Array<{ facility_code: string; installed: boolean; detail: { note?: string } | null }>>()
  for (const f of (facRes.data ?? []) as Array<{ building_id: string; facility_code: string; installed: boolean; detail: { note?: string } | null }>) {
    if (!facByBuilding.has(f.building_id)) facByBuilding.set(f.building_id, [])
    facByBuilding.get(f.building_id)!.push({ facility_code: f.facility_code, installed: f.installed, detail: f.detail })
  }
  const floorByBuilding = new Map<string, Array<{ floor_label: string; counts: Record<string, number> }>>()
  for (const fl of (floorRes.data ?? []) as Array<{ building_id: string; floor_label: string; counts: Record<string, number> }>) {
    if (!floorByBuilding.has(fl.building_id)) floorByBuilding.set(fl.building_id, [])
    floorByBuilding.get(fl.building_id)!.push({ floor_label: fl.floor_label, counts: fl.counts ?? {} })
  }
  const facilityBuildings = buildings.filter(b => b.is_active).map(b => ({
    id: b.id, building_name: b.building_name, verified_at: b.facilities_verified_at,
    facilities: facByBuilding.get(b.id) ?? [], floors: floorByBuilding.get(b.id) ?? [],
    // §6-E: 층 자동 생성·기본 세트용
    purpose: b.purpose, floorsAbove: b.floors_above, floorsBelow: b.floors_below,
  }))
  const inspections = (inspectionsRes.data ?? []) as Array<
    Pick<Inspection, 'id' | 'year' | 'sequence_num' | 'inspection_type' | 'inspection_start_date' | 'status' | 'assigned_employee_id'>
  >
  const activityLogs = (activityLogsRes.data ?? []) as ActivityLog[]
  const profileNameMap = new Map(
    ((allProfilesRes.data ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p.name])
  )
  // 과거 이력에 담당직원이 UUID로 저장된 행 표시 보정 (감사 로그 원본은 불변 — 표시 시점에만 변환)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  function displayChangeValue(field: string, v: string | null): string | null {
    if (v && field === 'assigned_employee_id' && UUID_RE.test(v)) {
      return profileNameMap.get(v) ?? '(삭제된 계정)'
    }
    return v
  }

  // 변경 이력 표시 화이트리스트 — 필수 고객관리 사항만 (기록 자체는 전부 보존, 전체는 관리자>활동로그)
  const ESSENTIAL_FIELDS = new Set(['assigned_employee_id', 'inspection_type', 'use_approval_date', 'plan_anchor_date', 'contract_date', 'is_active'])
  const ACTION_LABELS: Record<string, string> = {
    customer_created: '고객 등록',
    general_inspection_registered: '일반관리 점검 등록',
  }
  const essentialLogs = activityLogs
    .map(log => ({
      log,
      actionLabel: ACTION_LABELS[log.action],
      changes: (log.metadata?.changes ?? []).filter(c => ESSENTIAL_FIELDS.has(c.field)),
    }))
    .filter(x => x.actionLabel || x.changes.length > 0)

  // 점검별 단계 진행 카운트
  const stepCounts: Record<string, { total: number; completed: number }> = {}
  if (inspections.length > 0) {
    const { data: steps } = await admin
      .from('inspection_steps')
      .select('inspection_id, status')
      .in('inspection_id', inspections.map(i => i.id))

    for (const s of steps ?? []) {
      const r = s as { inspection_id: string; status: string }
      if (!stepCounts[r.inspection_id]) stepCounts[r.inspection_id] = { total: 0, completed: 0 }
      stepCounts[r.inspection_id].total++
      if (r.status === 'completed') stepCounts[r.inspection_id].completed++
    }
  }

  const firePlans: FirePlanRow[] = ((firePlansRes.data ?? []) as Array<{
    id: string; year: number; title: string | null; pdf_name: string | null; pdf_path: string | null
    pdf_status: string; html_path: string | null
    hwp_name: string | null; hwp_path: string | null; note: string | null; revision: number | null
    submitted_at: string | null; fire_station: string | null; created_at: string; uploaded_by: string | null
    fire_plan_attachments: Array<{ id: string; kind: string; file_name: string }> | null
  }>).map(p => ({
    id: p.id, year: p.year, title: p.title, pdf_name: p.pdf_name,
    pdf_status: p.pdf_status, has_html: !!p.html_path,
    hwp_name: p.hwp_name, note: p.note, created_at: p.created_at,
    revision: p.revision ?? 1, submitted_at: p.submitted_at, fire_station: p.fire_station,
    attachments: p.fire_plan_attachments ?? [],
    uploader_name: p.uploaded_by ? (profileNameMap.get(p.uploaded_by) ?? null) : null,
    generated: (p.pdf_path ?? p.hwp_path ?? '').includes('generated_'),
  }))

  const assignedEmployee = customer.assigned_employee_id
    ? employees.find(e => e.id === customer.assigned_employee_id)
    : null

  // B안: 고객 정보 수정은 전 직원, 담당 배정만 매니저 이상
  const canManage = can(profile.role as UserRole, 'customer_manage')
  const canAssign = can(profile.role as UserRole, 'customer_assign')

  // ── 계획서 정보 패널 데이터 — 탭 뱃지 준비율 계산에도 사용 (설계 §4) ──
  const cRec = customer as unknown as Record<string, unknown>
  const firstBld = buildings.filter(b => b.is_active)
    .sort((a, b) => String((a as Record<string, unknown>).created_at ?? '').localeCompare(String((b as Record<string, unknown>).created_at ?? '')))[0] as Record<string, unknown> | undefined
  const s = (v: unknown) => (v == null ? '' : String(v))
  const planInfoInitial = {
    receiverLocation: s(firstBld?.receiver_location),
    structure: s(firstBld?.main_structure),
    roof: s(firstBld?.roof_structure),
    height: s(firstBld?.height),
    hasBuilding: !!firstBld,
    managerSelectedAt: s(cRec.manager_selected_at),
    grade: s(cRec.building_grade),
    insuranceJoined: (cRec.insurance_joined as boolean | null) ?? null,
    insuranceCompany: s(cRec.insurance_company),
    insurancePeriod: s(cRec.insurance_period),
    insuranceAmountPerson: s(cRec.insurance_amount_person),
    insuranceAmountProperty: s(cRec.insurance_amount_property),
    opHoursWeekday: s(cRec.op_hours_weekday),
    opHoursHoliday: s(cRec.op_hours_holiday),
    headcountWorker: s(cRec.headcount_worker),
    headcountResident: s(cRec.headcount_resident),
    headcountMax: s(cRec.headcount_max),
    brigade: ((brigadeRes.data ?? []) as Array<{ team: string; name: string; duty: string | null; phone: string | null }>)
      .map(m => ({ team: m.team, name: m.name, duty: m.duty ?? '', phone: m.phone ?? '' })),
    // §6-D-1 추천값 판정용 (급수 규칙·운영시간 프리셋)
    purpose: (firstBld?.purpose as string | null) ?? null,
    totalArea: (firstBld?.total_area as number | null) ?? null,
    floorsAbove: (firstBld?.floors_above as number | null) ?? null,
    floorsBelow: (firstBld?.floors_below as number | null) ?? null,
    facilityCodes: firstBld
      ? (facByBuilding.get(firstBld.id as string) ?? []).filter(f => f.installed).map(f => f.facility_code)
      : [],
  }
  const planPeople = [
    ...contacts.map(ct => ({ name: ct.name, phone: ct.phone ?? '', kind: `관계인·${ct.role}` })),
    ...employees.map(e => ({ name: e.name, phone: '', kind: `직원${e.position ? `·${e.position}` : ''}` })),
  ]
  const readiness = computeFirePlanReadiness({
    receiverLocation: planInfoInitial.receiverLocation, structure: planInfoInitial.structure, roof: planInfoInitial.roof,
    managerSelectedAt: planInfoInitial.managerSelectedAt, grade: planInfoInitial.grade,
    insuranceJoined: planInfoInitial.insuranceJoined, opHoursWeekday: planInfoInitial.opHoursWeekday,
    hasHeadcount: !!(planInfoInitial.headcountWorker || planInfoInitial.headcountResident || planInfoInitial.headcountMax),
    hasBrigade: planInfoInitial.brigade.length > 0,
  })

  // ── P2: 문서 요구 매트릭스 + 빠른 입력 필수 완성도 (소방계획서_4.md §1-1·§9-8) ──
  const docProfile = { inspection_type: customer.inspection_type }
  const isGeneral = isGeneralManagement(docProfile)
  const quickReadiness = computeQuickReadiness(docProfile, {
    address: !!customer.address,
    purpose: !!firstBld?.purpose,
    useApprovalDate: !!customer.use_approval_date,
    permitDate: firstBld?.permit_date != null,
    totalArea: firstBld?.total_area != null,
    buildingArea: firstBld?.building_area != null,
    floors: firstBld?.floors_above != null || firstBld?.floors_below != null,
    height: !!planInfoInitial.height,
    households: firstBld?.households != null,
    buildingCount: firstBld?.building_count != null,
    elevator: firstBld?.elevator_count != null || firstBld?.emergency_elevator_count != null,
    parking: firstBld?.parking_summary != null,
    receiverLocation: !!planInfoInitial.receiverLocation,
    structure: !!planInfoInitial.structure,
    roof: !!planInfoInitial.roof,
    managerSelectedAt: !!planInfoInitial.managerSelectedAt,
    grade: !!planInfoInitial.grade,
    insurance: planInfoInitial.insuranceJoined !== null,
    opHours: !!planInfoInitial.opHoursWeekday,
    headcount: !!(planInfoInitial.headcountWorker || planInfoInitial.headcountResident || planInfoInitial.headcountMax),
    brigade: planInfoInitial.brigade.length > 0,
    emailConsent: (cRec.email_delivery_consent as boolean | null) != null,
  })
  const docChips = requiredDocs(docProfile).map(d => ({
    ...d,
    have: d.doc === 'fire_plan' ? firePlans.length > 0 : undefined,
  }))

  // ── 탭 상태 뱃지 (설계 §4) — 추가 쿼리 없이 이미 조회한 데이터로 계산 ──
  const activeBlds = buildings.filter(b => b.is_active)
  const hasRep = contacts.some(ct => ct.role === '대표')
  const inspDates = inspections.map(i => i.inspection_start_date).filter(Boolean).sort()
  const lastInspectionDate = inspDates.length > 0 ? inspDates[inspDates.length - 1] : null
  const repContact = contacts.find(ct => ct.role === '대표') ?? null
  const tabDefs: CustomerTabDef[] = [
    { key: 'info', label: '기본정보', warn: !customer.plan_anchor_date || !customer.assigned_employee_id },
    { key: 'buildings', label: '건물·시설', warn: !(activeBlds.length > 0 && activeBlds.some(b => b.purpose && b.total_area != null)) },
    { key: 'contacts', label: '관계인', badge: `(${contacts.length})`, warn: !hasRep },
    // 일반관리 = 소방계획서 작성 대상 아님 → 뱃지·⚠ 억제 (§9-8)
    { key: 'plan', label: '소방계획서', badge: isGeneral ? undefined : `${readiness.done}/${readiness.total}`, warn: isGeneral ? false : readiness.done < readiness.total },
    { key: 'billing', label: '청구·수금', warn: !billingProfileRes.data },
    { key: 'history', label: '이력', badge: lastInspectionDate ? lastInspectionDate.slice(5) : undefined },
  ]

  // ── §6-E: 지역 기반 담당 추천 — 같은 시군구+읍면 고객들의 최빈 담당 (미배정일 때만) ──
  let regionRecommend: { employeeId: string; name: string; regionLabel: string } | null = null
  const regionSi = (customer as unknown as Record<string, unknown>).region_si as string | null
  const regionMyeon = (customer as unknown as Record<string, unknown>).region_myeon as string | null
  if (!customer.assigned_employee_id && regionSi) {
    let rq = admin.from('customers').select('assigned_employee_id')
      .eq('is_active', true).eq('region_si', regionSi).not('assigned_employee_id', 'is', null).neq('id', id)
    if (regionMyeon) rq = rq.eq('region_myeon', regionMyeon)
    const { data: regionRows } = await rq
    const counts = new Map<string, number>()
    for (const r of (regionRows ?? []) as Array<{ assigned_employee_id: string }>) {
      counts.set(r.assigned_employee_id, (counts.get(r.assigned_employee_id) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top) {
      const emp = employees.find(e => e.id === top[0])
      if (emp) regionRecommend = { employeeId: emp.id, name: emp.name, regionLabel: [regionSi, regionMyeon].filter(Boolean).join(' ') }
    }
  }

  // ── §6-E: 이력 탭 필터 (URL hy=올해/작년, hk=점검/변경) + 다음 점검 예정 ──
  const nowYear = new Date().getFullYear()
  const histYear = hy === 'this' ? nowYear : hy === 'last' ? nowYear - 1 : null
  const inspFiltered = inspections.filter(i => (histYear === null || i.year === histYear) && hk !== 'log')
  const logsFiltered = essentialLogs.filter(x =>
    (histYear === null || new Date(x.log.created_at).getFullYear() === histYear) && hk !== 'insp')
  const todayStr = new Date().toISOString().slice(0, 10)
  const nextInspection = inspections
    .filter(i => i.status === 'scheduled' && i.inspection_start_date && i.inspection_start_date >= todayStr)
    .sort((a, b) => (a.inspection_start_date ?? '').localeCompare(b.inspection_start_date ?? ''))[0] ?? null
  const histChip = (label: string, key: 'hy' | 'hk', value: string, current: string | undefined) => {
    const sp = new URLSearchParams()
    sp.set('tab', 'history')
    if (lq) sp.set('lq', lq)
    const hyv = key === 'hy' ? value : (hy ?? '')
    const hkv = key === 'hk' ? value : (hk ?? '')
    if (hyv) sp.set('hy', hyv)
    if (hkv) sp.set('hk', hkv)
    const active = (current ?? '') === value
    return (
      <Link key={`${key}-${value || 'all'}`} href={`/customers/${id}?${sp.toString()}`} scroll={false}
        className={`h-6 px-2.5 rounded-full text-[11px] inline-flex items-center border transition-colors ${
          active ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`}>
        {label}
      </Link>
    )
  }

  // ── [◀ 이전|다음 ▶] 네비 (§6-C-3) — 목록 필터 컨텍스트(lq) 그대로 같은 순서로 이동 ──
  const navFilter = parseListFilter(Object.fromEntries(new URLSearchParams(lq ?? '')) as Record<string, string | undefined>)
  const navList = await fetchCustomerList(admin, navFilter)
  const navIdx = navList.findIndex(c => c.id === id)
  const prevId = navIdx > 0 ? navList[navIdx - 1].id : null
  const nextId = navIdx >= 0 && navIdx < navList.length - 1 ? navList[navIdx + 1].id : null
  const navPosition = navIdx >= 0 ? `${navIdx + 1} / ${navList.length}` : `– / ${navList.length}`

  // ── T1 탭 패널 — 기존 카드 로직 무변경, 배치만 이동 (설계 §2) ──
  // §11-2: 최근 변경 1줄 텍스트 (요약 모드에 전달)
  const lastChangeText = essentialLogs[0]
    ? `${essentialLogs[0].changes[0]
      ? `${essentialLogs[0].changes[0].field_label} ${displayChangeValue(essentialLogs[0].changes[0].field, essentialLogs[0].changes[0].old_value) ?? '없음'} → ${displayChangeValue(essentialLogs[0].changes[0].field, essentialLogs[0].changes[0].new_value) ?? '없음'}`
      : essentialLogs[0].actionLabel} · ${essentialLogs[0].log.created_at.slice(0, 10)} ${employees.find(e => e.id === essentialLogs[0].log.actor_id)?.name ?? '시스템'}`
    : null

  // §11: 기본정보 탭 = 단일 카드 (담당 인라인 배정 + 요약 모드 기본정보 — 스크롤 없이 한눈 조회)
  const infoTab = (
    <div className={`bg-white rounded-xl border shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5 space-y-4 ${!customer.assigned_employee_id ? 'border-red-200' : 'border-[#c8c4d0]'}`}>
      {/* §11-3: 담당 — 인라인 배정 (모달 폐지) + 지역 추천 병행 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${customer.assigned_employee_id ? 'bg-[#f5f4ff]' : 'bg-red-50'}`}>
          <UserCheck className={`size-4 ${customer.assigned_employee_id ? 'text-[#7b68ee]' : 'text-red-400'}`} />
        </div>
        <div>
          <p className="text-xs text-[#514b81] font-medium mb-0.5">담당직원</p>
          <AssignEmployeeInline
            customerId={customer.id}
            currentEmployeeId={customer.assigned_employee_id}
            employees={employees}
            canAssign={canAssign}
          />
        </div>
        {canAssign && regionRecommend && (
          <RecommendAssignClient customerId={customer.id}
            employeeId={regionRecommend.employeeId}
            employeeName={regionRecommend.name}
            regionLabel={regionRecommend.regionLabel} />
        )}
      </div>

      <div className="border-t border-[#e0ddf5]" />

      {/* §11-1·2·4: 기본정보 요약 모드 (연간 횟수는 유형 옆 병기, 값 클릭 = 편집+포커스) */}
      <EditCustomerInfoClient
        customer={customer}
        canManage={canManage}
        annualLabel={customer.inspection_type === '종합' ? '연 2회 (1차·2차)' : customer.inspection_type === '작동' ? '연 1회' : '1회 (점검계획일)'}
        typeSlot={
          <span className="flex items-center">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[customer.inspection_type]}`}>
              {inspectionTypeLabel(customer.inspection_type)}
            </span>
            {canManage && (
              <EditInspectionTypeClient
                customerId={customer.id}
                currentType={customer.inspection_type}
              />
            )}
          </span>
        }
        lastChangeText={lastChangeText}
      />
    </div>
  )

  // 관계인 정보 (수정 가능)
  const contactsTab = (
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <h2 className="text-sm font-semibold text-[#090c1d] mb-4">관계인 정보</h2>
        <EditContactsClient
          customerId={customer.id}
          contacts={contacts}
          canManage={canManage}
          brigadeByName={Object.fromEntries(planInfoInitial.brigade.map(m => [m.name, m.team]))}
        />
      </div>
  )

  const panelBuildings: BuildingPanelRow[] = buildings.map(b => {
    const r = b as unknown as Record<string, unknown>
    return {
      id: b.id, building_name: b.building_name, address: b.address,
      zipcode: (r.zipcode as string | null) ?? null,
      address_jibun: (r.address_jibun as string | null) ?? null,
      bcode: (r.bcode as string | null) ?? null,
      total_area: b.total_area, floors_above: b.floors_above, floors_below: b.floors_below,
      purpose: b.purpose, year_built: b.year_built,
      notes: (r.notes as string | null) ?? null, is_active: b.is_active,
    }
  })

  const buildingsTab = (
    <>
      {/* 건물 목록 + 인라인 등록·수정 패널 (설계 §5·§5-A — /buildings 페이지 이동 대체) */}
      <BuildingListPanel
        customerId={customer.id}
        customerName={customer.customer_name}
        customerAddress={customer.address}
        buildings={panelBuildings}
        canManage={canManage}
        initialOpenId={initialBuildingId}
        initialNew={initialNewBuilding === '1'}
      />

      {/* 소방시설 현황 패널은 소방계획서 탭 > 1장 > 1.4로 이동 (소방계획서_4.md §4 — 건물목록은 잔류) */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] px-4 py-3 text-xs text-[#514b81]">
        소방시설 현황 입력은 <Link href={`/customers/${customer.id}?tab=plan&sub=ch1`} className="text-[#7b68ee] hover:underline">소방계획서 탭 &gt; 1.4 소방시설</Link>로 이동했습니다.
      </div>
    </>
  )

  // 사업자정보 + 자동이체 — 세금계산서·수금 (doc02 §4-7, §1-5, P4-1/P4-2)
  const billingTab = (
      <BillingClient
        customerId={customer.id}
        profile={(billingProfileRes.data ?? null) as BillingProfile | null}
        autopay={(autopayRes.data ?? null) as Autopay | null}
        owners={(ownersRes.data ?? []) as Array<{ id: string; name: string; contact: string | null }>}
        ownerId={(customer as { owner_id?: string | null }).owner_id ?? null}
        canManage={canManage}
        customerName={customer.customer_name}
        repName={repContact?.name ?? null}
        customerAddress={customer.address}
      />
  )

  // 소방계획서 탭 — 장(章) 서브탭 골격 (소방계획서_4.md 4-1): 생성 바 + 개정이력·보관 + 1장>1.1
  const { data: fpForm } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', id).maybeSingle()
  const fpSections = ((fpForm as { sections?: {
    revision?: { revisionDate?: string; revisionNote?: string }
    zones?: ZoneRow[]; hazards?: HazardRow[]; location?: LocationSection; fireAccess?: FireAccessSection
    evacFire?: EvacFireSection; evacMaps?: EvacMapRow[]; etcFacility?: EtcFacilitySection; managers?: ManagerRow[]
    inspection?: InspectionPlanSection; multiUse?: MultiUseSection; fireHistory?: FireHistoryRow[]
    training?: TrainingSection; brigadeGeneral?: { type?: string }; brigadeTeams?: Record<string, string>
  } } | null)?.sections) ?? {}
  // 1.10.1 자동 시기 — 점검계획일 기준 (종합 고객: 종합=기준월·작동=+6개월 / 작동 고객: 작동=기준월)
  const planYear = new Date().getFullYear()
  const anchorM = customer.plan_anchor_date ? new Date(customer.plan_anchor_date).getMonth() + 1 : null
  const isComprehensive = customer.inspection_type === '종합'
  const autoOpMonth = anchorM ? `${planYear}년 ${isComprehensive ? ((anchorM - 1 + 6) % 12) + 1 : anchorM}월` : ''
  const autoCompMonth = anchorM && isComprehensive ? `${planYear}년 ${anchorM}월` : ''
  const revSection = fpSections.revision ?? null
  const revisionRows: RevisionRow[] = [...firePlans]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(p => ({ year: p.year, revision: p.revision, date: p.created_at, note: p.note, uploader: p.uploader_name }))
  const planTab = (
    <PlanTabView
      customerId={customer.id}
      canManage={canManage}
      purpose={planInfoInitial.purpose}
      readiness={{ done: readiness.done, total: readiness.total, missing: readiness.missing }}
      revisionInitial={{
        revisionDate: revSection?.revisionDate || '',
        revisionNote: revSection?.revisionNote || '',
      }}
      revisionRows={revisionRows}
      initialSection={sub}
      archive={<FirePlansClient customerId={customer.id} plans={firePlans} canManage={canManage} />}
      form11={<FirePlanInfoPanel customerId={customer.id} initial={planInfoInitial} people={planPeople} />}
      form12={<PlanForm12 customerId={customer.id} canManage={canManage}
        initialZones={fpSections.zones ?? []} initialHazards={fpSections.hazards ?? []}
        floorsAbove={planInfoInitial.floorsAbove} floorsBelow={planInfoInitial.floorsBelow} />}
      form13={<PlanForm13 customerId={customer.id} canManage={canManage}
        initialLocation={fpSections.location ?? { mapImage: null, surroundings: '', fireStation: s(cRec.fire_station), distance: '', eta: '', operation: '' }}
        initialFireAccess={fpSections.fireAccess ?? { routeDesc: '', routeImage: null, entryPoint: '', nearbyFacilities: '' }} />}
      form14={<PlanForm14 customerId={customer.id} buildings={facilityBuildings} canManage={canManage} />}
      form15={<PlanForm15 customerId={customer.id} canManage={canManage}
        initialEvacFire={fpSections.evacFire ?? EMPTY_EVAC_FIRE} initialMaps={fpSections.evacMaps ?? []} />}
      form16={<PlanForm16 customerId={customer.id} canManage={canManage}
        initial={fpSections.etcFacility ?? EMPTY_ETC_FACILITY} />}
      form17={<PlanForm17 customerId={customer.id} canManage={canManage}
        initialRows={fpSections.managers ?? []}
        autoRow={{ name: repContact?.name ?? '', selectedAt: planInfoInitial.managerSelectedAt }} />}
      form110={<PlanForm110 customerId={customer.id} canManage={canManage}
        isComprehensive={isComprehensive} autoOpMonth={autoOpMonth} autoCompMonth={autoCompMonth}
        useApprovalDate={s(cRec.use_approval_date)} fireStation={s(cRec.fire_station)}
        initialInspection={fpSections.inspection ?? null} initialMultiUse={fpSections.multiUse ?? null}
        initialHistory={fpSections.fireHistory ?? []} />}
      form111={<PlanForm111 customerId={customer.id} canManage={canManage}
        initial={fpSections.training ?? null} presetType={recommendPresetType(planInfoInitial.purpose) ?? ''} />}
      ch2={<PlanCh2 customerId={customer.id} canManage={canManage}
        initialType={fpSections.brigadeGeneral?.type ?? ''} initialTeams={fpSections.brigadeTeams ?? {}}
        initialBrigade={planInfoInitial.brigade} people={planPeople} />}
      isGeneral={isGeneral}
      docs={docChips}
      quick={quickReadiness}
      consentInitial={{
        consent: (cRec.email_delivery_consent as boolean | null) ?? null,
        email: s(cRec.report_email),
      }}
      latestPlan={firePlans[0] ? {
        year: firePlans[0].year, title: firePlans[0].title ?? '소방계획서',
        pdfStatus: firePlans[0].pdf_status ?? 'ready', revision: firePlans[0].revision,
      } : null}
    />
  )

  // 점검 이력 + 변경 이력 통합 타임라인
  const historyTab = (
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">점검 이력</h2>
          <span className="text-xs text-[#b0acd6] ml-auto">{inspections.length}건 점검 · {essentialLogs.length}건 변경</span>
        </div>

        {/* §6-E: 다음 점검 예정 + 기간·종류 필터 칩 + 딥링크 */}
        <div className="mb-3 space-y-2">
          <p className="text-xs">
            <span className="text-[#514b81]">다음 점검: </span>
            {nextInspection ? (
              <Link href={`/inspections/${nextInspection.id}`} className="font-medium text-[#7b68ee] hover:underline">
                {nextInspection.inspection_start_date} {inspectionTypeLabel(nextInspection.inspection_type)} ({nextInspection.year}년 {nextInspection.sequence_num}차)
              </Link>
            ) : (
              <span className="text-[#b0acd6]">예정 없음</span>
            )}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {histChip('전체', 'hy', '', hy)}
            {histChip('올해', 'hy', 'this', hy)}
            {histChip('작년', 'hy', 'last', hy)}
            <span className="text-[#e0ddf5]">|</span>
            {histChip('점검+변경', 'hk', '', hk)}
            {histChip('점검만', 'hk', 'insp', hk)}
            {histChip('변경만', 'hk', 'log', hk)}
            <span className="ml-auto flex items-center gap-3">
              <Link href="/inspection-reports/status" className="text-[11px] text-[#7b68ee] hover:underline">보고서 제출현황 →</Link>
              <Link href="/action-plans/status" className="text-[11px] text-[#7b68ee] hover:underline">이행계획 제출현황 →</Link>
            </span>
          </div>
        </div>

        {inspFiltered.length === 0 && logsFiltered.length === 0 ? (
          <p className="text-sm text-[#514b81] py-6 text-center">조건에 맞는 이력이 없습니다</p>
        ) : (
          <div className="space-y-1">
            {/* 점검 이력 테이블 */}
            {inspFiltered.length > 0 && (
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e0ddf5]">
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">연도/차수</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">유형</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">시작일</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">담당자</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">진행</th>
                      <th className="text-left text-xs font-medium text-[#514b81] pb-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspFiltered.map(insp => {
                      const emp = employees.find(e => e.id === insp.assigned_employee_id)
                      const steps = stepCounts[insp.id] ?? { total: 0, completed: 0 }
                      return (
                        <tr key={insp.id} className="border-b border-[#f8f9fa] last:border-0 hover:bg-[#fafafa] transition-colors">
                          <td className="py-3 pr-4">
                            <Link href={`/inspections/${insp.id}`} className="font-medium text-[#090c1d] hover:text-[#7b68ee]">
                              {insp.year}년 {insp.sequence_num}차
                            </Link>
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[insp.inspection_type]}`}>
                              {inspectionTypeLabel(insp.inspection_type)}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-[#514b81]">{insp.inspection_start_date}</td>
                          <td className="py-3 pr-4 text-[#514b81]">
                            {emp?.name ?? <span className="text-[#b0acd6]">미배정</span>}
                          </td>
                          <td className="py-3 pr-4">
                            {steps.total > 0 ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-[#e0ddf5] rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-[#7b68ee] rounded-full"
                                    style={{ width: `${(steps.completed / steps.total) * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs text-[#514b81]">{steps.completed}/{steps.total}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-[#b0acd6]">—</span>
                            )}
                          </td>
                          <td className="py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[insp.status as InspectionStatus]}`}>
                              {STATUS_LABELS[insp.status as InspectionStatus]}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 변경 이력 — 필수 고객관리 사항만 (담당직원·점검유형·사용승인일·계약일·활성상태·등록) */}
            {logsFiltered.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3 pt-2 border-t border-[#e0ddf5]">
                  <History className="size-3.5 text-[#b0acd6]" />
                  <span className="text-xs font-medium text-[#514b81]">변경 이력</span>
                </div>
                <div className="space-y-2">
                  {logsFiltered.map(({ log, actionLabel, changes }) => {
                    const actor = employees.find(e => e.id === log.actor_id)
                    const dateStr = new Date(log.created_at).toLocaleString('ko-KR', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit', second: '2-digit',
                    })
                    return (
                      <div key={log.id} className="flex gap-3 py-2 border-b border-[#f8f9fa] last:border-0">
                        <div className="size-6 rounded-full bg-[#f5f4ff] flex items-center justify-center shrink-0 mt-0.5">
                          <History className="size-3 text-[#7b68ee]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-[#090c1d]">
                              {actor?.name ?? '시스템'}
                            </span>
                            <span className="text-xs text-[#b0acd6]">{dateStr}</span>
                          </div>
                          <div className="space-y-0.5">
                            {changes.map((c, i) => (
                              <div key={i} className="text-xs text-[#514b81]">
                                <span className="font-medium text-[#090c1d]">{c.field_label}</span>
                                {' '}
                                <span className="text-[#b0acd6] line-through">{displayChangeValue(c.field, c.old_value) ?? '없음'}</span>
                                {' → '}
                                <span className="text-[#7b68ee]">{displayChangeValue(c.field, c.new_value) ?? '없음'}</span>
                              </div>
                            ))}
                            {changes.length === 0 && actionLabel && (
                              <span className="text-xs text-[#7b68ee] font-medium">{actionLabel}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
  )

  return (
    <div className="space-y-6">
      {/* 뒤로가기 + 헤더 */}
      <div className="flex items-center gap-3 max-w-3xl xl:max-w-none">
        <Link href="/customers" className="text-[#514b81] hover:text-[#7b68ee] transition-colors">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex-1 flex items-center gap-3">
          <h1 className="text-xl font-bold text-[#090c1d]">{customer.customer_name}</h1>
          <CustomerPrevNext prevId={prevId} nextId={nextId} position={navPosition} />
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${TYPE_COLORS[customer.inspection_type]}`}>
          {inspectionTypeLabel(customer.inspection_type)}
        </span>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${customer.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {customer.is_active ? '활성' : '비활성'}
        </span>
      </div>

      {/* §10-3: 등록 직후 보완 안내 1줄 */}
      {created === '1' && (
        <div className="max-w-3xl rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-xs text-green-800">
          고객 등록 완료 — {tabDefs.some(t => t.warn)
            ? `보완할 항목: ${tabDefs.filter(t => t.warn).map(t => t.label).join(' · ')} (탭의 ⚠를 따라 입력하세요)`
            : '필수 정보가 모두 입력됐습니다.'}
        </div>
      )}

      {/* 탭 셸 + 우측 요약 패널 (설계 §2·§6-C-2) */}
      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-3xl">
          <CustomerTabs
            initialTab={initialTab ?? 'info'}
            tabs={tabDefs}
            panels={{ info: infoTab, buildings: buildingsTab, contacts: contactsTab, plan: planTab, billing: billingTab, history: historyTab }}
          />
        </div>
        <CustomerSummaryPanel
          address={customer.address}
          repName={repContact?.name ?? null}
          repPhone={repContact?.phone ?? null}
          employeeName={assignedEmployee?.name ?? null}
          planDate={customer.plan_anchor_date}
          lastInspectionDate={lastInspectionDate}
        />
      </div>
    </div>
  )
}
