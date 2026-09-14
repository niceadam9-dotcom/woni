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

/** 두 **달력 날짜**('YYYY-MM-DD') 사이의 일수 — `b - a`. 음수면 b가 앞선다.
 *
 *  ⚠ 위 `kstDate`와 달리 여기엔 타임존이 없다. `use_approval_date`·`inspection_start_date`처럼
 *  DATE 컬럼끼리 재는 축이라 `Date.UTC`로 두 날을 같은 기준에 놓고 뺀다 — 로컬 TZ가 끼면
 *  서버·브라우저에서 답이 갈린다(같은 이유로 `new Date('YYYY-MM-DD')`를 쓰지 않는다).
 *
 *  ⚠ 이 구현은 `sms-recipients.ts`가 쓰던 것을 **옮겨온 것**이다(그쪽은 이제 여기서 재수출한다).
 *  날짜 산술 사본이 둘이면 조용히 어긋난다 — 같은 실수가 `fetchAllRows`에서 3벌까지 갔다(16 K-9). */
export function daysBetween(baseDate: string, targetDate: string): number {
  const a = Date.UTC(+baseDate.slice(0, 4), +baseDate.slice(5, 7) - 1, +baseDate.slice(8, 10))
  const b = Date.UTC(+targetDate.slice(0, 4), +targetDate.slice(5, 7) - 1, +targetDate.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/** 'YYYY-MM-DD'의 **한글 요일** 한 글자 — '월'·'화'…·'일'.
 *
 *  ⚠ `new Date('YYYY-MM-DD')`를 쓰지 않는다(위 daysBetween과 같은 이유) — 그 파싱은 UTC 자정이라
 *    음수 오프셋 지역에서 하루 앞 요일이 나온다. 서버 렌더와 브라우저가 **다른 요일**을 찍으면
 *    하이드레이션 불일치로 조용히 갈린다. Date.UTC로 고정해 어디서 불러도 같은 답을 준다.
 *
 *  왜 필요한가: 법정 점검 예정일은 토·일·공휴일이면 영업일로 밀린다. 사용자는 「사용승인일이
 *  26일인데 왜 28일인가」를 묻게 되는데, 요일을 함께 보여주면 그 자리에서 답이 된다(2026-09-14). */
export function weekdayKo(iso: string): string {
  if (!iso || iso.length < 10) return ''
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)))
  return ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()]
}

/** 'YYYY-MM-DD (금)' 표기 — 날짜와 요일을 늘 붙여 다니게 한다 */
export function ymdWithWeekday(iso: string | null | undefined): string {
  return iso ? `${iso} (${weekdayKo(iso)})` : '—'
}
