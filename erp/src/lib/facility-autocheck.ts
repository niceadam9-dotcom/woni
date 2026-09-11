/** 점검표 → 1.4 대장 **따라잡기**(자동 체크) 판정 — 소방계획서_49 §9 (2026-09-11 사용자 확정)
 *
 *  사용자가 1.4를 안 채우고 점검표부터 쓰는 흐름이 실재한다. 관문은 **경고만**(ⓑ)이라 무시할 수
 *  있으므로, 대장이 점검표를 **따라잡는** 이 경로가 사실상 주 방어선이다.
 *
 *  ## 🚨 설계서 §9-2의 전제를 정정한다 — `respondedNotInstalled`를 그대로 쓰면 안 된다
 *
 *  §9-2는 "이미 계산돼 있다 · 새 판정식 0개"라며 `rollUpForm3Results`의 `respondedNotInstalled`를
 *  그대로 트리거로 쓰라고 했다. **실증으로 뒤집혔다**(`_probe-49-spread.mts`):
 *
 *    「스프링클러설비」 시트에 ○ 하나 → 1.4가 비어 있으면 트리거가 **2건**
 *      = 스프링클러설비 + **화재조기진압용스프링클러설비**(ESFR — 전혀 다른 설비)
 *
 *  원인은 `rollUpForm3Results:391` — **설치된 형제가 하나도 없으면** 응답을 그 중분류가 덮는
 *  항목 **전체로 전개**한다(`installedHere.length > 0 ? installedHere : items`). 마크를 찍는
 *  용도로는 옳지만, **하필 「전부 미설치」가 이 기능의 대상 상황**이라 트리거가 그때만 부푼다.
 *  §9-3 ②의 대책(`withGroups: true`)으로도 못 막는다 — 중분류 매핑 등재 시트가 6개뿐이라
 *  스프링클러·할론/할로겐화합물·비상조명등/휴대용 4쌍은 등재 밖이고 그대로 전개된다.
 *
 *  ## 그래서 규칙은 「모르면 안 켠다」다
 *
 *  법정 대장에 **틀린 설비를 적는 것보다 안 적는 게 낫다.** 안 적으면 경고가 남아 사람이
 *  처리하지만, 틀리게 적으면 아무도 모른다. 후보가 둘 이상이면 켜지 않고 **물어본다**(ambiguous).
 *
 *  ## 세 규칙 (§9-3 — 어기면 서림사 사고가 자동화된다)
 *  ① **／는 트리거가 아니다** — 「해당 없다」는 진술이지 설치 근거가 아니다.
 *  ② **형제에게 번지지 않는다** — 후보가 1개로 좁혀질 때만 켠다(위 정정).
 *  ③ **이미 설치면 쓰지 않는다** — 실제 쓰기는 설비당 최초 1회.
 *
 *  ⚠ 이 모듈은 `installed`만 정한다. `facilities_verified_at`은 **절대 건드리지 않는다**(§9-4) —
 *    그 값은 「사람이 확인했다」는 뜻이고, 자동으로 찍으면 경고가 스스로 꺼져 관문이 죽는다. */

import { form3ItemsForSheetGroup, form3ItemMatchesFacility, type SheetGroupStat } from '@/lib/sheet-facility-map'

/** 자동으로 켤 설비(확정) + 사람에게 물어야 하는 갈래(모호) */
export type AutoCheckPlan = {
  /** 대장에 `installed=true`로 쓸 항목 — 후보가 정확히 하나로 좁혀진 것만 */
  confirmed: string[]
  /** 후보가 둘 이상이라 **켜지 않은** 갈래. 화면이 "어느 것입니까?"로 물어야 한다 */
  ambiguous: Array<{ sheet: string; group: string | null; candidates: string[] }>
}

export function planFacilityAutoCheck(opts: {
  /** 시트·중분류별 응답 통계 — `withGroups: true`로 모은 것 */
  entries: readonly SheetGroupStat[]
  /** 별지 3쪽 항목(= 1.4 대장 코드 축) */
  form3Items: string[]
  /** 지금 대장에 설치로 체크된 코드 */
  installedCodes: readonly string[]
}): AutoCheckPlan {
  const { entries, form3Items, installedCodes } = opts
  // 설치 판정은 `rollUpForm3Results`와 **같은 술어**를 써야 한다 — 여기서 다시 정의하면
  // 자동 체크가 롤업과 다른 집합을 보게 되고, 화면과 대장이 갈린다.
  const installed = new Set(
    form3Items.filter(it => installedCodes.some(c => form3ItemMatchesFacility(it, c))))

  const confirmed = new Set<string>()
  const ambiguous: AutoCheckPlan['ambiguous'] = []
  const seenAmbiguous = new Set<string>()

  for (const { sheet, group, stat } of entries) {
    // ① ／는 트리거가 아니다 — 실제 점검 흔적(○·×)이 있을 때만
    if (!stat.o && !stat.x) continue

    const items = form3ItemsForSheetGroup(sheet, group, form3Items)
    if (items.length === 0) continue

    // ③ 이미 설치된 형제가 있으면 이 응답은 그쪽 것이다 — 켤 것이 없다(롤업 :390-391과 같은 규약)
    const installedHere = items.filter(it => installed.has(it))
    if (installedHere.length > 0) continue

    // 위 가드를 지났으므로 `items` 중 설치된 것은 하나도 없다 — 전부가 후보다.
    // ⚠ 여기서 다시 `filter(!installed)`를 걸지 않는다: 항상 전체를 돌려주는 **죽은 필터**라
    //   읽는 사람에게 "설치된 것도 섞여 들어올 수 있다"는 거짓 인상을 준다(변이 실험에서
    //   동등 변이로 드러났다 — 바꿔도 동작이 같아 어떤 검사도 잡을 수 없는 코드였다).
    const candidates = items
    if (candidates.length === 1) {
      confirmed.add(candidates[0])
      continue
    }
    // ② 후보가 둘 이상 — **켜지 않는다.** 어느 설비인지 모르는 채 법정 대장에 적을 수 없다.
    if (candidates.length > 1) {
      const key = `${sheet}|${group ?? ''}`
      if (!seenAmbiguous.has(key)) {
        seenAmbiguous.add(key)
        ambiguous.push({ sheet, group, candidates })
      }
    }
  }
  // 같은 항목이 여러 시트에서 확정될 수 있다 — 집합이라 자연히 1회
  return { confirmed: [...confirmed], ambiguous }
}
