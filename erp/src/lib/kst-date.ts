/** 타임스탬프 → **KST 달력 날짜** (소방계획서_36 F-14)
 *
 *  ⚠ `completed_at.split('T')[0]`을 쓰면 **안 된다**. 그건 UTC 날짜다.
 *
 *  `inspection_steps.completed_at`은 `new Date().toISOString()`(UTC)으로 기록되고
 *  DB에서 `"2026-07-23T02:17:48.846+00:00"` 꼴로 돌아온다. KST는 UTC+9라
 *  **00:00~09:00 KST에 기록된 값은 문자열을 그냥 자르면 어제 날짜가 된다.**
 *  실측(2026-08-30 07:39 KST): 저장값 `2026-08-29T22:39Z` → 화면이 '완료 2026-08-29'.
 *
 *  ⚠ 이 결함은 **하루 중 9시간 창에서만** 재현된다 — 낮에 돌린 검사는 영원히 초록이다.
 *  그래서 회귀 검사는 '지금'이 아니라 **고정 입력**으로 판정해야 한다(test-kst-date.mts).
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** UTC 타임스탬프 문자열 → 'YYYY-MM-DD' (KST 기준). 값이 없거나 못 읽으면 빈 문자열. */
export function kstDate(ts: string | null | undefined): string {
  if (!ts) return ''
  // 타임존 표기가 없으면 UTC로 본다 — 기록하는 쪽이 UTC이기 때문이다.
  // 표기 없는 문자열을 그대로 Date.parse에 넘기면 ES 규격상 **로컬 시간대**로 해석돼
  // 서버·브라우저의 TZ에 따라 값이 갈린다(그 자체가 또 하나의 조용한 결함이 된다).
  const norm = /(Z|[+-]\d{2}:?\d{2})$/.test(ts) ? ts : `${ts}Z`
  const t = Date.parse(norm)
  if (Number.isNaN(t)) return ''
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** KST 기준 오늘 'YYYY-MM-DD' */
export function todayKst(now: number = Date.now()): string {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10)
}
