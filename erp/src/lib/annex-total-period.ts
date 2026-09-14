/** ④ 「총 이행기간 (수동 보정)」 수기값 → 기간 (2026-09-10 사용자 지시)
 *
 *  배경: 사용자가 ④에서 총 이행기간을 손으로 고치면 **PDF 별지 10호만** 그 값을 인쇄하고
 *  갑지 엑셀은 자동 산출값(`actionPlanPeriod` — 불량들의 action_start~action_end)을 그대로
 *  찍었다. 같은 회차의 두 산출물이 다른 날짜를 말한 것이다. 원인은 하나 —
 *  `workbook/route.ts`가 `annex_inputs`의 **report11(보고일)만** 읽고 report10을 안 읽었다.
 *
 *  이 값이 닿는 곳(전부 `actionPeriod` 하나에서 갈라진다):
 *    개요!G9(시작) · I9(종료) · J9(일수) · **G10(이행조치일자)** · 계획서!K·O·P 21칸
 *  ⚠ G10은 서식 원문이 `=I9`다 — 「이행조치일자」칸은 **원래부터 이행기간 종료일**을 가리키게
 *    만들어진 칸이다(xlsx-workbook.ts의 실측 주석). 그래서 여기서 기간만 바로잡으면 그 칸도
 *    저절로 옳아진다. G10의 계산식을 따로 손대면 축이 둘로 갈라진다.
 *
 *  ⚠ 법정 10·20일 산식은 여기 없다(action-period-legal.ts). 이 파일은 **이미 저장된 문자열을
 *    읽어 기간으로 바꾸기만** 한다.
 *
 *  🚧 **`date-range.ts`에 같은 파싱을 하는 `splitRange`가 들어오는 중이다**(2026-09-10 현재 타 세션
 *    미커밋). 그쪽이 먼저 들어왔다면 아래 `splitRange`를 지우고 그걸 import할 것 — 구분자 규칙이
 *    두 곳에 있으면 한쪽만 고쳐지는 날이 온다. 지금 import하지 **않는** 이유는 하나다:
 *    아직 HEAD에 없는 함수를 물면 이 커밋이 **HEAD를 깨뜨린다**([[risk_head_broken_imports]]).
 *    격리 워크트리 tsc가 이걸 잡았다 — 공유 트리에서는 남의 미커밋 덕에 초록이었다.
 */
import type { AnnexDone } from '@/lib/doc-templates/report9'
import { legalActionRange, DEFAULT_ACTION_PERIOD_DAYS } from '@/lib/action-period-legal'

export type ActionPeriod = { startISO: string; endISO: string; days: number }

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** "YYYY-MM-DD ~ YYYY-MM-DD" → `[시작, 종료]`. 완성된 날짜만 돌려주고 나머지는 `''`.
 *  ⚠ 과거 자유 텍스트('8월 중')가 날짜 산술로 새면 `new Date()`가 Invalid Date를 만들고
 *    그게 조용히 NaN 일수가 된다 — 그래서 꼴이 맞는 것만 통과시킨다. */
function splitRange(value: string): [string, string] {
  const [s = '', e = ''] = value.split(/\s*~\s*/)
  const ok = (v: string) => (YMD.test(v.trim()) ? v.trim() : '')
  return [ok(s), ok(e)]
}

/** 저장된 수기 총 이행기간 → 기간. 두 토막이 **모두** 완성된 `YYYY-MM-DD`일 때만 값이 있다.
 *
 *  🚨 **일수는 `totalDays` 칸을 믿지 않고 기간에서 다시 센다.** 엑셀 서식은 `I9 = G9 + J9 - 1`
 *    항등 위에 서 있어서(J9=일수), 저장된 일수가 기간과 어긋나면 **엑셀을 열어 재계산하는
 *    순간 종료일이 움직인다**. 사용자가 보는 화면 위젯도 시작일+일수로 종료일을 만들므로
 *    정상 입력에서는 두 값이 같다 — 어긋난 경우에만 기간 쪽을 정본으로 삼는 셈이다.
 *  ⚠ 양끝 포함(diff + 1) — `actionPlanPeriod`(자동 산출)와 **같은 셈법**이라야 수기/자동이
 *    같은 날짜에서 같은 일수를 낸다.
 *  ⚠ 과거 자유 텍스트('8월 중')는 `splitRange`가 걸러 null로 떨어진다 — 그때는 호출부가
 *    자동 산출값을 그대로 쓴다. 엑셀 날짜 칸은 serial이라 자유 텍스트를 실을 수 없고,
 *    PDF는 그 문자열을 그대로 인쇄한다(표현 가능한 쪽이 각자 최선을 한다).
 *  ⚠ 종료<시작이면 **버린다**. 저장 경로(dateRangeError)가 막는 조합이지만 과거 행에 남아
 *    있을 수 있고, 음수 일수가 엑셀에 실리면 인쇄물이 조용히 망가진다. */
export function manualActionPeriod(fields: Record<string, unknown>): ActionPeriod | null {
  const raw = fields['totalPeriod']
  if (typeof raw !== 'string') return null
  const [startISO, endISO] = splitRange(raw)
  if (!startISO || !endISO) return null
  if (endISO < startISO) return null
  const days = Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 86400000) + 1
  return { startISO, endISO, days }
}

/** 3순위 「법정 기본」의 재료 — 기산일(보고일)과 「이 회차에 이행할 것이 있는가」. */
export type LegalFallbackCtx = {
  /** 조문의 기산일 = 보고일(`annexReportDateISO`). 날짜꼴이 아니면 기본을 깔지 않는다 */
  reportDateISO?: string | null
  /** 불량(이행조치 계획)이 하나라도 있는가 — 없으면 이행기간 자체가 뜻이 없다 */
  hasDefect?: boolean
}

/** 수기 > 자동 > **법정 기본** — 호출부가 우선순위를 다시 적지 않게 한다.
 *  PDF(`report9-actions`의 report10 분기)와 갑지 엑셀(`workbook/route`)이 **같은 이 함수**를 탄다.
 *
 *  ## 3순위를 붙인 이유 (2026-09-14 사용자 확정)
 *  종전엔 「수기 > 자동」 둘뿐이었고, 둘 다 없으면 법정 서식의 이행조치기간이 **공란으로 제출**됐다.
 *  그런데 2순위(자동)의 원천인 **불량별 계획 시작·종료일 입력이 2026-09-11에 폐지**되어
 *  (`defect-grid` 입력 열 제거) 새 회차에서는 영영 0건이다. 즉 ④에서 손으로 넣지 않으면
 *  **반드시** 빈다. 스테이징 실측이 그대로였다 — 불량 있는 7회차 중 5회차가 공란, 수기 입력은 0건.
 *
 *  🚨 **없는 값을 지어내는 것**이므로 경계를 좁게 둔다:
 *   ① 불량이 없으면 깔지 않는다 — 이행할 것이 없는 회차에 기간이 서면 거짓이다.
 *   ② 기산일이 날짜꼴이 아니면 깔지 않는다.
 *   ③ **10일**(1호 수리·정비)이다 — 짧은 쪽이라, 틀렸을 때 사용자는 늘리는 쪽으로 고치게 되고
 *     법정 상한(20일)을 넘긴 기간이 조용히 인쇄되지 않는다(`DEFAULT_ACTION_PERIOD_DAYS` 주석).
 *   ④ **저장하지 않는다.** 화면은 이걸 자동값으로 비추기만 하고, 사용자가 고른 값만
 *     `annex_inputs`에 남는다 — 저장하면 그 순간 수동값이 되어 보고일을 고쳐도 옛 기간이 굳는다
 *     (공문 자동값 `getAnnexAutoDefaultsAction`이 같은 이유로 같은 규약을 쓴다). */
export function resolveActionPeriod(
  fields: Record<string, unknown>,
  auto?: ActionPeriod | null,
  legal?: LegalFallbackCtx | null,
): ActionPeriod | null {
  const chosen = manualActionPeriod(fields) ?? auto ?? null
  if (chosen) return chosen
  if (!legal?.hasDefect) return null
  return legalActionRange((legal.reportDateISO ?? '').slice(0, 10), DEFAULT_ACTION_PERIOD_DAYS)
}

/** 별지 11호 「이행완료 사항」 일자 = **총 이행기간 종료일**로 통일 (2026-09-10 사용자 지시).
 *
 *  종전에는 불량 **건별** `action_completed_at`을 그대로 찍어, 한 서식 안에서 4행이 서로 다른
 *  날짜를 말했다. 별지 10호 7행을 하나의 기간으로 통일한 것과 같은 이유다 — 소방서가 승인하는
 *  것은 **하나의 이행기간**이고, 그 기간이 끝나는 날 이행이 완료된 것으로 본다.
 *
 *  ⚠ **PDF 11호와 갑지 엑셀 `완료보고서!I19:I22`가 둘 다 이 함수를 탄다**(D-7). 한쪽만 적용하면
 *    같은 회차의 두 산출물이 다시 다른 날짜를 말한다 — 이 세션이 고치러 온 바로 그 형태다.
 *  ⚠ **기간이 없으면 건별 완료일을 그대로 둔다**(무변경 반환). 기간을 안 정한 회차에서 날짜를
 *    지워 버리면 법정 서식의 일자 칸이 통째로 비어 나간다 — 없느니만 못하다.
 *  ⚠ `kind !== 'rows'`(결과참조·이상없음·해당없음)는 손대지 않는다. 그 줄은 개별 이행조치가
 *    아니어서 일자 칸이 비는 게 정상이고, 「해당없음」 옆에 날짜가 서면 미대상 설비에 이행기간을
 *    적으라는 말이 된다(Q-5 b안).
 *  ⚠ 엑셀 4행 접기(`doneCells`)의 「외 N건」 행은 여기를 거치지 않는다 — 그 행은 접기가 새로
 *    만들고 `doneISO: ''`를 준다. 통일이 그 행에 날짜를 붙이는 일은 구조적으로 없다.
 *  ⚠ `done` 미공급(구 호출부·픽스처)도 그대로 통과시킨다 — 조립본에서 선택 필드라, 여기서
 *    빈 객체를 만들어 주면 「완료 0건」이 아니라 **「완료 축을 계산했는데 결과가 없다」**로 바뀌어
 *    하위 호환 대조군(8칸 공백 1칸)이 깨진다. */
export function unifyDoneDates(
  done: AnnexDone | undefined, periodEndISO?: string | null,
): AnnexDone | undefined {
  const end = (periodEndISO ?? '').trim().slice(0, 10)
  if (!done || !end || done.kind !== 'rows') return done
  return { ...done, rows: done.rows.map(r => ({ ...r, doneISO: end })) }
}
