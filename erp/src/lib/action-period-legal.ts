/** 이행조치 완료기간의 **법정 기산** — 「소방시설 설치 및 관리에 관한 법률 시행규칙」 제23조**제5항**.
 *
 *    1호  소방시설등을 구성하고 있는 기계·기구를 수리하거나 정비하는 경우 : 보고일부터 **10일** 이내
 *    2호  소방시설등의 전부 또는 일부를 철거하고 새로 교체하는 경우      : 보고일부터 **20일** 이내
 *
 *  ⚠ 조문 번호를 **제2항이라 적었던 것을 제5항으로 정정**했다(2026-09-08 법령 원문 대조).
 *    제2항은 관계인의 15일 보고(별지 9호)이고 완료기간 각 호는 제5항이다. 별지 10호 서식 본문의
 *    「시행규칙 제23조제2항」은 **그대로 둔다** — 이행계획서는 그 15일 보고의 첨부서류라 맞는 인용이다
 *    (별지 11호 본문의 제6항도 맞다). 틀렸던 건 우리가 덧붙인 설명 축뿐이었다.
 *
 *  별지 10호(이행계획서)의 「총 이행기간」·「총 일수」가 이 두 값으로만 나오도록 하는 단일 원천이다.
 *
 *  ⚠ **`actionPlanPeriod()`(report9-assemble.ts)와 축이 다르다.** 그쪽은 불량별 계획 시작·종료일을
 *    실측해 **양끝 포함(diff+1)** 으로 세는 *실적* 축이고, 여기는 조문이 정한 *상한* 축이다.
 *    조문은 "보고일부터 n일 이내"라고만 하므로 종료일 = 보고일 + n이고 총 일수 = n이다
 *    (2026-08-05 보고 → 2026-08-15, 10일 — 사용자 실사용 표기와 일치).
 *    둘을 같은 함수로 합치지 말 것: 한쪽을 고치면 다른 쪽이 조용히 따라 움직인다.
 *
 *  ⚠ **영업일 보정을 하지 않는다.** 조문에 그런 단서가 없다. 점검 6단계 마감일(step-dates.ts)이
 *    `add_working_days`를 쓰는 것은 그쪽이 내부 업무 일정 축이기 때문이고, 이 칸은 제출 문서에
 *    인쇄되는 법정 기간이다. 두 축을 섞으면 문서에 조문과 다른 날짜가 찍힌다. */

export type LegalActionPeriodKind = 'repair' | 'replace'

export type LegalActionPeriod = {
  kind: LegalActionPeriodKind
  /** 보고일부터 며칠 이내 */
  days: 10 | 20
  /** 조치 유형 — 버튼 라벨·문서 안내에 쓰는 조문 자구 요약 */
  label: string
  /** 근거 조문 */
  basis: string
}

/** 조문 순서 그대로. 화면 버튼도 이 배열을 돌아 그린다 — 목록을 손으로 두 벌 적지 않는다. */
export const LEGAL_ACTION_PERIODS: readonly LegalActionPeriod[] = [
  { kind: 'repair', days: 10, label: '수리·정비', basis: '시행규칙 제23조제5항제1호' },
  { kind: 'replace', days: 20, label: '철거·교체', basis: '시행규칙 제23조제5항제2호' },
] as const

/** 총일수를 **고르기 전에 시작일부터 적었을 때** 기본으로 잡는 일수(2026-09-11 사용자 지시).
 *
 *  1호(수리·정비 10일)다. 짧은 쪽을 기본으로 두는 것이 안전한 방향이다 — 틀렸을 때 사용자는
 *  기간을 **늘리는** 쪽으로 고치게 되고, 법정 상한(20일)을 넘긴 기간이 조용히 인쇄되지 않는다.
 *  ⚠ **이미 적혀 있는 종료일에는 쓰지 않는다.** 호출부가 「종료일이 비어 있을 때만」 적용한다 —
 *    손으로 정한 기간을 기본값으로 덮으면 되돌릴 방법이 없다. */
export const DEFAULT_ACTION_PERIOD_DAYS: LegalActionPeriod['days'] = 10

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** 달력일 더하기 — `daysBetween`(kst-date.ts)과 같은 UTC 기준.
 *  `new Date('YYYY-MM-DD')`나 로컬 생성자를 쓰면 서버·브라우저 TZ에 따라 답이 갈린다. */
export function addCalendarDays(baseISO: string, n: number): string {
  const t = Date.UTC(+baseISO.slice(0, 4), +baseISO.slice(5, 7) - 1, +baseISO.slice(8, 10))
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10)
}

/** 보고일 + 법정 일수 → 총 이행기간. 보고일이 날짜꼴이 아니면 null(호출부가 조용히 넘어가지 않게). */
export function legalActionRange(baseISO: string, days: number): { startISO: string; endISO: string; days: number } | null {
  if (!ISO_RE.test((baseISO ?? '').slice(0, 10))) return null
  const start = baseISO.slice(0, 10)
  return { startISO: start, endISO: addCalendarDays(start, days), days }
}

/** 작성 패널 `totalPeriod` 저장 형식("YYYY-MM-DD ~ YYYY-MM-DD")과 `totalDays` 한 벌.
 *  저장 형식을 여기서 만든다 — 화면이 문자열을 따로 조립하면 daterange 파서와 어긋난다. */
export function legalActionFields(baseISO: string, days: number): { totalPeriod: string; totalDays: string } | null {
  const r = legalActionRange(baseISO, days)
  return r ? { totalPeriod: `${r.startISO} ~ ${r.endISO}`, totalDays: String(r.days) } : null
}

/* ─────────────── 이행기간 종료일에서 파생되는 두 날짜 (2026-09-09 사용자 확정) ─────────────── */

/** ⑥ 이행완료 보고서 제출 기한의 일수 — **이행 보수를 완료한 날부터 10일**.
 *
 *  ⚠ 이 10일은 **영업일**이다(2026-09-09 사용자 확정). 위 §이행기간(10·20일)이 달력일인 것과
 *    기준이 다르다 — 한 파일 안에 두 기준이 있으니 **상수를 서로 돌려쓰지 말 것**.
 *  ⚠ 그래서 이 파일은 날짜를 직접 만들지 않는다. 영업일 계산은 공휴일 표가 있어야 하고
 *    그 표를 아는 곳은 서버뿐이라, `addWorkingDays`(step-dates.ts)를 부르는 **호출부가** 만든다. */
export const COMPLETION_REPORT_WORKING_DAYS = 10

/** 이행 기간 연기 신청 마감 — **만료일 3일 전까지**(2026-09-09 사용자 확정).
 *
 *  달력일이다: 이행기간 자체가 달력일 축이고, 「3일 전」에 영업일 단서가 없다.
 *  기간이 없거나 날짜꼴이 아니면 null — 호출부가 그 줄을 아예 안 그리게 한다
 *  (「연기 신청 마감: —」이라 적으면 없는 사실을 지어내는 것이다). */
export function extensionRequestDue(endISO?: string | null): string | null {
  const e = (endISO ?? '').slice(0, 10)
  if (!ISO_RE.test(e)) return null
  return addCalendarDays(e, -3)
}
