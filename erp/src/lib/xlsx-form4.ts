/** 별지 4호 1쪽(갑지 `현황` 시트) 설비 설치 체크칸 ↔ 점검결과 칸 **단일 원천**
 *  (소방계획서_27 — 2026-08-25, 좌표·라벨 전수 실측 `scripts/_probe-form4-install.mts`·`_probe-form4-rows.mts`)
 *
 *  ── 무엇이 문제였나 ────────────────────────────────────────────────────────
 *  이 쪽의 점검결과 칸은 서식 자체가 `IF(설치칸="[  ]","/","○")` 수식 **64칸**으로 되어 있었다.
 *  그런데 템플릿의 설치 체크칸은 표본 스크럽(④e) 뒤 전부 `[  ]`라, 어떤 고객이 받아도
 *  **전 설비가 `／`(해당없음)로 인쇄**됐다. 실제로 옥내소화전을 설치한 고객의 법정 서식에
 *  '해당없음'이 찍히는 상태였다.
 *
 *  캐시(`<v>`)만 비우는 것으로는 못 막는다 — LibreOffice가 파일을 여는 순간 **재계산되어
 *  되살아난다**(2026-08-25 실측 `scripts/_probe-xlsx-recalc.mts`). 저장소 여러 곳에 적힌
 *  D-9 공리('LO는 fullCalcOnLoad를 무시하므로 캐시가 곧 인쇄물이다')는 이 부류에 성립하지 않는다.
 *  캐시를 지우는 일과 수식을 없애는 일은 다르고, 이 축은 SheetJS·XML 검사로는 **영원히 안 보인다**.
 *
 *  ── 어떻게 고쳤나 ──────────────────────────────────────────────────────────
 *  ① 설치 여부를 **실값으로 배선**한다 — 아래 표가 서식의 칸과 ERP 설비 코드를 잇고,
 *     런타임 앵커(xlsx-anchors ANCHORS)가 설치된 설비에 `[√]`를 찍는다.
 *  ② 점검결과의 `○`(양호) 자동채움은 **끊는다** — 빌드가 64칸의 `<f>`를 아예 제거하고
 *     (build-workbook-template ④g), 런타임은 **미설치일 때만** `／`(해당없음)를 찍는다.
 *     설치된 설비의 결과칸은 **비운다**: 점검을 했는지, 양호인지는 설치 여부가 말해 줄 수 없다.
 *     설비 대장이 말해 주는 사실(미설치=해당없음)만 찍고 나머지는 사람이 채운다.
 *     → 별지 9호 3쪽 PDF(doc-templates/report9.ts 하위 행 규칙)와 **같은 판단**이다.
 *
 *  ── 배선하지 않은 칸(추측 금지) ────────────────────────────────────────────
 *  FORM4_UNWIRED 참조. ERP에 '설치 여부' 축이 없는 칸들이라 `[  ]`·공란으로 남긴다 —
 *  `／`조차 찍지 않는다(해당없음도 하나의 주장이다). */
import { ALL_STANDARD_CODES, FIRE_SUB_ITEMS, EVAC_FORM3_GROUPS } from '@/lib/facility-codes'

export const FORM4_SHEET = '현황'

export type Form4Row = {
  /** 설치 체크칸 좌표(현황 시트) */
  cell: string
  /** 점검결과 칸 좌표 — 부모 행(소화기구·피난기구)은 서식상 자기 결과칸이 없다(null) */
  verdictCell: string | null
  /** 라벨 검증 축 — 서식이 밀리면 앵커가 먼저 붉어진다 */
  labelCell: string
  label: string
  /** 설비 대장 축(fire_facilities.facility_code). 하나라도 설치면 체크 */
  codes?: string[]
  /** 피난기구 종류 축(세부제원 s36_evac.evac_equipment.types) — 대장이 아니라 이쪽을 보는 행.
   *  서식이 통합 어휘 11종을 체크박스 3칸으로 묶는 것은 별지 9호 3쪽과 **같은 묶음**이다 */
  evacGroup?: number
}

const norm = (s: string) => s.replace(/\s+/g, '')

/** 좌 열(소화·경보설비) — 설치칸 C/D 열, 점검결과 S 열(같은 행) */
const LEFT: Array<[cell: string, verdict: string | null, labelCell: string, label: string, code: string]> = [
  ['C6',  null,  'E6',  '소화기구 및 자동소화장치',            '소화기구 및 자동소화장치'],
  // 소화기구 하위 5종 — 대장에 개별 행으로 저장된다(report9.ts:457 `ledger.has(FIRE_SUB_ITEMS[i])`와 같은 축).
  // 서식 어휘와 대장 어휘가 달라('소화기구(소화기,자확,간이)' vs '소화기(소화기·자동확산·간이)')
  // 정규화 매칭이 성립하지 않는다 — 순서 대응(FIRE_SUB_ITEMS 0~4)을 명시로 박는다
  ['D7',  'S7',  'F7',  '소화기구(소화기,자확,간이)',          FIRE_SUB_ITEMS[0]],
  ['D8',  'S8',  'F8',  '주거용주방자동소화장치',              FIRE_SUB_ITEMS[1]],
  ['D9',  'S9',  'F9',  '상업용주방자동소화장치',              FIRE_SUB_ITEMS[2]],
  ['D10', 'S10', 'F10', '캐비닛형자동소화장치',                FIRE_SUB_ITEMS[3]],
  ['D11', 'S11', 'F11', '가스·분말·고체자동소화장치',          FIRE_SUB_ITEMS[4]],
  ['C12', 'S12', 'E12', '옥내소화전설비',                      '옥내소화전설비'],
  ['C13', 'S13', 'E13', '스프링클러설비',                      '스프링클러설비'],
  ['C14', 'S14', 'E14', '간이스프링클러설비',                  '간이스프링클러설비'],
  ['C15', 'S15', 'E15', '화재조기진압용스프링클러설비',        '화재조기진압용 스프링클러설비'],
  ['C16', 'S16', 'E16', '물분무소화설비',                      '물분무소화설비'],
  ['C17', 'S17', 'E17', '미분무소화설비',                      '미분무소화설비'],
  ['C18', 'S18', 'E18', '포소화설비',                          '포소화설비'],
  ['C19', 'S19', 'E19', '이산화탄소소화설비',                  '이산화탄소소화설비'],
  ['C20', 'S20', 'E20', '할론소화설비',                        '할론소화설비'],
  ['C21', 'S21', 'E21', '할로겐화합물 및 불활성기체 소화설비', '할로겐화합물 및 불활성기체소화설비'],
  ['C22', 'S22', 'E22', '분말소화설비',                        '분말소화설비'],
  ['C23', 'S23', 'E23', '강화액소화설비',                      '강화액소화설비'],
  ['C24', 'S24', 'E24', '고체에어로졸소화설비',                '고체에어로졸소화설비'],
  ['C25', 'S25', 'E25', '옥외소화전설비',                      '옥외소화전설비'],
  ['C26', 'S26', 'E26', '단독경보형감지기',                    '단독경보형감지기'],
  ['C27', 'S27', 'E27', '비상경보설비',                        '비상경보설비'],
  ['C28', 'S28', 'E28', '자동화재탐지설비 및 시각경보기',      '자동화재탐지설비 및 시각경보기'],
  ['C29', 'S29', 'E29', '비상방송설비',                        '비상방송설비'],
  ['C30', 'S30', 'E30', '통합감시시설',                        '통합감시시설'],
  ['C31', 'S31', 'E31', '자동화재속보설비',                    '자동화재속보설비'],
  ['C32', 'S32', 'E32', '누전경보기',                          '누전경보기'],
  ['C33', 'S33', 'E33', '가스누설경보기',                      '가스누설경보기'],
]

/** 우 열(피난구조·소화용수·소화활동설비) — 설치칸 Y/Z 열, 점검결과 AO 열(같은 행) */
const RIGHT: Array<[cell: string, verdict: string | null, labelCell: string, label: string, code: string]> = [
  ['Y6',  null,  'AA6',  '피난기구',            '피난기구'],
  ['Y12', 'AO12', 'AA12', '인명구조기구',       '인명구조기구'],
  ['Y13', 'AO13', 'AA13', '유도등',             '유도등'],
  ['Y14', 'AO14', 'AA14', '유도표지',           '유도표지'],
  ['Y15', 'AO15', 'AA15', '피난유도선',         '피난유도선'],
  ['Y16', 'AO16', 'AA16', '비상조명등',         '비상조명등'],
  ['Y17', 'AO17', 'AA17', '휴대용비상조명등',   '휴대용비상조명등'],
  ['Y18', 'AO18', 'AA18', '상수도소화용수설비', '상수도소화용수설비'],
  ['Y19', 'AO19', 'AA19', '소화수조 및 저수조', '소화수조 및 저수조'],
  ['Y20', 'AO20', 'AA20', '거실제연설비',       '거실제연설비'],
  ['Y21', 'AO21', 'AA21', '부속실 등 제연설비', '부속실 등 제연설비'],
  ['Y22', 'AO22', 'AA22', '연결송수관설비',     '연결송수관설비'],
  ['Y23', 'AO23', 'AA23', '연결살수설비',       '연결살수설비'],
  ['Y24', 'AO24', 'AA24', '비상콘센트설비',     '비상콘센트설비'],
  ['Y25', 'AO25', 'AA25', '무선통신보조설비',   '무선통신보조설비'],
  ['Y26', 'AO26', 'AA26', '연소방지설비',       '연소방지설비'],
]

/** 피난기구 하위 3칸 — 서식 라벨이 두 행에 걸쳐 있어(AB7+AB8 등) 라벨 검증은 첫 행만 쓴다.
 *  묶음은 EVAC_FORM3_GROUPS와 **자구까지 일치**한다(실측):
 *    Z7  AB7 '공기안전매트·피난사다리' + AB8 '(간이)완강기·미끄럼대·구조대'  = 그룹 0(6종)
 *    Z9  AB9 '다수인피난장비'                                                = 그룹 1(1종)
 *    Z10 AB10 '승강식피난기' + AB11 '하향식피난구용내림식사다리'             = 그룹 2(2종) */
const EVAC_ROWS: Array<[cell: string, verdict: string, labelCell: string, label: string, group: number]> = [
  ['Z7',  'AO7',  'AB7',  '공기안전매트·피난사다리', 0],
  ['Z9',  'AO9',  'AB9',  '다수인피난장비',          1],
  ['Z10', 'AO10', 'AB10', '승강식피난기',            2],
]

export const FORM4_ROWS: Form4Row[] = [
  ...LEFT.map(([cell, verdictCell, labelCell, label, code]) => ({ cell, verdictCell, labelCell, label, codes: [code] })),
  ...RIGHT.map(([cell, verdictCell, labelCell, label, code]) => ({ cell, verdictCell, labelCell, label, codes: [code] })),
  ...EVAC_ROWS.map(([cell, verdictCell, labelCell, label, evacGroup]) => ({ cell, verdictCell, labelCell, label, evacGroup })),
]

/** 이 행이 '설치'인가 — 대장 코드 축 또는 피난기구 종류 축.
 *  정규화 비교(공백 제거)는 sheet-facility-map과 같은 규약이다(대장 어휘의 공백 흔들림 흡수). */
export function isForm4Installed(row: Form4Row, installedCodes: string[], evacTypes: string[]): boolean {
  if (row.evacGroup !== undefined) {
    const set = new Set(evacTypes.map(norm))
    return EVAC_FORM3_GROUPS[row.evacGroup].some(t => set.has(norm(t)))
  }
  const set = new Set(installedCodes.map(norm))
  return (row.codes ?? []).some(c => set.has(norm(c)))
}

/** 앵커 field 이름 — 좌표에서 기계적으로 만든다(손으로 짓지 않아 중복·오타가 불가능) */
export const form4InstallField = (row: Form4Row) => `f4i_${row.cell}`
export const form4VerdictField = (row: Form4Row) => `f4v_${row.verdictCell}`

/** 서식에는 점검결과 칸이 있지만 **ERP에 설치 여부 축이 없어 배선하지 않은** 칸(실측 19칸).
 *
 *  ⚠ 배선하지 않는다는 것은 '`／`를 찍는다'가 아니다 — 해당없음도 하나의 주장이라,
 *  근거가 없으면 **비운다**. 빌드가 이 칸들의 수식도 함께 제거하므로 LibreOffice 재계산으로
 *  `／`가 되살아나지 않는다(그전에는 전 고객 문서에 '방화문 해당없음'이 찍히고 있었다).
 *
 *  ① 기타 3칸 — 설치 대장의 항목이 아니다. 별지 9호 3쪽 PDF는 **점검 응답 롤업**(etcMarks)으로
 *     채우는데, 그건 설치 여부가 아니라 점검 결과 축이라 이 작업의 범위 밖이다.
 *  ② 다중이용업소 16칸 — 안전시설등(MU-001~016)은 fire_facilities에 설치 행이 없다.
 *     별지 9호 3쪽 2절 PDF는 muResults(점검 응답 롤업)로 채운다. 같은 이유로 범위 밖. */
export const FORM4_UNWIRED: Array<{ cell: string; verdictCell: string; label: string; why: string }> = [
  { cell: 'Y27', verdictCell: 'AO27', label: '방화문, 방화셔터', why: '기타 — 설치 대장 축 없음(별지9호 etcMarks는 점검 응답 축)' },
  { cell: 'Y28', verdictCell: 'AO28', label: '비상구, 피난통로', why: '기타 — 설치 대장 축 없음' },
  { cell: 'Y29', verdictCell: 'AO29', label: '방  염',           why: '기타 — 설치 대장 축 없음' },
  ...([
    ['C37', 'S37', '소화기 또는 자동확산소화기'], ['Y37', 'AO37', '방화문'],
    ['C38', 'S38', '간이스프링클러설비'], ['Y38', 'AO38', '비상구(비상탈출구)'],
    ['C39', 'S39', '비상경보설비 또는 자동화재탐지설비'], ['Y39', 'AO39', '영업장 내부 피난통로'],
    ['C40', 'S40', '가스누설경보기'], ['Y40', 'AO40', '영상음향차단장치'],
    ['C41', 'S41', '피난기구'], ['Y41', 'AO41', '누전차단기'],
    ['C42', 'S42', '피난유도선'], ['Y42', 'AO42', '창 문'],
    ['C43', 'S43', '유도등, 유도표지 또는 비상조명등'], ['Y43', 'AO43', '피난안내도, 피난안내영상물'],
    ['C44', 'S44', '휴대용비상조명등'], ['Y44', 'AO44', '방염물품'],
  ] as const).map(([cell, verdictCell, label]) => ({
    cell, verdictCell, label, why: '다중이용업소 안전시설등 — fire_facilities에 설치 행이 없다(별지9호 muResults는 점검 응답 축)',
  })),
]

/** 서식에는 있는데 ERP 표준 코드에 대응 칸이 **없는** 설비 — 반대 방향의 공백.
 *  `화재알림설비`는 표준 40종에 있으나 갑지 현황 1쪽에 줄이 없다(실측). 설치해도 이 쪽에는
 *  인쇄되지 않는다 — 별지 9호 3쪽 PDF에는 자기 줄이 있다(FORM3_ITEMS). 서식 갱신 시 재실측 대상. */
export const FORM4_CODES_WITHOUT_ROW: string[] = ALL_STANDARD_CODES.filter(
  c => !FORM4_ROWS.some(r => (r.codes ?? []).some(x => norm(x) === norm(c))),
)

/** 표의 자기 검사 — 코드가 표준 목록(또는 소화기구 하위)에 실재하는가.
 *  오타 하나가 '그 설비는 영원히 미설치'로 조용히 인쇄되는 부류라, 빌드·테스트가 이걸 단언한다. */
export function form4CodeErrors(): string[] {
  const known = new Set([...ALL_STANDARD_CODES, ...FIRE_SUB_ITEMS].map(norm))
  const out: string[] = []
  for (const r of FORM4_ROWS) {
    for (const c of r.codes ?? []) if (!known.has(norm(c))) out.push(`${r.cell}(${r.label}) → 미등록 코드 '${c}'`)
    if (r.evacGroup !== undefined && !EVAC_FORM3_GROUPS[r.evacGroup]) out.push(`${r.cell} → 없는 피난기구 그룹 ${r.evacGroup}`)
  }
  const cells = FORM4_ROWS.map(r => r.cell)
  for (const c of new Set(cells)) if (cells.filter(x => x === c).length > 1) out.push(`설치칸 중복: ${c}`)
  const vs = FORM4_ROWS.map(r => r.verdictCell).filter(Boolean) as string[]
  for (const c of new Set(vs)) if (vs.filter(x => x === c).length > 1) out.push(`점검결과 칸 중복: ${c}`)
  const unwired = new Set(FORM4_UNWIRED.map(u => u.verdictCell))
  for (const c of vs) if (unwired.has(c)) out.push(`배선·미배선 양쪽에 등재: ${c}`)
  return out
}
