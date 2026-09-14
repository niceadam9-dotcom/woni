/** 점검달력 데이 패널 「계획 일정」 행 — **점검 레코드로 가는 입구**를 붙이는가.
 *
 *  입구는 둘뿐이다:
 *   · ▶ [점검 시작·완료]  — 누르면 inspections 행을 만든다(startInspectionCore)
 *   · [점검 보기]          — 이미 만들어진 inspections 행으로 간다
 *  그리고 그 점검 레코드가 곧 **점검표 입력 화면**이다(sheet-scope.ts — monthly는 외관점검표 EXT v2022).
 *
 *  🚨 2026-09-14 사용자 확정: **정기(monthly)는 더 이상 점검표 입력을 하지 않는다.**
 *  → 정기 행에서는 두 입구를 **둘 다** 없앤다. 하나만 없애면 반대쪽으로 그대로 들어간다.
 *
 *  ⚠ 정기 일정이 완료되지 않게 되는 것은 아니다 — 예정일에 크론
 *  (`/api/cron/auto-start-inspections`)이 자동 시작하고, 그때 `startInspectionCore`가
 *  `inspection_plan_items.status`를 completed로 쓴다(`inspection-start.ts:158`).
 *  수동 경로는 데이 패널 헤더의 [이날 전체 완료]가 그대로 담당한다(같은 날 사용자 결정).
 *
 *  ⚠ 일반(event)은 **범위 밖**이다 — 종전 동작을 그대로 돌려준다. 이 함수의 값어치는
 *  「정기에서 껐는가」보다 **「일반에서 끄지 않았는가」**에 있다(과잉 삭제 방지, 음성 대조).
 *
 *  [날짜 이동]은 이 함수가 다루지 않는다 — 그 판정은 `isMovablePlan`이 단일 원천이고
 *  정기 전용이라 여기서 같이 세면 두 벌이 된다. */

export type PlanRowEntry = {
  /** ▶ [점검 시작·완료] 버튼 */
  startComplete: boolean
  /** [점검 보기] 링크 */
  viewInspection: boolean
}

/** ⚠ `plan_type`을 리터럴 유니온이 아니라 `string`으로 받는다 — 계획 유형 집합의 주인은
 *  달력(`CalendarPlanItem`)이고 **늘어나는 중**이다(2026-09-14 현재 다른 축에서 자체점검
 *  `special_*`를 더하고 있다). 여기서 유니온을 베껴 두면 그쪽이 늘 때마다 이 모듈이 컴파일을
 *  깨뜨리고, 그때 「일단 통과시키자」로 넓히다 규칙이 흐려진다.
 *  이 모듈이 아는 것은 단 하나 — **정기(monthly)인가 아닌가**이고, 나머지는 전부 종전 규칙이다. */
export function planRowInspectionEntry(
  plan: { plan_type: string; inspection_id?: string | null },
  opts: { canAct: boolean; moveSelectMode: boolean },
): PlanRowEntry {
  if (plan.plan_type === 'monthly') return { startComplete: false, viewInspection: false }
  if (plan.inspection_id) return { startComplete: false, viewInspection: true }
  return { startComplete: opts.canAct && !opts.moveSelectMode, viewInspection: false }
}
