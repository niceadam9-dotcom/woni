/** 점검달력에서 **끌 수 있는 칩인가** — 드래그 가부 판정 단일 원천 (2026-09-22, R8b)
 *
 *  ## 왜 함수로 뺐나
 *  이 판정은 `inspection-calendar-client.tsx`(2,700줄) 안의 `draggableAccessor` 콜백이었다.
 *  거기 있는 한 **단언할 수 있는 방법이 없다** — 달력을 띄우고 마우스로 끌어 봐야 알 수 있고,
 *  그 검사는 표본(그 달에 마침 1단계 칩이 있는 고객)에 기대서 조용히 초록이 된다.
 *  이 저장소에서 그 부류의 사고가 반복됐다: 「모양만 보는 소스 단언은 값이 빈 채로도 초록」.
 *  순수 함수로 빼면 DB도 브라우저도 없이 **전 조합**을 셀 수 있다.
 *
 *  ## 두 축이 있고, 서로 다른 일을 한다
 *   · **step** — 시작된 점검의 1단계 칩 = 점검일자. 끌면 1~6단계 마감일을 서버가 다시 깐다(R8a 경유).
 *   · **plan** — 미시작 정기 계획 칩 = 예정일. 같은 달 안에서만 옮긴다(2026-07-13 설계).
 *  둘을 한 조건으로 합치지 않는다. 확인 문구도 서버 액션도 다르고, 합치는 순간
 *  「어느 쪽 규칙으로 막혔나」를 못 가른다(`moveConfirm`/`dateChange` 상태를 따로 둔 이유와 같다).
 *
 *  ## ⚠ 1단계만 끌린다
 *  2~6단계 칩은 **마감일**이고 그건 점검일자에서 파생되는 값이다. 끌어서 따로 옮기게 하면
 *  산식 밖에서 마감일이 생겨 「옮겼는데 다시 계산하면 제자리로 돌아오는」 화면이 된다.
 *  나머지 단계는 사람이 옮기지 않는다 — **서버가 따라 옮긴다**(사용자 확정 2026-09-22).
 *
 *  ## ⚠ 가부는 다시 세지 않는다
 *  `dateChange`는 서버가 **의무 축**으로 판정해 실어 보낸 값이다(`lib/inspection-date-change`).
 *  화면에서 단계를 다시 세면 표시 축이라 불량 0일 때 ⑤⑥이 빠지고, **이미 협회·소방서에 나간
 *  날짜를 끌 수 있게** 된다. 여기서는 `allowed`를 읽기만 한다.
 */

/** 판정에 필요한 것만 추린 칩 — 달력 이벤트(`CalEventResource`)의 구조적 부분집합 */
export type DraggableChip = {
  kind?: 'step' | 'plan' | 'plan-group'
  stepNum?: number
  planType?: string | null
  planStatus?: string | null
  /** 서버가 의무 축으로 판정한 점검일자 변경 가부 */
  dateChange?: { allowed: boolean } | null
}

/** 정기 계획 칩이 **미시작**임을 뜻하는 상태 어휘.
 *  🚨 `'planned'`는 마이그레이션 162(2026-09-12)로 **폐지된 값**이다. 그래도 남겨 둔다 —
 *    지우면 과거 행을 들고 있는 화면에서 칩이 조용히 안 잡히고, 그건 「드래그가 안 된다」는
 *    신고로만 드러난다. 폐지된 값을 **받아 주는 것**은 안전하지만 새로 쓰지는 않는다. */
const MOVABLE_PLAN_STATUS = new Set(['planned', 'confirmed'])

/** 이 칩을 끌 수 있는가.
 *  @param chip      달력 이벤트의 resource
 *  @param canManage `inspection_plan_manage` 권한 — 서버 액션 둘이 요구하는 것과 **같은 축**.
 *                   없으면 어느 칩도 안 잡힌다(끌린 뒤 서버에서 거절당하는 화면을 만들지 않는다).
 */
export function canDragCalendarChip(chip: DraggableChip, canManage: boolean): boolean {
  if (!canManage) return false

  // ① 점검일자 — 1단계 칩만. 서버가 막았으면(2단계 이상 완료) 애초에 안 잡힌다.
  if (chip.kind === 'step') return chip.stepNum === 1 && chip.dateChange?.allowed === true

  // ② 정기 예정일 — 미시작 monthly만. 자체점검(special_*)은 **일부러 제외**한다(사용자 확정
  //    2026-09-22): 서버가 `plan_type !== 'monthly'`를 거부할 뿐 아니라, 자체점검은 날짜를
  //    적용하는 순간 **점검이 시작된다**(`confirmPlanItemStageOneAction` → `startInspectionCore`).
  //    드래그는 의도가 낮은 제스처인데 결과가 법정 점검 개시라 짝이 맞지 않는다.
  if (chip.kind === 'plan') {
    return chip.planType === 'monthly' && MOVABLE_PLAN_STATUS.has(chip.planStatus ?? '')
  }

  // ③ 일별 집계 칩(plan-group)·그 밖 — 끌지 않는다. 집계는 여러 건을 묶은 것이라
  //    끌면 「무엇이 옮겨졌나」를 말할 수 없다(일괄 이동은 데이 패널의 선택 모드가 맡는다).
  return false
}
