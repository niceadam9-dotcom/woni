/** 점검 기간 — **종료일 ↔ 일수**의 단일 원천 (2026-09-21 사용자 요청).
 *
 *  배경: 두 칸이 서로를 전혀 모르고 있었다. 종료일을 넣어도 일수가 안 따라오고, 일수를 고쳐도
 *  종료일이 안 움직였다. 그래서 **다일 점검 3건 중 3건 전부** 기간은 3·4·8일인데 저장된
 *  `inspection_days`는 `1`이었다(2026-09-21 스테이징 실측 — 100%).
 *
 *  🚨 이게 화면 안에서 끝나는 문제가 아니다. `inspection_days`는 **별지 9호에 그대로 인쇄된다**
 *    (`report9-assemble.ts`의 `inspDays`). 어긋나면 법정 서류에 「기간 9/14~9/21 · 일수 1일」이
 *    찍힌다 — 기간과 일수가 같은 종이에서 서로를 부정한다.
 *
 *  ⚠ 날짜 산술을 **여기서 새로 적지 않는다**. `daysBetween`(kst-date)·`addCalendarDays`
 *    (action-period-legal)를 그대로 쓴다 — 이 저장소에서 날짜 사본은 세 벌까지 갔고 조용히 어긋났다.
 *  ⚠ **양끝 포함**이다: 시작일이 1일차라 `종료 = 시작 + (일수-1)`이고 `일수 = diff + 1`.
 *    총 이행기간(action-period-legal)·단계 마감일과 **같은 셈법**이다. 여기만 `+N`으로 세면
 *    한 회차 안에서 하루 어긋난다(그 사고가 실제로 있었다).
 */
import { daysBetween } from './kst-date'
import { addCalendarDays } from './action-period-legal'

/** 다일 점검 상한 — DB 제약(`inspection_days BETWEEN 1 AND 5`, 마이그레이션 079)과 같은 값.
 *
 *  🚨 서버가 이 수를 넘는 값을 받으면 종전엔 **조용히 1로 떨어뜨렸다**(`<= 5 ? days : 1`).
 *    7을 넣으면 5도 아니고 1이 되는, 화면 어디에도 안 드러나는 손실이었다. 이제는 막고 말한다. */
export const MAX_INSPECTION_DAYS = 5

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** 기간(시작·종료) → 일수. 종료일이 없으면 **1일**(당일 점검, 079 주석의 「NULL이면 당일」).
 *  날짜꼴이 아니거나 종료일이 시작일보다 앞서면 `null` — 호출부가 조용히 숫자로 쓰지 못하게 한다. */
export function daysFromRange(start?: string | null, end?: string | null): number | null {
  if (!start || !YMD.test(start)) return null
  if (!end) return 1
  if (!YMD.test(end)) return null
  const d = daysBetween(start, end)
  return d < 0 ? null : d + 1
}

/** 일수 → 종료일. 1일이면 **빈 문자열**을 돌려준다 — 당일 점검은 종료일을 비워 두는 것이
 *  이 컬럼의 기존 표기다(079). 없는 날짜를 지어내 채우지 않는다. */
export function endFromDays(start?: string | null, days?: number | null): string {
  if (!start || !YMD.test(start)) return ''
  if (!Number.isFinite(days) || (days as number) <= 1) return ''
  return addCalendarDays(start, (days as number) - 1)
}

/** 화면 한 줄로 읽을 **점검기간 요약** (2026-09-22 — 점검달력 R3).
 *
 *  🚨 **저장된 일수를 그냥 찍지 않는다.** `inspection_days`와 실제 기간이 어긋난 행이 실재한다
 *    (2026-09-21 실측: 다일 3건 중 **3건 전부** 기간은 3·4·8일인데 저장값은 1). 위 수리는
 *    앞으로 들어올 값만 고치지 **과거 행을 되돌리지 않는다**. 그래서 본문은 기간에서 다시 센 값을
 *    쓰고, 저장값이 다르면 `mismatch`로 그 사실을 내보낸다 — 감추면 화면과 별지 9호가
 *    다른 말을 하는데 아무도 모른다.
 *
 *  ⚠ 순수 함수로 둔 이유: 컴포넌트 안에 인라인으로 두면 `mismatch = false`로 바꿔 놔도 소스
 *    단언이 초록이다(변이 M14가 실제로 그렇게 뚫었다). 여기 있으면 값으로 셀 수 있다. */
export function periodSummary(
  start?: string | null, end?: string | null, storedDays?: number | null,
): { text: string; days: number | null; storedDays: number | null; mismatch: boolean } {
  const days = daysFromRange(start, end)
  const stored = Number.isFinite(storedDays as number) ? (storedDays as number) : null
  // 「어긋났다」는 **둘 다 있을 때만** 할 수 있는 말이다 — 한쪽이 없으면 비교할 근거가 없다
  const mismatch = days !== null && stored !== null && stored !== days
  const text = !start || !YMD.test(start)
    ? '—'
    // 종료일이 있고 실제로 여러 날일 때만 범위로 적는다 — 당일인데 「9/14 ~ 9/14」는 소음이다
    : end && days !== null && days > 1
      ? `${start} ~ ${end} · ${days}일`
      : `${start} · 당일`
  return { text, days, storedDays: stored, mismatch }
}

/** 저장 전 판정 — 문제면 **사람이 읽을 문장**, 괜찮으면 null.
 *
 *  ⚠ 순서가 뜻을 만든다: 「거꾸로다」를 먼저 말한다. 5일 초과를 먼저 말하면 9/21~9/14 같은
 *    역전 입력에 「최대 5일입니다」라는 엉뚱한 이유가 붙는다.
 *  ⚠ 한쪽만 입력된 상태·미완성 날짜는 **통과**시킨다(date-range.ts와 같은 규약) — 타이핑 도중에
 *    빨갛게 만들면 입력이 불가능해진다. */
export function inspectionPeriodError(start?: string | null, end?: string | null): string | null {
  if (!start || !end || !YMD.test(start) || !YMD.test(end)) return null
  if (end < start) return '점검 종료일: 종료일이 시작일보다 빠를 수 없습니다.'
  const days = daysFromRange(start, end)
  if (days !== null && days > MAX_INSPECTION_DAYS) {
    return `점검 기간이 ${days}일입니다 — 다일 점검은 최대 ${MAX_INSPECTION_DAYS}일까지 기록할 수 있습니다.`
  }
  return null
}
