import * as XLSX from 'xlsx'

/** 보고서 개요 시트 주입 데이터 (doc02 §3-0 — 개요만 채우면 수식으로 30장 자동완성) */
export type OverviewData = {
  mainInspector: { name: string; license_no: string | null } | null
  auxInspectors: { name: string; license_no: string | null }[]
  year: number
  docDate: string                 // 발신일자·문서번호 = 생성일 (YYYY-MM-DD)
  inspectionDate: string | null
  contact: { name: string; position: string | null; phone: string | null; birth_date: string | null } | null
  fireStation: string | null
  customerName: string
  purpose: string | null          // 대상물 용도
  buildingCount: number
  address: string | null
  totalArea: number | null
  floorsAbove: number | null
  floorsBelow: number | null
  useApprovalDate: string | null
  step5Date: string | null        // 이행조치 필요기간 시작
  step6Date: string | null        // 종료
}

type Cell = { t: 's' | 'n'; v: string | number; z?: string }

function serial(d: string | null): number | null {
  if (!d) return null
  const dt = new Date(d + 'T00:00:00Z')
  if (isNaN(dt.getTime())) return null
  return Math.floor((dt.getTime() - Date.UTC(1899, 11, 30)) / 86400000)
}

/** 개요 셀 값 + 누락 항목 산출 (셀 주소는 실제 갑지 템플릿 기준) */
export function buildOverview(o: OverviewData): { cells: Record<string, Cell>; missing: string[] } {
  const cells: Record<string, Cell> = {}
  const missing: string[] = []
  const S = (a: string, v: string | null | undefined) => { if (v) cells[a] = { t: 's', v } }
  const D = (a: string, v: string | null) => { const s = serial(v); if (s != null) cells[a] = { t: 'n', v: s, z: 'yyyy-mm-dd' } }
  const N = (a: string, v: number | null | undefined) => { if (v != null) cells[a] = { t: 'n', v } }

  // 점검인력 (주된 B1/D1, 보조 B2~B8/D2~D8)
  S('B1', o.mainInspector?.name); S('D1', o.mainInspector?.license_no)
  if (!o.mainInspector?.name) missing.push('주된 점검인력(담당) 미배정')
  else if (!o.mainInspector.license_no) missing.push(`${o.mainInspector.name} 경력수첩번호 없음`)
  o.auxInspectors.slice(0, 7).forEach((a, i) => {
    S(`B${2 + i}`, a.name); S(`D${2 + i}`, a.license_no)
    if (!a.license_no) missing.push(`${a.name} 경력수첩번호 없음`)
  })

  N('B9', o.year)
  D('B10', o.docDate); S('B11', o.docDate.replace(/-/g, ''))  // 발신일자 / 문서번호
  D('B12', o.inspectionDate)

  // 관계인 (D10 이름, D11 직위, D12 연락처, D13 생년월일)
  S('D10', o.contact?.name); S('D11', o.contact?.position); S('D12', o.contact?.phone)
  if (o.contact && !o.contact.position) missing.push('관계인 직위 없음 (위임장)')
  S('D13', o.contact?.birth_date ? o.contact.birth_date.replace(/-/g, '').slice(2) : null)
  if (o.contact && !o.contact.birth_date) missing.push('관계인 생년월일 없음 (위임장)')

  S('B14', o.customerName); S('D14', o.fireStation)
  if (!o.fireStation) missing.push('관할 소방서 없음')
  S('B15', o.purpose); N('D15', o.buildingCount)
  S('B16', o.address); if (!o.address) missing.push('소재지(주소) 없음')
  S('B17', o.contact?.name)                    // 소방안전관리자 = 대표 관계인
  N('D17', o.totalArea); if (o.totalArea == null) missing.push('연면적 없음')
  S('B19', o.contact?.phone)
  D('D19', o.useApprovalDate)
  N('B22', o.floorsAbove); N('B23', o.floorsBelow)
  D('G9', o.step5Date); D('I9', o.step6Date)   // 이행조치 필요기간

  return { cells, missing }
}

/** 템플릿(xlsx ArrayBuffer)의 개요 시트에 값 주입 → xlsx 바이트. 다른 시트 수식은 보존됨. */
export function injectOverview(templateBuf: ArrayBuffer, cells: Record<string, Cell>): Uint8Array {
  const wb = XLSX.read(templateBuf, { type: 'array', cellFormula: true, cellStyles: true })
  const ws = wb.Sheets['개요']
  if (!ws) throw new Error('템플릿에 개요 시트가 없습니다')
  for (const [addr, cell] of Object.entries(cells)) ws[addr] = cell as XLSX.CellObject
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
}

// ── 설비별 점검표면 O/X 주입 (P34-5) ─────────────────────────────────────────
// 각 설비 점검표 시트: A열=item_code(예: 1-A-001), C열=점검결과. 결과 심볼 매핑.
const RESULT_SYMBOL: Record<string, string> = { O: '○', X: 'X', N: '/' }
const ITEM_CODE_RE = /^\s*\d{1,2}-[A-Z]-\d{3}\s*$/   // 1-A-001, 15-B-001, 21-A-001

/**
 * 워크북의 모든 설비 점검표 시트를 훑어, A열 item_code에 해당하는 응답을
 * C열(점검결과)에 ○/X/／로 주입. 개요/현황 등 코드가 없는 시트는 자동 skip.
 * @returns 주입된 셀 수 + 응답은 있으나 시트에서 못 찾은 item_code 목록
 */
export function injectSheetResults(
  wb: XLSX.WorkBook,
  responses: Record<string, 'O' | 'X' | 'N'>,
): { injected: number; unmatched: string[] } {
  const seen = new Set<string>()
  let injected = 0
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) continue
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let r = range.s.r; r <= range.e.r; r++) {
      const aAddr = XLSX.utils.encode_cell({ r, c: 0 })      // A열
      const a = ws[aAddr]
      if (!a || typeof a.v !== 'string' || !ITEM_CODE_RE.test(a.v)) continue
      const code = a.v.trim()
      const res = responses[code]
      if (!res) continue
      const cAddr = XLSX.utils.encode_cell({ r, c: 2 })      // C열 = 점검결과
      ws[cAddr] = { t: 's', v: RESULT_SYMBOL[res] ?? '/' } as XLSX.CellObject
      injected++
      seen.add(code)
    }
  }
  const unmatched = Object.keys(responses).filter(c => !seen.has(c))
  return { injected, unmatched }
}

// ── 소방시설 현황면 주입 (P33-3) ─────────────────────────────────────────────
// facility_code(fire_facilities) → 현황 시트 체크박스 셀. 결과열(S/AO)은
// =IF(체크="[  ]","/","○") 수식이라 체크박스만 넣으면 양호/해당없음 자동 산출.
// 좌측 블록 체크=C/D열, 우측 블록 체크=Y/Z열. (셀 좌표는 실제 갑지 현황 시트 검증값)
const FACILITY_CHECKBOX: Record<string, string[]> = {
  '소화기구': ['D7'],
  '옥내소화전': ['C12'],
  '스프링클러': ['C13'],
  '간이스프링클러': ['C14'],
  '물분무등소화설비': ['C16'],
  '옥외소화전': ['C25'],
  '자동화재탐지설비': ['C28'],
  '비상경보설비': ['C27'],
  '비상방송설비': ['C29'],
  '자동화재속보설비': ['C31'],
  '가스누설경보기': ['C33'],
  '피난기구': ['Z7'],
  '인명구조기구': ['Y12'],
  '유도등·유도표지': ['Y13'],
  '비상조명등': ['Y16'],
  '상수도소화용수설비': ['Y18'],
  '소화수조·저수조': ['Y19'],
  '제연설비': ['Y20'],
  '연결송수관설비': ['Y22'],
  '연결살수설비': ['Y23'],
  '비상콘센트설비': ['Y24'],
  '무선통신보조설비': ['Y25'],
}
const CHECKED = '[√]', UNCHECKED = '[  ]'

/**
 * 현황 시트의 설비 체크박스를 fire_facilities 설치여부로 주입 (P33-3).
 * 매핑된 모든 셀을 우선 [  ]로 초기화 후, 설치된 설비만 [√]로 표시.
 * @returns 체크된 설비 수 + 매핑에 없는 설치 설비 코드
 */
export function injectFacilityStatus(
  wb: XLSX.WorkBook,
  installedCodes: string[],
): { checked: number; unmapped: string[] } {
  const ws = wb.Sheets['현황']
  if (!ws) return { checked: 0, unmapped: installedCodes }
  const installed = new Set(installedCodes)
  // 매핑된 모든 체크박스 초기화
  for (const cells of Object.values(FACILITY_CHECKBOX))
    for (const addr of cells) ws[addr] = { t: 's', v: UNCHECKED } as XLSX.CellObject
  let checked = 0
  for (const code of installed) {
    const cells = FACILITY_CHECKBOX[code]
    if (!cells) continue
    for (const addr of cells) ws[addr] = { t: 's', v: CHECKED } as XLSX.CellObject
    checked++
  }
  const unmapped = installedCodes.filter(c => !FACILITY_CHECKBOX[c])
  return { checked, unmapped }
}

// ── 다수동 처리 (P32-7) ──────────────────────────────────────────────────────
// '다수동일때' 시트: 동별 블록(10행 간격, 최대 3동). 건축물구조·지붕구조는 체크박스 문자열.
export type BuildingInfo = {
  total_area: number | null; building_area: number | null
  floors_above: number | null; floors_below: number | null
  height_m: number | null; unit_count: number | null
  structure: string | null; roof: string | null
}
const STRUCTURE_OPTS = ['콘크리트구조', '철골구조', '조적조', '목구조']
const ROOF_OPTS = ['슬라브', '기와', '슬레이트', '기타']
const checkboxLine = (opts: string[], sel: string | null, trailingComma = false) =>
  ' ' + opts.map(o => `[${o === sel ? '√' : '  '}]${o}`).join(', ') + (trailingComma ? ', ' : '')

/**
 * '다수동일때' 시트에 동별 건축물 정보 주입 (P32-7). 최대 3동(시트 블록 수).
 * @returns 주입된 동 수 + 초과로 누락된 동 수
 */
export function injectMultiBuilding(
  wb: XLSX.WorkBook,
  buildings: BuildingInfo[],
): { injected: number; overflow: number } {
  const ws = wb.Sheets['다수동일때']
  if (!ws) return { injected: 0, overflow: buildings.length }
  const S = (a: string, v: string | number | null | undefined) => { if (v !== null && v !== undefined && v !== '') ws[a] = { t: typeof v === 'number' ? 'n' : 's', v } as XLSX.CellObject }
  const MAX = 3
  buildings.slice(0, MAX).forEach((b, i) => {
    const base = 4 + i * 10
    S(`B${base}`, b.total_area)                 // 연면적
    S(`E${base}`, b.building_area)              // 건축면적
    S(`J${base}`, b.unit_count)                 // 세대수
    S(`C${base + 1}`, b.floors_above)           // 지상 층수
    S(`E${base + 1}`, b.floors_below)           // 지하 층수
    S(`H${base + 1}`, b.height_m)               // 높이
    ws[`B${base + 2}`] = { t: 's', v: checkboxLine(STRUCTURE_OPTS, b.structure, true) } as XLSX.CellObject   // 건축물구조
    ws[`B${base + 3}`] = { t: 's', v: checkboxLine(ROOF_OPTS, b.roof) } as XLSX.CellObject                   // 지붕구조
  })
  return { injected: Math.min(buildings.length, MAX), overflow: Math.max(0, buildings.length - MAX) }
}

// ── 완료보고서 이행조치 주입 (P34-4) ─────────────────────────────────────────
export type CompletionInfo = { actionContent: string | null; completedDate: string | null }

/** '완료보고서' 시트에 이행조치 내용(B20)·완료일(I20) 주입 */
export function injectCompletionReport(wb: XLSX.WorkBook, c: CompletionInfo): boolean {
  const ws = wb.Sheets['완료보고서']
  if (!ws) return false
  if (c.actionContent) ws['B20'] = { t: 's', v: c.actionContent } as XLSX.CellObject
  const s = serial(c.completedDate)
  if (s != null) ws['I20'] = { t: 'n', v: s, z: 'yyyy-mm-dd' } as XLSX.CellObject
  return true
}

/** 개요 허브 + 설비별 점검표면 + 현황면을 한 워크북에 함께 주입 → xlsx 바이트 (P32-3 + P34-5 + P33-3) */
export function injectReport(
  templateBuf: ArrayBuffer,
  cells: Record<string, Cell>,
  responses: Record<string, 'O' | 'X' | 'N'>,
  installedFacilities: string[] = [],
  buildings: BuildingInfo[] = [],
  completion?: CompletionInfo,
): {
  bytes: Uint8Array
  sheetResult: { injected: number; unmatched: string[] }
  facilityResult: { checked: number; unmapped: string[] }
  buildingResult: { injected: number; overflow: number }
} {
  const wb = XLSX.read(templateBuf, { type: 'array', cellFormula: true, cellStyles: true })
  const ov = wb.Sheets['개요']
  if (!ov) throw new Error('템플릿에 개요 시트가 없습니다')
  for (const [addr, cell] of Object.entries(cells)) ov[addr] = cell as XLSX.CellObject
  const sheetResult = injectSheetResults(wb, responses)
  const facilityResult = injectFacilityStatus(wb, installedFacilities)
  // 다수동(2동 이상)일 때만 '다수동일때' 시트 주입
  const buildingResult = buildings.length > 1 ? injectMultiBuilding(wb, buildings) : { injected: 0, overflow: 0 }
  if (completion) injectCompletionReport(wb, completion)
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
  return { bytes, sheetResult, facilityResult, buildingResult }
}
