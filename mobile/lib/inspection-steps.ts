/** 점검 6단계 중 **유효 단계** 판정 — 웹 ERP `erp/src/lib/inspection-step-status.ts`의 사본.
 *
 *  ⚠⚠ **이 파일은 사본이다.** mobile은 별도 Expo 패키지라 `erp/src`를 import할 수 없어 규칙을
 *  옮겨 적었다. 원본이 바뀌면 여기도 바꿔야 한다 — 그 갈라짐을 사람이 기억으로 막을 수 없으므로
 *  `erp/scripts/_probe-45-neighbors.mjs`가 **두 파일의 규칙을 대조하는 단언**을 들고 있다.
 *
 *  왜 생겼나(소방계획서_45 4차 독립 판정 R-8): 웹은 「점검표 모두 합격(✕ 0 AND 등록 불량 0)이면
 *  ⑤⑥은 해당없음」을 여섯 표면에서 공유하는데, **모바일만 6행을 그대로 그리고 ⑤⑥에 [완료] 버튼을
 *  띄우고 있었다.** 게다가 그 버튼이 `inspections.status='completed'`를 직접 쓴다 —
 *  웹이 「하지 않은 일이 완료로 남는다」(D34-2)로 막아 온 바로 그 끝인데, 여기는 화면 열람이 아니라
 *  **사람이 누르는 버튼**이라 더 직접적이었다. 유예 목록에도, 3차 판정의 5개 표면에도 없던 6번째다. */

export type StepNum = 1 | 2 | 3 | 4 | 5 | 6

/** 자체점검 여부 — **plan_type 축 단독**(관리유형이 아니다. 두 축을 혼동하면 분모가 1로 줄어든다) */
export function isSelfInspection(planType: string | null | undefined): boolean {
  return !planType || planType.startsWith('special')
}

/** ⑤⑥이 필요한가 = 점검표 모두 합격이 **아닌가**.
 *  @param axisIncomplete 불량·✕ 조회가 불완전한가 — **모르면 '조치가 필요하다'로 본다**(닫는 쪽으로
 *  기울지 않는다). 0으로 접힌 개수와 진짜 0건을 구별할 수 없기 때문이다. */
export function hasSheetDefect(e: {
  defectsTotal: number; sheetX: number; axisIncomplete: boolean | undefined
}): boolean {
  if (e.axisIncomplete) return true
  return e.defectsTotal > 0 || e.sheetX > 0
}

/** 진행률 분모·화면에 그릴 **유효 단계**. 정기·일반(월간 외관)은 ① 하나뿐이다. */
export function activeStepNums(isSpecial: boolean, needsRepairSteps: boolean): StepNum[] {
  if (!isSpecial) return [1]
  return needsRepairSteps ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4]
}
