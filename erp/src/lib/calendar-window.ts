/** 점검 달력의 **조회 창(窓)** 산술 — 서버(page·액션)와 클라이언트가 같은 규칙으로 달 범위를 센다.
 *
 *  🎯 2026-10-01 — 달력은 여태 **전년 1월~익년 12월 3년치**를 매 진입마다 통째로 실었다
 *  (계획 항목 5,360행·HTML 415KB·조회 3초). 화면에는 한 달만 보인다. 이제 **보이는 달 앞뒤 1개월**만
 *  먼저 싣고, 그 밖으로 넘어가면 달 단위로 보충해 받는다(`loadCalendarRangeAction`).
 *
 *  ⚠ 순수 모듈이다 — React·DB·`next/*`를 끌어오지 않는다. 달력 날짜('YYYY-MM-DD')끼리의 산술이라
 *  타임존이 없다(`Date.UTC`로만 센다 — `new Date('YYYY-MM')`은 로컬 TZ가 끼어 서버·브라우저가 갈린다). */

export type DateRange = { from: string; to: string }

/** 'YYYY-MM' 꼴인가 */
export function isYm(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}
/** 'YYYY-MM-DD' 꼴인가(달력 날짜 — 실재 여부는 묻지 않는다) */
export function isYmd(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/** 달력 날짜 → 그 달('YYYY-MM') */
export function ymOf(date: string): string {
  return date.slice(0, 7)
}

/** 'YYYY-MM'에 n개월을 더한다(음수 가능) */
export function shiftYm(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 그 달의 첫날~마지막날 */
export function monthRange(ym: string): DateRange {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

/** 기준 달 앞뒤로 before·after개월을 더한 창 — 기본 ±1개월(3개월) */
export function windowAround(ym: string, before = 1, after = 1): DateRange {
  return { from: monthRange(shiftYm(ym, -before)).from, to: monthRange(shiftYm(ym, after)).to }
}

/** 창에 걸친 달 목록('YYYY-MM' 오름차순) */
export function monthsIn(range: DateRange): string[] {
  const out: string[] = []
  let ym = ymOf(range.from)
  const last = ymOf(range.to)
  for (let i = 0; i < 120 && ym <= last; i++) { out.push(ym); ym = shiftYm(ym, 1) }
  return out
}

/** 그 달 전체가 어느 한 창에 **통째로** 들어 있는가 — 반쪽만 들어 있으면 미적재로 본다 */
export function monthCovered(loaded: readonly DateRange[], ym: string): boolean {
  const r = monthRange(ym)
  return loaded.some(l => l.from <= r.from && l.to >= r.to)
}

/** 창의 달 수 — 액션이 한 번에 받아 줄 상한을 재는 데 쓴다 */
export function monthSpan(range: DateRange): number {
  return monthsIn(range).length
}

/** 보충 조회 한 번의 상한(달 수). 3년치(36)를 되살리지 않도록 막는다 — 창 축소의 목적 자체다 */
export const MAX_RANGE_MONTHS = 13
