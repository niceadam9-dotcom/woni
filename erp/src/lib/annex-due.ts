/** 별지 9호·11호 **제출 기한** — 작업대의 기한 표시·D-day가 읽는 단일 원천 (2026-09-09).
 *
 *  두 기한 모두 **영업일**이다(사용자 확정 2026-09-09):
 *    ④ 별지 9호  = 점검이 끝난 날부터 **15영업일**
 *    ⑥ 별지 11호 = 이행 보수를 완료한 날부터 **10영업일**
 *
 *  ⚠ **⑤ 이행기간(10·20일)만 달력일이다.** 같은 업무 흐름에 두 기준이 섞여 있으니
 *    `action-period-legal.ts`(달력일 축)와 이 파일(영업일 축)을 서로 돌려쓰지 말 것.
 *
 *  🚨 종전에는 이 두 산식이 `inspections/[id]/page.tsx` 안에 인라인으로 있었고 **둘 다 틀렸다**:
 *    ④는 달력일 15일이었고(트리거·법정과 어긋남), ⑥은 `max(action_end)` 그 자체라 **+10일이
 *    아예 없었다** — 보수를 끝낸 날 당일이 곧 제출 기한이라고 화면이 말하고 있었다.
 *    화면 안에 있으면 검사가 닿지 않아 그 상태로 남는다. 그래서 여기로 뺐다.
 *
 *  ⚠ 영업일 계산은 `step-dates.addWorkingDays`를 **재사용**한다. 점검 6단계 마감일이 쓰는 바로
 *    그 함수라, 공휴일 판정이 화면과 단계에서 갈라질 수 없다.
 */
import { addWorkingDays } from '@/lib/step-dates'
import { splitRange } from '@/lib/date-range'
import { COMPLETION_REPORT_WORKING_DAYS } from '@/lib/action-period-legal'

/** 「점검이 끝난 날부터 15일 이내」 — 시행규칙 제23조제2항 */
export const REPORT9_WORKING_DAYS = 15

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** **실재하는 날짜**인가 — 모양만 보면 부족하다.
 *
 *  🚨 `2026-13-99`는 `^\d{4}-\d{2}-\d{2}$`를 통과하는데 JS `Date`가 조용히 **다음 해로 굴린다**
 *    (2027-04-08). 그러면 있지도 않은 기한이 화면에 서고, 그게 법정 마감일로 읽힌다.
 *    `2026-02-30`도 같다. 왕복 대조(만들어서 다시 찍어 같은가)가 이 둘을 한 번에 잡는다.
 *  ⚠ 기산점은 DB DATE(항상 유효)뿐 아니라 **사람이 적은 `annex_inputs.totalPeriod`**에서도 온다. */
function validISO(v: string): boolean {
  if (!ISO_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** 날짜가 아니면 null — 계산하지 않는다(없는 기한을 지어내는 것보다 안 보이는 편이 낫다) */
function due(baseISO: string | null | undefined, days: number, holidays: ReadonlySet<string>): string | null {
  const b = (baseISO ?? '').slice(0, 10)
  if (!validISO(b)) return null
  return addWorkingDays(b, days, holidays as Set<string>)
}

/** ④ 별지 9호 제출 기한 — 기산점은 **점검 종료일**(다일 점검이면 마지막 날). */
export function report9DueISO(
  inspectionEndISO: string | null | undefined, holidays: ReadonlySet<string>,
): string | null {
  return due(inspectionEndISO, REPORT9_WORKING_DAYS, holidays)
}

/**
 * 이행 보수 완료일(= 이행기간 종료일) — ⑥ 기한의 기산점.
 *
 *  ① 별지 10호 「총 이행기간」의 종료일 — 사람이 확정해 소방서에 낸 값이라 이것이 정본이다
 *  ② 없으면 불량별 `action_end`의 최댓값 — 종전 동작
 *
 *  ⚠ 불량이 0건이면 둘 다 비어 `''`가 된다. 그게 곧 **⑥ 해당없음**의 표현이다
 *    (불량 0건이면 이행완료보고서를 내지 않고 별지 9호만 낸다 — 소방계획서_45 규약).
 *    여기서 오늘 날짜 같은 것으로 메우지 말 것: 없는 기한을 지어내게 된다.
 */
export function repairEndISO(src: {
  /** annex_inputs report10 `totalPeriod` — "YYYY-MM-DD ~ YYYY-MM-DD" */
  totalPeriod?: string | null
  /** 불량별 `action_end` (정렬 여부 무관) */
  actionEnds?: ReadonlyArray<string | null | undefined>
}): string {
  const [, end] = splitRange(src.totalPeriod ?? '')
  if (end) return end
  const ends = (src.actionEnds ?? []).filter((v): v is string => !!v).map(v => v.slice(0, 10)).sort()
  return ends.length ? ends[ends.length - 1] : ''
}

/** ⑥ 별지 11호 제출 기한 — 이행 보수 완료일 + 10영업일. 기산점이 없으면 null(= 해당없음). */
export function report11DueISO(
  repairEnd: string | null | undefined, holidays: ReadonlySet<string>,
): string | null {
  return due(repairEnd, COMPLETION_REPORT_WORKING_DAYS, holidays)
}
