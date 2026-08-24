'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { convertHtmlToPdf } from '@/lib/pdf'
import { renderReport10, renderReport11, type Annex1011Data } from '@/lib/doc-templates/report1011'
import { renderReport9 } from '@/lib/doc-templates/report9'
import { renderReport4, type Report4Data, type Report4PumpRow } from '@/lib/doc-templates/report4'
import { annexDownloadName } from '@/lib/annex-filename'
import { judgePumpTest, PUMP_TEST_SHEETS, PUMP_SHEET_LABELS, type PumpTestRow } from '@/lib/pump-test'
import { renderExterior, type ExteriorData, type ExteriorMonthEntry } from '@/lib/doc-templates/exterior'
import { renderCover } from '@/lib/doc-templates/cover'
import { renderOfficial } from '@/lib/doc-templates/official'
import { assembleCover, assembleOfficial, assembleDelegation } from '@/lib/annex-cover-official'
import { renderDelegation } from '@/lib/doc-templates/delegation'
import { isRegenBlocked, REGEN_BLOCKED_MESSAGE } from '@/lib/annex-regen-policy'
import { getSheets } from '@/lib/sheet-catalog'
import type { DocAsset } from '@/lib/doc-templates/base'
import { resolveFireSafetyManager, type ContactLite } from '@/lib/fire-safety-manager'
import { formatBizNo, formatTel } from '@/lib/format-contact'
import { INSPECTION_DOC_FILE_RE, EXTERIOR_DOC_FILE_RE } from '@/lib/generated-docs'
import type { ManagerRow } from '@/components/customers/plan-form17'
import { assembleReport9, kdate, pageAll, loadAnnexInputs, fstr } from '@/lib/report9-assemble'

/** 별지 9호(자체점검 실시결과 보고서) 생성 — P3 MVP (소방계획서_4.md §9-3·§9-6⑦)
 *  입력은 소유하지 않는 준비 화면 원칙: 공통값=고객 탭, 점검값=점검 상세, 여기는 생성·조회만.
 *  별지 9·10·11호·외관점검표(별지 6호)는 서버 동기 생성(HTML→Gotenberg PDF —
 *  소방계획서_7 H-5·H-6·H-7·H-8, SDK·워커 미경유). 워커에는 소방계획서(기본 유형)만 남는다. */

const BUCKET = 'fire-plans'

type Admin = ReturnType<typeof createAdminClient>

/** 별지 10·11호 데이터 조립 — 워커 process_report1011과 동일 원본 (fireplan-worker.py 이식).
 *  ③ 서식 고유 값(annex_inputs — 제출일·총 이행기간 보정·계획 요약·완료 보고 문구)은 말미에 오버레이(H-23) */
async function assembleAnnex1011(
  admin: Admin,
  customerId: string,
  inspectionId: string,
  kind: 'report10' | 'report11',
): Promise<{ data: Annex1011Data; missing: string[] }> {
  const [custRes, bldRes, contactsRes, defectsRes, formRes] = await Promise.all([
    admin.from('customers').select('customer_name, address, fire_station, manager_contact_id').eq('id', customerId).single(),
    admin.from('buildings').select('purpose').eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1),
    admin.from('customer_contacts').select('id, role, name, phone').eq('customer_id', customerId),
    admin.from('inspection_defects')
      .select('defect_name, action_plan, action_start, action_end, action_taken, action_completed_at')
      .eq('inspection_id', inspectionId).order('created_at'),
    // B-1(소방계획서_19 K-1): 서식 1.7 선임현황 — 소방안전관리자 결정 원천
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).limit(1),
  ])
  const cust = custRes.data as {
    customer_name: string; address: string | null; fire_station: string | null; manager_contact_id: string | null
  } | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')
  const purpose = ((bldRes.data?.[0] as { purpose: string | null } | undefined)?.purpose) ?? ''
  const contacts = (contactsRes.data ?? []) as ContactLite[]
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0] ?? null
  // 소방안전관리자 — 별지 9호와 **같은 해석기**를 탄다. 종전에는 대표 고정이라 선임자≠대표인 고객은
  // 별지9호와 10·11호의 관리자 이름이 서로 다르게 인쇄됐다(B-1, 소방계획서_19 K-1).
  const a1011Sections = ((formRes.data?.[0] as { sections?: Record<string, unknown> } | undefined)?.sections) ?? {}
  const a1011Mgr = resolveFireSafetyManager({
    contacts, managerContactId: cust.manager_contact_id,
    managers: (a1011Sections['managers'] ?? null) as ManagerRow[] | null,
  })
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
    mgrName: a1011Mgr.name,
    mgrPhone: formatTel(a1011Mgr.phone),
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
  // ※ 펌프성능시험 — 법정 서식의 표(R5-7 후속). 37시트 엑셀만 담던 실측치가 여기로 들어온다.
  // 131 미적용 환경에서도 나머지 쪽은 정상 생성돼야 하므로 조회 실패는 빈 배열로 흡수한다.
  const pumpRows = await loadPumpRows(admin, inspectionId)
  // 송달 동의·사용승인일·건축허가일은 별지 9호 전용(1~2쪽) — 별지 4호 서식에 없음
  const missing = m9.filter(m => !['송달 동의', '사용승인일', '건축허가일'].includes(m))
  if (Object.keys(d9.specs ?? {}).length === 0) missing.push('설비 세부현황(설비 대장) 미입력 — 3~7쪽 빈 서식')
  if (!annex4.companyRegNo) missing.push('관리업 등록번호(회사 정보) 미입력')
  // V21-2: 펌프성능시험 미입력 경고. 엑셀 폐지(R5-6) 후엔 이 표가 실측치의 **유일 기록처**라
  // '안 넣었다'를 알려 줄 수단이 필요하다. 대상 판정 축은 화면(page.tsx)과 같은 STD-{n} 시트다.
  {
    const targetSheets = (await getSheets('v2025'))
      .map(s => Number(s.sheet_code.match(/^STD-(\d+)$/)?.[1] ?? ''))
      .filter(n => (PUMP_TEST_SHEETS as readonly number[]).includes(n))
    const filled = new Set(pumpRows.map(r => r.sheetNo))
    const empty = [...new Set(targetSheets)].filter(n => !filled.has(n)).sort((a, b) => a - b)
    if (empty.length > 0) {
      missing.push(`펌프성능시험 실측치 미입력 ${empty.length}개 설비(${empty.map(n => PUMP_SHEET_LABELS[n] ?? n).join('·')}) — 해당 쪽의 표가 공란으로 인쇄됨`)
    }
  }
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
    pumpRows,
    specs: d9.specs ?? {},
  }
  return { data, missing }
}

/** 펌프성능시험 실측치 → 별지 4호 행. 판정은 lib/pump-test.judgePumpTest 하나만 쓴다
 *  (화면과 문서가 다른 규칙으로 판정하면 두 갈래가 된다). */
async function loadPumpRows(admin: Admin, inspectionId: string): Promise<Report4PumpRow[]> {
  const { data, error } = await admin.from('inspection_pump_tests')
    .select('sheet_no, pump_kind, shutoff_flow, shutoff_press, rated_flow, rated_press,'
      + ' over_flow, over_press, set_start_press, set_stop_press, judge1, judge2, judge3, note')
    .eq('inspection_id', inspectionId)
    .order('sheet_no')
  if (error || !data) return []
  return (data as unknown as Array<Record<string, unknown>>).map(d => {
    const mark = (v: unknown) => (v === 'O' || v === 'X' ? v : null)
    const n = (v: unknown) => (typeof v === 'number' ? v : null)
    const row: PumpTestRow = {
      sheetNo: Number(d.sheet_no), pumpKind: d.pump_kind === '예비' ? '예비' : '주',
      shutoffFlow: n(d.shutoff_flow), shutoffPress: n(d.shutoff_press),
      ratedFlow: n(d.rated_flow), ratedPress: n(d.rated_press),
      overFlow: n(d.over_flow), overPress: n(d.over_press),
      setStartPress: n(d.set_start_press), setStopPress: n(d.set_stop_press),
      judge1: mark(d.judge1), judge2: mark(d.judge2), judge3: mark(d.judge3),
      note: typeof d.note === 'string' ? d.note : null,
    }
    return {
      sheetNo: row.sheetNo, pumpKind: row.pumpKind,
      shutoffFlow: row.shutoffFlow, shutoffPress: row.shutoffPress,
      ratedFlow: row.ratedFlow, ratedPress: row.ratedPress,
      overFlow: row.overFlow, overPress: row.overPress,
      setStartPress: row.setStartPress, setStopPress: row.setStopPress,
      judges: judgePumpTest(row).final,
      note: row.note,
    }
  })
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
    admin.from('customers').select('customer_name, address, fire_station, manager_contact_id').eq('id', customerId).single(),
    admin.from('buildings').select('purpose').eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1),
    admin.from('customer_contacts').select('id, role, name, phone, position').eq('customer_id', customerId),
    // 서식 1.7 선임현황 — 지목(145)이 없을 때의 폴백 원천
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).limit(1),
  ])
  const insp = inspRes.data as {
    inspection_start_date: string | null; assigned_employee_id: string | null; year: number
  } | null
  if (!insp) throw new Error('점검 건을 찾을 수 없습니다')
  const cust = custRes.data as {
    customer_name: string; address: string | null; fire_station: string | null; manager_contact_id: string | null
  } | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')
  const purpose = ((bldRes.data?.[0] as { purpose: string | null } | undefined)?.purpose) ?? ''
  const contacts = (contactsRes.data ?? []) as ContactLite[]
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0] ?? null
  // 소방안전관리자 — 별지 9호·10·11호와 같은 해석기(lib/fire-safety-manager)
  const extSections = ((formRes.data?.[0] as { sections?: Record<string, unknown> } | undefined)?.sections) ?? {}
  const extMgr = resolveFireSafetyManager({
    contacts, managerContactId: cust.manager_contact_id,
    managers: (extSections['managers'] ?? null) as ManagerRow[] | null,
  })
  const extMgrName = extMgr.name
  // EX-3(B-8 감사): 직위 — 서식에 자리가 있는데 항상 공란이었다. 지목이면 관계인 직위, 1.7이면 그 행의 구분.
  // 대표 폴백만으로는 직위를 단정하지 않는다(해석기가 ''를 준다).
  const extMgrTitle = extMgr.title

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
    mgrTitle: extMgrTitle,  // EX-3
    mgrName: extMgrName,
    mgrPhone: formatTel(extMgr.phone),
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
  if (!extMgrName) missing.push('소방안전관리자(관계인 탭 [소방안전관리] 지정 또는 1.7 선임현황) 미등록')
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

/** 생성 요청 — 별지 4·9·10·11호·외관점검표·공문·표지·위임장 전부 서버 동기 생성, fire_plan_gen_jobs는 완료 기록용 (H-8·H-7·H-21).
 *  official(공문)·cover(표지)는 소방계획서_22 S5·S7, delegation(위임장)은 S8 —
 *  번들 순서는 공문 → 위임장 → 표지 → 본문(bundle/route TYPE_ORDER) */
const ANNEX_TYPES = ['report4', 'report9', 'report10', 'report11', 'exterior', 'cover', 'official', 'delegation'] as const
export type AnnexType = typeof ANNEX_TYPES[number]

export async function requestReport9Action(
  inspectionId: string,
  reportType: AnnexType = 'report9',
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!ANNEX_TYPES.includes(reportType)) return { error: '지원하지 않는 서식입니다.' }
  const admin = createAdminClient()

  // ⚠ error를 함께 본다 — data만 destructure하면 **없는 컬럼 하나가 조용한 0행**이 되어(42703)
  //   "점검을 찾을 수 없습니다."로 둔갑한다. 실제로 sheet_protocol(마이그레이션 149) 미적용 DB에서
  //   별지 생성 전건이 이 메시지로 죽어 스키마 문제임을 알 길이 없었다(2026-08-23 독립 판정)
  const { data: insp, error: inspErr } = await admin.from('inspections')
    .select('id, customer_id, year, inspection_type, plan_type, inspection_start_date, inspection_end_date, sheet_protocol, customer:customers(customer_name)')
    .eq('id', inspectionId).maybeSingle()
  if (inspErr) return { error: `점검 조회 실패(${inspErr.code ?? '?'}): ${inspErr.message}` }
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const i = insp as unknown as {
    id: string; customer_id: string; year: number; inspection_type: string; plan_type: string | null
    inspection_start_date: string | null; inspection_end_date: string | null
    sheet_protocol: 'legacy_na' | 'blank_unanswered' | null
    customer: { customer_name: string } | null
  }

  // 유형 가드(데이터 계층) — 별지 9·10·11호는 자체점검(special_*·null)만, 정기·레거시 event는 외관점검표만.
  // 관리유형 무관 — 일반관리 자체점검도 대상 (소방계획서_6 W-15, page.tsx isSpecial과 동일 기준)
  const isSpecial = !i.plan_type || i.plan_type.startsWith('special')
  if (['report4', 'report9', 'report10', 'report11', 'cover', 'official', 'delegation'].includes(reportType) && !isSpecial) {
    return { error: '일반·정기 점검은 별지 4·9·10·11호(표지·공문·위임장 포함) 대상이 아닙니다 — 외관점검표만 작성합니다.' }
  }
  if (reportType === 'exterior' && isSpecial) {
    return { error: '자체점검(특별점검)은 외관점검표 대상이 아닙니다 — 별지 9호를 작성해주세요.' }
  }
  // S9-1 재설계(2026-08-21) — 규약 버전 축. 구규약(legacy_na)·미상+응답있음은 재생성 차단
  // (보관함 원본이 원천). 응답 수는 미상일 때만 판정에 필요하므로 그때만 센다.
  {
    let respondedCount = 0
    if (i.sheet_protocol === null) {
      const { count } = await admin.from('inspection_sheet_responses')
        .select('id', { count: 'exact', head: true }).eq('inspection_id', inspectionId)
      respondedCount = count ?? 0
    }
    if (isRegenBlocked({ sheetProtocol: i.sheet_protocol, respondedCount })) {
      return { error: REGEN_BLOCKED_MESSAGE }
    }
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
    // 표지만 이미지 첨부(건물 사진·로고) — 기존 4종 경로는 빈 배열 그대로(무손상, S5-7)
    let assets: DocAsset[] = []
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
    } else if (reportType === 'cover') {
      const assembled = await assembleCover(admin, i.customer_id, inspectionId)
      html = renderCover(assembled.data)
      missing = assembled.missing
      assets = assembled.assets
    } else if (reportType === 'official') {
      const assembled = await assembleOfficial(admin, i.customer_id, inspectionId)
      html = renderOfficial(assembled.data)
      missing = assembled.missing
    } else if (reportType === 'delegation') {
      const assembled = await assembleDelegation(admin, i.customer_id, inspectionId)
      html = renderDelegation(assembled.data)
      missing = assembled.missing
    } else {
      const assembled = await assembleAnnex1011(admin, i.customer_id, inspectionId, reportType)
      html = reportType === 'report10' ? renderReport10(assembled.data) : renderReport11(assembled.data)
      missing = assembled.missing
    }
    // 22 S1-8 — 별지 4호는 Q-1·Q-4로 부속 분량이 늘었다(설치 시트 전 항목 + 설비당 페이지).
    // 기본 60초(pdf.ts) 대신 120초(선례 fire-plan-generate.ts)로 여유를 둔다.
    const pdf = await convertHtmlToPdf(html, assets, {
      marginMode: 'none', ...(reportType === 'report4' ? { timeoutMs: 120_000 } : {}),
    })
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
      : reportType === 'cover' ? '표지'
      : reportType === 'official' ? '공문'
      : reportType === 'delegation' ? '위임장'
      : `별지 ${reportType === 'report4' ? '4' : reportType === 'report9' ? '9' : reportType === 'report10' ? '10' : '11'}호`
    return { error: `${label} 생성 실패: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 별지 9·10·11호·외관점검표 미리보기 HTML (소방계획서_7 H-4·H-7) — 생성물과 동일 렌더 함수 단일 소스,
 *  미입력 항목은 하이라이트(§4-A-2c). 클라이언트는 iframe srcDoc으로 표시.
 *
 *  `highlight: false` = 초안 인쇄용 — 미입력 노란 배경(.missing)을 뺀다. BASE_CSS가
 *  print-color-adjust:exact라 하이라이트가 인쇄에서 **살아나기 때문에**, 화면 미리보기 HTML을
 *  그대로 인쇄하면 노란 칠이 종이에 찍힌다. 인쇄 경로는 반드시 이 옵션으로 다시 렌더할 것. */
export async function getAnnexPreviewHtmlAction(
  inspectionId: string,
  reportType: 'report4' | 'report9' | 'report10' | 'report11' | 'exterior' | 'cover' | 'official' | 'delegation',
  opts?: { highlight?: boolean },
): Promise<{ html?: string; missing?: string[]; error?: string }> {
  const hl = opts?.highlight ?? true
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('id, customer_id, plan_type').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const ins = insp as { customer_id: string; plan_type: string | null }
  // 유형 가드 — requestReport9Action과 동일 기준(자체점검=별지 4·9·10·11호·표지·공문, 정기·레거시 event=외관점검표)
  const isSpecial = !ins.plan_type || ins.plan_type.startsWith('special')
  if (reportType === 'exterior') {
    if (isSpecial) return { error: '자체점검(특별점검)은 외관점검표 대상이 아닙니다 — 별지 9호를 작성해주세요.' }
  } else if (!isSpecial) {
    return { error: '자체점검 건만 별지 4·9·10·11호(표지·공문 포함) 대상입니다.' }
  }
  try {
    if (reportType === 'report9') {
      const { data, missing } = await assembleReport9(admin, ins.customer_id, inspectionId)
      return { html: renderReport9(data, { highlight: hl }), missing }
    }
    if (reportType === 'report4') {
      const { data, missing } = await assembleReport4(admin, ins.customer_id, inspectionId)
      return { html: renderReport4(data, { highlight: hl }), missing }
    }
    if (reportType === 'exterior') {
      const { data, missing } = await assembleExterior(admin, ins.customer_id, inspectionId)
      return { html: renderExterior(data, { highlight: hl }), missing }
    }
    if (reportType === 'cover') {
      // 미리보기는 서명 URL을 <img src>로 직접 — iframe이 브라우저에서 fetch(S5-7 분기)
      const { data, missing } = await assembleCover(admin, ins.customer_id, inspectionId, { forPreview: true })
      return { html: renderCover(data), missing }
    }
    if (reportType === 'official') {
      const { data, missing } = await assembleOfficial(admin, ins.customer_id, inspectionId)
      return { html: renderOfficial(data), missing }
    }
    if (reportType === 'delegation') {
      const { data, missing } = await assembleDelegation(admin, ins.customer_id, inspectionId)
      return { html: renderDelegation(data), missing }
    }
    const { data, missing } = await assembleAnnex1011(admin, ins.customer_id, inspectionId, reportType)
    const html = reportType === 'report10'
      ? renderReport10(data, { highlight: hl })
      : renderReport11(data, { highlight: hl })
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
  // 22 S5·S7 — 표지·공문도 문서 목록에 잡혀야 재생성·다운로드 동선이 성립한다
  const allowTypes = isSpecial ? ['report4', 'report9', 'report10', 'report11', 'cover', 'official', 'delegation'] : ['exterior']
  // 필터는 lib/generated-docs 한 곳 — 페이지 최초 렌더와 이 갱신이 서로 다른 규칙을 쓰면
  // 문서가 만들면 보였다가 새로고침하면 사라진다(2026-08-20 실측 결함)
  const filePattern = isSpecial ? INSPECTION_DOC_FILE_RE : EXTERIOR_DOC_FILE_RE

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
 *  보고서 센터 ②③ 목록의 인라인 [받기]용(문서 현황 우회, 중복 생성 대신 기생성분 우선).
 *  ⚠ 저장명은 화면과 **같은 규약**(lib/annex-filename)을 쓴다 — 종전엔 여기만 호출부가 넘긴
 *  saveBase+타임스탬프8자를 붙여, 같은 문서인데 경로에 따라 이름이 갈렸다. saveBase는 더 안 쓴다. */
export async function getLatestAnnexUrlAction(
  inspectionId: string, kind: 'report9' | 'report10' | 'report11',
): Promise<{ url?: string; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('customer_id, inspection_type, plan_type, customers:customer_id (customer_name)')
    .eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const ins = insp as unknown as {
    customer_id: string; inspection_type: string | null; plan_type: string | null
    customers: { customer_name: string } | null
  }
  const customerId = ins.customer_id
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
  const saveName = annexDownloadName({
    kind, ext,
    customerName: ins.customers?.customer_name ?? '',
    inspectionType: ins.inspection_type, planType: ins.plan_type,
    createdAt: new Date(Number(bestStamp)).toISOString(),
  })
  const { data, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(`${prefix}/${name}`, 300, { download: saveName })
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
