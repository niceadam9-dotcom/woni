/** 갑지 워크북 동봉 설비별 점검표 — 기증 시트 단일 원천 (소방계획서_27 Phase 5 / S10)
 *
 *  기증 원본은 `전체 보고서.xls`(43시트, 미커밋 실물 자산 — 커밋 금지)이고, 빌드 스크립트
 *  (scripts/build-workbook-full.mts)가 갑지 템플릿에 이식해 templates/report-workbook-full.xlsx를
 *  만든다. 런타임은 **제거만** 한다: 고객 미설치 설비의 시트를 빼고 목차를 다시 쓴다.
 *
 *  경계(Q-1, 2026-08-21 사용자 확정): 이것은 R5-6/D-9가 폐지한 '엑셀을 별지 4호의 원천으로 쓰는'
 *  생성기가 아니라, 경복빌딩 실물처럼 결과보고서 묶음에 점검표 시트를 **동봉**하는 것이다.
 *  원천은 여전히 DB·별지 4호이고, 이 시트들은 담당자가 손으로 고쳐 쓰는 백지 양식이다(결과 주입은
 *  Phase 4와 같은 축이라 S10-3에서 재견적).
 *
 *  matchKey는 점검표 카탈로그(v2025 STD)와 같은 고시 어휘라 sheetMatchesFacilities를 그대로 쓴다 —
 *  '스프링클러설비' 설치가 조기진압·간이까지 켜지 않는 명시 매핑이 공짜로 따라온다.
 *
 *  실측(2026-08-22, _probe-donor-sheets · _probe-donor-styles · _probe-donor-scrub):
 *  - 기증 시트는 원천 고객의 **작성 완료본** — 결과 마크(○·／·X) 약 700칸은 빌드가 전수 스크럽한다.
 *    단 시트당 정확히 1곳 있는 세로 3연속(○→/→X)은 **범례**(양식의 일부)라 보존한다.
 *  - 조건부서식·그림·하이퍼링크·수식 0 · 원본 여백 전부 보유 · 변환본 definedNames 0건
 *    (→ 시트 제거가 localSheetId를 흔들지 않는다).
 *  - 원본 목차에는 CO2(고시 9) 항목이 없다 — tocLabel을 합성해 보완한다(verifyToc: false). */

export type DonorGroup = {
  /** sheetMatchesFacilities에 넣는 키 — 고시 점검표 제목(= SHEET_FACILITY_MAP 어휘) */
  matchKey: string
  /** 고시 별지 4호 서식 번호 — 시트 제목 'n. …'의 n (실측) */
  gosiNo: number
  /** 전체 보고서.xls의 시트명들 (면 순서) */
  sheets: string[]
  /** 목차 표기 — 원본 '목 차' 시트의 행 문자열. verifyToc=false면 합성본 */
  tocLabel: string
  /** 원본 목차에 이 행이 실재하는가 — 빌드가 tocLabel과 대조한다 */
  verifyToc: boolean
  /** facility: 설치 설비 매칭 · always: 상시 동봉(STD-31 축) · multiUse: 다중이용업소만(STD-32 축) */
  kind: 'facility' | 'always' | 'multiUse'
}

/** 목차 시트명 — 고시 번호 체계 쪽('목 차'). 일련번호 재부여본('목차')·빈 시트('Sheet1')는 이식하지 않는다 */
export const DONOR_TOC_SHEET = '목 차'

export const DONOR_GROUPS: DonorGroup[] = [
  { matchKey: '소화기구 및 자동소화장치', gosiNo: 1, sheets: ['소'], kind: 'facility',
    tocLabel: '1.  소화기구 및 자동소화장치 점검표', verifyToc: true },
  { matchKey: '옥내소화전설비', gosiNo: 2, sheets: ['옥1', '옥2', '옥3'], kind: 'facility',
    tocLabel: '2.  옥내소화전설비 점검표', verifyToc: true },
  { matchKey: '스프링클러설비', gosiNo: 3, sheets: ['스1', '스2', '스3', '스4'], kind: 'facility',
    tocLabel: '3.  스프링클러소화설비 점검표', verifyToc: true },
  { matchKey: '간이스프링클러설비', gosiNo: 4, sheets: ['간1', '간2', '간3', '간4'], kind: 'facility',
    tocLabel: '4.  간이스프링클러소화설비 점검표', verifyToc: true },
  // 원본 목차에 없던 행 — 시트(CO2-1~4)는 실재하므로 목차를 보완한다
  { matchKey: '이산화탄소소화설비', gosiNo: 9, sheets: ['CO2-1', 'CO2-2', 'CO2-3', 'CO2-4'], kind: 'facility',
    tocLabel: '9.  이산화탄소소화설비 점검표', verifyToc: false },
  { matchKey: '할로겐화합물 및 불활성기체소화설비', gosiNo: 11, sheets: ['할1', '할2', '할3'], kind: 'facility',
    tocLabel: '11. 할로겐화합물 및 불활성기체소화설비 점검표', verifyToc: true },
  { matchKey: '옥외소화전설비', gosiNo: 13, sheets: ['옥외1', '옥외2', '옥외3'], kind: 'facility',
    tocLabel: '13. 옥외소화전설비 점검표', verifyToc: true },
  { matchKey: '비상경보설비 및 단독경보형감지기', gosiNo: 14, sheets: ['비상경보'], kind: 'facility',
    tocLabel: '14. 비상경보설비 및 단독경보형감지기 점검표', verifyToc: true },
  { matchKey: '자동화재탐지설비 및 시각경보장치', gosiNo: 15, sheets: ['자탐1', '자탐2'], kind: 'facility',
    tocLabel: '15. 자동화재탐지설비 및 시각경보장치 점검표', verifyToc: true },
  { matchKey: '비상방송설비', gosiNo: 16, sheets: ['방송'], kind: 'facility',
    tocLabel: '16. 비상방송설비 점검표', verifyToc: true },
  { matchKey: '자동화재속보설비 및 통합감시시설', gosiNo: 17, sheets: ['속보'], kind: 'facility',
    tocLabel: '17. 자동화재속보설비 및 통합감시시설 점검표', verifyToc: true },
  { matchKey: '가스누설경보기', gosiNo: 19, sheets: ['가누'], kind: 'facility',
    tocLabel: '19. 가스누설경보기 점검표', verifyToc: true },
  { matchKey: '피난기구 및 인명구조기구', gosiNo: 20, sheets: ['피난기구'], kind: 'facility',
    tocLabel: '20. 피난기구 및 인명구조기구 점검표', verifyToc: true },
  { matchKey: '유도등 및 유도표지', gosiNo: 21, sheets: ['유도등'], kind: 'facility',
    tocLabel: '21. 유도등 및 유도표지 점검표', verifyToc: true },
  { matchKey: '비상조명등 및 휴대용비상조명등', gosiNo: 22, sheets: ['비조'], kind: 'facility',
    tocLabel: '22. 비상조명등 및 휴대용비상조명등 점검표', verifyToc: true },
  { matchKey: '소화용수설비', gosiNo: 23, sheets: ['소화용수'], kind: 'facility',
    tocLabel: '23. 소화용수설비 점검표', verifyToc: true },
  { matchKey: '특별피난계단의 계단실 및 부속실 제연설비', gosiNo: 25, sheets: ['특피'], kind: 'facility',
    tocLabel: '25. 특별피난계단의 계단실 및 부속실 제연설비 점검표', verifyToc: true },
  { matchKey: '연결송수관설비', gosiNo: 26, sheets: ['연결송수관'], kind: 'facility',
    tocLabel: '26. 연결송수관설비 점검표', verifyToc: true },
  { matchKey: '연결살수설비', gosiNo: 27, sheets: ['연결살수'], kind: 'facility',
    tocLabel: '27. 연결살수설비 점검표', verifyToc: true },
  { matchKey: '비상콘센트설비', gosiNo: 28, sheets: ['비콘'], kind: 'facility',
    tocLabel: '28. 비상콘센트설비 점검표', verifyToc: true },
  { matchKey: '무선통신보조설비', gosiNo: 29, sheets: ['무통'], kind: 'facility',
    tocLabel: '29. 무선통신보조설비 점검표', verifyToc: true },
  // 기타사항(방화문·비상구·방염) — 설비 축이 아니라 전 대상물 공통(STD-31 · ALWAYS_SHOWN 축)
  { matchKey: '기타사항', gosiNo: 31, sheets: ['기타'], kind: 'always',
    tocLabel: '31. 기타사항 점검표', verifyToc: true },
  // 다중이용업소 — 해당 대상물만(STD-32 · sheet-overview ⑦과 같은 판별 축)
  { matchKey: '다중이용업소', gosiNo: 32, sheets: ['다중1', '다중2'], kind: 'multiUse',
    tocLabel: '32. 다중이용업소 점검표', verifyToc: true },
]

/** 목차 본문 행 — **템플릿 실측 A2~A23(22칸)**. A1 제목('- 목      차 -')은 불변.
 *  그룹 수(23)보다 1칸 적다 — CO2(고시 9)는 원본 목차에 없던 행이라 시트 원본에 칸 자체가 없고,
 *  없는 셀 삽입은 불가(S0-5 전제)라 그룹 수로 계산하면 마지막 칸이 XML 미실재로 500이 난다.
 *  전 그룹 동봉 고객만 1건이 넘치며 라우트가 자르되 경고·헤더에 남긴다(S8-2 규약과 같은 축).
 *  칸 수·실재는 test-xlsx-donors가 템플릿 XML로 고정한다 — 도너 원본 갱신 시 재실측. */
export const DONOR_TOC_BODY_CELLS: string[] = Array.from({ length: 22 }, (_, i) => `A${i + 2}`)

/** 이식되는 기증 시트 전부 — 목차 + 그룹 시트(면 순서 유지) */
export function allDonorSheets(): string[] {
  return [DONOR_TOC_SHEET, ...DONOR_GROUPS.flatMap(g => g.sheets)]
}

/** 남길 그룹 판정 — 인쇄 번들 대상 선정과 같은 축.
 *  facility는 sheetMatchesFacilities(명시 매핑 — 전용 시트 분리 F-1f 규칙 포함),
 *  always(기타)는 무조건, multiUse(다중)는 판별 플래그를 따른다. */
export function donorGroupsToKeep(
  matches: (matchKey: string) => boolean, multiUse: boolean,
): DonorGroup[] {
  return DONOR_GROUPS.filter(g =>
    g.kind === 'always' || (g.kind === 'multiUse' ? multiUse : matches(g.matchKey)))
}
