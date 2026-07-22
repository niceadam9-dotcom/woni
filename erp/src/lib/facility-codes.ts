/** 소방시설 표준 코드 — 서식 1.4 정식 명칭 42종 (소방계획서_4.md §4-3, 2026-07-23 표준화)
 *
 *  단일 기준: 이 상수를 시설현황 UI(facilities-client)·웹 PDF(fire-plan-template FACILITY_FORM)·
 *  HWP 병합(build_stage2)·별지 9호 3쪽·점검 보고서(report-generator)가 공유한다.
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

/** 피난기구 하위 8종 (서식 1.4 — 피난기구 체크 시 세부 선택, fire_facilities에 개별 행으로 저장) */
export const EVAC_SUB_ITEMS: string[] = [
  '공기안전매트', '피난사다리', '(간이)완강기', '미끄럼대', '구조대', '다수인피난장비',
  '승강식피난기', '하향식피난구용내림식사다리',
]

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
