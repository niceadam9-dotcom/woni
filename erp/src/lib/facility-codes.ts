/** 소방시설 표준 코드 — 서식 1.4 정식 명칭 42종 (소방계획서_4.md §4-3, 2026-07-23 표준화)
 *
 *  단일 기준: 이 상수를 시설현황 UI(facilities-client)·웹 PDF(fire-plan-template FACILITY_FORM)·
 *  HWP 병합(build_stage2)·별지 9호 3쪽이 공유한다.
 *  (점검 보고서 엑셀 주입기 report-generator는 소방계획서_21 R5-6으로 폐지 — 별지 4호 PDF가 대체)
 *  DB(fire_facilities.facility_code)는 마이그레이션 100에서 축약 22종 → 이 표준 코드로 이관됨.
 *  피난기구 하위 8종(공기안전매트 등)은 1.4 양식 재현 화면(P4-②b)에서 detail로 추가 예정. */

export const FACILITY_STANDARD: Array<{ category: string; items: string[] }> = [
  { category: '소화설비', items: [
    '소화기구 및 자동소화장치', '옥내소화전설비', '옥외소화전설비', '스프링클러설비', '간이스프링클러설비',
    '화재조기진압용 스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비', '이산화탄소소화설비',
    '할론소화설비', '할로겐화합물 및 불활성기체소화설비', '분말소화설비', '강화액소화설비', '고체에어로졸소화설비',
  ] },
  { category: '경보설비', items: [
    '단독경보형감지기', '비상경보설비', '자동화재탐지설비 및 시각경보기', '화재알림설비', '비상방송설비',
    '통합감시시설', '자동화재속보설비', '누전경보기', '가스누설경보기',
  ] },
  { category: '피난구조설비', items: [
    '피난기구', '인명구조기구', '유도등', '유도표지', '피난유도선', '비상조명등', '휴대용비상조명등',
  ] },
  { category: '소화용수설비', items: ['상수도소화용수설비', '소화수조 및 저수조'] },
  { category: '소화활동설비', items: [
    '거실제연설비', '부속실 등 제연설비', '연결송수관설비', '연결살수설비', '비상콘센트설비',
    '무선통신보조설비', '연소방지설비',
  ] },
]

export const ALL_STANDARD_CODES: string[] = FACILITY_STANDARD.flatMap(g => g.items)

/** 서식 1.4 「기타」 — **소방시설이 아닌** 점검 대상. 법이 범주를 달리 둔다:
 *  피난·방화시설(방화문·비상구)과 방염은 소방시설 42종이 아니고, 위험물·화기·가스·전기는
 *  설비가 아니라 대상물이 가진 시설이다. 고시 별지 4호도 이것들을 「기타」로 따로 뒀다.
 *  → **FACILITY_STANDARD·ALL_STANDARD_CODES에 절대 섞지 않는다.** 별지 9호 3쪽·4호 1쪽의
 *     42칸 배선(FORM3_ITEMS·rollUpForm3Results)이 그 42종 축이고, 여기 코드는 그 축과 무관하다
 *     (form3ItemMatchesFacility는 정규화 완전일치라 새 코드가 42칸에 새지 않는다 — 실측 고정).
 *
 *  왜 대장에 두는가: 이 항목들을 덮는 점검표는 있는데(STD-31·EXT-10~14) **설비 축이 없어
 *  installed가 영원히 false**였다. 그래서 인쇄는 늘 되면서 소방계획서_39의 필수 입력 강제
 *  (● 배지·미입력 카운터·이탈 확인창·완료 보류·문서 미비 고지)를 통째로 비켜갔고, 무응답이
 *  조용히 ／로 찍혀 **안 채워도 완성돼 보였다**(실측 2026-09-03: 31-* 응답 스테이징 1행·운영 0행).
 *  여기 체크가 `sheet-facility-map`을 통해 그 점검표의 installed가 되므로, 체크하는 순간
 *  39의 강제가 **그대로** 붙는다. 미체크 대상물은 종전과 완전히 같다(점진 적용).
 *
 *  체크의 뜻은 '이 대상물에 해당한다'이고, 점검 **결과**(○/×/／)는 점검표에서 받는다 — 두 축이다. */
export const ETC_ITEMS: Array<{ code: string; sheetName: string; note: string }> = [
  { code: '방화문 및 방화셔터', sheetName: '기타사항', note: '자체점검 「기타사항」 / 외관점검 「기타사항 점검표」' },
  { code: '비상구 및 피난통로', sheetName: '기타사항', note: '자체점검 「기타사항」 / 외관점검 「기타사항 점검표」' },
  { code: '방염', sheetName: '기타사항', note: '자체점검 「기타사항」 / 외관점검 「기타사항 점검표」' },
  { code: '위험물 저장·취급시설', sheetName: '위험물 저장·취급시설', note: '외관점검 「위험물 저장·취급시설」' },
  { code: '화기시설', sheetName: '화기시설', note: '외관점검 「화기시설」' },
  { code: '가연성 가스시설', sheetName: '가연성 가스시설', note: '외관점검 「가연성 가스시설」' },
  { code: '전기시설', sheetName: '전기시설', note: '외관점검 「전기시설」' },
]

export const ETC_CATEGORY = '기타'
export const ETC_CODES: string[] = ETC_ITEMS.map(i => i.code)

/** 피난기구 종류 — **통합 어휘 11종** (2026-08-08 단일화).
 *
 *  종전에는 같은 정보를 두 곳에서 서로 다른 어휘로 받았다:
 *    ① 1.4 대장 하위 체크 8종(fire_facilities 개별 행) — **어느 문서에도 인쇄되지 않았다**
 *       (fire-plan-generate가 표준 42종만 남기고 필터, 별지 9호 3쪽은 ck(false) 하드코딩)
 *    ② 세부제원 s36_evac.evac_equipment.types 10종 — 별지 9호·4호 4~7쪽에 실제 인쇄
 *  그래서 **인쇄되는 ②를 단일 저장소로 삼고**, 한쪽에만 있던 항목을 합쳐 11종으로 통일했다
 *  (①에만 있던 하향식피난구용내림식사다리 + ②에만 있던 피난교·피난용트랩).
 *  1.4 대장의 하위 체크박스는 이 값을 읽고 쓰는 또 하나의 창구다 — fire_facilities에 하위 행을 만들지 않는다. */
export const EVAC_TYPES: string[] = [
  '피난사다리', '완강기', '간이완강기', '구조대', '공기안전매트', '미끄럼대',
  '다수인피난장비', '승강식피난기', '하향식피난구용내림식사다리', '피난교', '피난용트랩',
]

/** 별지 9호 3쪽 원문은 위 11종을 **체크박스 3칸**으로 묶는다 (report9.ts facilityResultSection).
 *  피난교·피난용트랩은 3쪽 원문에 칸이 없어 어느 그룹에도 넣지 않는다(4~7쪽 세부현황에만 인쇄). */
export const EVAC_FORM3_GROUPS: string[][] = [
  ['공기안전매트', '피난사다리', '완강기', '간이완강기', '미끄럼대', '구조대'],
  ['다수인피난장비'],
  ['승강식피난기', '하향식피난구용내림식사다리'],
]

/** 세부제원(customer_facility_specs) → 피난기구 종류 목록 — **단일 원천**.
 *  종전엔 이 경로 파고들기가 report9.ts에만 인라인으로 있었다. 갑지 워크북(별지 4호 1쪽)이
 *  같은 값을 필요로 하면서 두 벌이 될 뻔했고, 저장 경로가 바뀌면 한쪽만 조용히 빈 배열을
 *  받는 부류다(그러면 그 문서에서만 피난기구가 전부 미설치로 인쇄된다). 한 곳에서 가져다 쓴다. */
export function evacTypesFromSpecs(specs: Record<string, unknown> | undefined | null): string[] {
  const s36 = (specs?.['s36_evac'] ?? undefined) as Record<string, unknown> | undefined
  const eq = (s36?.['evac_equipment'] ?? undefined) as Record<string, unknown> | undefined
  const types = eq?.['types'] as unknown
  return Array.isArray(types) ? types.filter((t): t is string => typeof t === 'string') : []
}

/** 레거시 — 통일 이전에 fire_facilities에 개별 행으로 쌓이던 피난기구 하위 코드.
 *  신규 저장 경로는 없다. 기존 행 이관(scripts/migrate-evac-subitems.mjs)과 잔존 행 무시 판정에만 쓴다. */
export const EVAC_SUB_ITEMS_LEGACY: string[] = [
  '공기안전매트', '피난사다리', '(간이)완강기', '미끄럼대', '구조대', '다수인피난장비',
  '승강식피난기', '하향식피난구용내림식사다리',
]

/** 레거시 하위 코드 → 통합 어휘. '(간이)완강기' 한 칸이 완강기·간이완강기 두 종을 겸했다. */
export const EVAC_LEGACY_TO_TYPES: Record<string, string[]> = {
  '공기안전매트': ['공기안전매트'],
  '피난사다리': ['피난사다리'],
  '(간이)완강기': ['완강기', '간이완강기'],
  '미끄럼대': ['미끄럼대'],
  '구조대': ['구조대'],
  '다수인피난장비': ['다수인피난장비'],
  '승강식피난기': ['승강식피난기'],
  '하향식피난구용내림식사다리': ['하향식피난구용내림식사다리'],
}

/** 소화기구 하위 5종 (별지 서식 3쪽 원문 — 소화기구 및 자동소화장치 체크 시 세부 선택,
 *  피난기구 하위와 동일 패턴으로 fire_facilities 개별 행 저장. 2026-08-04 image-34 서식 반영) */
export const FIRE_SUB_ITEMS: string[] = [
  '소화기(소화기·자동확산·간이)', '주거용주방자동소화장치', '상업용주방자동소화장치',
  '캐비닛형자동소화장치', '가스·분말·고체자동소화장치',
]

/** 점검표 대괄호 소제목(별지 4호 원문 축자, 134 subgroup_name) ↔ 대장 하위 코드(FIRE_SUB_ITEMS).
 *  두 어휘가 다르다 — 공백 유무만이 아니라 '가스·분말·고체에어로졸'(원문) vs '가스·분말·고체'(대장)처럼
 *  낱말 자체가 달라 정규화 매칭이 안 된다. 명시 매핑만 쓴다(소방계획서_23 S7-26 대장 힌트 배너).
 *  판정 주체는 사람 — 이 맵은 힌트 표시에만 쓰고 자동 기록에 쓰지 않는다(22 Q-8). */
export const FIRE_SUB_BY_SUBGROUP: Record<string, string> = {
  '주거용 주방 자동소화장치': '주거용주방자동소화장치',
  '상업용 주방 자동소화장치': '상업용주방자동소화장치',
  '캐비닛형 자동소화장치': '캐비닛형자동소화장치',
  '가스·분말·고체에어로졸 자동소화장치': '가스·분말·고체자동소화장치',
}

/** 축약 22종 → 표준 코드 매핑 (§4-3 표 — 마이그레이션 100과 동일 기준)
 *  1:N 이관(물분무등→물분무, 제연→거실제연)은 대표 코드로 옮기고 재확인 노트를 남긴다.
 *  유도등·유도표지는 1:2 분리(둘 다 체크). */
export const LEGACY_TO_STANDARD: Record<string, string[]> = {
  '소화기구': ['소화기구 및 자동소화장치'],
  '옥내소화전': ['옥내소화전설비'],
  '옥외소화전': ['옥외소화전설비'],
  '스프링클러': ['스프링클러설비'],
  '간이스프링클러': ['간이스프링클러설비'],
  '물분무등소화설비': ['물분무소화설비'],
  '자동화재탐지설비': ['자동화재탐지설비 및 시각경보기'],
  '유도등·유도표지': ['유도등', '유도표지'],
  '소화수조·저수조': ['소화수조 및 저수조'],
  '제연설비': ['거실제연설비'],
}

/** 임의 코드(레거시 포함)를 표준 코드 배열로 정규화 — 표준이면 그대로, 레거시면 매핑, 모르면 원본 유지 */
export function toStandardCodes(codes: string[]): string[] {
  const out = new Set<string>()
  for (const c of codes) {
    if (ALL_STANDARD_CODES.includes(c)) out.add(c)
    else for (const s of LEGACY_TO_STANDARD[c] ?? [c]) out.add(s)
  }
  return [...out]
}
