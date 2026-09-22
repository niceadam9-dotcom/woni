/** 시작된 점검의 **점검일자를 옮길 수 있는가** — 판정 단일 원천 (2026-09-22 사용자 확정)
 *
 *  ## 왜 이 모듈이 생겼나
 *  `confirmPlanItemStageOneAction`은 1단계가 완료되면 날짜 변경을 거부하면서
 *  **「날짜는 점검 상세에서 변경해주세요」**라고 안내한다(`plan-date-actions.ts`).
 *  그런데 **점검 상세에 그런 경로가 없다** — `inspection_start_date`를 고치는 입구는
 *  계획 확정·정기 드래그뿐이고, 둘 다 1단계 완료 건에서 막힌다.
 *  그래서 실제로는 **스크립트로** 고쳐 왔다(2026-09-20 「해오름 9/12→9/18」).
 *  제품이 없는 곳을 가리키고 있었고, 이 모듈이 그 입구의 판정을 맡는다.
 *
 *  ## 규칙 (사용자 확정 2026-09-22)
 *  - **1단계만 완료면 허용.** 1단계(점검일)는 시작과 거의 동시에 완료되므로
 *    「날짜를 잘못 적었다」는 정정이 거의 이 구간에서 일어난다.
 *  - **2단계 이상이 하나라도 완료면 거부.** 2단계(배치신고)부터는 협회·소방서에
 *    **이미 나간 날짜**가 있다. 기산일을 움직이면 제출한 서류와 ERP가 어긋난다.
 *  - 거부할 때는 **어느 단계가 막았는지**를 말한다. 「안 된다」만 하면 사용자가
 *    무엇을 되돌려야 하는지 알 수 없다.
 *
 *  ⚠ 판정은 **의무 축(전 단계)** 으로 한다. 표시 축(`visibleMap` — 불량 0이면 ⑤⑥ 숨김)으로
 *    세면 숨겨진 단계의 완료를 못 보고 통과시킨다.
 */

export type StepLite = {
  step_num: number
  status: string
  /** 거부 사유에 이름을 실으려고 받는다 — 없으면 번호만 말한다 */
  name_ko?: string | null
}

export type DateChangeVerdict = {
  /** 옮길 수 있는가 */
  allowed: boolean
  /** 막혔다면 사람에게 보일 사유 (allowed=true면 없다) */
  reason?: string
  /** 막은 단계 번호 — 화면이 그 줄을 짚어 줄 수 있게 */
  blockedBy?: number
}

/** 완료로 치는 상태 — `inspection_steps.status`의 어휘(`pending`·`completed`·`overdue`) */
const isDone = (s: StepLite) => s.status === 'completed'

/** 점검일자 변경 가부. steps는 **의무 축 전 단계**를 넘긴다(표시 축이 아니다). */
export function dateChangeVerdict(steps: readonly StepLite[]): DateChangeVerdict {
  // 단계를 못 받았으면 판정할 수 없다 — 「없음」을 「완료 0건」으로 읽으면 열려 버린다.
  // 기울기는 닫는 쪽이다(못 잰 것은 조치가 필요하다로 센다).
  if (steps.length === 0) {
    return { allowed: false, reason: '단계 정보를 불러오지 못해 날짜를 옮길 수 없습니다.' }
  }

  const blocker = [...steps]
    .filter(s => s.step_num >= 2 && isDone(s))
    .sort((a, b) => a.step_num - b.step_num)[0]

  if (!blocker) return { allowed: true }

  const label = blocker.name_ko?.trim()
  return {
    allowed: false,
    blockedBy: blocker.step_num,
    reason: `${blocker.step_num}단계${label ? `(${label})` : ''}가 이미 완료돼 협회·소방서에 나간 날짜가 있습니다.`
      + ' 점검일자를 옮기면 제출한 서류와 어긋납니다.',
  }
}
