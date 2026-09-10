/** ⑤ 계획 기간·⑥ 완료일을 **총 이행기간에서 고르는** 규칙 (2026-09-10 사용자 결정)
 *
 *  배경: ⑥ 불량 표에서 완료일을 불량마다 손으로 쳤다. 사용자 지시 —
 *  「완료일 입력 할 필요가 없는데… 총이행일 기간을 넣으면 될 것 같다」.
 *
 *  ⚠ **칸 자체는 없앨 수 없었다.** `action_completed_at`은 별지 11호 「이행조치 일자」에 인쇄되고
 *    (report9-assemble `annexDoneRows`), 갑지 엑셀 완료보고서 I19:I22에 실리며, 무엇보다
 *    **⑤ 단계 완료 판정이 이 칸 하나에 걸려 있다**(inspection-step-sync `defectsDone`).
 *    값이 늘 비면 조치를 다 해도 ⑤가 영영 안 닫힌다. 그래서 없앤 것은 **손으로 치는 일**이다.
 *
 *  ⚠ 기간 문자열("YYYY-MM-DD ~ YYYY-MM-DD") 파싱은 여기 없다 — `splitRange`(date-range.ts)가
 *    단일 원천이다. 구분자 규칙을 두 곳에 적으면 한 화면에서만 기간이 사라진다.
 *  ⚠ 날짜 **산술**도 여기 없다(법정 10·20일은 action-period-legal.ts). 이 파일은 이미 정해진
 *    날짜들 중에서 **고르기만** 한다 — 축을 섞으면 한쪽을 고칠 때 다른 쪽이 조용히 따라 움직인다.
 */

/** ⑥ 완료일로 쓸 날짜 — 총 이행기간 **종료일** → 그 불량의 계획 종료일 → 없음(`''`).
 *
 *  🚨 **오늘로 떨어지지 않는다.** 폴백을 오늘로 두면 기간을 정하지 않은 회차에서도 체크가 통하고,
 *    근거 없는 날짜가 소방서 제출 서식에 그대로 찍힌다 — 그건 육안으로 잡을 수 없는 종류의 오류다.
 *    `''`는 「고를 수 없다」는 뜻이고, 호출부는 그때 **저장을 거절**해야 한다.
 *  ⚠ 시작일이 아니라 **종료일**이다. 이행조치는 그 기간이 끝나는 날 완료되는 것으로 본다. */
export function completionDateFrom(periodEndISO?: string | null, planEndISO?: string | null): string {
  const fromPeriod = (periodEndISO ?? '').trim().slice(0, 10)
  if (fromPeriod) return fromPeriod
  return (planEndISO ?? '').trim().slice(0, 10)
}

/** ⑤ 기간 일괄 적용의 대상인가 — **시작·종료가 둘 다 빈 행만**.
 *
 *  ⚠ 값이 있는 행은 건너뛴다. 한 번의 클릭이 손으로 정한 개별 일정을 지우면 되돌릴 방법이 없다.
 *  ⚠ **한쪽만 있는 행도 건너뛴다.** 빈 쪽만 채우면 남은 한쪽과 짝이 맞지 않아 기간이 뒤집힐 수
 *    있고(종료<시작), 그건 저장 경로가 막는 바로 그 조합이라 일괄 적용이 통째로 실패한다. */
export function isPlanFillTarget(row: { action_start?: string | null; action_end?: string | null }): boolean {
  return !(row.action_start ?? '').trim() && !(row.action_end ?? '').trim()
}
