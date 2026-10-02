/** 다중이용업소 '해당 여부' 단일 판정 (2026-08-20 사용자 확정 — 인쇄 지점 3곳 통일)
 *
 *  원천은 서식 1.10.3 `fire_plan_forms.sections.multiUse.applicable` **하나뿐**이다.
 *  규약: **미입력(섹션 부재 · 토글 미선택)은 비대상으로 본다.**
 *  근거 — 별지 9호 3쪽 2절이 이미 그 축으로 ／를 찍고 있었고(`fillNonApplicableMu`, A안),
 *  1절이 fire_facilities 행 부재를 '미설치'로 단정하는 것과 같은 축이다.
 *
 *  ⚠ **직접 `.applicable`을 읽지 말 것.** 판정이 갈리면 한 문서 안에서 모순이 인쇄된다 —
 *  2026-08-20 이전 별지 9호가 정확히 그랬다: 2쪽은 `applicable === false`라 미입력 건의
 *  '해당없음'을 비워두면서, 3쪽은 같은 건을 비대상으로 단정해 16칸을 전부 ／로 찍었다
 *  (스테이징 fire_plan_forms 4건 중 3건이 이 상태 — 서림사·지평5·별그리다).
 *  소방계획서 1.10은 또 달라서 `!!mu && !applicable`이었다(섹션 부재만 다르게 취급).
 *
 *  사용처(한 곳이 바뀌면 전부 같이 바뀌어야 한다):
 *   · 별지 9호 2쪽 다중이용업소현황 체크 — report9-actions.assembleReport9
 *   · 별지 9호 3쪽 2절 / 4호 2쪽 MU 16칸 — mu-std32-map.fillNonApplicableMu 호출 인자
 *   · 소방계획서 서식 1.10 '해당 여부' — fire-plan-template
 *   · 점검표 시트 노출·인쇄 번들 판정 — sheet-overview · bundle-actions (여기 더해 개소 입력까지 요구)
 *  회귀 고정: scripts/_probe-mu-applicable.mts */

export type MultiUseSectionLike = { applicable?: boolean } | null | undefined

/** 다중이용업소 대상 — 1.10.3에서 '해당'을 명시적으로 켠 경우에만 참.
 *
 *  ⚠ 일부러 타입 술어(`mu is T`)로 만들지 않았다. 참일 때 mu가 non-null인 건 맞지만,
 *  술어는 양방향이라 **거짓 분기에서 mu를 null|undefined로 좁혀버린다** — `{applicable:false}`도
 *  거짓이므로 거짓말이 된다. 대신 호출부가 `mu && isMultiUseApplicable(mu)`처럼 null을 직접
 *  좁힌다(판정 규칙은 여전히 여기 하나뿐이고, 좁히기만 호출부 몫). */
export function isMultiUseApplicable(mu: MultiUseSectionLike): boolean {
  return mu?.applicable === true
}

/** 다중이용업소 비대상('해당없음') — 미입력 포함. isMultiUseApplicable의 정확한 여집합 */
export function isMultiUseNone(mu: MultiUseSectionLike): boolean {
  return !isMultiUseApplicable(mu)
}

/* ══ 서식 1.10.3 관리현황 10~27행 (B3, 2026-10-02) ══════════════════════════════════
 *
 *  원문: `erp_goal/_Data/양식-placeholder.hwpx` table 27 = 템플릿 시트 「1.10.3 다중이용업소 관리현황」(자구 일치 실측).
 *  세 축 모두 **사람이 카드에서 체크한 값만** 인쇄한다 — ERP가 다른 데이터에서 추정하지 않는다.
 *   · 분기 4칸 — 그 분기에 업소 안전점검을 했는가(분기 점검 이력 축이 따로 없다)
 *   · 안전시설 14칸 — 다중이용업소 **전용** 설비 목록이라 1.4(대상물 전체 설치 축)와 다르다
 *   · 확인사항 9항목 ○/× — 그 업소를 확인한 결과
 *  ⚠ 셀 위치는 `fire-plan-anchors.ts`가 쥔다. 여기는 **자구와 키**만 둔다(라벨이 바뀌면 앵커 검증이 먼저 깬다). */

/** 10행 안전점검 분기 — 키 1~4 */
export const MU_QUARTERS = [
  { q: 1, label: '1분기(1~3월)' }, { q: 2, label: '2분기(4~6월)' },
  { q: 3, label: '3분기(7~9월)' }, { q: 4, label: '4분기(10~12월)' },
] as const

/** 11~17행 안전시설 14칸 — 저장값은 자구 그대로(`facilities: string[]`). 순서 = 인쇄 순서(N열 7 → AO열 7) */
export const MU_FACILITIES = [
  '소화기', '자동확산소화기', '간이 S/P', '비상벨설비', '자동화재탐지설비', '가스누설경보기', '피난기구',
  '유도등', '유도표지', '피난유도선', '비상조명등', '휴대용 비상조명등', '영상음향차단장치', '누전차단기',
] as const

/** 피난기구 칸은 괄호 안에 종류를 적는다(`□ 피난기구(      )`) — `evacNote`로 받는다 */
export const MU_FACILITY_WITH_NOTE = '피난기구'

/** 19~27행 확인사항 9항목 — 키 '1'~'9', 값 'O' | 'X' */
export const MU_CHECK_ITEMS = [
  '소화기, 자동확산소화기 등 소화설비 외관상태 확인',
  '비상벨설비, 자동화재탐지설비 등 경보설비 외관상태 확인',
  '피난기구 설치 위치 및 관리상태 확인',
  '유도등 설치 위치 및 점등상태 확인',
  '비상조명등 및 휴대용 비상조명등 설치 위치 및 점등상태 확인',
  '피난안내도 내용 적합성 및 설치 위치 확인',
  '피난통로 내 피난장애요소 확인',
  '방염물품의 방염성능확인(성적서 확인 등)',
  '교육 실시 여부(영업주 및 종업원의 소방안전교육)',
] as const

export type MuCheckMark = 'O' | 'X'
/** ○/× 인쇄 글리프 — 결과칸 머리글이 `[○,×]`다 */
export const muCheckGlyph = (v: MuCheckMark | '' | null | undefined) => (v === 'O' ? '○' : v === 'X' ? '×' : '')
