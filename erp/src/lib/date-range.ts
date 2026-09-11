/** 기간(시작일~종료일) 입력 검증 — 화면·서버 공용 단일 규칙 (2026-08-19)
 *
 *  배경: 불량 이행기간에 2026-08-20 ~ 2026-08-18을 넣어도 조용히 저장됐다(사용자 보고).
 *  기간 입력이 앱 곳곳에 흩어져 있어 어떤 곳은 막고 어떤 곳은 안 막는 상태였다 —
 *  규칙을 여기 하나로 모으고, **서버 액션에서도** 같은 함수를 부른다.
 *  화면 검사만 두면 액션이 곧 공개 엔드포인트라 그대로 뚫린다('use server' 규약).
 *
 *  판정 규칙:
 *  - 한쪽만 입력된 상태는 통과 — 작성 중일 수 있고, 부분 입력을 막으면 타이핑이 불가능해진다.
 *  - YYYY-MM-DD로 완성되지 않은 값은 통과 — 미완성 형식은 각 칸의 형식 검증이 따로 잡는다.
 *  - 같은 날(당일 시작·종료)은 **허용**한다. 하루짜리 이행·1일 점검이 정상 업무다.
 *  - ISO 문자열은 사전식 비교가 곧 시간순 비교라 Date 파싱이 필요 없다(타임존 함정 회피). */

export const DATE_RANGE_ERROR = '종료일이 시작일보다 빠를 수 없습니다.'

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** 종료일이 시작일보다 앞서는가 — 위 규칙에 따라 '판정 불가'는 전부 false */
export function isEndBeforeStart(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return false
  if (!YMD.test(start) || !YMD.test(end)) return false
  return end < start
}

/** 위반이면 메시지, 아니면 null.
 *  호출부 관용구: `const err = dateRangeError(s, e, '이행 기간'); if (err) return { error: err }` */
export function dateRangeError(
  start?: string | null, end?: string | null, label?: string,
): string | null {
  if (!isEndBeforeStart(start, end)) return null
  return label ? `${label}: ${DATE_RANGE_ERROR}` : DATE_RANGE_ERROR
}

/** "YYYY-MM-DD ~ YYYY-MM-DD" 한 문자열로 저장하는 칸(가입기간·총 이행기간)용.
 *  과거 자유 텍스트가 들어 있는 행도 있으므로, 두 토막이 모두 완성된 날짜일 때만 판정한다. */
export function combinedRangeError(value?: string | null, label?: string): string | null {
  if (!value) return null
  const [s = '', e = ''] = value.split(/\s*~\s*/)
  return dateRangeError(s.trim(), e.trim(), label)
}

/** 같은 저장 형식을 **읽는** 쪽의 단일 원천 — `[시작, 종료]`, 없거나 날짜꼴이 아니면 ''.
 *
 *  ⚠ 구분자 정규식을 호출부마다 다시 적지 않는다. 화면(annex-fields)·서버(별지 기한 산식)가
 *    같은 문자열을 읽는데 한쪽만 `~` 앞뒤 공백을 다르게 다루면 **한 화면에서만 기간이 사라진다**.
 *  ⚠ 완성된 `YYYY-MM-DD`만 돌려준다 — 과거 자유 텍스트('8월 중')가 날짜 산술로 새어 들어가면
 *    `new Date()`가 Invalid Date를 만들고 그게 조용히 NaN 기한이 된다. */
export function splitRange(value?: string | null): [string, string] {
  const [s = '', e = ''] = (value ?? '').split(/\s*~\s*/)
  const ok = (v: string) => (YMD.test(v.trim()) ? v.trim() : '')
  return [ok(s), ok(e)]
}
