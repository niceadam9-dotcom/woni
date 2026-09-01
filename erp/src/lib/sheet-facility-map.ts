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
  '스프링클러설비': ['스프링클러설비'],
  '화재조기진압용 스프링클러설비': ['화재조기진압용 스프링클러설비'],
  '간이스프링클러설비': ['간이스프링클러설비'],
  '이산화탄소소화설비': ['이산화탄소소화설비'],
  '할로겐화합물 및 불활성기체소화설비': ['할로겐화합물 및 불활성기체소화설비'],
  '할론소화설비': ['할론소화설비'],
  // ── 148 편입 7종(소방계획서_26 F-1) — 고시 별지4에 독립 점검표가 있는데 시딩에서 빠져 있던 시트들.
  //    '제연설비'는 고시 24번 제목 축자이고 ERP 어휘로는 거실제연설비다(부속실 제연은 25번 별도).
  //    조기진압(5)·할론(10)은 150에서 전용 시트로 분리(F-1f) — 과거 응답 귀속은 LEGACY_ROLLUP_MAP.
  '물분무소화설비': ['물분무소화설비'],
  '미분무소화설비': ['미분무소화설비'],
  '포소화설비': ['포소화설비'],
  '분말소화설비': ['분말소화설비'],
  '누전경보기': ['누전경보기'],
  '제연설비': ['거실제연설비'],
  '연소방지설비': ['연소방지설비'],
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

  // ── 외관점검표(별지 6호) EXT-01~14 (2026-08-26) ────────────────────────────
  // 이 파일 상단 규약대로 **카탈로그가 고정이면 명시 매핑**인데 EXT만 퍼지 폴백에 남아 있었다.
  // 퍼지(공백 제거 양방향 includes)는 시트명이 설비 어휘의 부분문자열일 때만 맞는데, 외관 시트명은
  // 그 형태가 아니다 — '옥내·외 소화전 설비'엔 '옥내소화전설비'가 통째로 없고, '(간이)스프링클러설비'는
  // 괄호가 끼어 있고, '이산화탄소'엔 '소화설비' 접미가 없다. 실측 6/8 미매칭이었다.
  //
  // ⚠ 이 맵은 인쇄 롤업(form3ItemsForSheet)만 쓰는 게 아니다. sheetMatchesFacilities가
  //    **입력 화면 노출**(sheet-overview.ts:247 installed → [설치 설비만 보기])과
  //    **'영구 공란' 경고**(:275-276 uncoveredFacilityCodes)도 결정한다. 그래서 안 걸리면
  //    설비를 설치했는데도 그 외관 시트가 화면에서 사라져 **입력할 길이 없어진다**.
  //    (인쇄 쪽은 지금 안 닿는다 — EXT 응답은 plan_type=event 전용이고 별지 9호는 isSpecial 전용이라
  //     report9-actions.ts:435-441이 배타 분할한다. 그 가드가 바뀌면 여기로 흘러든다.)
  //
  // 값은 **시트명이 실제로 이름을 부른 설비만** 넣는다. 부르지 않은 설비를 끼워 넣으면 설비 대장에
  // 없는 판정을 만들어내는 셈이라, 형제 고지·공란 경고가 조용히 틀어진다.
  // EXT-01 '소화기구 및 자동소화장치'는 STD-01과 이름이 같아 위 키가 이미 덮는다(중복 등재 금지).
  '옥내·외 소화전 설비': ['옥내소화전설비', '옥외소화전설비'],
  '(간이)스프링클러설비, 물분무소화설비, 미분무소화설비, 포소화설비':
    ['스프링클러설비', '간이스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비'],
  '이산화탄소, 할론소화설비, 할로겐화합물 및 불활성기체소화설비, 분말소화설비':
    ['이산화탄소소화설비', '할론소화설비', '할로겐화합물 및 불활성기체소화설비', '분말소화설비'],
  // 단독경보형감지기는 시트 제목엔 없지만 본문 X5-04가 "감지기의 변형 또는 손상이 있는지 여부
  // **(단독경보형감지기 포함)**"로 명시한다(exterior.ts:79) — 제목만 보고 빼면 이 설비만 설치한
  // 대상물에서 EXT-05가 통째로 숨는다(실측: 행복마을아파트).
  '자동화재탐지설비, 비상경보설비, 시각경보기, 비상방송설비, 자동화재속보설비':
    ['자동화재탐지설비 및 시각경보기', '비상경보설비', '단독경보형감지기', '비상방송설비', '자동화재속보설비'],
  '피난기구, 유도등(유도표지), 비상조명등 및 휴대용비상조명등':
    ['피난기구', '유도등', '유도표지', '비상조명등', '휴대용비상조명등'],
  '제연설비, 특별피난계단의 계단실 및 부속실 제연설비': ['거실제연설비', '부속실 등 제연설비'],
  '연결송수관설비, 연결살수설비': ['연결송수관설비', '연결살수설비'],
  '비상콘센트설비, 무선통신보조설비, 지하구': ['비상콘센트설비', '무선통신보조설비'],
  // EXT-10~14는 **설비 대장 축이 아니다**(기타사항·위험물·화기·가스·전기 시설) — 덮는 설비가 없다는
  // 사실 자체를 빈 배열로 못박는다. 퍼지에 남겨두면 나중에 설비 어휘가 늘 때 우연히 걸릴 수 있다.
  // 결과는 종전과 동일(0개)이라 화면·인쇄 어디도 변하지 않는다.
  // ※ STD-31(기타사항)은 ALWAYS_SHOWN_SHEET_CODES로 상시 노출된다 — EXT-10을 같이 넣을지는
  //   업무 판단이라 손대지 않았다(넣으면 외관 회차에 기타사항 시트가 상시 뜬다).
  '기타사항 점검표': [],
  '위험물 저장·취급시설': [],
  '화기시설': [],
  '가연성 가스시설': [],
  '전기시설': [],
}

/** F-1f 이중 귀속(2026-08-22, 마이그레이션 150과 짝) — 과거 회차가 묶음 시트에 남긴 응답의
 *  **귀속만** 유지하는 레거시 간선. 150이 전용 시트(STD-05 조기진압·STD-10 할론)를 신설하면서
 *  신규 입력·시트 노출·[전체 양호]·인쇄 대상 선정(sheetMatchesFacilities)은 전용 시트로 갔다.
 *  그러나 기존 회차의 응답은 묶음 시트에 있고(실측: 스테이징 서림사 2026 완료 회차 27건),
 *  재귀속(이관)은 문항이 1:1이 아니라 위험하다 — 옮기지 않고 간선으로 남긴다.
 *
 *  방향이 갈리는 이유: 롤업(form3ItemsForSheet)과 형제 고지(facilitiesForSheet)는 이 간선을
 *  **합쳐서** 본다 — 묶음 시트의 응답이 종전대로 조기진압·할론 결과칸에 귀속되고(무퇴행),
 *  화면은 그 사실을 숨기지 않는다(D-5). 선택(sheetMatchesFacilities)에서만 빠진다 —
 *  신규 입력 경로가 전용 시트로 수렴하도록. 여기서 빼면 과거 회차 결과칸이 공란으로 퇴행한다. */
export const LEGACY_ROLLUP_MAP: Record<string, string[]> = {
  '스프링클러설비': ['화재조기진압용 스프링클러설비'],
  '할로겐화합물 및 불활성기체소화설비': ['할론소화설비'],
}

/** 시트 하나가 FORM3 항목 **여럿**을 덮을 때, 그 응답이 어느 항목의 것인지 가르는 축
 *  (2026-09-01 — 실사고: 서림사 작동 회차에서 유도등·유도표지를 전부 ／로 입력했는데 갑지 「현황」과
 *  별지 9호 3쪽에 **○**가 찍혔다. 같은 시트의 피난유도선 5문항이 ○였고, 롤업이 시트 단위라
 *  그 ○가 형제 항목 칸까지 칠한 것이다 — 사람이 입력한 값과 **반대 방향**의 판정이 법정 문서에 나갔다).
 *
 *  값은 지어낸 게 아니라 DB에 이미 있는 중분류(마이그레이션 134 `group_code`/`group_name`)다.
 *  아래 6시트는 중분류 이름이 FORM3 항목과 **자구까지 1:1**임을 실측으로 확인했다
 *  (`scripts/_probe-multiitem-sheets.mjs`, 2026-09-01 스테이징):
 *    21-A "유도등" · 21-B "유도표지" · 21-C "피난유도선" / 22-A "비상조명등" · 22-B "휴대용비상조명등" …
 *  코드(21-A)를 키로 삼는다 — 이름은 서식 개정으로 흔들리지만 코드는 item_code 접두라 파생이 결정적이다.
 *
 *  ⚠ STD-15(자동화재탐지설비 및 시각경보장치)는 **일부러 뺐다**. 이 시트의 중분류는 설비축이 아니라
 *    구성요소축(수신기·감지기·배선…)이고, 함께 덮는 '화재알림설비'에는 대응하는 중분류가 아예 없다.
 *    억지로 이으면 감지기 응답이 화재알림설비로 가는, 지금보다 나쁜 거짓이 된다(추측 금지).
 *  ⚠ EXT 시트도 뺐다 — 중분류가 facility_type이라 어휘 축이 다르고, 인쇄 경로에 닿지 않는다.
 *
 *  등재하지 않은 시트는 종전대로 **시트 단위 전개**다(form3ItemsForSheetGroup 폴백). */
export const SHEET_GROUP_FORM3_MAP: Record<string, Record<string, string>> = {
  '비상경보설비 및 단독경보형감지기': { '14-A': '비상경보설비', '14-B': '단독경보형감지기' },
  '자동화재속보설비 및 통합감시시설': { '17-A': '자동화재속보설비', '17-B': '통합감시시설' },
  // 20-A~D는 전부 피난기구(공통사항·매트/사다리·다수인·승강식) — 인명구조기구만 20-E로 갈린다
  '피난기구 및 인명구조기구': {
    '20-A': '피난기구', '20-B': '피난기구', '20-C': '피난기구', '20-D': '피난기구',
    '20-E': '인명구조기구',
  },
  '유도등 및 유도표지': { '21-A': '유도등', '21-B': '유도표지', '21-C': '피난유도선' },
  '비상조명등 및 휴대용비상조명등': { '22-A': '비상조명등', '22-B': '휴대용비상조명등' },
  '소화용수설비': { '23-A': '소화수조 및 저수조', '23-B': '상수도소화용수설비' },
}

const norm = (s: string) => s.replace(/\s+/g, '')
const MAP_BY_NORM = new Map(Object.entries(SHEET_FACILITY_MAP).map(([k, v]) => [norm(k), v.map(norm)]))
const GROUP_BY_NORM = new Map(Object.entries(SHEET_GROUP_FORM3_MAP).map(([k, v]) => [norm(k), v]))
const LEGACY_BY_NORM = new Map(Object.entries(LEGACY_ROLLUP_MAP).map(([k, v]) => [norm(k), v.map(norm)]))
/** 정규화 시트명 → 매핑 + 레거시 간선 합산(귀속·고지용). 레거시 키는 전부 본 매핑에 있는 시트다. */
const withLegacy = (sn: string, mapped: string[]): string[] => {
  const extra = LEGACY_BY_NORM.get(sn)
  return extra ? [...mapped, ...extra] : mapped
}

/** 시트가 설치 시설 목록과 매칭되는가 — 명시 매핑 우선, 미등재 시트는 퍼지 폴백.
 *  ⚠ 레거시 간선은 여기 없다(F-1f) — 노출·[전체 양호]·인쇄 대상 선정은 전용 시트만 잡아야
 *  신규 입력이 전용 시트로 간다. 응답이 이미 있는 묶음 시트는 responded>0 규칙이 계속 보여준다. */
export function sheetMatchesFacilities(sheetName: string, facilityCodes: string[]): boolean {
  const sn = norm(sheetName)
  const codes = facilityCodes.map(norm)
  const mapped = MAP_BY_NORM.get(sn)
  if (mapped) return mapped.some(f => codes.includes(f))
  return codes.some(c => c.includes(sn) || sn.includes(c))
}

/** 시트명 → 커버하는 설비 코드 목록 (역방향, 소방계획서_8 H-5e·D-17 교차 검증 칩 · S4-5 형제 고지) —
 *  후보(candidates) 중 이 시트가 다루는 설비만 반환. 명시 매핑 우선, 미등재 시트는 퍼지 폴백.
 *  레거시 간선 포함 — 이 시트에 쓰면 조기진압·할론 배지도 바뀐다는 사실을 숨기지 않는다(D-5). */
export function facilitiesForSheet(sheetName: string, candidates: string[]): string[] {
  const sn = norm(sheetName)
  const mapped = MAP_BY_NORM.get(sn)
  if (mapped) { const all = withLegacy(sn, mapped); return candidates.filter(c => all.includes(norm(c))) }
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
 *  미등재 시트(EXT 등)는 종전과 같이 퍼지 폴백 — 카탈로그 밖 시트를 떨어뜨리지 않기 위해서다.
 *  레거시 간선 포함(F-1f) — 묶음 시트에 남은 과거 응답이 조기진압·할론 결과칸에 계속 귀속된다. */
export function form3ItemsForSheet(sheetName: string, form3Items: string[]): string[] {
  const sn = norm(sheetName)
  const mapped = MAP_BY_NORM.get(sn)
  if (mapped) { const all = withLegacy(sn, mapped); return form3Items.filter(i => all.includes(norm(i))) }
  return form3Items.filter(i => { const inm = norm(i); return inm.includes(sn) || sn.includes(inm) })
}

/** 시트 + **중분류**(group_code) → FORM3 항목 — 롤업이 실제로 쓰는 축(2026-09-01).
 *
 *  `form3ItemsForSheet`가 시트가 덮는 항목 **전부**를 주는 것과 다르다. 한 시트가 항목 여럿을 덮을 때
 *  그 응답은 셋 다의 것이 아니라 **중분류 하나의 것**이고, 그 사실을 버리면 ／로 입력한 칸에 ○가 찍힌다.
 *
 *  폴백은 종전 동작(시트 전개)이다 — 다음 중 하나라도 해당하면:
 *    · 중분류를 모르는 호출부(group=null)      · 시트가 덮는 항목이 애초에 1개
 *    · 등재되지 않은 시트·중분류(STD-15·EXT)   · 매핑된 항목이 이 시트의 커버 목록에 없음(어휘 어긋남)
 *  즉 **모르면 종전대로**다. 좁히는 건 실측으로 확인한 자리에서만. */
export function form3ItemsForSheetGroup(
  sheetName: string,
  group: string | null,
  form3Items: string[],
): string[] {
  const all = form3ItemsForSheet(sheetName, form3Items)
  if (!group || all.length < 2) return all
  const target = GROUP_BY_NORM.get(norm(sheetName))?.[group]
  if (!target) return all
  const hit = all.filter(i => norm(i) === norm(target))
  return hit.length > 0 ? hit : all
}

/** SHEET_GROUP_FORM3_MAP 자기 검사 — 오타 하나가 '그 중분류는 영원히 폴백'으로 조용히 묻힌다.
 *  폴백이 종전 동작이라 **아무도 모른 채** 실사고가 되살아나는 부류다(test-form3-axis가 단언). */
export function sheetGroupMapErrors(form3Items: string[]): string[] {
  const out: string[] = []
  for (const [sheet, groups] of Object.entries(SHEET_GROUP_FORM3_MAP)) {
    const covered = form3ItemsForSheet(sheet, form3Items)
    if (!MAP_BY_NORM.has(norm(sheet))) out.push(`'${sheet}' → SHEET_FACILITY_MAP에 없는 시트`)
    if (covered.length < 2) out.push(`'${sheet}' → FORM3 항목을 ${covered.length}개만 덮는다(좁힐 게 없다)`)
    const seen = new Set<string>()
    for (const [code, item] of Object.entries(groups)) {
      if (!covered.some(c => norm(c) === norm(item))) out.push(`'${sheet}' ${code} → '${item}'은 이 시트가 덮는 항목이 아니다`)
      seen.add(norm(item))
    }
    for (const c of covered) if (!seen.has(norm(c))) out.push(`'${sheet}' → '${c}'를 가리키는 중분류가 없다(그 칸은 늘 폴백)`)
  }
  return out
}

/** 설치 설비 코드 ↔ FORM3 항목 — 정규화 정확 매칭.
 *  퍼지였을 때 '스프링클러설비' 설치가 '간이스프링클러설비'·'화재조기진압용스프링클러설비'까지,
 *  '비상조명등'이 '휴대용비상조명등'까지 켜던 오검을 없앤다(표준 40종 중 5종에서 판정이 달라진다). */
export function form3ItemMatchesFacility(form3Item: string, facilityCode: string): boolean {
  return norm(form3Item) === norm(facilityCode)
}

/** 시트별 점검 응답 통계 — 시트명 → 그 시트에 무엇이 들어왔는가.
 *
 *  ⚠ `o`는 선택 필드가 아니다(소방계획서_26 S1). 종전 `{any, x}` 두 축으로는 '응답은 있는데 전부 ／'를
 *  표현할 수 없었고, any=true·x=false가 곧 ○로 해석돼 **해당없음이 양호로 인쇄**됐다
 *  (재현: scripts/_probe-na-only-becomes-good.mts — [／ 전체] 버튼 하나로 만들 수 있는 상태였다).
 *  필수로 두는 이유: 구성 지점이 여럿이라(별지 조립·1.4 배지·프로브) 하나만 빠뜨리면 문서와 화면이
 *  갈린다. src/ 쪽 누락은 컴파일러가 잡고, scripts/는 tsconfig exclude라 프로브 갱신은 수동이다. */
export type SheetStat = {
  /** 응답이 하나라도 있는가 — ／(N)도 응답이다. 무응답(공란)과 구별하는 축 */
  any: boolean
  /** ✕(불량)가 있는가 */
  x: boolean
  /** ○(양호)가 있는가. any && !x && !o = 전부 해당없음 → ／ */
  o: boolean
}

/** 응답 1건을 시트 통계에 접는다 — 구성 로직을 한 곳에 두어 o 누락 재발을 막는다. */
export function foldSheetResult(cur: SheetStat | undefined, result: string): SheetStat {
  return {
    any: true,
    x: (cur?.x ?? false) || result === 'X',
    o: (cur?.o ?? false) || result === 'O',
  }
}

/** 롤업 입력 1건 — **(시트, 중분류)** 단위 통계. 종전엔 시트 단위 `[시트명, SheetStat]` 튜플이었다.
 *
 *  타입을 바꾼 것이 요점이다(2026-09-01). 중분류를 **선택 인자**로 얹었으면 안 넘기는 호출부가
 *  조용히 옛 동작으로 남았을 것이다 — 이 저장소에서 이미 두 번 당한 부류라(부분 업데이트 F-27),
 *  컴파일러가 전 호출부를 세우도록 필수 필드로 만든다.
 *  중분류를 모르는 호출부는 `group: null`을 **명시**한다 — 모른다는 사실이 코드에 남는다. */
export type SheetGroupStat = { sheet: string; group: string | null; stat: SheetStat }

/** 응답 목록 → 롤업 입력 — 접기를 한 곳에 둔다(구성 지점이 별지 조립·1.4 배지·대장 배지 셋이라
 *  한 곳만 놓치면 문서와 화면이 갈린다. o 축 누락이 정확히 그렇게 났다 — 소방계획서_26 S1). */
export function foldSheetGroupStats(
  rows: Array<{ sheet: string; group: string | null; result: string }>,
): SheetGroupStat[] {
  // 키는 **중첩 Map**이다 — 두 값을 문자열로 이어 붙이지 않는다. 구분자를 쓰면 시트명에 그 글자가
  // 섞였을 때 조용히 뭉개지고, 안전해 보이는 제어문자(\0)를 쓰면 이 파일이 **바이너리로 분류돼
  // Grep이 통째로 못 읽는다**(실측 2026-09-01 — 도구가 침묵하면 다음 세션이 코드를 못 찾는다).
  const acc = new Map<string, Map<string, SheetGroupStat>>()
  for (const r of rows) {
    if (!r.sheet) continue
    let byGroup = acc.get(r.sheet)
    if (!byGroup) { byGroup = new Map(); acc.set(r.sheet, byGroup) }
    const gk = r.group ?? ''
    byGroup.set(gk, { sheet: r.sheet, group: r.group, stat: foldSheetResult(byGroup.get(gk)?.stat, r.result) })
  }
  return [...acc.values()].flatMap(m => [...m.values()])
}

/** 시트 단위 통계를 롤업 입력으로 — **검사·프로브 전용**(2026-09-01).
 *
 *  🚫 제품 코드에서 쓰지 말 것. 중분류를 잃으므로 한 점검표가 설비 여럿을 덮을 때 형제 칸까지
 *     같은 마크가 칠해진다(유도등 사고 그 자체). 제품 경로는 `foldSheetGroupStats`로 중분류까지 접는다.
 *  검사 쪽에는 남겨 둔다 — '시트 단위로 접으면 어떻게 되는가'가 그 사고의 **대조군**이라
 *  표현할 수단이 있어야 한다. `scripts/test-form3-axis.mts`가 src/ 유입을 감시한다. */
export function legacySheetOnlyStats(
  sheetStat: Map<string, SheetStat> | Array<[string, SheetStat]>,
): SheetGroupStat[] {
  return [...sheetStat].map(([sheet, stat]) => ({ sheet, group: null, stat }))
}

/** 두 축(설치 √ / 점검결과 ○×) 어긋남 — 인쇄 전 경고(missing)용. 어느 쪽도 조용히 넘기지 않는다. */
export type Form3AxisWarnings = {
  /** 설치된 형제 항목이 있는 시트의 응답이 **미설치 항목까지 번지던** 것 — 이제 ／로 인쇄된다.
   *  (예: '자동화재탐지설비 및 시각경보장치' 시트 하나에 응답 → 미설치 화재알림설비까지 ○였다) */
  spillSuppressed: string[]
  /** 미설치인데 그 항목을 겨눈 응답이 있다 — 대장 누락 의심. 결과는 **지우지 않는다**(실점검일 수 있다). */
  respondedNotInstalled: string[]
}

/** 별지9호 3쪽 롤업 — (시트, 중분류) 통계 + 설치 설비 → FORM3 항목별 설치 체크·점검결과 마크.
 *
 *  ── 귀속의 축(2026-09-01 — 시트에서 중분류로) ────────────────────────────────
 *  종전엔 통계가 **시트 단위**라, 한 시트가 FORM3 항목 2~3개를 덮으면 그 시트의 ○/×가 형제 칸까지
 *  똑같이 칠해졌다. 서림사 실사고: 유도등(21-A 4문항)·유도표지(21-B 4문항)를 전부 ／로 입력했는데
 *  피난유도선(21-C)의 ○ 때문에 세 칸 모두 ○로 인쇄됐다 — **사람이 넣은 값의 반대**가 법정 문서에 나갔다.
 *  이제 SHEET_GROUP_FORM3_MAP에 등재된 6시트는 중분류로 갈라 귀속한다(그 밖은 종전 그대로).
 *
 *  assembleReport9(서버 액션 파일이라 외부에서 호출 불가)에서 순수 로직만 뽑아낸 것.
 *  T-3 프로브가 DB 없이 실제 코드를 검증할 수 있고, T-2a(세부제원 패널 점검 결과 배지)가
 *  같은 함수를 재사용해 문서와 화면이 어긋나지 않는다.
 *
 *  규약(소방계획서_26 S1에서 3축화): ✕ 있으면 × → ○ 있으면 ○ → 응답이 전부 ／면 ／ →
 *  무응답+미설치 ／ → 무응답+설치 공란(키 없음). 종전엔 '전부 ／'를 표현할 수 없어 ○로 인쇄됐다.
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
  entries: SheetGroupStat[],
  form3Items: string[],
  installedCodes: string[],
): { facilityChecks: string[]; resultMarks: Record<string, 'O' | 'X' | 'N'>; axisWarnings: Form3AxisWarnings } {
  const facilityChecks = form3Items.filter(it => installedCodes.some(c => form3ItemMatchesFacility(it, c)))
  const installed = new Set(facilityChecks)
  const statByItem = new Map<string, SheetStat>()
  const touched = new Set<string>()      // 응답 있는 시트가 덮는 항목 전체(종전 규칙이 마크를 찍던 범위)
  for (const { sheet: sheetName, group, stat: st } of entries) {
    if (!st.any) continue
    // ⭐ 축이 한 칸 내려왔다(2026-09-01) — 시트가 아니라 **중분류**가 덮는 항목만.
    //    등재 밖이면 종전대로 시트 전개다(form3ItemsForSheetGroup 폴백).
    const items = form3ItemsForSheetGroup(sheetName, group, form3Items)
    for (const it of items) touched.add(it)
    const installedHere = items.filter(it => installed.has(it))
    // 설치된 형제가 있으면 응답은 그쪽 것 — 나머지로 번지지 않는다. 전부 미설치면 종전대로 전개.
    for (const it of installedHere.length > 0 ? installedHere : items) {
      const cur = statByItem.get(it) ?? { any: false, x: false, o: false }
      statByItem.set(it, { any: cur.any || st.any, x: cur.x || st.x, o: cur.o || st.o })
    }
  }
  const resultMarks: Record<string, 'O' | 'X' | 'N'> = {}
  for (const it of form3Items) {
    const st = statByItem.get(it)
    // 순서가 규약이다: 불량 하나면 × → 양호 하나면 ○ → 응답은 있는데 전부 ／면 ／ → 무응답은 미설치일 때만 ／.
    // 세 번째 줄이 소방계획서_26 S1에서 생겼다 — 그전엔 '전부 ／'가 ○로 인쇄돼 해당없음이 양호로 둔갑했다.
    if (st?.x) resultMarks[it] = 'X'
    else if (st?.o) resultMarks[it] = 'O'
    else if (st?.any) resultMarks[it] = 'N'
    else if (!installed.has(it)) resultMarks[it] = 'N'
  }
  // 대장 누락 의심은 **실제 점검 흔적(○·×)이 있을 때만**이다. 전부 ／인 시트는 그 설비를 점검했다는
  // 근거가 아니라 '해당 없다'는 진술이라, 대장에 설치를 넣으라고 권할 이유가 없다.
  const axisWarnings: Form3AxisWarnings = {
    spillSuppressed: [...touched].filter(it => !installed.has(it) && !statByItem.has(it)),
    respondedNotInstalled: [...statByItem]
      .filter(([it, st]) => !installed.has(it) && (st.o || st.x)).map(([it]) => it),
  }
  return { facilityChecks, resultMarks, axisWarnings }
}

/** 부모 1행 + 하위 n행의 **점검결과 배분** — 별지 9호 3쪽 = 별지 4호 1쪽 = 갑지 엑셀 `현황` 공용(D-7).
 *
 *  소화기구·피난기구는 서식에서 부모 아래 하위 줄을 갖는데, ERP의 점검 결과(resultMarks)는
 *  **부모(FORM3 항목) 단위**로만 존재한다. 그 한 값을 어느 줄에 내릴지가 이 함수다.
 *
 *  규칙(값을 지어내지 않는다 — 22 Q-8 '자동 기록 금지'):
 *    · 미설치 하위        → 'N'(해당없음). 설비 대장이 말해 주는 사실이다.
 *    · 설치된 하위        → 부모 롤업을 **첫 설치 행 하나에만** 내린다. 지금 부모에 찍히는 값이
 *                          곧 그 시트의 점검 결과이므로 새로 만든 값이 아니다.
 *                          나머지 설치 행은 undefined(공란) — 무응답 = 공란(B-6 규약).
 *    · 설치된 하위가 없으면 → 롤업을 부모 행에 그대로 둔다(옮길 자리가 없다고 결과를 버리지 않는다).
 *
 *  ⚠ 렌더러가 두 벌이다 — HTML 템플릿(doc-templates/report9.ts subRows)과 엑셀 주입
 *    (xlsx-form4.ts form4VerdictMarks). 이 규칙을 어느 한쪽에 복제하면 한쪽만 고쳐져
 *    **같은 점검 건의 PDF와 엑셀이 조용히 갈라진다**(D-7). 그래서 규칙은 여기 한 곳이다. */
export function distributeSubMarks(
  parentMark: 'O' | 'X' | 'N' | undefined,
  subsInstalled: boolean[],
): { parent: 'O' | 'X' | 'N' | undefined; subs: Array<'O' | 'X' | 'N' | undefined> } {
  const first = subsInstalled.findIndex(Boolean)
  return {
    parent: first < 0 ? parentMark : undefined,
    subs: subsInstalled.map((on, i) => (on ? (i === first ? parentMark : undefined) : 'N')),
  }
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
// EXT-10~14(기타사항·위험물·화기·가스·전기)도 같은 부류다 — 설비 대장 축이 없어 installed가 늘
// false라 [설치 설비만 보기]에서 숨는데, `renderExterior`는 EXTERIOR_SECTIONS 14개를 **조건 없이
// 전부** 인쇄한다(exterior.ts:313-320, "원본 서식과 동일한 16쪽"). 그래서 STD-31과 똑같이
// '인쇄는 항상 되는데 채울 화면이 없는' 상태였다. 5개를 함께 넣지 않으면 같은 버그가 4개 남는다.
export const ALWAYS_SHOWN_SHEET_CODES: string[] = [
  'STD-31', 'EXT-10', 'EXT-11', 'EXT-12', 'EXT-13', 'EXT-14',
]

/** '설치 설비만' 켠 상태에서 이 시트를 보여줄 것인가.
 *  이미 입력이 있는 시트는 절대 숨기지 않는다 — 화면에서 사라지면 유령 입력이 된다. */
export function sheetShownWhenInstalledOnly(
  s: { sheetCode: string; installed: boolean; responded: number },
): boolean {
  return s.installed || s.responded > 0 || ALWAYS_SHOWN_SHEET_CODES.includes(s.sheetCode)
}
