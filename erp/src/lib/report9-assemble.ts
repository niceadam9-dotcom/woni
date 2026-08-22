/** 별지 9호 데이터 조립 + 공용 헬퍼 (소방계획서_27 S7-0 — report9-actions에서 추출)
 *
 *  assembleReport9는 'use server' 파일(report9-actions.ts)의 비공개 함수였는데, 엑셀 워크북
 *  라우트(S7·S3-5 2차)가 같은 값을 써야 한다. 'use server'에서 export하면 공개 엔드포인트가
 *  되므로(소방계획서_17 교훈) annex-cover-official.ts 패턴대로 lib으로 추출했다 — 조회·해석은
 *  전부 여기, 렌더(doc-templates/report9)는 순수 함수, 액션은 이 추출본을 import해 종전 그대로.
 *  PDF와 엑셀이 같은 조립을 타므로 등급·선임자·교육이수일 해석이 갈라질 수 없다(D-7).
 *
 *  kdate·pageAll·loadAnnexInputs·fstr은 report9-actions의 다른 조립(10·11호·외관)도 계속 쓰는
 *  공용 헬퍼라 함께 왔다(액션 파일이 import — 값 import는 공개 엔드포인트를 만들지 않는다). */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  FORM3_ITEMS, form3Group, parseParkingSummary,
  type Report9Data, type Report9DefectRow, type Report9Person,
} from '@/lib/doc-templates/report9'
import { form3ItemsForSheet, rollUpForm3Results, sheetMatchesFacilities, foldSheetResult, type SheetStat } from '@/lib/sheet-facility-map'
import type { Report4SheetSection } from '@/lib/doc-templates/report4'
import type { SpecMap } from '@/lib/doc-templates/spec-sections'
import { getAllSheetItems, getSheets, type SheetCatalogItem } from '@/lib/sheet-catalog'
import { isMultiUseApplicable, isMultiUseNone } from '@/lib/multi-use'
import { resolveFireSafetyManager, type ContactLite } from '@/lib/fire-safety-manager'
import { formatTel } from '@/lib/format-contact'
import { trainingDoneIn, type TrainingRecordLike } from '@/lib/training-records'
import { deriveMuFromStd32, fillNonApplicableMu } from '@/lib/mu-std32-map'
import type { ManagerRow } from '@/components/customers/plan-form17'

export type Admin = ReturnType<typeof createAdminClient>

export function kdate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

/** (제거) 설비명 퍼지 매칭 nameMatch — T-3(소방계획서_14_점검업무)에서 명시 매핑으로 교체.
 *  sheet-facility-map.ts의 form3ItemsForSheet·form3ItemMatchesFacility가 대체한다. */

/** PostgREST 1,000행 한도 대비 offset 페이지 순회 — 워커 db_get_all과 동일 계열 */
export async function pageAll<T>(
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
export async function loadAnnexInputs(
  admin: Admin,
  inspectionId: string,
  annexNo: 'report9' | 'report10' | 'report11' | 'exterior',
): Promise<Record<string, unknown>> {
  const { data } = await admin.from('annex_inputs').select('fields')
    .eq('inspection_id', inspectionId).eq('annex_no', annexNo).maybeSingle()
  return (data?.fields ?? {}) as Record<string, unknown>
}

/** annex_inputs 문자열 필드 안전 추출 (trim, 비문자열은 공백) */
export function fstr(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** 별지 9호 데이터 조립 — 워커 process_report9(fireplan-worker.py)와 동일 원본·규칙의 TS 이식 (H-5, 파리티 우선).
 *  개선분(별지9호.MD §4 기승인)만 추가: 8쪽 불량 세부 자동, 다중이용업 업종 체크(fire_plan_forms sections.multiUse),
 *  보조 점검인력 5명 초과 허용. ③ 서식 고유 값(annex_inputs — 보고일 수기·비고)은 말미에 오버레이(H-23) */
export async function assembleReport9(
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
        // 145: 소방안전관리자로 지목된 관계인 — 2쪽 성명·전화의 1순위 원천
        + 'email_delivery_consent, report_email, rep_role, manager_license_grade, manager_edu_date, manager_appointment_type,'
        // inspection_sub_type(030·035): 일반관리 고객의 종합/작동 축 — 2쪽 «자체점검(전년도)» 판정에 필요
        + 'manager_contact_id, inspection_sub_type')
      .eq('id', customerId).single(),
    admin.from('buildings')
      .select('id, purpose, total_area, building_area, floors_above, floors_below, height, main_structure, roof_structure,'
        + 'households, building_count, permit_date, parking_summary, elevator_count, emergency_elevator_count, evac_elevator_count,'
        + 'stairs_count, ramp_count')
      .eq('customer_id', customerId).eq('is_active', true).order('created_at', { ascending: true }).limit(1),
    admin.from('customer_contacts').select('id, role, name, phone, position').eq('customer_id', customerId),
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
    manager_contact_id: string | null
    inspection_sub_type: string | null
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
  const contacts = (contactsRes.data ?? []) as ContactLite[]
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
  // 카탈로그는 **항상** 조회한다(22 S3-5·S3-6) — 부속 시트 집합이 응답 역산이 아니라 설치 설비 축이라
  // 응답 0건이어도 시트·항목이 나와야 한다. 종전 `responses.length ? … : []` 최적화는 Q-4 번복으로 제거.
  // 마스터 데이터라 캐시에서 읽는다(sheet-catalog.ts, 2026-08-20) — 종전엔 별지를 조립할 때마다
  // **테이블 전건**(sheet_id 필터도 없이 860행 페이징)을 다시 읽었고, 미리보기 프리페치가 이를 반복시켰다.
  // 134 미적용 DB의 42703 폴백도 캐시 안으로 옮겼다.
  type CatalogRow = SheetCatalogItem
  const [items, sheets] = await Promise.all([getAllSheetItems(), getSheets()])
  const sheetNameById = new Map(sheets.map(s => [s.id, s.sheet_name]))
  const sheetByItem = new Map(items.map(i => [i.item_code, sheetNameById.get(i.sheet_id) ?? '']))
  const itemNameByCode = new Map(items.map(i => [i.item_code, i.item_name]))
  // ⚠ 구성은 foldSheetResult 한 곳으로(소방계획서_26 S1) — 종전 {any,x} 수기 구성은 o를 표현할 수 없어
  // **전부 ／인 시트가 ○로 인쇄**됐다. 같은 통계를 만드는 1.4 배지(facility-spec-actions.ts)와 함께 통일.
  const sheetStat = new Map<string, SheetStat>()
  for (const r of responses) {
    const name = sheetByItem.get(r.item_code)
    if (!name) continue
    sheetStat.set(name, foldSheetResult(sheetStat.get(name), r.result))
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

  // T-3(소방계획서_14_점검업무) — 시트·설비 ↔ FORM3 연결에서 퍼지 매칭 제거.
  // 종전 nameMatch(공백 제거 양방향 includes)는 sheet-facility-map 상단 주석의 두 결함을 문서 생성 경로에 남겨뒀다:
  //   오검 — 설치 '스프링클러설비'가 '간이·화재조기진압용' 항목까지 켬 / '비상조명등'이 '휴대용비상조명등'까지 켬
  //   누락 — 시트 '…시각경보장치' ↔ 항목 '…시각경보기', 시트 '소화용수설비' ↔ 항목 2종, '부속실 등 제연설비' 등
  // 설비→항목은 정규화 정확 매칭, 시트→항목은 명시 매핑(미등재 시트만 퍼지 폴백). _probe-form3-map.mjs가 차이를 고정.
  const { facilityChecks, resultMarks, axisWarnings } = rollUpForm3Results(sheetStat, FORM3_ITEMS, codes)

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

  // 3쪽 2절 안전시설등(다중이용업소, §9-6e) — MU-01 직접 응답 항목 단위 반영.
  // Q-10(22 S14): 이제 입력 원천은 STD-32 한 벌이고 16칸은 롤업 파생이지만,
  // 직접 응답이 있는 레거시 건은 그 값이 이긴다(S14-3) — 아래 부속 조립 뒤에서 빈 칸만 파생을 채운다.
  const muResults: Record<string, 'O' | 'X' | 'N'> = {}
  for (const r of responses) {
    if (r.item_code.startsWith('MU-') && ['O', 'X', 'N'].includes(r.result)) muResults[r.item_code] = r.result
  }

  // 2쪽 자동 판정(§9-6③) — 데이터가 있을 때만 체크 (없으면 공란 유지, 단정 금지 — 워커 동일)
  const hasPlan = (plansRes.data ?? []).length > 0
  const { data: prevRows } = await admin.from('inspections')
    .select('inspection_type').eq('customer_id', customerId).eq('year', insp.year - 1).eq('status', 'completed')
  const prevList = (prevRows ?? []) as Array<{ inspection_type: string }>
  // D(전년도 자체점검 자동 체크) — 전년도 이력이 보관돼 있으면 그 축 그대로 √.
  //  · **종합은 종합, 작동은 작동**(2026-08-20 확정) — 축을 섞지 않는다. 종전엔 '최초'를 종합에
  //    얹었으나(prevTypes.has('최초')) 그 값이 종합 1차라는 근거가 확정되지 않았고, 035가 레거시
  //    '최초'·'기타'를 전부 '작동'으로 바꿔 데이터에 남아 있지도 않다(035:6-17). 근거 없는 단정을
  //    지운 것이라 실데이터 판정은 달라지지 않는다. is_initial로도 축을 넓히지 않는다.
  //  · 일반관리 고객의 점검 행은 inspection_type='일반관리'라 작동/종합 어디에도 걸리지 않았다
  //    (inspections에는 inspection_sub_type 컬럼이 없다 — 035는 customers·plan_items에만 추가).
  //    전년도 점검을 완료해도 두 칸이 영구 공란이던 원인 — 고객의 sub_type으로 **같은 축**을 복원한다.
  const prevGeneral = prevList.some(r => r.inspection_type === '일반관리')
  const generalSub = cust.inspection_sub_type ?? ''
  const prevOpDone = prevList.some(r => r.inspection_type === '작동') || (prevGeneral && generalSub === '작동')
  const prevCompDone = prevList.some(r => r.inspection_type === '종합') || (prevGeneral && generalSub === '종합')
  const sections = ((formsRes.data?.[0] as { sections: Record<string, unknown> | null } | undefined)?.sections) ?? {}
  // B-2(소방계획서_19 K-2, Q-1 확정 2026-08-11): 교육훈련 = **전년도 실시** 기입(서식 9쪽 작성방법 8호
  // "교육훈련(전년도)" — 자체점검(전년도)과 동일 축). 종전 `!!sections['training']`은 1.11 '계획' 존재만으로
  // 교육·훈련을 둘 다 '실시'로 찍던 판정 비약(A9-2). 실적 원천 = 1.11.4 결과 기록부(records)의
  // 전년도(insp.year-1) 행 — 구분(교육/훈련)별로 분리 판정. 부정 단정 없음 — 실적 없으면 미체크(☐)일 뿐.
  // C·D: 연도 판정은 lib/training-records 한 곳 — 입력 화면(1.11.4)의 전년도 배지와 같은 함수를 쓴다.
  // 종전 `at.slice(0,4)` 비교는 at이 자유 텍스트라 '25.6.10'·앞 공백이 조용히 탈락했다.
  const trainingRecords = ((sections['training'] as { records?: TrainingRecordLike[] } | null)?.records) ?? []
  const prevTraining = trainingDoneIn(trainingRecords, insp.year - 1)
  const eduDone = prevTraining.edu
  const drillDone = prevTraining.drill
  // 소방안전관리자 — 145 지목(manager_contact_id) → 서식 1.7 → 대표 폴백. 규칙은 lib/fire-safety-manager 한 곳.
  const mgr = resolveFireSafetyManager({
    contacts, managerContactId: cust.manager_contact_id,
    managers: (sections['managers'] ?? null) as ManagerRow[] | null,
  })
  // 다중이용업소현황 — 서식 1.10.3(sections.multiUse)과 공유 원본 (별지9호.MD §2 MULTI_USE_CATEGORIES)
  const muSection = (sections['multiUse'] ?? null) as { applicable?: boolean; categories?: Record<string, string> } | null
  const multiUseCounts: Record<string, string> = {}
  if (muSection && isMultiUseApplicable(muSection)) {
    for (const [cat, cnt] of Object.entries(muSection.categories ?? {})) {
      if (String(cnt ?? '').trim()) multiUseCounts[cat] = String(cnt).trim()
    }
  }

  // ── 부속 '설비별 점검표' 조립 (22 S1·S3 — Q-1·Q-3·Q-4·Q-5, 2026-08-14 확정) ──
  // 시트 집합을 설치 설비(fire_facilities.installed) 축에서 **먼저** 정하고, 그 시트의 전 항목을
  // 카탈로그에서 가져와 응답을 왼쪽 조인한다. ○·×·／ 세 값 전부 수록, 무응답은 공란(행은 존재),
  // 응답 0건 설비도 본문·목차에 나온다. 종전 A4-1 Q-2(○/× 발췌 수록·무응답 설비 미생성)는 Q-1이 번복.
  // 목차(tocPage)와 본문(sheetItemPages)이 이 배열 하나를 읽으므로 둘이 어긋날 수 없다(S3-4).
  const SHEET_CODE_RE = /^\d{1,2}-[A-Z]-\d{3}$/
  const resByCode = new Map(responses.map(r => [r.item_code, r.result]))
  // 응답이 있는 시트 — 대장 미등록이어도 실제 입력을 버리지 않기 위한 레거시 보호 축(합집합)
  const respSheetIds = new Set<string>()
  for (const it of items) {
    if (SHEET_CODE_RE.test(it.item_code) && resByCode.has(it.item_code)) respSheetIds.add(it.sheet_id)
  }
  // 부속은 자체점검 전용이라 버전은 항상 v2025(sheetScope: isSpecial → v2025, 생성 게이트가 보장)
  const stdSheets = sheets.filter(s => s.version === 'v2025' && /^STD-\d+$/.test(s.sheet_code))
  const hasMultiUse = Object.keys(multiUseCounts).length > 0
  const includedSheets = stdSheets.filter(s => {
    const no = Number(s.sheet_code.match(/^STD-(\d+)$/)![1])
    if (no === 31) return true                                   // 기타사항 — 맵 미등재·항상 포함(Q-3·P-12)
    if (no === 32) return hasMultiUse || respSheetIds.has(s.id)  // 다중이용업소 — 1.10.3 업종 축(Q-10)
    return sheetMatchesFacilities(s.sheet_name, codes) || respSheetIds.has(s.id)
  })
  // 대장 미등록인데 응답만으로 편입된 시트 — 아래 missing에서 표면화(조용한 편입 금지)
  const respOnlySheetNames = includedSheets
    .filter(s => !/^STD-3[12]$/.test(s.sheet_code) && !sheetMatchesFacilities(s.sheet_name, codes))
    .map(s => s.sheet_name)
  const itemsBySheetId = new Map<string, CatalogRow[]>()
  for (const it of items) {
    if (!SHEET_CODE_RE.test(it.item_code)) continue
    const arr = itemsBySheetId.get(it.sheet_id)
    if (arr) arr.push(it)
    else itemsBySheetId.set(it.sheet_id, [it])
  }
  const seenCodes = new Set<string>()   // 시드에 같은 코드가 2행 있어도 1건(전 경로 공통 중복 방어)
  const sheetSections: Report4SheetSection[] = includedSheets
    .map(s => {
      const rows = (itemsBySheetId.get(s.id) ?? [])
        .sort((a, b) => ((a.order_num ?? 0) - (b.order_num ?? 0)) || a.item_code.localeCompare(b.item_code))
        .filter(it => (seenCodes.has(it.item_code) ? false : (seenCodes.add(it.item_code), true)))
      return {
        no: Number(s.sheet_code.match(/^STD-(\d+)$/)![1]),   // 법정 번호 유지(S3-3) — 1~n 재번호 금지
        name: s.sheet_name,
        items: rows.map(it => {
          const res = resByCode.get(it.item_code)
          // 중분류 헤더는 법정 표기('1-A. 소화기구(…)') — group_name엔 이름만 있고 접두는 코드에서 온다.
          // 134 미적용 폴백(select에 컬럼 없음)이면 undefined로 남아 렌더에 헤더 행이 없다(Q-16).
          const prefix = it.item_code.replace(/-\d+$/, '')
          return {
            code: it.item_code, name: it.item_name,
            mark: res === 'O' || res === 'X' || res === 'N' ? res : null,   // 무응답 = 공란(Q-5)
            comprehensive: !!it.comprehensive_only,
            group: it.group_name != null ? `${prefix}. ${it.group_name}` : undefined,
            subgroup: it.subgroup_name,
          }
        }),
      }
    })
    .filter(s => s.items.length > 0)
    .sort((a, b) => (a.no - b.no) || a.name.localeCompare(b.name))

  // Q-10(22 S14-2·3) — MU 16칸 롤업: 직접 응답이 없는 칸만 STD-32 응답에서 파생
  // (X 있으면 X → O 있으면 O → 전부 N이면 N → 응답 없으면 공란). 매핑·규칙은 mu-std32-map.ts 단일 원천.
  for (const [mu, v] of Object.entries(deriveMuFromStd32(c => resByCode.get(c)))) {
    if (!muResults[mu]) muResults[mu] = v
  }
  // 다중이용업소가 아니면 남은 16칸을 전부 해당없음(／)으로 — 1절 '미설치 → N'과 대칭(A안, 2026-08-20).
  // 규칙·근거는 mu-std32-map.ts 단일 원천. 별지 4호 2쪽도 이 값을 그대로 공유한다(:648).
  fillNonApplicableMu(muResults, isMultiUseApplicable(muSection))

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
    // 2쪽 — 대표자 구분(104 rep_role — 미입력 시 관계인 대표=소유자 폴백)
    repRole: ['소유자', '관리자', '점유자'].includes(cust.rep_role ?? '') ? (cust.rep_role as string) : (owner ? '소유자' : ''),
    ownerName: owner?.name ?? '',
    // 별지 9호만 종전에 원문 그대로였다 — 같은 파일의 10·11호(:118)·외관(:820)·companyPhone(:519)은
    // 전부 formatTel을 거치므로, 2쪽 소방안전정보에서만 '01012345678' 꼴로 찍히던 표기 불일치를 맞춘다.
    ownerPhone: formatTel(owner?.phone),
    // 소방안전관리등급 = **대상물** 등급(building_grade) 하나만 쓴다.
    // 서식 각주 7이 말하는 「화재예방법 시행령 별표 4」는 특정소방대상물의 등급이고, ERP에서 그 축은
    // building_grade다(091 '소방안전관리대상물 급수', suggestGrade가 별표4로 산정해 넣는 컬럼).
    // 종전엔 manager_license_grade(=**사람**의 자격구분, 104 주석에 "대상물 등급과 별개"로 명시)를
    // 1순위로 읽어, 2급 대상물에 1급 자격 관리자가 선임되면 '1급'이 찍혔다. 축이 다른 값을 폴백으로
    // 두면 틀린 등급을 조용히 인쇄하므로 아예 끊는다 — 미입력은 공란이 맞고, missing이 그 사실을 알린다.
    managerGrade: ['특급', '1급', '2급', '3급'].includes(cust.building_grade ?? '') ? (cust.building_grade as string) : '',
    // 145: 관계인 지목이 있으면 그 사람의 전화가 그대로 온다 — 종전엔 선임자≠대표면 항상 공란이었다
    mgrName: mgr.name,
    mgrPhone: formatTel(mgr.phone),
    mgrEduDate: cust.manager_edu_date ? kdate(cust.manager_edu_date) : '',
    hasFirePlan: hasPlan,
    prevOpDone,
    prevCompDone,
    eduDone,
    drillDone,
    insuranceJoined: cust.insurance_joined,
    insCompany: cust.insurance_company ?? '',
    insPeriod: cust.insurance_period ?? '',
    insPerson: cust.insurance_amount_person ?? '',
    insProperty: cust.insurance_amount_property ?? '',
    // 3쪽 2절(fillNonApplicableMu)과 **같은 판정**을 써야 한다 — 종전 `applicable === false`는
    // 1.10.3 미입력을 비대상으로 안 봐서, 3쪽이 16칸을 전부 ／로 찍는 건에서도 2쪽 '해당없음'이
    // 빈 채로 인쇄됐다(스테이징 4건 중 3건). 판정은 lib/multi-use 한 곳.
    multiUseNone: isMultiUseNone(muSection),
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
  // A(3상태화): ③ 수동 보정 — '실시/미실시', '작성/미작성', '보관/미보관'을 사람이 확정한다.
  //  자동 판정은 종전대로 **부정을 단정하지 않는다**(A9-6). 부정 칸(미실시·미작성·미보관)은 종전에
  //  ck(false) 하드코딩이라 실제로 미실시인 대상물조차 √를 찍을 수 없었다 — 그 경로를 여기서만 연다.
  const mark2 = (key: string, yes: string, no: string): 'yes' | 'no' | '' => {
    const v = fstr(annexFields, key)
    return v === yes ? 'yes' : v === no ? 'no' : ''
  }
  const mEdu = mark2('eduDone', '실시', '미실시')
  if (mEdu) { data.eduDone = mEdu === 'yes'; data.eduNone = mEdu === 'no' }
  const mDrill = mark2('drillDone', '실시', '미실시')
  if (mDrill) { data.drillDone = mDrill === 'yes'; data.drillNone = mDrill === 'no' }
  const mPrevOp = mark2('prevOpDone', '실시', '미실시')
  if (mPrevOp) { data.prevOpDone = mPrevOp === 'yes'; data.prevOpNone = mPrevOp === 'no' }
  const mPrevComp = mark2('prevCompDone', '실시', '미실시')
  if (mPrevComp) { data.prevCompDone = mPrevComp === 'yes'; data.prevCompNone = mPrevComp === 'no' }
  const mPlan = mark2('firePlanWritten', '작성', '미작성')
  if (mPlan) { data.hasFirePlan = mPlan === 'yes'; data.firePlanNone = mPlan === 'no' }
  // 미작성이면 보관 칸은 성립하지 않는다 — 자동 폴백(hasFirePlan)이 살아나지 않게 명시로 끊는다
  if (data.firePlanNone) data.firePlanStored = false
  const mStore = mark2('firePlanStored', '보관', '미보관')
  if (mStore) { data.firePlanStored = mStore === 'yes'; data.firePlanUnstored = mStore === 'no' }

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
  // 반대 방향(2026-08-21) — 설치 축 밖인데 결과가 찍히던 두 갈래. ①만 세면 절반만 보인다.
  //  ②b는 결과를 지우지 않으므로(실점검일 수 있다) **여기서 말하지 않으면 아무도 모른다** — 서식상
  //  성립하지 않는 칸이 그대로 인쇄된다. 고칠 곳은 문서가 아니라 1.4 대장이다.
  if (axisWarnings.respondedNotInstalled.length > 0) {
    missing.push(`대장 미체크인데 점검표 응답 있음 ${axisWarnings.respondedNotInstalled.length}건`
      + `(${axisWarnings.respondedNotInstalled.join('·')}) — 3쪽에 [ ]+○로 인쇄됨, 1.4 설비 대장 확인 필요`)
  }
  //  ②a는 자동 정정된 쪽이라 인쇄물은 옳지만, '점검한 줄 알았는데 ／'로 읽힐 수 있어 사실을 남긴다.
  if (axisWarnings.spillSuppressed.length > 0) {
    missing.push(`미설치 항목 ${axisWarnings.spillSuppressed.length}건`
      + `(${axisWarnings.spillSuppressed.join('·')}) — 같은 시트의 설치 설비 응답이 번지지 않도록 ／로 인쇄됨`)
  }
  // 22 S3 — 설치 축 밖인데 응답이 있어 부속에 편입된 시트는 조용히 넘기지 않는다(대장 정비 유도)
  if (respOnlySheetNames.length > 0) {
    missing.push(`설비 대장 미등록 시트 ${respOnlySheetNames.join('·')} — 점검표 응답이 있어 부속 점검표·목차에 포함됨`)
  }
  // 2쪽 «소방안전정보» 블록 — 라벨은 실제 입력처(관계인 탭 [소방안전관리])와 맞춘다.
  // 이 블록이 다 채워진 고객은 320곳 중 1곳뿐이었다(2026-08-20 실측). 아무도 알려주지 않았기 때문이다.
  if (!cust.manager_appointment_type) missing.push('소방안전관리자 선임 형태 미입력 — 2쪽 체크 공란')
  if (!data.managerGrade) missing.push('소방안전관리등급(대상물 급수) 미입력 — 2쪽 체크 공란')
  if (!data.mgrName) missing.push('소방안전관리자 미지정 — 2쪽 성명·전화 공란')
  else if (!data.mgrPhone) missing.push('소방안전관리자 전화번호 없음 — 지정한 관계인에 번호가 비어 2쪽 공란')
  if (!data.mgrEduDate) missing.push('소방안전관리자 최근 교육이수일 미입력 — 2쪽 공란')
  // B: 2쪽 «소방계획서»·«자체점검(전년도)»·«교육훈련» 공란 사유 표면화. 이 세 줄은 자동 판정이라
  // 아무도 입력을 요구받지 않고, 왜 비었는지 모른 채 그대로 인쇄돼 나갔다. 실시/미실시를 ③에서
  // 확정하면(A) 사라진다 — 즉 "확정되지 않은 칸"만 남는다.
  const prevYear = insp.year - 1
  if (!data.hasFirePlan && !data.firePlanNone) {
    missing.push('소방계획서 보관함(고객 > 소방계획서)에 등록분 없음 — 2쪽 작성·보관 칸 공란')
  }
  if (!data.prevOpDone && !data.prevCompDone && !data.prevOpNone && !data.prevCompNone) {
    missing.push(`전년도(${prevYear}) 완료된 자체점검 이력 없음 — 2쪽 자체점검 칸 공란(작성 패널 ③에서 실시·미실시 확정 가능)`)
  }
  if (!data.eduDone && !data.eduNone) {
    missing.push(`전년도(${prevYear}) 소방안전교육 실적 없음 — 2쪽 교육훈련 칸 공란(서식 1.11.4 기록부 입력 또는 작성 패널 ③ 보정)`)
  }
  if (!data.drillDone && !data.drillNone) {
    missing.push(`전년도(${prevYear}) 소방훈련 실적 없음 — 2쪽 교육훈련 칸 공란(서식 1.11.4 기록부 입력 또는 작성 패널 ③ 보정)`)
  }
  return { data, missing, annex4: { companyRegNo: company.management_reg_no ?? '', sheetSections } }
}
