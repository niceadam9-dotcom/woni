/** 점검표 3층 아웃라인 — 중분류(머더) → 소제목 run → 항목 분해 (소방계획서_23 S5-3, 순수 함수).
 *
 *  ⚠ `groupBy(subgroup_name)` 금지 — 같은 소제목이 비연속으로 재등장하면 항목이 재정렬되어
 *  order_num 순서가 깨지고, 별지 4호 인쇄가 그 순서에 의존한다. 여기서는 **연속 구간(run)만** 묶는다.
 *  혼재 중분류(G-2 — 예: 9-A는 9항목 중 앞 6개가 소제목 없음)는 [null run][소제목 run]… 순서로
 *  원문 그대로 나온다. null run은 라벨 없이 렌더된다(원문에 없는 헤더를 지어내지 않는다).
 *
 *  입력은 (group_order, subgroup_order, order_num)으로 정렬돼 있어야 한다 — 서버 액션이 보장.
 *  134 미적용 폴백(sheetItemGroupRef)에서도 동작한다 — 그땐 그룹당 run 1개(null)가 된다. */

import { sheetItemGroupRef, type SheetItemGroupInput } from './sheet-scope'

export type OutlineRun<T> = { subgroup: string | null; items: T[] }

export type OutlineGroup<T> = {
  code: string
  /** 폴백에서는 code와 같을 수 있다 — 호출부는 name === code면 이름 병기를 생략한다 */
  name: string
  runs: OutlineRun<T>[]
  /** run을 접지 않은 평면 항목 — 진행률 분모 등 run 무관 집계용 */
  items: T[]
}

export function buildSheetOutline<T extends SheetItemGroupInput>(items: T[]): OutlineGroup<T>[] {
  const groups: OutlineGroup<T>[] = []
  let g: OutlineGroup<T> | null = null
  let run: OutlineRun<T> | null = null
  for (const it of items) {
    const ref = sheetItemGroupRef(it)
    if (!g || g.code !== ref.code) {
      g = { code: ref.code, name: ref.name, runs: [], items: [] }
      groups.push(g)
      run = null   // 중분류가 바뀌면 run도 끊는다 — 이전 소제목이 이월되면 안 된다
    }
    if (!run || run.subgroup !== ref.subgroup) {
      run = { subgroup: ref.subgroup, items: [] }
      g.runs.push(run)
    }
    run.items.push(it)
    g.items.push(it)
  }
  return groups
}
