/** 한 바퀴가 **끝났는가** — 「종료됨」 판정 단일 원천 (2026-09-22 사용자 확정, 점검달력 R7)
 *
 *  ## 왜 이 모듈이 생겼나
 *  달력은 「얼마나 했나」는 말했지만 **「끝났다」는 말을 한 번도 하지 않았다.** 진행률 바가
 *  100%에서 초록으로 바뀌는 것이 전부였고, 그건 *수치*지 *상태*가 아니다. 그래서 다 끝난 회차와
 *  아직 한 단계 남은 회차가 달력에서 똑같이 생겼다 — 사용자는 매번 패널을 열어 세어 봐야 했다.
 *
 *  ## 🚨 축을 틀리면 조용히 거짓말한다 — 여기가 이 모듈의 전부다
 *  같은 점검에 단계 목록이 **두 벌** 돌아다닌다(`lib/active-steps`):
 *   · `map`(**의무 축**) — 이 회차가 실제로 해야 하는 단계. 완료 판정·크론이 쓴다.
 *   · `visibleMap`(**표시 축**) — 화면에 그릴 단계. 불량 0이면 ⑤⑥을 감춘다.
 *  달력 패널의 `steps`는 **표시 축으로 이미 걸러져** 서버에서 온다. 그 목록으로 세면
 *  「4/4 = 100% = 종료됨」이 되는데, 숨겨진 ⑤⑥이 미완일 수 있다. 같은 함정이 바로 옆
 *  `inspection-date-change`에서 한 번 잡혔고(그 주석이 이 주석의 형제다), 더 거슬러 올라가면
 *  ⑤⑥이 분모에서 빠진 채 `status='completed'`가 **DB에 기록된** 사고까지 있다
 *  (`inspection-step-status`의 axisIncomplete 주석). 그래서 이 함수는 **의무 축을 인자로 받는다** —
 *  호출부가 표시 축을 넘기는 실수를 하지 않도록 타입이 아니라 이름과 주석으로 못박는다.
 *
 *  ## ⚠ 기울기 — 못 잰 것은 「끝났다」가 아니다
 *  전 저장소가 공유하는 규약(`active-steps` 18~20줄, `inspection-date-change` 44~48줄)과 같은 방향:
 *  **모르면 닫는 쪽이 아니라 「아직」 쪽으로 기운다.** 「없음」을 「완료 0건」으로 읽으면
 *  단계 조회가 실패한 회차가 **전부 종료됨으로 보인다** — 한 해치를 그리는 달력에서 그건
 *  조용한 대형 오보다. 단계 0건·의무 집합 0건은 `closed:false`(모름)로 돌려보낸다.
 *
 *  판정만 한다(조회·쓰기 없음). 순수 함수라 DB 없이 전 조합을 단언할 수 있다.
 */

export type ClosedStepLite = {
  step_num: number
  /** `inspection_steps.status`의 어휘 — `pending` · `completed` · `overdue` */
  status: string
  /** 「언제 끝났나」를 말하려고 받는다. 없으면 시각 없이 종료만 말한다 */
  completed_at?: string | null
}

export type ClosedVerdict = {
  /** 의무 단계를 **전부** 끝냈는가. 판정 재료가 모자라면 false(= 「아직」이 아니라 「모름」) */
  closed: boolean
  /** 마지막 의무 단계가 완료된 시각 — closed일 때만 채운다. 못 구하면 null */
  closedAt?: string | null
  /** 아직 안 끝난 **의무** 단계 수. 재료가 모자라 판정을 못 했으면 undefined */
  remaining?: number
}

/** 완료로 치는 상태 — `inspection-date-change`의 isDone과 **같은 어휘**를 쓴다(두 벌이 되지 않게) */
const isDone = (s: ClosedStepLite) => s.status === 'completed'

/** 한 바퀴가 끝났는가.
 *
 *  @param steps       **의무 축 전 단계**(거르기 전). 표시 축(`stepsMap`)을 넘기지 말 것 — 머리 주석 참조.
 *  @param activeNums  이 회차가 실제로 해야 하는 단계 번호 집합(`activeSteps.map.get(id)`).
 *                     넘기지 않으면 **받은 단계 전부를 의무로** 본다 — `isStepActive`의
 *                     「모르면 참」과 같은 기울기라, 모를 때 단계가 조용히 빠지지 않는다.
 */
export function closedVerdict(
  steps: readonly ClosedStepLite[],
  activeNums?: ReadonlySet<number>,
): ClosedVerdict {
  // 단계를 못 받았으면 판정할 수 없다. 「완료 0건」이 아니라 **모름**이다 —
  // 여기서 true로 기울면 조회가 실패한 회차가 전부 「종료됨」으로 그려진다.
  if (steps.length === 0) return { closed: false }

  const required = activeNums ? steps.filter(s => activeNums.has(s.step_num)) : [...steps]

  // 의무 집합이 비었다 = 이 회차가 할 일이 하나도 없다? 그런 회차는 없다(activeStepNums는
  // 최소 [1]을 돌려준다). 빈 집합은 재료가 어긋났다는 뜻이므로 「끝났다」고 말하지 않는다.
  if (required.length === 0) return { closed: false }

  const undone = required.filter(s => !isDone(s))
  if (undone.length > 0) return { closed: false, remaining: undone.length }

  // 가장 늦게 완료된 의무 단계가 곧 이 바퀴가 닫힌 시각이다.
  // completed_at이 비어 있는 행이 섞일 수 있어(과거 데이터) 있는 것 중에서만 고른다 —
  // 없으면 시각 없이 「종료됨」만 말한다. 지어내 채우지 않는다.
  const stamps = required.map(s => s.completed_at).filter((v): v is string => !!v)
  const closedAt = stamps.length > 0 ? stamps.reduce((a, b) => (a >= b ? a : b)) : null

  return { closed: true, closedAt, remaining: 0 }
}
