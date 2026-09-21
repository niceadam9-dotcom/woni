import type { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_ACTION_PERIOD_DAYS, LEGAL_ACTION_PERIODS } from '@/lib/action-period-legal'

type Admin = ReturnType<typeof createAdminClient>

/** 자체점검 6단계 법정 마감일 산식 — **단일 원천**.
 *
 *  ## 왜 모듈로 뺐나
 *  이 산식은 `confirmPlanItemStageOneAction`(plan-date-actions.ts) 안에 인라인으로만 있었다.
 *  그 함수는 `'use server'` 액션이라 **크론 라우트가 부를 수 없고**(세션이 없어 requirePermission이
 *  선다), 그래서 당일 자동 시작 크론은 특별점검을 아예 대상에서 빼고 있었다.
 *
 *  빼 두는 것으로 끝났으면 무해했을 텐데, 점검확정 폐지(마이그 161·162)로 전제가 무너졌다:
 *  계획 항목이 **생성 시점에 이미 confirmed + scheduled_date**를 갖고 태어나므로 아무도
 *  `confirmPlanItemStageOneAction`을 부르지 않는다. 그 함수가 「확정=시작」(2026-07-23)의
 *  유일한 트리거였으니, 신규 특별점검은 **사람이 [작성 시작]을 누르기 전까지 시작되지 않는다**.
 *
 *  ## 왜 계산을 옮기는 것으로 부족한가
 *  생성기(inspection-plan-generator)는 `step1~6_date`를 넣지 않는다(planned_date·scheduled_date뿐).
 *  그런데 `startInspectionCore`는 마감일을 **다시 계산하지 않고** plan_item의 step1~6_date를
 *  그대로 동기화하며, `syncInspectionStepDates`는 null을 조용히 건너뛴다.
 *  → 크론 필터만 넓히면 6단계 due_date가 DB 트리거의 **사용승인일 기준** 값으로 남는다.
 *    확정일 기준이어야 하는 법정 마감일이 두 갈래로 갈라지고, 그 사실이 화면 어디에도 안 드러난다.
 *
 *  그래서 산식을 여기로 올리고, 시작 경로가 **비어 있으면 스스로 채우게** 했다
 *  (`startInspectionCore`). 크론·[작성 시작]·일괄 어느 문으로 들어와도 같은 값이 나온다.
 */

/** 마감일 계산에 필요한 공휴일 범위 — 확정일 기준 이전 1개월 ~ 이후 7개월.
 *
 *  ⚠ 종료일을 '-31'로 하드코딩하면 2·4·6·9·11월에서 무효 날짜(예: 2027-02-31)가 되어 쿼리가
 *  통째로 실패하고 **공휴일이 전부 무시된다**(실증: 2026-07-09 제헌절 미제외). 말일을 정확히 계산한다. */
export async function loadStepHolidaySet(
  admin: Admin,
  confirmedDate: string,
): Promise<{ holidays?: Set<string>; error?: string }> {
  const base = new Date(confirmedDate)
  const rangeStart = new Date(base); rangeStart.setMonth(rangeStart.getMonth() - 1)
  const rangeEnd   = new Date(base); rangeEnd.setMonth(rangeEnd.getMonth() + 7)
  const startStr = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth()+1).padStart(2,'0')}-01`
  const rangeEndLast = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 0)
  const endStr = `${rangeEndLast.getFullYear()}-${String(rangeEndLast.getMonth()+1).padStart(2,'0')}-${String(rangeEndLast.getDate()).padStart(2,'0')}`

  const { data, error } = await admin
    .from('holidays').select('date')
    .gte('date', startStr).lte('date', endStr)
  // 공휴일 없이 계산하면 마감일이 조용히 틀어지므로 조회 실패는 명시적으로 중단한다
  if (error) return { error: '공휴일 조회에 실패했습니다. 잠시 후 다시 시도해주세요.' }
  return { holidays: new Set((data ?? []).map(h => (h as Record<string, unknown>).date as string)) }
}

export type StepDates = [string, string, string, string, string, string]

/** 확정일 → 1~6단계 마감일. 순수 함수 — 공휴일 셋만 주면 DB 없이 검사할 수 있다.
 *
 *  · 2·3·4단계: 확정일로부터 5·10·15 **영업일**(주말·공휴일 제외)
 *  · 5단계: 4단계 **당일을 1일째로 포함한 총 이행기간째**(= +days-1, 주말·공휴일 포함 = 달력일)
 *    2026-07-09 사용자 확정: step4 08-18 → step5 08-27(10일). DB 트리거·recalc도 050에서 같은 규칙.
 *  · 6단계: 5단계로부터 10 영업일
 *
 *  🚨 2026-09-21 — `totalDays`를 인자로 올렸다. 종전에는 **10일이 하드코딩**(`+9`)돼 있었는데,
 *    총 이행기간은 시행규칙 제23조제5항에 따라 **10일(수리·정비) 또는 20일(철거·교체)** 중
 *    사람이 고르는 값이다(`action-period-legal.LEGAL_ACTION_PERIODS`). 그래서 20일을 고른 회차는
 *    ⑤ 마감이 **열흘 이르게** 서 있었고, ⑥은 ⑤+10영업일이라 **함께 당겨졌다**
 *    (실측 2026-09-21 스테이징: 20일 선택 1건 — ④ 10-12 → ⑤ 10-21, 기대 10-31).
 *  ⚠ 기본값은 `DEFAULT_ACTION_PERIOD_DAYS`(10) — 별지 10호를 아직 안 쓴 회차의 종전 동작을
 *    그대로 둔다. 상수를 여기 다시 적지 않는다(적으면 법정 기본이 두 곳이 된다).
 *  ⚠ 검증 표본: **운영 하늘촌 2026-1**(확정 09-18·총 10일) 6단계 전부 일치 — 회귀로 고정했다. */
export function computeStepDates(
  confirmedDate: string,
  holidaySet: Set<string>,
  totalDays: number = DEFAULT_ACTION_PERIOD_DAYS,
): StepDates {
  function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  function addWorkingDays(from: Date, n: number): string {
    const d = new Date(from)
    let count = 0
    while (count < n) {
      d.setDate(d.getDate() + 1)
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6 && !holidaySet.has(toDateStr(d))) count++
    }
    return toDateStr(d)
  }

  const step1 = confirmedDate
  const step2 = addWorkingDays(new Date(step1), 5)
  const step3 = addWorkingDays(new Date(step1), 10)
  const step4 = addWorkingDays(new Date(step1), 15)
  // 총 이행기간은 **당일을 1일째로 센다** — 10일이면 +9, 20일이면 +19. 달력일이라 주말·공휴일을 포함한다
  // (영업일 축인 ②③④⑥과 섞지 말 것 — annex-due.ts:7의 경고와 같은 자리다).
  const step4Date = new Date(step4); step4Date.setDate(step4Date.getDate() + (totalDays - 1))
  const step5 = toDateStr(step4Date)
  const step6 = addWorkingDays(new Date(step5), 10)
  return [step1, step2, step3, step4, step5, step6]
}

/** 조회 + 계산을 한 번에 — 호출처가 공휴일 범위 규칙을 다시 쓰지 않게 한다.
 *  `totalDays`를 주지 않으면 법정 기본(10일)이다 — 별지 10호를 아직 안 쓴 회차가 그 경우다. */
export async function resolveStepDates(
  admin: Admin,
  confirmedDate: string,
  totalDays?: number,
): Promise<{ dates?: StepDates; error?: string }> {
  const { holidays, error } = await loadStepHolidaySet(admin, confirmedDate)
  if (error || !holidays) return { error: error ?? '공휴일 조회에 실패했습니다.' }
  return { dates: computeStepDates(confirmedDate, holidays, totalDays) }
}

/** 이 점검 건의 총 이행기간(일) — 별지 10호에 사람이 고른 값, 없으면 법정 기본 10일.
 *
 *  ⚠ `annex_inputs.fields.totalDays`는 **문자열**이다(폼이 그렇게 저장한다). 숫자로 바꾸되
 *    법정 목록(10·20)에 없는 값은 받지 않는다 — 손으로 고친 흔적이 마감일 산식에 새어들면
 *    법정 기한이 조용히 임의값이 된다. */
export async function resolveTotalActionDays(admin: Admin, inspectionId: string): Promise<number> {
  const { data } = await admin.from('annex_inputs')
    .select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'report10').maybeSingle()
  const raw = (data as { fields?: Record<string, unknown> } | null)?.fields?.totalDays
  const n = Number(String(raw ?? '').trim())
  return LEGAL_ACTION_PERIODS.some(p => p.days === n) ? n : DEFAULT_ACTION_PERIOD_DAYS
}

/** 이 점검 건의 6단계 마감일을 **지금의 확정일·총 이행기간으로** 다시 계산해 저장한다.
 *
 *  쓰는 곳: 별지 10호 총 이행기간 변경(10↔20일). 그 값이 ⑤⑥ 마감을 움직이는데 종전에는
 *  그 경로가 없어 저장만 되고 마감은 옛 기준으로 남았다.
 *
 *  ⚠ 기산일은 **`inspection_steps` 1단계 마감**이다 — 그 값이 곧 확정일이고(computeStepDates의
 *    step1 = confirmedDate), 달력·작업대가 읽는 바로 그 칸이라 축이 갈라질 수 없다.
 *    계획 항목(`plan_item.scheduled_date`)을 다시 읽지 않는 이유가 이것이다: 시작 이후에
 *    점검일이 옮겨진 회차는 두 값이 다를 수 있고, 화면이 보는 쪽은 `inspection_steps`다.
 *  ⚠ 완료된 단계의 마감도 함께 갱신한다 — 마감일은 '지켜야 했던 날짜'라 사후에도 사실이어야 한다
 *    (`recalcStepDueDates`의 `p_include_completed: true`와 같은 판단). */
export async function recalcStepDatesForInspection(
  admin: Admin, inspectionId: string,
): Promise<{ dates?: StepDates; error?: string }> {
  const { data: rows, error: readErr } = await admin.from('inspection_steps')
    .select('step_num, due_date').eq('inspection_id', inspectionId).order('step_num')
  if (readErr) return { error: `단계 조회 실패: ${readErr.message}` }
  const confirmed = ((rows ?? []) as Array<{ step_num: number; due_date: string | null }>)
    .find(r => r.step_num === 1)?.due_date
  // 1단계 마감이 없으면 기산일이 없다 — 지어내지 않는다(시작 전 회차가 그 경우다)
  if (!confirmed) return { error: '1단계 마감일(확정일)이 없어 재계산할 수 없습니다.' }

  const totalDays = await resolveTotalActionDays(admin, inspectionId)
  const { dates, error } = await resolveStepDates(admin, confirmed, totalDays)
  if (error || !dates) return { error: error ?? '공휴일 조회에 실패했습니다.' }

  // ⑤⑥만 움직이지만 여섯 칸을 다 쓴다 — 부분 갱신은 '어느 칸이 새 산식인지'를 흐린다
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const { error: updErr } = await admin.from('inspection_steps')
      .update({ due_date: dates[n - 1] } as Record<string, unknown>)
      .eq('inspection_id', inspectionId).eq('step_num', n)
    if (updErr) return { error: `${n}단계 마감 갱신 실패: ${updErr.message}` }
  }
  return { dates }
}

/** 이 계획 항목이 6단계(자체점검) 대상인가 — 정기(monthly)·레거시 event는 1단계형.
 *  일반관리는 plan_type이 null인데 **6단계 대상**이다(소방계획서_6 W-10, migration 111 트리거와 동일 분기). */
export function isSixStepPlanType(planType: string | null | undefined): boolean {
  return !planType || planType.startsWith('special')
}
