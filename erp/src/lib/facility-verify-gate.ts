/** 1.4 소방시설 **확인 여부** 판정 — 소방계획서_49 §5-1·§6 (2026-09-11)
 *
 *  「미입력」 신호는 `buildings.facilities_verified_at IS NULL` **한 축**이다.
 *  값이 있으면 사람이 1.4를 확인한 것이고, 설비가 **정말 하나도 없는** 건물도
 *  `[해당 설비 없음 — 확인만]`으로 이 값을 찍을 수 있다(`verifyFacilitiesAction`).
 *  그래서 「설비 0건」과 「아직 안 봤다」가 구별된다 — 이 구별이 이 축의 전부다.
 *
 *  🚨 판정식을 **여기 한 곳에** 둔다. 경고 배너·완료 보류 두 표면이 각자 세면 갈라지고,
 *  「배너는 떴는데 완료는 됐다」 같은 모순이 난다(39의 `countRequiredItemBlanks` 단일 원천과 같은 이유).
 *
 *  ⚠ `facilities_verified_at`은 **사람만 찍는다.** 점검표 → 대장 따라잡기(`facility-autocheck`)는
 *    `installed`만 쓰고 이 값은 건드리지 않는다(§9-4). 자동으로 찍으면 아래 판정이 스스로 풀려
 *    경고도 보류도 동시에 죽는다. */

export type FacilityVerifyState = {
  /** 활성 건물 수 */
  total: number
  /** 그중 확인일이 비어 있는 동 */
  unverified: number
}

export function facilityVerifyState(
  buildings: ReadonlyArray<{ facilities_verified_at?: string | null }>,
): FacilityVerifyState {
  return {
    total: buildings.length,
    unverified: buildings.filter(b => !b.facilities_verified_at).length,
  }
}

/** 경고를 띄울 것인가 — **하나라도 미확인이면** 알린다.
 *
 *  관문은 ⓑ경고만이다(2026-09-11 사용자 확정: "ⓐ를 하면 사용자들이 사용에 어려움이 있을 것 같아").
 *  현장에서 점검표부터 쓰는 흐름이 실재하고, 1.4는 사무실에서 정리하는 성격이라 막으면
 *  그 자리에서 할 수 없는 일을 요구받는다. 그래서 **막지 않고 알린다**. */
export function shouldWarnFacilitiesUnverified(s: FacilityVerifyState): boolean {
  return s.total > 0 && s.unverified > 0
}

/** ① 완료를 **보류**할 것인가 — 활성 동이 **전부** 미확인일 때만.
 *
 *  🚨 ⓑ(경고만)를 골랐으므로 이 보류가 **유일한 그물**인 경우가 있다: 점검표를 전부 ／로만 채우면
 *    따라잡기가 안 돈다(／는 트리거가 아니다 — 「해당 없다」는 진술로 「있다」를 적을 수 없다).
 *    그러면 대장은 빈 채로 남고, 분모가 0이라 필수 미입력 카운터·이탈 팝업·별지 경고가
 *    **동시에 침묵**한다. 화면을 우회해 액션을 직접 불러도 잘못된 완료가 DB에 박히지 않게 하는 것이
 *    이 층의 목적이다(§6 ③).
 *
 *  ⚠ **일부만 미확인이면 보류하지 않는다.** 다동에서 한 동을 아직 안 봤다고 회차 전체를 막으면
 *    되돌릴 방법이 화면에 없다 — 그때는 경고 줄만 뜬다(§6 ② 판정과 같은 규약).
 *    고객 1:건물 1로 고정된 뒤(`cf139d0`) 정상 경로에서 total은 늘 1이라 두 판정이 일치한다.
 *  ⚠ 건물이 0동이면 보류하지 않는다 — 확인할 대상 자체가 없는데 막으면 영영 못 끝낸다. */
export function shouldHoldForFacilitiesUnverified(s: FacilityVerifyState): boolean {
  return s.total > 0 && s.unverified === s.total
}
