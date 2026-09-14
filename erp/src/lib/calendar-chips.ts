/** 점검달력 계획 칩 — **이름을 보여줄 것인가, 건수로 뭉칠 것인가**. 순수·무의존.
 *
 *  ## 왜 이 파일이 생겼나 (2026-09-14 지평리56 신고)
 *
 *  "점검달력에서 조회가 안 된다"의 정체는 **두 결함**이었고, 둘 다 이 판정에 있었다.
 *
 *  ① 집계 칩은 하루 100건짜리 날의 "+N개 더 보기" 폭발을 막으려는 장치인데, 그 장치가
 *     **1건뿐인 날에도** 이름을 가렸다. 고객을 검색해 그 날 1건만 남겨도 회색
 *     「정기 1건」 칩만 보였다 — 이름을 보려면 날짜를 눌러 데이 패널을 열어야 했다.
 *     ⭐ 검색 중이면 사용자가 **이미 대상을 좁힌 것**이므로 건수와 무관하게 편다.
 *        좁히는 행위의 목적 자체가 "누구인지 보는 것"이라, 거기서도 뭉치면 검색이
 *        아무 일도 안 한 것처럼 보인다.
 *
 *  ② 자체점검(`special_종합`·`special_작동`)은 **뭉치면 안 된다**. 한 날에 몇 건 안 되고,
 *     무엇보다 '누구의 종합점검인가'가 그 탭을 여는 이유라 건수로 뭉치면 의미가 없다.
 *
 *  ## 왜 화면 밖으로 꺼냈나
 *
 *  규칙이 `useMemo` 안 JSX 계산에 묻혀 있어 **아무도 단언할 수 없었다** — 실제로 위 두
 *  결함이 검사 전건 초록인 채로 운영에 나가 있었다. 순수 함수면 서버·DB 없이 물을 수 있다.
 *
 *  ⚠ `plan_type`을 리터럴 유니온이 아니라 `string`으로 받는다 — 계획 유형 집합의 주인은
 *    달력(`CalendarPlanItem`)이다. 여기서 베껴 두면 그쪽이 늘 때마다 이 모듈이 컴파일을
 *    깨뜨리고, 그때 「일단 통과시키자」로 넓히다 규칙이 흐려진다.
 *    이 모듈이 아는 것은 단 하나 — **정기(monthly)인가 아닌가**이다.
 */

/** 정기를 뭉치지 않고 이름을 찍는 상한 — 이 수 이하인 날은 집계할 이유가 없다 */
export const PLAN_CHIP_NAME_MAX = 3

export type ChipPlanItem = {
  plan_type: string
  /** 'YYYY-MM-DD' — 달력에 찍히는 날짜(확정 전 항목은 예정일이 여기 들어와 있다) */
  scheduled_date: string
}

export type PlanChipGroup<T> = {
  date: string
  /** 뭉쳐진 원본 항목 — 건수·완료·지연 셈은 호출부가 한다(`today`를 이 모듈에 들이지 않는다) */
  items: T[]
}

export type PlanChipLayout<T> = {
  /** 고객 이름이 보이는 개별 칩으로 그릴 항목 */
  individuals: T[]
  /** 「정기 N건」 집계 칩으로 그릴 날짜 묶음 — **정기만 여기 온다** */
  groups: Array<PlanChipGroup<T>>
}

/** 계획 항목을 개별 칩 / 날짜별 집계 칩으로 가른다.
 *
 *  · 정기(monthly)가 **아닌** 것은 언제나 개별 — 일반(event)·자체점검(special_*)
 *  · 정기는 날짜별로 모으되, 검색 중이거나 상한 이하면 펴서 이름을 보여준다
 *
 *  순서는 화면 규약을 그대로 따른다: 비정기 개별 → 펴진 정기 개별 → 집계 칩.
 *  (입력 순서를 보존하므로 호출부의 정렬이 그대로 살아 있다.) */
export function layoutPlanChips<T extends ChipPlanItem>(
  items: readonly T[],
  opts: { searching: boolean },
): PlanChipLayout<T> {
  const individuals: T[] = []
  const byDate = new Map<string, T[]>()

  for (const p of items) {
    // 집계는 정기만 — 나머지는 여기서 바로 편다
    if (p.plan_type !== 'monthly') { individuals.push(p); continue }
    const rows = byDate.get(p.scheduled_date)
    if (rows) rows.push(p)
    else byDate.set(p.scheduled_date, [p])
  }

  const groups: Array<PlanChipGroup<T>> = []
  for (const [date, rows] of byDate) {
    if (opts.searching || rows.length <= PLAN_CHIP_NAME_MAX) individuals.push(...rows)
    else groups.push({ date, items: rows })
  }

  return { individuals, groups }
}
