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

/** 개요 허브 + 설비별 점검표면 + 현황면을 한 워크북에 함께 주입 → xlsx 바이트 (P32-3 + P34-5 + P33-3) */
export function injectReport(
  templateBuf: ArrayBuffer,
  cells: Record<string, Cell>,
  responses: Record<string, 'O' | 'X' | 'N'>,
  installedFacilities: string[] = [],
): {
  bytes: Uint8Array
  sheetResult: { injected: number; unmatched: string[] }
  facilityResult: { checked: number; unmapped: string[] }
} {
  const wb = XLSX.read(templateBuf, { type: 'array', cellFormula: true, cellStyles: true })
  const ov = wb.Sheets['개요']
  if (!ov) throw new Error('템플릿에 개요 시트가 없습니다')
  for (const [addr, cell] of Object.entries(cells)) ov[addr] = cell as XLSX.CellObject
  const sheetResult = injectSheetResults(wb, responses)
  const facilityResult = injectFacilityStatus(wb, installedFacilities)
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
  return { bytes, sheetResult, facilityResult }
}
