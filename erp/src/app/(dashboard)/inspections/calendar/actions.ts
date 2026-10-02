'use server'

import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCalendarWindow, type CalendarPlacementLoad } from '@/lib/calendar-data'
import { isYmd, monthSpan, MAX_RANGE_MONTHS, type DateRange } from '@/lib/calendar-window'
import type { CalendarInspection, CalendarPlanItem } from '@/components/inspections/inspection-calendar-client'

/** 달 이동 보충 조회 — 첫 진입 창(보이는 달 ±1개월) 밖으로 넘어갈 때 클라이언트가 **달 단위**로 부른다.
 *  page.tsx와 같은 `loadCalendarWindow`를 쓴다(두 벌이면 넘긴 달의 칩이 첫 화면과 다른 말을 한다). */
export async function loadCalendarRangeAction(range: DateRange): Promise<
  { inspections: CalendarInspection[]; planItems: CalendarPlanItem[]; placementLoad: CalendarPlacementLoad[] } | { error: string }
> {
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  if (!isYmd(range?.from) || !isYmd(range?.to) || range.from > range.to) return { error: '날짜 범위가 올바르지 않습니다.' }
  // 3년치를 되살리는 호출을 막는다 — 창 축소의 목적 자체다
  if (monthSpan(range) > MAX_RANGE_MONTHS) return { error: `한 번에 ${MAX_RANGE_MONTHS}개월까지만 불러올 수 있습니다.` }
  try {
    const { inspections, planItems, placementLoad } = await loadCalendarWindow(createAdminClient(), range)
    return { inspections, planItems, placementLoad }
  } catch (e) {
    // 실패를 빈 달로 뭉개지 않는다 — 화면이 「일정 없음」과 구별해 보여야 한다
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
