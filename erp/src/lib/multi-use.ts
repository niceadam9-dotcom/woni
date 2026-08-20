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

/** 다중이용업소 대상 — 1.10.3에서 '해당'을 명시적으로 켠 경우에만 참 */
export function isMultiUseApplicable(mu: MultiUseSectionLike): boolean {
  return mu?.applicable === true
}

/** 다중이용업소 비대상('해당없음') — 미입력 포함. isMultiUseApplicable의 정확한 여집합 */
export function isMultiUseNone(mu: MultiUseSectionLike): boolean {
  return !isMultiUseApplicable(mu)
}
