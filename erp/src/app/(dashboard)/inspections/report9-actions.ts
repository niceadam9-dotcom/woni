'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { convertHtmlToPdf } from '@/lib/pdf'
import { renderReport10, renderReport11, type Annex1011Data } from '@/lib/doc-templates/report1011'
import {
  renderReport9, FORM3_ITEMS, form3Group, parseParkingSummary,
  type Report9Data, type Report9DefectRow, type Report9Person,
} from '@/lib/doc-templates/report9'
import { form3ItemsForSheet, rollUpForm3Results } from '@/lib/sheet-facility-map'
import { renderReport4, type Report4Data, type Report4SheetSection } from '@/lib/doc-templates/report4'
import type { SpecMap } from '@/lib/doc-templates/spec-sections'
import { renderExterior, type ExteriorData, type ExteriorMonthEntry } from '@/lib/doc-templates/exterior'
import { pickFirePlanManager } from '@/lib/fire-plan-template'
import { formatBizNo, formatTel } from '@/lib/format-contact'
import type { ManagerRow } from '@/components/customers/plan-form17'

/** 별지 9호(자체점검 실시결과 보고서) 생성 — P3 MVP (소방계획서_4.md §9-3·§9-6⑦)
 *  입력은 소유하지 않는 준비 화면 원칙: 공통값=고객 탭, 점검값=점검 상세, 여기는 생성·조회만.
 *  별지 9·10·11호·외관점검표(별지 6호)는 서버 동기 생성(HTML→Gotenberg PDF —
 *  소방계획서_7 H-5·H-6·H-7·H-8, SDK·워커 미경유). 워커에는 소방계획서(기본 유형)만 남는다. */

const BUCKET = 'fire-plans'

type Admin = ReturnType<typeof createAdminClient>

function kdate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

/** (제거) 설비명 퍼지 매칭 nameMatch — T-3(소방계획서_14_점검업무)에서 명시 매핑으로 교체.
 *  sheet-facility-map.ts의 form3ItemsForSheet·form3ItemMatchesFacility가 대체한다. */

/** PostgREST 1,000행 한도 대비 offset 페이지 순회 — 워커 db_get_all과 동일 계열 */
async function pageAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  page = 1000,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += page) {
    const { data, error } = await query(offset, offset + page - 1)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < page) return rows
  }
}

/** ③ 서식 고유 값(annex_inputs) 조회 — H-23 작성 화면(annex-compose-panel) 저장분. 없으면 빈 객체(fail-soft) */
async function loadAnnexInputs(
  admin: Admin,
  inspectionId: string,
  annexNo: 'report9' | 'report10' | 'report11' | 'exterior',
): Promise<Record<string, unknown>> {
  const { data } = await admin.from('annex_inputs').select('fields')
    .eq('inspection_id', inspectionId).eq('annex_no', annexNo).maybeSingle()
  return (data?.fields ?? {}) as Record<string, unknown>
}

/** annex_inputs 문자열 필드 안전 추출 (trim, 비문자열은 공백) */
function fstr(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** 별지 10·11호 데이터 조립 — 워커 process_report1011과 동일 원본 (fireplan-worker.py 이식).
 *  ③ 서식 고유 값(annex_inputs — 제출일·총 이행기간 보정·계획 요약·완료 보고 문구)은 말미에 오버레이(H-23) */
async function assembleAnnex1011(
  admin: Admin,
  customerId: string,
  inspectionId: string,
  kind: 'report10' | 'report11',
): Promise<{ data: Annex1011Data; missing: string[] }> {
  const [custRes, bldRes, contactsRes, defectsRes, formRes] = await Promise.all([
    admin.from('customers').select('customer_name, address, fire_station').eq('id', customerId).single(),
    admin.from('buildings').select('purpose').eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1),
    admin.from('customer_contacts').select('role, name, phone').eq('customer_id', customerId),
    admin.from('inspection_defects')
      .select('defect_name, action_plan, action_start, action_end, action_taken, action_completed_at')
      .eq('inspection_id', inspectionId).order('created_at'),
    // B-1(소방계획서_19 K-1): 서식 1.7 선임현황 — 소방안전관리자 결정 원천
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).limit(1),
  ])
  const cust = custRes.data as { customer_name: string; address: string | null; fire_station: string | null } | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')
  const purpose = ((bldRes.data?.[0] as { purpose: string | null } | undefined)?.purpose) ?? ''
  const contacts = (contactsRes.data ?? []) as Array<{ role: string; name: string; phone: string | null }>
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0] ?? null
  // B-1(소방계획서_19 K-1): 소방안전관리자 = 1.7 선임현황 1순위 → 관계인 대표 폴백 — 별지9호(A9-1)와 동일 규칙.
  // 종전에는 대표 고정이라, 선임자≠대표인 고객은 별지9호와 10·11호의 관리자 이름이 서로 다르게 인쇄됐다.
  const a1011Sections = ((formRes.data?.[0] as { sections?: Record<string, unknown> } | undefined)?.sections) ?? {}
  const a1011Mgr = pickFirePlanManager((a1011Sections['managers'] ?? null) as ManagerRow[] | null)
  type DefectRow = {
    defect_name: string | null; action_plan: string | null; action_start: string | null
    action_end: string | null; action_taken: string | null; action_completed_at: string | null
  }
  const defects = (defectsRes.data ?? []) as DefectRow[]

  const missing: string[] = []
  const data: Annex1011Data = {
    customerName: cust.customer_name,
    purpose,
    address: cust.address ?? '',
    ownerName: owner?.name ?? '',
    // E10-2·E11-2(B-8 감사): 관계인·관리자 전화도 회사 전화와 같은 정규화 — 무하이픈 실데이터가 그대로 인쇄되던 건
    ownerPhone: formatTel(owner?.phone),
    // B-1: 1.7 선임자 우선 — 전화는 선임자=대표 동일인일 때만(1.7에 전화 열 없음, 타인 전화 오기재 방지)
    mgrName: a1011Mgr?.name ?? owner?.name ?? '',
    mgrPhone: (a1011Mgr?.name ?? owner?.name ?? '') === (owner?.name ?? '') ? formatTel(owner?.phone) : '',
    rows: [],
    reportDate: kdate(new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]),
    submitTo: cust.fire_station ? `${cust.fire_station}장` : '관할 소방서장',
  }

  if (kind === 'report10') {
    // E10-4(B-8 감사): 종료일만 입력된 불량도 계획 건으로 편입 — 종전 필터는 표·총기간에서 통째 탈락시켰다
    const planned = defects.filter(d => d.action_plan || d.action_start || d.action_end)
    // E10-1(소방계획서_19 B-8 감사): 표 행 기간도 총 이행기간·보고일과 같은 한국어 날짜로 통일
    data.rows = planned.map(d => ({
      content: d.action_plan || d.defect_name || '',
      period: `${d.action_start ? kdate(d.action_start) : ''} ~ ${d.action_end ? kdate(d.action_end) : ''}`.replace(/^ ~ $/, ''),
    }))
    const starts = planned.map(d => d.action_start).filter(Boolean).sort() as string[]
    const ends = planned.map(d => d.action_end).filter(Boolean).sort() as string[]
    if (starts.length && ends.length) {
      const days = Math.round((new Date(ends[ends.length - 1]).getTime() - new Date(starts[0]).getTime()) / 86400000) + 1
      data.totalPeriod = `${kdate(starts[0])} ~ ${kdate(ends[ends.length - 1])}`
      data.totalDays = String(days)
    }
    if (planned.length === 0) missing.push('이행조치 계획 미입력')
    // E10-3(B-8 감사): 총 이행기간은 시작·종료가 둘 다 있어야 산출된다 — 공란으로 나가는 걸 표면화
    else if (!data.totalPeriod) missing.push('총 이행기간 — 계획 시작일·종료일이 모두 있는 건이 없어 산출 불가')
  } else {
    const done = defects.filter(d => d.action_completed_at)
    // E11-1(소방계획서_19 B-8 감사): 완료일도 보고일과 같은 한국어 날짜로 통일
    data.rows = done.map(d => ({
      content: d.action_taken || d.defect_name || '',
      period: d.action_completed_at ? kdate(d.action_completed_at.slice(0, 10)) : '',
    }))
    const { data: companyRows } = await admin.from('company_profile')
      .select('company_name, business_number, representative, phone, address').limit(1)
    const company = (companyRows?.[0] ?? {}) as {
      company_name?: string; business_number?: string; representative?: string; phone?: string; address?: string
    }
    data.companyName = company.company_name ?? ''
    data.companyBizno = formatBizNo(company.business_number)
    data.companyRep = company.representative ?? ''
    data.companyPhone = formatTel(company.phone)
    data.companyAddress = company.address ?? ''
    if (done.length === 0) missing.push('이행완료 항목 없음')
    // E11-3(B-8 감사): 조치 내용 없이 완료일만 저장하면 불량명이 '이행조치 내용' 칸에 폴백 인쇄된다(오독 소지)
    const takenMissing = done.filter(d => !d.action_taken?.trim()).length
    if (takenMissing > 0) missing.push(`이행조치 내용 미입력 ${takenMissing}건 — 불량명이 대신 인쇄됨`)
  }
  // E10-6(B-8 감사): 10·11호 공통 — 제출처·관계인 부재는 종전 무경고였다
  if (!cust.fire_station) missing.push('관할 소방서 — 제출처가 일반 문구로 인쇄됨')
  if (!owner?.name) missing.push('관계인(대표) 미등록')

  // ③ 서식 고유 값 오버레이 (H-23, §4-A-0) — 작성 패널 저장분이 자동 계산값보다 우선
  const fields = await loadAnnexInputs(admin, inspectionId, kind)
  const fDate = fstr(fields, 'reportDate')
  if (/^\d{4}-\d{2}-\d{2}$/.test(fDate)) data.reportDate = kdate(fDate)
  if (kind === 'report10') {
    // 작성 패널 daterange는 "YYYY-MM-DD ~ YYYY-MM-DD"로 저장 — 자동 산출과 같은 한국어 날짜로 변환 (과거 자유 텍스트는 그대로 통과)
    if (fstr(fields, 'totalPeriod')) data.totalPeriod = fstr(fields, 'totalPeriod').replace(/\d{4}-\d{2}-\d{2}/g, m => kdate(m))
    if (fstr(fields, 'totalDays')) data.totalDays = fstr(fields, 'totalDays')
    // 계획 내용 요약 — 이행조치 사항 표의 첫 행으로 출력하되 개별 계획 항목과 구분한다(E10-5).
    // 종전엔 구분 없이 얹혀 있어 기간이 빈 요약 줄이 '기간 미정인 이행조치 1건'처럼 읽혔다.
    const summary = fstr(fields, 'summary')
    if (summary) data.rows = [{ content: summary, period: '', isSummary: true }, ...data.rows]
  } else {
    // 완료 보고 문구 — 있을 때만 서명 블록 위 1줄 (report1011.ts note)
    const note = fstr(fields, 'note')
    if (note) data.note = note
  }
  return { data, missing }
}

/** 별지 9호 데이터 조립 — 워커 process_report9(fireplan-worker.py)와 동일 원본·규칙의 TS 이식 (H-5, 파리티 우선).
 *  개선분(별지9호.MD §4 기승인)만 추가: 8쪽 불량 세부 자동, 다중이용업 업종 체크(fire_plan_forms sections.multiUse),
 *  보조 점검인력 5명 초과 허용. ③ 서식 고유 값(annex_inputs — 보고일 수기·비고)은 말미에 오버레이(H-23) */
async function assembleReport9(
  admin: Admin,
  customerId: string,
  inspectionId: string,
): Promise<{
  data: Report9Data
  missing: string[]
  /** 별지 4호 전용 부가 조립분 — 별지 9호 렌더에는 쓰이지 않는다 (A4-2·A4-1 Q-2) */
  annex4: { companyRegNo: string; sheetSections: Report4SheetSection[] }
}> {
  const [inspRes, custRes, bldRes, contactsRes, companyRes, partsRes, plansRes, formsRes, defectsRes] = await Promise.all([
    admin.from('inspections')
      .select('inspection_type, is_initial, inspection_start_date, inspection_end_date, inspection_days, year, assigned_employee_id')
      .eq('id', inspectionId).single(),
    admin.from('customers')
      .select('customer_name, address, use_approval_date, fire_station, building_grade,'
        + 'insurance_joined, insurance_company, insurance_period, insurance_amount_person, insurance_amount_property,'
        // B-4d(소방계획서_19 A9-4, Q-2 확정): 선임 형태(manager_appointment_type, 마이그레이션 124)
        + 'email_delivery_consent, report_email, rep_role, manager_license_grade, manager_edu_date, manager_appointment_type')
      .eq('id', customerId).single(),
    admin.from('buildings')
      .select('id, purpose, total_area, building_area, floors_above, floors_below, height, main_structure, roof_structure,'
        + 'households, building_count, permit_date, parking_summary, elevator_count, emergency_elevator_count, evac_elevator_count,'
        + 'stairs_count, ramp_count')
      .eq('customer_id', customerId).eq('is_active', true).order('created_at', { ascending: true }).limit(1),
    admin.from('customer_contacts').select('role, name, phone').eq('customer_id', customerId),
    // A4-2(소방계획서_15): 관리업 등록번호(management_reg_no, 마이그레이션 123) — 별지4호 2쪽 주입용
    admin.from('company_profile').select('company_name, phone, management_reg_no').limit(1),
    admin.from('inspection_participants').select('employee_id, role, sort_order')
      .eq('inspection_id', inspectionId).order('sort_order'),
    admin.from('fire_plans').select('id').eq('customer_id', customerId).limit(1),
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).limit(1),
    admin.from('inspection_defects').select('defect_code, defect_name').eq('inspection_id', inspectionId).order('created_at'),
  ])
  type InspRow = {
    inspection_type: string | null; is_initial: boolean | null
    inspection_start_date: string | null; inspection_end_date: string | null
    inspection_days: number | null; year: number; assigned_employee_id: string | null
  }
  const insp = inspRes.data as InspRow | null
  if (!insp) throw new Error('점검 건을 찾을 수 없습니다')
  type CustRow = {
    customer_name: string; address: string | null; use_approval_date: string | null; fire_station: string | null
    building_grade: string | null; insurance_joined: boolean | null; insurance_company: string | null
    insurance_period: string | null; insurance_amount_person: string | null; insurance_amount_property: string | null
    email_delivery_consent: boolean | null; report_email: string | null; rep_role: string | null
    manager_license_grade: string | null; manager_edu_date: string | null
    manager_appointment_type: string | null
  }
  const cust = custRes.data as CustRow | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')
  type BldRow = {
    id: string; purpose: string | null; total_area: number | null; building_area: number | null
    floors_above: number | null; floors_below: number | null; height: number | null
    main_structure: string | null; roof_structure: string | null; households: number | null
    building_count: number | null; permit_date: string | null; parking_summary: string | null
    elevator_count: number | null; emergency_elevator_count: number | null; evac_elevator_count: number | null
    stairs_count: number | null; ramp_count: number | null
  }
  const b = (bldRes.data?.[0] as BldRow | undefined) ?? null
  const contacts = (contactsRes.data ?? []) as Array<{ role: string; name: string; phone: string | null }>
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0] ?? null
  const company = (companyRes.data?.[0] ?? {}) as {
    company_name?: string | null; phone?: string | null; management_reg_no?: string | null
  }

  // 점검인력 — 주된 = 담당 직원(참여자에 '주된' 행이 있으면 우선), 보조 = inspection_participants (워커 동일)
  let parts = (partsRes.data ?? []) as Array<{ employee_id: string; role: string; sort_order: number }>
  if (!parts.some(p => p.role === '주된') && insp.assigned_employee_id) {
    parts = [{ employee_id: insp.assigned_employee_id, role: '주된', sort_order: -1 }, ...parts]
  }
  let profMap = new Map<string, { name: string | null; license_no: string | null; license_grade: string | null }>()
  const ids = [...new Set(parts.map(p => p.employee_id).filter(Boolean))]
  if (ids.length) {
    const { data: profs } = await admin.from('profiles').select('id, name, license_no, license_grade').in('id', ids)
    profMap = new Map(((profs ?? []) as Array<{ id: string; name: string | null; license_no: string | null; license_grade: string | null }>)
      .map(p => [p.id, p]))
  }

  // 점검표 응답 롤업(§9-3) — 시트별 X 유무 → 3쪽 양호○/불량×, 미설치 설비는 해당없음 /
  const responses = await pageAll<{ item_code: string; result: 'O' | 'X' | 'N' }>((from, to) =>
    admin.from('inspection_sheet_responses').select('item_code, result').eq('inspection_id', inspectionId).range(from, to))
  const items = responses.length
    ? await pageAll<{ item_code: string; item_name: string; sheet_id: string; order_num: number | null }>((from, to) =>
      admin.from('inspection_sheet_items').select('item_code, item_name, sheet_id, order_num').range(from, to))
    : []
  const sheets = responses.length
    ? ((await admin.from('inspection_sheets').select('id, sheet_name')).data ?? []) as Array<{ id: string; sheet_name: string }>
    : []
  const sheetNameById = new Map(sheets.map(s => [s.id, s.sheet_name]))
  const sheetByItem = new Map(items.map(i => [i.item_code, sheetNameById.get(i.sheet_id) ?? '']))
  const itemNameByCode = new Map(items.map(i => [i.item_code, i.item_name]))
  const sheetStat = new Map<string, { any: boolean; x: boolean }>()
  for (const r of responses) {
    const name = sheetByItem.get(r.item_code)
    if (!name) continue
    const st = sheetStat.get(name) ?? { any: false, x: false }
    st.any = true
    st.x = st.x || r.result === 'X'
    sheetStat.set(name, st)
  }

  const codes = b
    ? (((await admin.from('fire_facilities').select('facility_code').eq('building_id', b.id).eq('installed', true))
      .data ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code)
    : []

  // 4~7쪽 세부 현황(H-21) — customer_facility_specs 병합: 대표 건물(building_id) 행 우선, 공통(null) 폴백
  type SpecRow = { section_key: string; spec: Record<string, unknown> | null; building_id: string | null }
  let specQ = admin.from('customer_facility_specs')
    .select('section_key, spec, building_id').eq('customer_id', customerId)
  specQ = b ? specQ.or(`building_id.eq.${b.id},building_id.is.null`) : specQ.is('building_id', null)
  const specRows = (((await specQ).data ?? []) as SpecRow[])
  const specs: SpecMap = {}
  for (const r of specRows.filter(r => r.building_id === null)) specs[r.section_key] = (r.spec ?? {}) as Record<string, unknown>
  for (const r of specRows.filter(r => r.building_id !== null)) specs[r.section_key] = (r.spec ?? {}) as Record<string, unknown>

  // Q-2(소방계획서_15 A4-1, 2026-08-11 사용자 확정) — 별지 4호 부속 '설비별 점검표':
  // 점검번호 체계(1-A-001…) 항목 중 결과가 ○/×인 것만 수록한다.
  // /(해당없음)·무응답 항목은 생략하고, ○/×가 하나도 없는 설비(시트)는 통째로 미생성.
  const SHEET_CODE_RE = /^\d{1,2}-[A-Z]-\d{3}$/
  const resByCode = new Map(responses.map(r => [r.item_code, r.result]))
  const seenCodes = new Set<string>()
  const bySheet = new Map<string, { name: string; rows: Array<{ code: string; name: string; order: number; mark: 'O' | 'X' }> }>()
  for (const it of items) {
    if (!SHEET_CODE_RE.test(it.item_code) || seenCodes.has(it.item_code)) continue
    const res = resByCode.get(it.item_code)
    if (res !== 'O' && res !== 'X') continue
    seenCodes.add(it.item_code)
    const g = bySheet.get(it.sheet_id) ?? { name: sheetNameById.get(it.sheet_id) ?? '', rows: [] }
    g.rows.push({ code: it.item_code, name: it.item_name, order: it.order_num ?? 0, mark: res })
    bySheet.set(it.sheet_id, g)
  }
  const sheetSections: Report4SheetSection[] = [...bySheet.values()]
    .map(g => {
      const rows = g.rows.sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code))
      return {
        no: Number(rows[0].code.split('-')[0]),
        name: g.name,
        items: rows.map(({ code, name, mark }) => ({ code, name, mark })),
      }
    })
    .sort((a, b) => (a.no - b.no) || a.name.localeCompare(b.name))

  // T-3(소방계획서_14_점검업무) — 시트·설비 ↔ FORM3 연결에서 퍼지 매칭 제거.
  // 종전 nameMatch(공백 제거 양방향 includes)는 sheet-facility-map 상단 주석의 두 결함을 문서 생성 경로에 남겨뒀다:
  //   오검 — 설치 '스프링클러설비'가 '간이·화재조기진압용' 항목까지 켬 / '비상조명등'이 '휴대용비상조명등'까지 켬
  //   누락 — 시트 '…시각경보장치' ↔ 항목 '…시각경보기', 시트 '소화용수설비' ↔ 항목 2종, '부속실 등 제연설비' 등
  // 설비→항목은 정규화 정확 매칭, 시트→항목은 명시 매핑(미등재 시트만 퍼지 폴백). _probe-form3-map.mjs가 차이를 고정.
  const { facilityChecks, resultMarks } = rollUpForm3Results(sheetStat, FORM3_ITEMS, codes)

  // B-3(소방계획서_19 K-3): '기타' 3항목(방화문·자동방화셔터 / 비상구·피난통로 / 방염) —
  // 31번 '기타사항' 점검표(STD-31) 응답을 명시 매핑으로 반영(T-3 교훈 — 퍼지 금지).
  // 롤업 규칙 = rollUpForm3Results 계열: X 있으면 ×, 아니면 O 있으면 ○, 전부 N이면 ／, 무응답이면 종전 ☐+공란.
  const ETC_ITEM_MAP: Record<string, 'door' | 'exit' | 'flame'> = {
    '31-A-001': 'door',   // 방화문 및 방화셔터의 관리 상태 …
    '31-A-002': 'exit',   // 비상구 및 피난통로 확보 적정 여부 …
    '31-B-001': 'flame',  // 선처리 방염대상물품 …
    '31-B-002': 'flame',  // 후처리 방염대상물품 …
  }
  const etcAgg: Record<'door' | 'exit' | 'flame', Array<'O' | 'X' | 'N'>> = { door: [], exit: [], flame: [] }
  for (const r of responses) {
    const g = ETC_ITEM_MAP[r.item_code]
    if (g && ['O', 'X', 'N'].includes(r.result)) etcAgg[g].push(r.result)
  }
  const etcRoll = (rs: Array<'O' | 'X' | 'N'>): 'O' | 'X' | 'N' | undefined =>
    rs.includes('X') ? 'X' : rs.includes('O') ? 'O' : rs.length ? 'N' : undefined
  const etcMarks = { door: etcRoll(etcAgg.door), exit: etcRoll(etcAgg.exit), flame: etcRoll(etcAgg.flame) }

  // 3쪽 2절 안전시설등(다중이용업소, §9-6e) — MU 시트 응답 항목 단위 반영 (다중이용업 아니면 응답 없음 → 공란)
  const muResults: Record<string, 'O' | 'X' | 'N'> = {}
  for (const r of responses) {
    if (r.item_code.startsWith('MU-') && ['O', 'X', 'N'].includes(r.result)) muResults[r.item_code] = r.result
  }

  // 2쪽 자동 판정(§9-6③) — 데이터가 있을 때만 체크 (없으면 공란 유지, 단정 금지 — 워커 동일)
  const hasPlan = (plansRes.data ?? []).length > 0
  const { data: prevRows } = await admin.from('inspections')
    .select('inspection_type').eq('customer_id', customerId).eq('year', insp.year - 1).eq('status', 'completed')
  const prevTypes = new Set(((prevRows ?? []) as Array<{ inspection_type: string }>).map(r => r.inspection_type))
  const sections = ((formsRes.data?.[0] as { sections: Record<string, unknown> | null } | undefined)?.sections) ?? {}
  // B-2(소방계획서_19 K-2, Q-1 확정 2026-08-11): 교육훈련 = **전년도 실시** 기입(서식 9쪽 작성방법 8호
  // "교육훈련(전년도)" — 자체점검(전년도)과 동일 축). 종전 `!!sections['training']`은 1.11 '계획' 존재만으로
  // 교육·훈련을 둘 다 '실시'로 찍던 판정 비약(A9-2). 실적 원천 = 1.11.4 결과 기록부(records)의
  // 전년도(insp.year-1) 행 — 구분(교육/훈련)별로 분리 판정. 부정 단정 없음 — 실적 없으면 미체크(☐)일 뿐.
  const trainingRecords = ((sections['training'] as { records?: Array<{ at?: string; kind?: string }> } | null)?.records) ?? []
  const prevYearRecords = trainingRecords.filter(r => String(r.at ?? '').slice(0, 4) === String(insp.year - 1))
  const eduDone = prevYearRecords.some(r => String(r.kind ?? '').includes('교육'))
  const drillDone = prevYearRecords.some(r => String(r.kind ?? '').includes('훈련'))
  // A9-1(소방계획서_15): 소방안전관리자 = 서식 1.7 선임현황(sections.managers) 1순위 → 관계인 대표 폴백
  const mgrRow = pickFirePlanManager((sections['managers'] ?? null) as ManagerRow[] | null)
  // 다중이용업소현황 — 서식 1.10.3(sections.multiUse)과 공유 원본 (별지9호.MD §2 MULTI_USE_CATEGORIES)
  const muSection = (sections['multiUse'] ?? null) as { applicable?: boolean; categories?: Record<string, string> } | null
  const multiUseCounts: Record<string, string> = {}
  if (muSection?.applicable) {
    for (const [cat, cnt] of Object.entries(muSection.categories ?? {})) {
      if (String(cnt ?? '').trim()) multiUseCounts[cat] = String(cnt).trim()
    }
  }

  let period = ''
  if (insp.inspection_start_date) {
    const end = insp.inspection_end_date || insp.inspection_start_date
    period = `${kdate(insp.inspection_start_date)} ~ ${kdate(end)}`
  }

  const toPerson = (employeeId: string): Report9Person => {
    const pr = profMap.get(employeeId)
    return { name: pr?.name ?? '', grade: pr?.license_grade ?? '', licenseNo: pr?.license_no ?? '', period }
  }
  const mains = parts.filter(p => p.role === '주된')
  const assists = parts.filter(p => p.role === '보조')

  // 점검 구분 — 작동/종합(최초·그 밖의) (워커 동일)
  const itype = insp.inspection_type ?? ''
  const ckOp = itype === '작동'
  const ckInitial = itype === '최초' || (itype === '종합' && !!insp.is_initial)
  const ckCompEtc = itype === '종합' && !ckInitial

  const ms = b?.main_structure ?? ''
  const rf = b?.roof_structure ?? ''
  const pk = b?.parking_summary ?? ''
  const stCon = ms.includes('콘크리트')
  const stSteel = !stCon && ms.includes('철골')
  const stBrick = !stCon && !stSteel && ms.includes('조적')
  const stWood = !stCon && !stSteel && !stBrick && ms.includes('목')
  const stEtc = !!ms && !stCon && !stSteel && !stBrick && !stWood
  const rfSlab = rf.includes('슬래브') || rf.includes('슬라브')
  const rfTile = !rfSlab && rf.includes('기와')
  const rfSlate = !rfSlab && !rfTile && rf.includes('슬레이트')
  const rfEtc = !!rf && !rfSlab && !rfTile && !rfSlate

  // 8쪽 불량 세부 — 시트 X 응답의 점검번호 + defects 불량명 조인, 설비 구분 그룹핑 (MD §4-2)
  type DefectDbRow = { defect_code: string | null; defect_name: string }
  const defects = (defectsRes.data ?? []) as DefectDbRow[]
  const defectByCode = new Map(defects.filter(d => d.defect_code).map(d => [d.defect_code as string, d]))
  const groupOfCode = (code: string): string => {
    if (code.startsWith('MU-')) return '안전시설등'
    const sheetName = sheetByItem.get(code)
    if (sheetName) {
      // T-3 — 명시 매핑(미등재 시트는 퍼지 폴백). 한 시트가 여러 항목을 덮어도 8쪽 구분은 같으므로 첫 항목으로 판정
      const it = form3ItemsForSheet(sheetName, FORM3_ITEMS)[0]
      if (it) return form3Group(it)
    }
    return '기타'
  }
  const xCodes = responses.filter(r => r.result === 'X').map(r => r.item_code).sort()
  const defectRows: Report9DefectRow[] = xCodes.map(code => ({
    group: groupOfCode(code),
    code,
    content: defectByCode.get(code)?.defect_name ?? itemNameByCode.get(code) ?? '',
  }))
  for (const d of defects) {
    if (d.defect_code && xCodes.includes(d.defect_code)) continue // X 응답과 조인된 건은 위에서 렌더
    defectRows.push({
      group: d.defect_code ? groupOfCode(d.defect_code) : '기타',
      code: d.defect_code ?? '',
      content: d.defect_name,
    })
  }

  const data: Report9Data = {
    ckOp, ckInitial, ckCompEtc,
    customerName: cust.customer_name,
    purpose: b?.purpose ?? '',
    address: cust.address ?? '',
    inspPeriod: period,
    inspDays: String(insp.inspection_days ?? (period ? 1 : '')),
    companyName: company.company_name ?? '',
    companyPhone: formatTel(company.phone),
    consent: cust.email_delivery_consent,
    reportEmail: cust.email_delivery_consent === true ? (cust.report_email ?? '') : '',
    main: mains.length ? toPerson(mains[0].employee_id) : null,
    assistants: assists.map(a => toPerson(a.employee_id)),
    reportDate: kdate(new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]),
    submitTo: cust.fire_station ? `관계인ㆍ${cust.fire_station}장` : '관계인ㆍ소방본부장ㆍ소방서장',
    // 2쪽 — 대표자 구분(104 rep_role — 미입력 시 관계인 대표=소유자 폴백)·자격구분(manager_license_grade 우선)
    repRole: ['소유자', '관리자', '점유자'].includes(cust.rep_role ?? '') ? (cust.rep_role as string) : (owner ? '소유자' : ''),
    ownerName: owner?.name ?? '',
    ownerPhone: owner?.phone ?? '',
    managerGrade: ['특급', '1급', '2급', '3급'].includes(cust.manager_license_grade || cust.building_grade || '')
      ? (cust.manager_license_grade || cust.building_grade || '') : '',
    // A9-1(소방계획서_15): 1.7 선임현황 1순위 → 관계인 대표 폴백(종전 동작).
    // 1.7에는 전화 열이 없어, 선임자가 대표와 동일인일 때만 대표 전화를 사용한다(타인 전화 오기재 방지).
    mgrName: mgrRow?.name ?? owner?.name ?? '',
    mgrPhone: (mgrRow?.name ?? owner?.name ?? '') === (owner?.name ?? '') ? (owner?.phone ?? '') : '',
    mgrEduDate: cust.manager_edu_date ? kdate(cust.manager_edu_date) : '',
    hasFirePlan: hasPlan,
    prevOpDone: prevTypes.has('작동'),
    prevCompDone: prevTypes.has('종합') || prevTypes.has('최초'),
    eduDone,
    drillDone,
    insuranceJoined: cust.insurance_joined,
    insCompany: cust.insurance_company ?? '',
    insPeriod: cust.insurance_period ?? '',
    insPerson: cust.insurance_amount_person ?? '',
    insProperty: cust.insurance_amount_property ?? '',
    multiUseNone: muSection ? muSection.applicable === false : false,
    multiUseCounts,
    permitDate: b?.permit_date ? kdate(b.permit_date) : '',
    useApprovalDate: cust.use_approval_date ? kdate(cust.use_approval_date) : '',
    totalArea: String(b?.total_area ?? ''),
    buildingArea: String(b?.building_area ?? ''),
    households: b?.households ? `${b.households}세대` : '',
    floorsAbove: String(b?.floors_above ?? ''),
    floorsBelow: String(b?.floors_below ?? ''),
    heightM: String(b?.height ?? ''),
    buildingCount: String(b?.building_count ?? ''),
    stCon, stSteel, stBrick, stWood, stEtc,
    rfSlab, rfTile, rfSlate, rfEtc,
    elvR: b?.elevator_count ? String(b.elevator_count) : '',
    elvE: b?.emergency_elevator_count ? String(b.emergency_elevator_count) : '',
    elvV: b?.evac_elevator_count ? String(b.evac_elevator_count) : '',
    // B-4c(소방계획서_19 A9-5): 주차 체크 — 매칭 규칙은 parseParkingSummary 단일 정의(프로브 공용)
    ...parseParkingSummary(pk),
    // 계단·경사로 — 1.1 일반현황 입력분(그동안 템플릿에 빈칸 하드코딩되어 미반영, 2026-08-06 연결)
    rampCount: b?.ramp_count ? String(b.ramp_count) : '',
    stairsCount: b?.stairs_count ? String(b.stairs_count) : '',
    // A9-3(소방계획서_15): 특별피난계단 — 세부제원 3-8 전실(smoke_lobby.stair_count)이 유일 원천
    specialStairCount: (() => {
      const lobby = (specs['s38_activity']?.['smoke_lobby'] ?? null) as Record<string, unknown> | null
      const n = Number(lobby?.['stair_count'])
      return Number.isFinite(n) && n > 0 ? String(lobby!['stair_count']) : ''
    })(),
    facilityChecks,
    // B-3: '기타' 3항목 롤업 · B-4d: 선임 형태(124)
    etcMarks,
    mgrAppointType: cust.manager_appointment_type ?? '',
    // 3쪽 하위 체크칸(소화기구 5종)·세부현황 파생(가스계·유도표지·피난유도선)의 원천 — 필터 전 전체 코드
    ledgerCodes: codes,
    building: (b ?? undefined) as Record<string, number | string | null | undefined> | undefined,
    resultMarks,
    muResults,
    specs,
    defectRows,
  }

  // ③ 서식 고유 값 오버레이 (H-23, §4-A-0) — 보고일 수기 지정·비고 (작성 패널 저장분)
  const annexFields = await loadAnnexInputs(admin, inspectionId, 'report9')
  const fReportDate = fstr(annexFields, 'reportDate')
  if (/^\d{4}-\d{2}-\d{2}$/.test(fReportDate)) data.reportDate = kdate(fReportDate)
  const fNote = fstr(annexFields, 'note')
  if (fNote) data.note = fNote
  // B-2c: ③ 수동 보정 — 실적 기록부에 없지만 실제 실시한 경우만 '실시'로 강제(양성 보정만, 부정 단정 없음)
  if (fstr(annexFields, 'eduDone') === '실시') data.eduDone = true
  if (fstr(annexFields, 'drillDone') === '실시') data.drillDone = true

  // 누락 항목 — 워커 process_report9 missing과 동일 문구
  const missing: string[] = []
  if (!period) missing.push('점검기간')
  if (!mains.length) missing.push('주된 점검인력')
  if (!responses.length) missing.push('점검표 응답')
  if (cust.email_delivery_consent === null) missing.push('송달 동의')
  if (!(parts.length && parts.every(p => profMap.get(p.employee_id)?.license_no))) missing.push('자격정보')
  if (!cust.address) missing.push('주소')
  if (!cust.use_approval_date) missing.push('사용승인일')
  if (!b?.permit_date) missing.push('건축허가일')
  // B-6(소방계획서_19 A9-11, Q-5 확정): 상시 공란 칸 인지 — 결과칸은 실제 응답 ○·×만 반영(무응답 공란 유지)
  // 하므로, 공란이 남는 원인을 missing으로 표면화한다.
  const unanswered = facilityChecks.filter(item => !resultMarks[item]).length
  if (unanswered > 0) missing.push(`설치 설비 중 점검표 무응답 ${unanswered}건 — 3쪽 결과칸 공란`)
  if (!cust.manager_appointment_type) missing.push('소방안전관리자 선임 형태(계획서 정보) 미입력 — 2쪽 체크 공란')
  return { data, missing, annex4: { companyRegNo: company.management_reg_no ?? '', sheetSections } }
}

/** 별지 4호(소방시설등점검표) 데이터 조립 — H-21. 1·2쪽(대상물·점검결과·MU·인력·기간)은
 *  별지 9호 조립과 동일 원본이라 assembleReport9를 재사용하고, 3~7쪽 세부 현황은 같은 specs
 *  (customer_facility_specs 공용 원본 §4-A-1). 별지 4호 서식에 없는 누락 항목만 제외. */
async function assembleReport4(
  admin: Admin,
  customerId: string,
  inspectionId: string,
): Promise<{ data: Report4Data; missing: string[] }> {
  const { data: d9, missing: m9, annex4 } = await assembleReport9(admin, customerId, inspectionId)
  const [inspStart = '', inspEnd = ''] = d9.inspPeriod ? d9.inspPeriod.split(' ~ ') : ['', '']
  // 송달 동의·사용승인일·건축허가일은 별지 9호 전용(1~2쪽) — 별지 4호 서식에 없음
  const missing = m9.filter(m => !['송달 동의', '사용승인일', '건축허가일'].includes(m))
  if (Object.keys(d9.specs ?? {}).length === 0) missing.push('설비 세부현황(설비 대장) 미입력 — 3~7쪽 빈 서식')
  if (!annex4.companyRegNo) missing.push('관리업 등록번호(회사 정보) 미입력')
  const data: Report4Data = {
    ckOp: d9.ckOp, ckInitial: d9.ckInitial, ckCompEtc: d9.ckCompEtc,
    customerName: d9.customerName, purpose: d9.purpose, address: d9.address,
    facilityChecks: d9.facilityChecks, resultMarks: d9.resultMarks, muResults: d9.muResults,
    etcMarks: d9.etcMarks,
    ledgerCodes: d9.ledgerCodes, building: d9.building,
    main: d9.main, assistants: d9.assistants,
    inspStart, inspEnd, inspDays: d9.inspDays,
    companyName: d9.companyName,
    companyRegNo: annex4.companyRegNo,
    sheetSections: annex4.sheetSections,
    specs: d9.specs ?? {},
  }
  return { data, missing }
}

/** 외관점검표(별지 6호) 데이터 조립 — 워커 process_exterior(fireplan-worker.py)와 동일 원본·규칙의 TS 이식 (H-7, 파리티 우선).
 *  데이터 = 고객·건물·관계인·점검 건 + 외관점검 시트 응답(item_code X{섹션}-{행}, 시트 v2022) → 해당 월 결과란 ○/×// */
async function assembleExterior(
  admin: Admin,
  customerId: string,
  inspectionId: string,
): Promise<{ data: ExteriorData; missing: string[] }> {
  const [inspRes, custRes, bldRes, contactsRes, formRes] = await Promise.all([
    admin.from('inspections').select('inspection_start_date, assigned_employee_id, year')
      .eq('id', inspectionId).single(),
    admin.from('customers').select('customer_name, address, fire_station').eq('id', customerId).single(),
    admin.from('buildings').select('purpose').eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1),
    admin.from('customer_contacts').select('role, name, phone').eq('customer_id', customerId),
    // B-1(소방계획서_19 K-1): 서식 1.7 선임현황 — 소방안전관리자 결정 원천
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).limit(1),
  ])
  const insp = inspRes.data as {
    inspection_start_date: string | null; assigned_employee_id: string | null; year: number
  } | null
  if (!insp) throw new Error('점검 건을 찾을 수 없습니다')
  const cust = custRes.data as { customer_name: string; address: string | null; fire_station: string | null } | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')
  const purpose = ((bldRes.data?.[0] as { purpose: string | null } | undefined)?.purpose) ?? ''
  const contacts = (contactsRes.data ?? []) as Array<{ role: string; name: string; phone: string | null }>
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0] ?? null
  // B-1(소방계획서_19 K-1): 소방안전관리자 = 1.7 선임현황 1순위 → 관계인 대표 폴백 (별지9호 A9-1과 동일 규칙)
  const extSections = ((formRes.data?.[0] as { sections?: Record<string, unknown> } | undefined)?.sections) ?? {}
  const extMgr = pickFirePlanManager((extSections['managers'] ?? null) as ManagerRow[] | null)
  const extMgrName = extMgr?.name ?? owner?.name ?? ''
  // EX-3(B-8 감사): 직위 — 서식에 자리가 있는데 항상 공란이었다. 1.7 선임현황의 구분(관리자/보조자)이 유일 원천,
  // 선임자를 못 찾으면(대표 폴백) 직위를 단정하지 않는다.
  const extMgrTitle = extMgr?.name ? (extMgr.role ?? '') : ''

  // ── EX-4(소방계획서_19, 2026-08-12 사용자 확정): **연간 누적본** ──
  // 서식이 12개월 × 12행 연간 양식인데 종전엔 회차 단위로 생성해 해당 월 1칸만 채웠다(같은 해 이전 월은 영구 공백).
  // 이제 같은 고객·같은 연도의 **외관점검 대상 회차 전부**를 모아 월별로 채운다.
  // 대상 판정은 생성 게이트(requestReport9Action)와 동일 축 — plan_type이 있고 'special'로 시작하지 않는 건.
  const yearInsps = await pageAll<{
    id: string; inspection_start_date: string | null; assigned_employee_id: string | null; plan_type: string | null
  }>((from, to) =>
    admin.from('inspections')
      .select('id, inspection_start_date, assigned_employee_id, plan_type')
      .eq('customer_id', customerId).eq('year', insp.year)
      .not('plan_type', 'is', null).not('plan_type', 'like', 'special%')
      .order('inspection_start_date', { ascending: true }).range(from, to))
  // 생성 요청 건이 목록에 없으면(가드를 우회한 예외 상황) 그 건만이라도 포함해 빈 문서를 막는다
  const targets = yearInsps.some(x => x.id === inspectionId)
    ? yearInsps
    : [...yearInsps, { id: inspectionId, inspection_start_date: insp.inspection_start_date, assigned_employee_id: insp.assigned_employee_id, plan_type: null }]

  const empIds = [...new Set(targets.map(t => t.assigned_employee_id).filter(Boolean))] as string[]
  const nameById = new Map<string, string>()
  if (empIds.length) {
    const { data: profs } = await admin.from('profiles').select('id, name').in('id', empIds)
    for (const p of (profs ?? []) as Array<{ id: string; name: string | null }>) nameById.set(p.id, p.name ?? '')
  }

  // 외관점검 시트 응답(X{섹션}-{행}) → 월별 결과란 ○/×// (워커: item_code=like.X*)
  // EX-1(B-8 감사): memo도 조회 — X 항목 메모가 문서 어디에도 안 나가던 유실 해소(표지 비고칸 요약)
  // EX-4(125): **month가 연간 누적의 1차 축**이다(고객·연도당 점검 건이 최대 2건이라 회차로는 12달을 못 담는다).
  // month=0(백필 이전 레거시)은 그 점검 건의 시작월로 본다.
  type ExtResp = { item_code: string; result: 'O' | 'X' | 'N'; memo: string | null }
  const respByMonth = new Map<number, ExtResp[]>()
  const metaOfMonth = new Map<number, { employeeId: string | null; day: number }>()
  if (targets.length) {
    const allResp = await pageAll<{ inspection_id: string; item_code: string; result: 'O' | 'X' | 'N'; memo: string | null; month: number }>((from, to) =>
      admin.from('inspection_sheet_responses').select('inspection_id, item_code, result, memo, month')
        .in('inspection_id', targets.map(t => t.id)).like('item_code', 'X%').range(from, to))
    const inspById = new Map(targets.map(t => [t.id, t]))
    for (const r of allResp) {
      const t = inspById.get(r.inspection_id)
      const start = t?.inspection_start_date ?? null
      const m = r.month > 0 ? r.month : (start ? Number(start.slice(5, 7)) : 0)
      if (!(m >= 1 && m <= 12)) continue
      const arr = respByMonth.get(m) ?? []
      arr.push({ item_code: r.item_code, result: r.result, memo: r.memo })
      respByMonth.set(m, arr)
      // 그 달의 점검자·일자 — 응답이 붙은 점검 건 기준(같은 달에 여러 건이면 시작일이 늦은 건이 남는다)
      if (start && !metaOfMonth.has(m)) metaOfMonth.set(m, { employeeId: t?.assigned_employee_id ?? null, day: Number(start.slice(8, 10)) })
    }
  }

  const remarks: string[] = []
  const monthMap = new Map<number, ExteriorMonthEntry>()
  for (const [month, resp] of [...respByMonth.entries()].sort((a, b) => a[0] - b[0])) {
    const results: Record<string, 'O' | 'X' | 'N'> = {}
    for (const r of resp) {
      const m = /^X(\d{1,2})-(\d{1,3})$/.exec(r.item_code)
      if (m && ['O', 'X', 'N'].includes(r.result)) {
        // 워커의 정수 정규화와 동일 계열 — 카탈로그 코드(0패딩 2자리)로 통일
        results[`X${Number(m[1])}-${String(Number(m[2])).padStart(2, '0')}`] = r.result
      }
    }
    const anyX = resp.some(r => r.result === 'X')
    const anyO = resp.some(r => r.result === 'O')
    const meta = metaOfMonth.get(month)
    monthMap.set(month, {
      month,
      day: meta?.day ?? 0,
      inspectorName: meta?.employeeId ? (nameById.get(meta.employeeId) ?? '') : '',
      // EX-5(B-8 감사): 전부 N(해당없음)·무응답이면 양호 단정 대신 공란 — 종전 `!anyX`는 O가 없어도 양호로 찍었다
      good: anyX ? false : anyO ? true : null,
      results,
    })
    for (const r of resp) {
      if (r.result === 'X' && r.memo?.trim()) remarks.push(`${month}월 ${r.item_code} ${r.memo.trim()}`)
    }
  }
  const months = [...monthMap.values()].sort((a, b) => a.month - b.month)
  // 생성 요청 건의 응답 유무 — missing 판정 기준은 종전과 동일하게 '이 회차'
  const responses = [...respByMonth.values()].flat()
  const inspector = insp.assigned_employee_id ? (nameById.get(insp.assigned_employee_id) ?? '') : ''

  const data: ExteriorData = {
    customerName: cust.customer_name,
    purpose,
    address: cust.address ?? '',
    mgrTitle: extMgrTitle,  // EX-3: 1.7 선임현황 구분(선임자를 찾았을 때만)
    // B-1: 1.7 선임자 우선 — 전화는 선임자=대표 동일인일 때만(타인 전화 오기재 방지)
    mgrName: extMgrName,
    mgrPhone: extMgrName === (owner?.name ?? '') ? formatTel(owner?.phone) : '',
    year: String(insp.year),
    // EX-4: 연간 누적 — 같은 해 점검한 달이 전부 채워진다
    months,
    // EX-1(B-8 감사): X 항목 메모 요약 → 표지 비고칸 (종전 항상 공란 — 메모가 문서상 완전 사장)
    remark: remarks.join(' / '),
  }

  // ③ 서식 고유 값 오버레이 (EX-2) — 외관만 이 계층이 없어 보고일·비고를 손볼 방법이 아예 없었다.
  // 다른 별지와 같은 규약: 작성 패널 저장분이 자동 계산값보다 우선한다.
  const fields = await loadAnnexInputs(admin, inspectionId, 'exterior')
  const fNote = fstr(fields, 'note')
  if (fNote) data.remark = data.remark ? `${data.remark} / ${fNote}` : fNote
  const fDate = fstr(fields, 'reportDate')
  if (/^\d{4}-\d{2}-\d{2}$/.test(fDate)) {
    // 표는 월·일 칸이라 날짜 자체를 그 달 항목에 반영한다(연도는 생성열이라 건드리지 않는다)
    const m = Number(fDate.slice(5, 7)), d2 = Number(fDate.slice(8, 10))
    const hit = data.months.find(x => x.month === m)
    if (hit) hit.day = d2
  }

  // 누락 항목 — 워커 process_exterior missing과 동일 문구
  const missing: string[] = []
  if (!responses.length) missing.push('외관점검 시트 응답 없음 — 결과란 공란')
  if (!inspector) missing.push('점검자(담당) 미배정')
  // EX-4: 연간 누적본이므로 '이 회차만 있고 나머지 달은 비어 있음'을 알린다(연간 12칸 중 몇 칸이 찼는지)
  if (months.length > 0) {
    const filled = months.filter(m => m.good !== null).length
    if (filled < months.length || months.length < 12) {
      missing.push(`연간 누적 — ${insp.year}년 ${months.length}개월 기록(응답 있는 달 ${filled}개월), 나머지 달은 공란`)
    }
  }
  if (!extMgrName) missing.push('소방안전관리자(1.7 선임현황 또는 대표 관계인) 미등록')
  // EX-7(B-8 감사): 표지 절반을 차지하는 대상물 정보 공란이 종전 무경고였다
  if (!cust.address) missing.push('소재지 미입력 — 표지 공란')
  if (!purpose) missing.push('대상물 구분(용도) 미입력 — 표지 공란')
  // EX-6(B-8 감사)은 성립하지 않는다 — inspections.year는 inspection_start_date 기반 생성열
  // (002_fire_safety.sql:109 GENERATED ALWAYS AS ... STORED)이라 표 헤더 연도와 점검월일의 축이
  // 어긋난 행 자체를 만들 수 없다. 독립 검증(2026-08-12)이 428C9로 실증 — 경고를 두지 않는다.
  return { data, missing }
}

export type Report9Job = {
  id: string; status: string; missing: string[] | null; error: string | null; created_at: string
}
export type Report9File = { name: string; path: string; createdAt: string | null }

/** 생성 요청 — 별지 4·9·10·11호·외관점검표 전부 서버 동기 생성, fire_plan_gen_jobs는 완료 기록용 (H-8·H-7·H-21) */
const ANNEX_TYPES = ['report4', 'report9', 'report10', 'report11', 'exterior'] as const
export type AnnexType = typeof ANNEX_TYPES[number]

export async function requestReport9Action(
  inspectionId: string,
  reportType: AnnexType = 'report9',
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!ANNEX_TYPES.includes(reportType)) return { error: '지원하지 않는 서식입니다.' }
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections')
    .select('id, customer_id, year, inspection_type, plan_type, customer:customers(customer_name)')
    .eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const i = insp as unknown as { id: string; customer_id: string; year: number; inspection_type: string; plan_type: string | null; customer: { customer_name: string } | null }

  // 유형 가드(데이터 계층) — 별지 9·10·11호는 자체점검(special_*·null)만, 정기·레거시 event는 외관점검표만.
  // 관리유형 무관 — 일반관리 자체점검도 대상 (소방계획서_6 W-15, page.tsx isSpecial과 동일 기준)
  const isSpecial = !i.plan_type || i.plan_type.startsWith('special')
  if (['report4', 'report9', 'report10', 'report11'].includes(reportType) && !isSpecial) {
    return { error: '일반·정기 점검은 별지 4·9·10·11호 대상이 아닙니다 — 외관점검표만 작성합니다.' }
  }
  if (reportType === 'exterior' && isSpecial) {
    return { error: '자체점검(특별점검)은 외관점검표 대상이 아닙니다 — 별지 9호를 작성해주세요.' }
  }

  const { data: waiting } = await admin.from('fire_plan_gen_jobs')
    .select('id').eq('inspection_id', inspectionId).in('status', ['pending', 'processing']).limit(1)
  if (waiting && waiting.length > 0) return { error: '이미 생성 대기·진행 중입니다 — 잠시 후 새로고침해주세요.' }

  // 소방계획서_7 H-8·H-7: 별지 9·10·11호·외관점검표(별지 6호) 전부 서버 동기 생성 — HTML 템플릿 → Gotenberg PDF,
  // 잡은 완료 기록용(기존 폴링 UI·문서 현황·최근 문서가 잡 테이블·파일 규약을 그대로 읽음).
  // 이로써 fire_plan_gen_jobs 4개 별지 유형 전부 서버 동기 — 워커(fireplan-worker.py)에는 소방계획서(기본 유형)만 남는다.
  try {
    let html: string
    let missing: string[]
    if (reportType === 'report9') {
      const assembled = await assembleReport9(admin, i.customer_id, inspectionId)
      html = renderReport9(assembled.data)
      missing = assembled.missing
    } else if (reportType === 'report4') {
      const assembled = await assembleReport4(admin, i.customer_id, inspectionId)
      html = renderReport4(assembled.data)
      missing = assembled.missing
    } else if (reportType === 'exterior') {
      const assembled = await assembleExterior(admin, i.customer_id, inspectionId)
      html = renderExterior(assembled.data)
      missing = assembled.missing
    } else {
      const assembled = await assembleAnnex1011(admin, i.customer_id, inspectionId, reportType)
      html = reportType === 'report10' ? renderReport10(assembled.data) : renderReport11(assembled.data)
      missing = assembled.missing
    }
    const pdf = await convertHtmlToPdf(html, [], { marginMode: 'none' })
    const stamp = Date.now()
    const base = `${i.customer_id}/inspections/${inspectionId}/${reportType}_${stamp}`
    const upHtml = await admin.storage.from(BUCKET)
      .upload(`${base}.html`, new TextEncoder().encode(html), { contentType: 'text/html; charset=utf-8' })
    if (upHtml.error) return { error: `HTML 업로드 실패: ${upHtml.error.message}` }
    const upPdf = await admin.storage.from(BUCKET)
      .upload(`${base}.pdf`, pdf, { contentType: 'application/pdf' })
    if (upPdf.error) return { error: `PDF 업로드 실패: ${upPdf.error.message}` }
    await admin.from('fire_plan_gen_jobs').insert({
      report_type: reportType,
      inspection_id: inspectionId,
      customer_id: i.customer_id,
      customer_name: i.customer?.customer_name ?? '—',
      year: i.year,
      requested_by: profile.id,
      requested_by_name: profile.name,
      status: 'done',
      missing,
      finished_at: new Date().toISOString(),
    } as Record<string, unknown>)
    revalidatePath(`/inspections/${inspectionId}`)
    return {}
  } catch (e) {
    const label = reportType === 'exterior' ? '외관점검표'
      : `별지 ${reportType === 'report4' ? '4' : reportType === 'report9' ? '9' : reportType === 'report10' ? '10' : '11'}호`
    return { error: `${label} 생성 실패: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 별지 9·10·11호·외관점검표 미리보기 HTML (소방계획서_7 H-4·H-7) — 생성물과 동일 렌더 함수 단일 소스,
 *  미입력 항목은 하이라이트(§4-A-2c). 클라이언트는 iframe srcDoc으로 표시 */
export async function getAnnexPreviewHtmlAction(
  inspectionId: string,
  reportType: 'report4' | 'report9' | 'report10' | 'report11' | 'exterior',
): Promise<{ html?: string; missing?: string[]; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('id, customer_id, plan_type').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const ins = insp as { customer_id: string; plan_type: string | null }
  // 유형 가드 — requestReport9Action과 동일 기준(자체점검=별지 4·9·10·11호, 정기·레거시 event=외관점검표)
  const isSpecial = !ins.plan_type || ins.plan_type.startsWith('special')
  if (reportType === 'exterior') {
    if (isSpecial) return { error: '자체점검(특별점검)은 외관점검표 대상이 아닙니다 — 별지 9호를 작성해주세요.' }
  } else if (!isSpecial) {
    return { error: '자체점검 건만 별지 4·9·10·11호 대상입니다.' }
  }
  try {
    if (reportType === 'report9') {
      const { data, missing } = await assembleReport9(admin, ins.customer_id, inspectionId)
      return { html: renderReport9(data, { highlight: true }), missing }
    }
    if (reportType === 'report4') {
      const { data, missing } = await assembleReport4(admin, ins.customer_id, inspectionId)
      return { html: renderReport4(data, { highlight: true }), missing }
    }
    if (reportType === 'exterior') {
      const { data, missing } = await assembleExterior(admin, ins.customer_id, inspectionId)
      return { html: renderExterior(data, { highlight: true }), missing }
    }
    const { data, missing } = await assembleAnnex1011(admin, ins.customer_id, inspectionId, reportType)
    const html = reportType === 'report10'
      ? renderReport10(data, { highlight: true })
      : renderReport11(data, { highlight: true })
    return { html, missing }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** 최신 작업 상태 + 생성물 목록 (클라이언트 폴링용) */
export async function getReport9StatusAction(inspectionId: string): Promise<{
  job: Report9Job | null; files: Report9File[]; error?: string
}> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections')
    .select('customer_id, inspection_type, plan_type').eq('id', inspectionId).single()
  if (!insp) return { job: null, files: [], error: '점검을 찾을 수 없습니다.' }
  const ins = insp as { customer_id: string; inspection_type: string; plan_type: string | null }
  const customerId = ins.customer_id

  // 유형 가드(데이터 계층) — 자체점검은 별지 4/9/10/11호만, 정기·레거시 event는 외관점검표만 조회 (page.tsx isSpecial과 동일)
  const isSpecial = !ins.plan_type || ins.plan_type.startsWith('special')
  const allowTypes = isSpecial ? ['report4', 'report9', 'report10', 'report11'] : ['exterior']
  const filePattern = isSpecial ? /^report(4|9|10|11)_/ : /^exterior_/

  const { data: jobs } = await admin.from('fire_plan_gen_jobs')
    .select('id, status, missing, error, created_at')
    .eq('inspection_id', inspectionId).in('report_type', allowTypes)
    .order('created_at', { ascending: false }).limit(1)

  const prefix = `${customerId}/inspections/${inspectionId}`
  const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 60, sortBy: { column: 'name', order: 'desc' } })
  const files: Report9File[] = (objects ?? [])
    .filter(o => filePattern.test(o.name))
    .map(o => ({ name: o.name, path: `${prefix}/${o.name}`, createdAt: o.created_at ?? null }))

  return { job: (jobs?.[0] as Report9Job | undefined) ?? null, files }
}

/** R4-c: 최신 생성물 바로 받기 — 종류별 최신 스탬프의 PDF(없으면 HWP) 서명 URL.
 *  보고서 센터 ②③ 목록의 인라인 [받기]용(문서 현황 우회, 중복 생성 대신 기생성분 우선). */
export async function getLatestAnnexUrlAction(
  inspectionId: string, kind: 'report9' | 'report10' | 'report11', saveBase?: string,
): Promise<{ url?: string; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const customerId = (insp as { customer_id: string }).customer_id
  const prefix = `${customerId}/inspections/${inspectionId}`
  const { data: objects } = await admin.storage.from(BUCKET)
    .list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
  const re = new RegExp(`^${kind}_(\\d+)\\.(hwpx?|pdf|html?)$`, 'i')
  const byStamp: Record<string, { pdf?: string; hwp?: string }> = {}
  let bestStamp = ''
  for (const o of objects ?? []) {
    const m = o.name.match(re)
    if (!m) continue
    const stamp = m[1]; const ext = m[2].toLowerCase()
    const slot = byStamp[stamp] ??= {}
    if (ext.startsWith('pdf')) slot.pdf = o.name
    else if (ext.startsWith('hwp')) slot.hwp = o.name
    if (stamp > bestStamp) bestStamp = stamp
  }
  if (!bestStamp) return { error: '생성된 문서가 없습니다 — 먼저 생성해주세요.' }
  const name = byStamp[bestStamp].pdf ?? byStamp[bestStamp].hwp
  if (!name) return { error: '내려받을 파일을 찾지 못했습니다.' }
  const ext = name.split('.').pop()!
  const saveName = saveBase ? `${saveBase.replace(/[\\/:*?"<>|]/g, '_')}_${(bestStamp || '').slice(0, 8)}.${ext}` : undefined
  const { data, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(`${prefix}/${name}`, 300, saveName ? { download: saveName } : undefined)
  if (error || !data) return { error: '다운로드 URL 생성 실패' }
  return { url: data.signedUrl }
}

/** 생성물 다운로드 — 5분 서명 URL (경로는 해당 점검 폴더로 한정)
 *  saveName 지정 시 저장명 = 고객명_문서명_YYYY-MM-DD.확장자 (R11-d, content-disposition) */
export async function downloadReport9Action(inspectionId: string, path: string, saveName?: string): Promise<{ url?: string; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const prefix = `${(insp as { customer_id: string }).customer_id}/inspections/${inspectionId}/`
  if (!path.startsWith(prefix)) return { error: '잘못된 경로입니다.' }
  const { data, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(path, 300, saveName ? { download: saveName } : undefined)
  if (error || !data) return { error: '다운로드 URL 생성 실패' }
  return { url: data.signedUrl }
}
