/** 점검표 시트 ↔ 설치 시설(fire_facilities.facility_code) 매칭 (§9-4 빠른 입력 · 별지 9호 조립 공용)
 *  ※ 종전 V-1 음성 점검표 누락 감지도 이 함수를 썼으나 소방계획서_21 R3에서 음성 경로를 제거했다.
 *
 *  실전 검증(2026-07-25, 별그리다)에서 퍼지 매칭(공백 제거 양방향 includes)의 두 결함 확인:
 *  - 오검: '스프링클러설비' 설치 → '간이스프링클러설비' 시트까지 매칭(이름 포함 관계)
 *  - 누락: 시설 어휘 '…시각경보기' ↔ 시트 어휘 '…시각경보장치' 불일치로 자탐 시트 탈락
 *  시트 카탈로그(v2025 STD)는 고정이므로 명시 매핑으로 판정한다. 미등재 시트(EXT 등)는 종전 퍼지 폴백. */

export const SHEET_FACILITY_MAP: Record<string, string[]> = {
  '소화기구 및 자동소화장치': ['소화기구 및 자동소화장치'],
  '옥내소화전설비': ['옥내소화전설비'],
  '스프링클러설비': ['스프링클러설비', '화재조기진압용 스프링클러설비'],
  '간이스프링클러설비': ['간이스프링클러설비'],
  '이산화탄소소화설비': ['이산화탄소소화설비'],
  '할로겐화합물 및 불활성기체소화설비': ['할로겐화합물 및 불활성기체소화설비', '할론소화설비'],
  '옥외소화전설비': ['옥외소화전설비'],
  '비상경보설비 및 단독경보형감지기': ['비상경보설비', '단독경보형감지기'],
  '자동화재탐지설비 및 시각경보장치': ['자동화재탐지설비 및 시각경보기', '화재알림설비'],
  '비상방송설비': ['비상방송설비'],
  '자동화재속보설비 및 통합감시시설': ['자동화재속보설비', '통합감시시설'],
  '가스누설경보기': ['가스누설경보기'],
  '피난기구 및 인명구조기구': ['피난기구', '인명구조기구'],
  '유도등 및 유도표지': ['유도등', '유도표지', '피난유도선'],
  '비상조명등 및 휴대용비상조명등': ['비상조명등', '휴대용비상조명등'],
  '소화용수설비': ['상수도소화용수설비', '소화수조 및 저수조'],
  '특별피난계단의 계단실 및 부속실 제연설비': ['부속실 등 제연설비'],
  '연결송수관설비': ['연결송수관설비'],
  '연결살수설비': ['연결살수설비'],
  '비상콘센트설비': ['비상콘센트설비'],
  '무선통신보조설비': ['무선통신보조설비'],
}

const norm = (s: string) => s.replace(/\s+/g, '')
const MAP_BY_NORM = new Map(Object.entries(SHEET_FACILITY_MAP).map(([k, v]) => [norm(k), v.map(norm)]))

/** 시트가 설치 시설 목록과 매칭되는가 — 명시 매핑 우선, 미등재 시트는 퍼지 폴백 */
export function sheetMatchesFacilities(sheetName: string, facilityCodes: string[]): boolean {
  const sn = norm(sheetName)
  const codes = facilityCodes.map(norm)
  const mapped = MAP_BY_NORM.get(sn)
  if (mapped) return mapped.some(f => codes.includes(f))
  return codes.some(c => c.includes(sn) || sn.includes(c))
}

/** 시트명 → 커버하는 설비 코드 목록 (역방향, 소방계획서_8 H-5e·D-17 교차 검증 칩) —
 *  후보(candidates) 중 이 시트가 다루는 설비만 반환. 명시 매핑 우선, 미등재 시트는 퍼지 폴백. */
export function facilitiesForSheet(sheetName: string, candidates: string[]): string[] {
  const sn = norm(sheetName)
  const mapped = MAP_BY_NORM.get(sn)
  if (mapped) return candidates.filter(c => mapped.includes(norm(c)))
  return candidates.filter(c => { const cn = norm(c); return cn.includes(sn) || sn.includes(cn) })
}

/** 시트명 → 별지9호 3쪽 FORM3 항목명 목록 (소방계획서_14_점검업무 T-3).
 *
 *  별도 매핑 표를 새로 쓰지 않고 SHEET_FACILITY_MAP을 그대로 쓴다 — 이 맵의 **값이 이미 FORM3 어휘**다
 *  (FACILITY_STANDARD 42종과 FORM3_ITEMS 40종은 정규화하면 같은 어휘. `_probe-form3-map.mjs`가 매 실행마다 단언).
 *  표를 두 벌 두면 한쪽만 고쳐져 다시 어긋나므로 단일 원천을 유지한다.
 *
 *  종전에는 assembleReport9가 자체 퍼지(nameMatch: 공백 제거 양방향 includes)로 시트↔FORM3를 이었고,
 *  그 결과 이 파일 상단 주석의 두 결함(오검·누락)이 **문서 생성 경로에만** 남아 있었다.
 *  미등재 시트(EXT 등)는 종전과 같이 퍼지 폴백 — 카탈로그 밖 시트를 떨어뜨리지 않기 위해서다. */
export function form3ItemsForSheet(sheetName: string, form3Items: string[]): string[] {
  const sn = norm(sheetName)
  const mapped = MAP_BY_NORM.get(sn)
  if (mapped) return form3Items.filter(i => mapped.includes(norm(i)))
  return form3Items.filter(i => { const inm = norm(i); return inm.includes(sn) || sn.includes(inm) })
}

/** 설치 설비 코드 ↔ FORM3 항목 — 정규화 정확 매칭.
 *  퍼지였을 때 '스프링클러설비' 설치가 '간이스프링클러설비'·'화재조기진압용스프링클러설비'까지,
 *  '비상조명등'이 '휴대용비상조명등'까지 켜던 오검을 없앤다(표준 40종 중 5종에서 판정이 달라진다). */
export function form3ItemMatchesFacility(form3Item: string, facilityCode: string): boolean {
  return norm(form3Item) === norm(facilityCode)
}

/** 시트별 점검 응답 통계 — 시트명 → { any: 응답 있음, x: 불량 있음 } */
export type SheetStat = { any: boolean; x: boolean }

/** 두 축(설치 √ / 점검결과 ○×) 어긋남 — 인쇄 전 경고(missing)용. 어느 쪽도 조용히 넘기지 않는다. */
export type Form3AxisWarnings = {
  /** 설치된 형제 항목이 있는 시트의 응답이 **미설치 항목까지 번지던** 것 — 이제 ／로 인쇄된다.
   *  (예: '자동화재탐지설비 및 시각경보장치' 시트 하나에 응답 → 미설치 화재알림설비까지 ○였다) */
  spillSuppressed: string[]
  /** 미설치인데 그 항목을 겨눈 응답이 있다 — 대장 누락 의심. 결과는 **지우지 않는다**(실점검일 수 있다). */
  respondedNotInstalled: string[]
}

/** 별지9호 3쪽 롤업 — 시트 통계 + 설치 설비 → FORM3 항목별 설치 체크·점검결과 마크.
 *
 *  assembleReport9(서버 액션 파일이라 외부에서 호출 불가)에서 순수 로직만 뽑아낸 것.
 *  T-3 프로브가 DB 없이 실제 코드를 검증할 수 있고, T-2a(세부제원 패널 점검 결과 배지)가
 *  같은 함수를 재사용해 문서와 화면이 어긋나지 않는다.
 *
 *  규약: 응답 있으면 X 유무로 ○/×, 응답이 없고 미설치면 해당없음 ／, 응답도 설치도 없으면 공란(키 없음).
 *  한 시트가 FORM3 여러 항목을 덮을 수 있어(예: '소화용수설비' → 상수도·소화수조) 항목별로 합산한다.
 *
 *  ── 귀속 규칙(2026-08-21) ────────────────────────────────────────────────
 *  종전엔 시트에 응답이 있으면 **그 시트가 덮는 항목 전부**에 ○를 찍었다. 설치 여부를 보지 않아
 *  '설치도 안 한 설비를 점검해 양호'라는, 서식상 성립하지 않는 칸이 인쇄됐다(2026-08-20 사용자 지적:
 *  체크 없는 화재조기진압용·할론·화재알림설비에 ○). 실측 7건에서 12칸.
 *
 *  그렇다고 '미설치면 무조건 ／'로 덮으면 반대쪽이 깨진다 — 대장에 체크를 빠뜨렸을 뿐 **실제로 점검한**
 *  결과까지 해당없음으로 지워지고, 그건 법정 문서에 다른 방향의 거짓을 찍는 일이다.
 *
 *  두 원인은 구분할 수 있다. 시트의 응답은 **그 시트가 덮는 설치 항목의 것**이다:
 *    · 설치된 형제가 하나라도 있으면 → 응답은 그 형제 것. 미설치 항목으로 번지지 않는다(→ ／)
 *    · 형제가 전부 미설치면 → 그 응답을 귀속시킬 데가 없다. 대장 누락일 가능성이 크므로
 *      **결과를 지우지 않고** 종전대로 ○/×를 두되 경고로 표면화한다(대장을 고치는 건 사람 몫)
 *  판정은 항목별이 아니라 시트별로 한 번 하고, 그 결과를 항목에 나눠 준다. */
export function rollUpForm3Results(
  sheetStat: Map<string, SheetStat> | Array<[string, SheetStat]>,
  form3Items: string[],
  installedCodes: string[],
): { facilityChecks: string[]; resultMarks: Record<string, 'O' | 'X' | 'N'>; axisWarnings: Form3AxisWarnings } {
  const facilityChecks = form3Items.filter(it => installedCodes.some(c => form3ItemMatchesFacility(it, c)))
  const installed = new Set(facilityChecks)
  const statByItem = new Map<string, SheetStat>()
  const touched = new Set<string>()      // 응답 있는 시트가 덮는 항목 전체(종전 규칙이 마크를 찍던 범위)
  for (const [sheetName, st] of sheetStat) {
    if (!st.any) continue
    const items = form3ItemsForSheet(sheetName, form3Items)
    for (const it of items) touched.add(it)
    const installedHere = items.filter(it => installed.has(it))
    // 설치된 형제가 있으면 응답은 그쪽 것 — 나머지로 번지지 않는다. 전부 미설치면 종전대로 전개.
    for (const it of installedHere.length > 0 ? installedHere : items) {
      const cur = statByItem.get(it) ?? { any: false, x: false }
      statByItem.set(it, { any: cur.any || st.any, x: cur.x || st.x })
    }
  }
  const resultMarks: Record<string, 'O' | 'X' | 'N'> = {}
  for (const it of form3Items) {
    const st = statByItem.get(it)
    if (st?.any) resultMarks[it] = st.x ? 'X' : 'O'
    else if (!installed.has(it)) resultMarks[it] = 'N'
  }
  const axisWarnings: Form3AxisWarnings = {
    spillSuppressed: [...touched].filter(it => !installed.has(it) && !statByItem.has(it)),
    respondedNotInstalled: [...statByItem.keys()].filter(it => !installed.has(it)),
  }
  return { facilityChecks, resultMarks, axisWarnings }
}

// ── '설치 설비만' 필터의 단일 규칙 (2026-08-20) ──────────────────────────────
//
// 종전엔 같은 규칙이 네 곳에 복사돼 있었다: 점검표 보드·스텝 링크·별지 트리·인쇄 번들.
// 그래서 STD-31(기타사항) 예외가 **인쇄에만** 들어갔다 — 인쇄는 항상 대상으로 잡으면서
// 입력 화면은 숨겨, 별지 9호 3쪽 '기타' 3칸(방화문·비상구·방염)이 채워질 길이 없었다
// (실측 2026-08-20: STD-31 응답 스테이징 전체 0건). 별지 트리는 한술 더 떠 responded 조건마저
// 빠져 있어 이미 입력한 시트도 숨겼다. 규칙을 여기 한 곳에 둔다.

/** 설비 축에 매이지 않는 상시 시트 — 설비가 아니라 모든 대상물 공통이라 설치 여부로 거르면 안 된다.
 *  STD-32(다중이용업소)는 여기 넣지 않는다: 그쪽은 sheet-overview가 multiUse일 때만 installed로 쳐서
 *  '해당 대상물만' 노출한다(비대상에까지 띄우면 안 되는 시트다). */
export const ALWAYS_SHOWN_SHEET_CODES: string[] = ['STD-31']

/** '설치 설비만' 켠 상태에서 이 시트를 보여줄 것인가.
 *  이미 입력이 있는 시트는 절대 숨기지 않는다 — 화면에서 사라지면 유령 입력이 된다. */
export function sheetShownWhenInstalledOnly(
  s: { sheetCode: string; installed: boolean; responded: number },
): boolean {
  return s.installed || s.responded > 0 || ALWAYS_SHOWN_SHEET_CODES.includes(s.sheetCode)
}
