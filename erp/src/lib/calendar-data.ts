import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows, fetchAllRowsByIds } from '@/lib/supabase/paginate'
import { activeStepsByInspection, isStepVisible } from '@/lib/active-steps'
import { isSelfInspection } from '@/lib/inspection-step-status'
import { dateChangeVerdict } from '@/lib/inspection-date-change'
import { closedVerdict } from '@/lib/inspection-closed'
import { facilityVerifyState, shouldWarnFacilitiesUnverified } from '@/lib/facility-verify-gate'
import { todayKst } from '@/lib/kst-date'
import { KFMA_DAILY_MAX } from '@/lib/legal-link'
import type { DateRange } from '@/lib/calendar-window'
import type { CalendarInspection, CalendarPlanItem } from '@/components/inspections/inspection-calendar-client'
import type { InspectionType, InspectionStatus } from '@/types'

type Admin = ReturnType<typeof createAdminClient>

export type CalendarEmployee = { id: string; name: string; position: string | null }

/** 점검 달력이 한 창(窓)에 싣는 재료 — page.tsx(첫 진입)와 `loadCalendarRangeAction`(달 이동 보충)이
 *  **같은 함수**로 받는다. 두 벌이면 달을 넘긴 뒤의 칩이 첫 화면과 다른 말을 한다.
 *
 *  🎯 2026-10-01 — 종전 page.tsx의 조회 묶음을 **창 인자**만 받도록 옮겼다. 쿼리·판정·보수 로그는
 *  그대로다(3년치 → 창 범위). 창에 「걸리는」 점검은 둘이다:
 *    ① 시작일이 창 안인 점검
 *    ② 어느 단계의 **마감일**이 창 안인 점검 — 7월에 시작한 자체점검의 ⑥ 마감은 9월이다.
 *       달력은 칩을 마감일에 그리므로 시작일만 보면 그 칩이 빠진다.
 *  단계 행은 창으로 자르지 않고 그 점검의 **전 단계**를 싣는다 — 진행 N/6·날짜 변경 가부·종료 판정이
 *  전 단계를 봐야 한다(의무 축). */
export async function loadCalendarWindow(admin: Admin, range: DateRange): Promise<{
  inspections: CalendarInspection[]
  planItems: CalendarPlanItem[]
  employees: CalendarEmployee[]
  /** 167 — 하루 배치 건수(주된 기술인력·상한 이상인 쌍만). 달력 칩·이동 경고가 읽는다 */
  placementLoad: CalendarPlacementLoad[]
}> {
  type InspRow = {
    id: string; customer_id: string; inspection_type: string; plan_type: string | null; year: number
    sequence_num: number; inspection_start_date: string; status: string
    inspection_end_date: string | null
    inspection_days: number | null
    assigned_employee_id: string
  }
  // 라운드 A — 서로 독립인 넷을 함께 던진다
  const [profilesRes, inspByStartRes, stepIdsRes, planItemsRes] = await Promise.all([
    // 이름 해석은 퇴사자 포함 전체 — 사이드바 직원 목록만 활성·비시스템으로 제한
    admin.from('profiles').select('id, name, position, is_active, is_system').order('name'),
    // ① 시작일이 창 안 — 페이징 규약대로 id를 2차 정렬로 고정.
    // plan_type — 패널 [보고서 엑셀]의 축(2026-09-21). inspection_end_date·inspection_days — 데이 패널
    // 점검기간 한 줄(R3). ⚠ 컬럼 목록은 **리터럴**로 둔다(소스 단언 스위트가 from→select 인접을 묻는다)
    fetchAllRows<InspRow>((from, to) => admin
      .from('inspections').select('id, customer_id, inspection_type, plan_type, year, sequence_num, inspection_start_date, inspection_end_date, inspection_days, status, assigned_employee_id')
      .gte('inspection_start_date', range.from).lte('inspection_start_date', range.to)
      .order('inspection_start_date').order('id').range(from, to)),
    // ② 마감일이 창 안인 단계의 점검 id
    fetchAllRows<{ inspection_id: string }>((from, to) => admin
      .from('inspection_steps').select('inspection_id')
      .gte('due_date', range.from).lte('due_date', range.to)
      .order('id').range(from, to)),
    // 정기(monthly)·일반관리(event)·자체점검(special_*) 계획 항목 — 계획 예정일 1건짜리 일정.
    // 확정 전 항목은 scheduled_date가 없으므로 planned_date(예정일)로도 표시.
    // ⚠ 시작된 자체점검(inspection_id 있음)은 아래에서 빼고 inspections 축이 그린다.
    // 1000행씩 끝까지 — 요청당 상한에서 조용히 잘린다. 창이 좁아져도 규약은 그대로 둔다.
    // (제네릭을 안 건다 — 임베드 `customers`를 supabase-js가 배열로 추론하지만 실제 행은 객체다. 아래서 캐스팅)
    fetchAllRows((from, to) => admin
      .from('inspection_plan_items')
      .select('id, customer_id, plan_type, inspection_sub_type, scheduled_date, planned_date, status, assigned_employee_id, inspection_id, customers(customer_name, customer_code, address, is_active)')
      .in('plan_type', ['monthly', 'event', 'special_종합', 'special_작동'])
      .neq('status', 'cancelled')
      .or(`and(scheduled_date.gte.${range.from},scheduled_date.lte.${range.to}),and(scheduled_date.is.null,planned_date.gte.${range.from},planned_date.lte.${range.to})`)
      .order('planned_date').order('id').range(from, to), { parallel: 4 }),
  ])
  if (inspByStartRes.error || inspByStartRes.truncated) {
    console.error('[calendar] 점검 로드 이상:', inspByStartRes.error ?? `${inspByStartRes.rows.length}건에서 상한 도달`)
  }
  if (stepIdsRes.error || stepIdsRes.truncated) {
    console.error('[calendar] 마감 단계 조회 이상 — 창 밖에서 시작한 점검의 칩이 빠질 수 있습니다:', stepIdsRes.error)
  }
  if (planItemsRes.error || planItemsRes.truncated) {
    // 조용히 적게 그리지 않는다 — 빠진 게 있으면 서버 로그에 남긴다
    console.error('[calendar] 계획 항목 로드 이상:', planItemsRes.error ?? `${planItemsRes.rows.length}건에서 상한 도달`)
  }

  // ②에서 나왔지만 ①에 없는 점검을 한 번 더 받는다(창 밖에서 시작해 창 안에 마감이 있는 건)
  const loaded = new Map(inspByStartRes.rows.map(i => [i.id, i]))
  const missingIds = [...new Set(stepIdsRes.rows.map(r => r.inspection_id))].filter(id => !loaded.has(id))
  if (missingIds.length > 0) {
    const extra = await fetchAllRowsByIds<InspRow, string>(missingIds, (c, from, to) => admin
      .from('inspections').select('id, customer_id, inspection_type, plan_type, year, sequence_num, inspection_start_date, inspection_end_date, inspection_days, status, assigned_employee_id')
      .in('id', c).order('id').range(from, to))
    if (extra.error || extra.truncated) console.error('[calendar] 창 밖 시작 점검 조회 이상:', extra.error)
    for (const i of extra.rows) loaded.set(i.id, i)
  }
  const rawInspections = [...loaded.values()]
    .sort((a, b) => a.inspection_start_date.localeCompare(b.inspection_start_date) || a.id.localeCompare(b.id))

  type ProfileRow = { id: string; name: string; position: string | null; is_active: boolean; is_system: boolean }
  const allProfiles = (profilesRes.data ?? []) as ProfileRow[]
  const employees: CalendarEmployee[] = allProfiles
    .filter(e => e.is_active && !e.is_system)
    .map(({ id, name, position }) => ({ id, name, position }))
  const empMap = new Map(allProfiles.map(e => [e.id, e]))
  // 퇴사(비활성) 직원 담당 항목도 이름 + (퇴사) 표기로 표시
  const empName = (id: string | null) => {
    if (!id) return '미배정'
    const e = empMap.get(id)
    if (!e) return '미배정'
    return e.is_active ? e.name : `${e.name} (퇴사)`
  }

  let calendarData: CalendarInspection[] = []

  if (rawInspections.length > 0) {
    const inspIds = rawInspections.map(i => i.id)
    const custIds = [...new Set(rawInspections.map(i => i.customer_id))]

    type StepRow = {
      id: string; inspection_id: string; step_num: number; name_ko: string
      due_date: string | null; status: string; completed_at: string | null
    }
    // 라운드 B — 넷이 서로 독립. activeSteps는 라운드 A가 실은 plan_type을 넘겨 재조회를 뺀다.
    const [stepsRes, customersRes, bldVerifyRes, activeCal] = await Promise.all([
      // ⚠ 단계 행은 점검당 최대 6이라 상한을 가장 먼저 넘는다 — 잘리면 뒤쪽 점검의 진행 칩이
      // 통째로 사라진다(오류 없이). 정렬은 페이징 규약대로 동점 없는 id로 걸고 step_num은 아래서 세운다.
      fetchAllRowsByIds<StepRow, string>(inspIds, (c, from, to) => admin
        .from('inspection_steps')
        .select('id, inspection_id, step_num, name_ko, due_date, status, completed_at')
        .in('inspection_id', c).order('id').range(from, to)),
      // ⚠ 1000행 상한에 걸려 고객이 map에서 빠지면 아래 is_active 필터가 `undefined !== false`로 통과해
      // **비활성 고객이 달력에 되살아난다**(조용한 실패). id 목록은 URL에 실려 400건부터 요청 자체가
      // 실패하므로 쪼개 보낸다. [[risk_supabase_1000row_cap]]
      fetchAllRowsByIds<{ id: string; customer_name: string; customer_code: string; is_active: boolean; address: string | null }, string>(
        custIds, (c, from, to) => admin
          .from('customers').select('id, customer_name, customer_code, is_active, address')
          .in('id', c).order('id').range(from, to)),
      /* 1.4 **확인 여부**(2026-09-21 A) — 달력의 ① 링크가 「점검표로 보낼까, 설비 확인부터 보낼까」를
         고르는 데 쓴다. 판정 축은 `buildings.facilities_verified_at` **하나** — `facilityVerifyState`에 넘긴다. */
      fetchAllRowsByIds<{ id: string; customer_id: string; facilities_verified_at: string | null }, string>(
        custIds, (c, from, to) => admin
          .from('buildings').select('id, customer_id, facilities_verified_at')
          .in('customer_id', c).eq('is_active', true).order('id').range(from, to)),
      // 🎯 소방계획서_45 §S11 — 점검표 모두 합격이라 작업대에서 '해당없음'으로 흐려진 ⑤⑥을 여기서도
      // 같은 한 벌로 거른다(표시 축). 소방계획서_48 — 불량 0이면 ④도 즉시 감춘다. 완료 판정은 의무 축.
      activeStepsByInspection(admin, inspIds, 'inspection-calendar',
        { planTypes: new Map(rawInspections.map(i => [i.id, i.plan_type])) }),
    ])

    const stepsMap = new Map<string, StepRow[]>()
    /* 🚨 점검일자 변경 가부·종료 판정은 **거르기 전 전 단계**(의무 축)로 — stepsMap은 표시 축이라
       불량 0이면 ⑤⑥이 빠진다. 그 축으로 세면 숨겨진 단계의 완료를 못 보고 날짜 변경을 통과시킨다. */
    const allStepsMap = new Map<string, StepRow[]>()
    for (const s of stepsRes.rows) {
      if (!allStepsMap.has(s.inspection_id)) allStepsMap.set(s.inspection_id, [])
      allStepsMap.get(s.inspection_id)!.push(s)
      if (!isStepVisible(activeCal, s.inspection_id, s.step_num)) continue
      if (!stepsMap.has(s.inspection_id)) stepsMap.set(s.inspection_id, [])
      stepsMap.get(s.inspection_id)!.push(s)
    }
    for (const rows of stepsMap.values()) rows.sort((a, b) => a.step_num - b.step_num)

    if (customersRes.error || customersRes.truncated) {
      console.error('[calendar] 고객 조회 불완전 — 비활성 고객이 달력에 남을 수 있습니다', customersRes.error)
    }
    if (stepsRes.error || stepsRes.truncated) {
      console.error('[calendar] 단계 조회 불완전 — 진행 칩이 일부 점검에서 누락됩니다', stepsRes.error)
    }
    const customerMap = new Map(customersRes.rows.map(c => [c.id, c]))

    const bldByCust = new Map<string, Array<{ facilities_verified_at: string | null }>>()
    for (const b of bldVerifyRes.rows) {
      const arr = bldByCust.get(b.customer_id)
      if (arr) arr.push(b)
      else bldByCust.set(b.customer_id, [b])
    }

    // 고객관리에서 삭제(비활성)된 고객의 점검 건은 달력에 싣지 않는다 (2026-08-28)
    calendarData = rawInspections.filter(insp => customerMap.get(insp.customer_id)?.is_active !== false).map(insp => {
      const cust = customerMap.get(insp.customer_id)
      return {
        facilitiesUnverified: shouldWarnFacilitiesUnverified(
          facilityVerifyState(bldByCust.get(insp.customer_id) ?? [])),
        id: insp.id,
        customer_id: insp.customer_id,
        customer_name: cust?.customer_name ?? '—',
        customer_code: cust?.customer_code ?? '',
        customer_address: cust?.address ?? null,
        inspection_type: insp.inspection_type as InspectionType,
        // 결과보고서가 **있는 건인가** — 판정은 `isSelfInspection` 한 곳. plan_type null은 '있다'로(기울기).
        hasResultReport: isSelfInspection(insp.plan_type),
        // 의무 축(거르기 전)으로 판정 — 표시 축을 넘기면 숨겨진 ⑤⑥ 완료를 못 본다
        dateChange: dateChangeVerdict(allStepsMap.get(insp.id) ?? []),
        closed: closedVerdict(allStepsMap.get(insp.id) ?? [], activeCal.map.get(insp.id)),
        year: insp.year,
        sequence_num: insp.sequence_num as 1 | 2,
        inspection_start_date: insp.inspection_start_date,
        // 점검기간은 **원재료 그대로** — 저장된 일수와 기간에서 센 일수의 어긋남을 화면이 맞대 본다(R3)
        inspection_end_date: insp.inspection_end_date,
        inspection_days: insp.inspection_days,
        status: insp.status as InspectionStatus,
        assigned_employee_id: insp.assigned_employee_id,
        assigned_employee_name: empName(insp.assigned_employee_id),
        steps: (stepsMap.get(insp.id) ?? []).map(s => ({
          id: s.id,
          step_num: s.step_num,
          name_ko: s.name_ko,
          due_date: s.due_date,
          status: s.status as 'pending' | 'completed' | 'overdue',
          completed_at: s.completed_at,
        })),
      }
    })
  }

  const planItems: CalendarPlanItem[] = (planItemsRes.rows as unknown as PlanItemRow[]).flatMap(p => {
    const date = p.scheduled_date ?? p.planned_date
    if (!date) return []
    // 삭제(비활성) 고객의 계획은 상태 무관 제외 — 자동취소를 벗어난 완료 항목도 달력에서 뺀다
    if (p.customers?.is_active === false) return []
    // 이미 시작된 자체점검은 inspections 축이 6단계로 그린다 — 계획 칩까지 실으면 같은 날 두 번 나온다
    if ((p.plan_type === 'special_종합' || p.plan_type === 'special_작동') && p.inspection_id) return []
    return [{
      id: p.id,
      customer_id: p.customer_id,
      customer_name: p.customers?.customer_name ?? '—',
      customer_code: p.customers?.customer_code ?? '',
      customer_address: p.customers?.address ?? null,
      plan_type: p.plan_type,
      sub_type: p.inspection_sub_type === '종합' || p.inspection_sub_type === '작동' ? p.inspection_sub_type : null,
      scheduled_date: date,
      status: p.status as CalendarPlanItem['status'],
      assigned_employee_id: p.assigned_employee_id,
      assigned_employee_name: empName(p.assigned_employee_id),
      inspection_id: p.inspection_id,
    }]
  })

  /* 167 — 하루 배치 건수(주된 기술인력 기준). 협회 배치신고는 하루 5개 초과 대상물이 **부적합**이다.
   *  센 것: ① 창 안 자체점검 회차 — 시작일~종료일(없으면 당일) 각 날짜에 1건
   *        ② 아직 시작 안 한 자체점검 계획(special_*, inspection_id 없음) — 예정일에 1건(미리 경고하려고)
   *  보조 인력은 창 조회에 없으므로 세지 않는다(주된 기술인력만). 상한(5) **이상**인 쌍만 실어 보낸다 —
   *  5건은 「한 건 더 옮기면 초과」 경고용, 6건부터 초과 칩. 창 밖 날짜는 자르지 않는다(며칠 넘치는 정도). */
  const loadByKey = new Map<string, { date: string; employeeId: string; count: number }>()
  const bump = (date: string, employeeId: string | null) => {
    if (!employeeId || !date) return
    const key = `${date}|${employeeId}`
    const cur = loadByKey.get(key)
    if (cur) cur.count += 1
    else loadByKey.set(key, { date, employeeId, count: 1 })
  }
  for (const i of rawInspections) {
    if (!isSelfInspection(i.plan_type)) continue
    const start = i.inspection_start_date
    const end = i.inspection_end_date ?? start
    // 다일 점검은 날짜마다 1건 — 10일을 넘기는 기간은 입력 오류로 보고 10일에서 끊는다
    const d = new Date(start + 'T00:00:00')
    for (let n = 0; n < 10; n++) {
      const iso = d.toISOString().slice(0, 10)
      if (iso > end) break
      bump(iso, i.assigned_employee_id)
      d.setUTCDate(d.getUTCDate() + 1)
    }
  }
  for (const p of planItems) {
    if ((p.plan_type === 'special_종합' || p.plan_type === 'special_작동') && !p.inspection_id) bump(p.scheduled_date, p.assigned_employee_id)
  }
  const placementLoad: CalendarPlacementLoad[] = [...loadByKey.values()]
    .filter(l => l.count >= KFMA_DAILY_MAX)
    .map(l => ({ ...l, employeeName: empName(l.employeeId) }))

  return { inspections: calendarData, planItems, employees, placementLoad }
}

/** 167 — 어느 날 어느 주된 기술인력에게 자체점검이 몇 건 몰렸는가(상한 5 이상인 쌍만) */
export type CalendarPlacementLoad = { date: string; employeeId: string; employeeName: string; count: number }

type PlanItemRow = {
  id: string; customer_id: string; plan_type: 'monthly' | 'event' | 'special_종합' | 'special_작동'
  inspection_sub_type: string | null
  scheduled_date: string | null; planned_date: string | null
  status: string; assigned_employee_id: string | null; inspection_id: string | null
  customers: { customer_name: string; customer_code: string; address: string | null; is_active: boolean } | null
}

/** 기한초과 진입(`?filter=overdue`)의 착지 달 — **가장 오래된 미완료·지난 마감**(표시 축).
 *
 *  종전엔 클라이언트가 3년치 단계를 훑어 골랐다. 창이 좁아지면 그 달이 창 밖일 수 있으므로
 *  서버가 먼저 정하고 창을 그 달에 맞춘다. 판정은 종전 클라이언트와 같다:
 *  활성 고객의 점검 × 표시되는 단계(모두 합격 ⑤⑥ 제외) × 미완료 × 마감 < 오늘. */
export async function earliestOverdueDue(admin: Admin): Promise<string | null> {
  const today = todayKst()
  const { data } = await admin
    .from('inspection_steps')
    .select('due_date, inspection_id, step_num, inspections!inner(plan_type, customers:customer_id!inner(is_active))')
    .neq('status', 'completed')
    .lt('due_date', today)
    .eq('inspections.customers.is_active', true)
    .order('due_date')
    // 숨겨진 ⑤⑥(모두 합격)이 앞을 막을 수 있어 여럿 받아 표시 축으로 거른다 — 한 점검당 최대 2행
    .limit(80)
  const rows = (data ?? []) as unknown as Array<{
    due_date: string; inspection_id: string; step_num: number
    inspections: { plan_type: string | null } | null
  }>
  if (rows.length === 0) return null
  const active = await activeStepsByInspection(admin, [...new Set(rows.map(r => r.inspection_id))], 'calendar-overdue',
    { planTypes: new Map(rows.map(r => [r.inspection_id, r.inspections?.plan_type ?? null])) })
  return rows.find(r => isStepVisible(active, r.inspection_id, r.step_num))?.due_date ?? null
}

/** 퇴사(비활성) 직원이 담당으로 남은 **미완료** 일정 수 — 도구줄 「퇴사 담당 N건」 칩.
 *  종전엔 실린 3년치에서 셌다. 창이 좁아지면 창 밖 건이 빠지므로 전 기간을 count로 센다(행 0건). */
export async function countOrphanAssignments(admin: Admin): Promise<number> {
  // 활성·비시스템 직원 = 달력 사이드바 목록과 같은 축(loadCalendarWindow의 employees)
  const { data: active, error: actErr } = await admin.from('profiles').select('id').eq('is_active', true).eq('is_system', false)
  if (actErr) { console.error('[calendar] 활성 직원 조회 실패:', actErr.message); return 0 }
  const ids = ((active ?? []) as Array<{ id: string }>).map(p => p.id)
  if (ids.length === 0) return 0
  const notIn = `(${ids.join(',')})`
  const [a, b] = await Promise.all([
    admin.from('inspections')
      .select('id, customers:customer_id!inner(is_active)', { count: 'exact', head: true })
      .eq('customers.is_active', true)
      // ⚠ `not in (completed,cancelled)`는 **빈 message의 오류**로 떨어진다 — inspections.status는
      //   enum이라 없는 값('cancelled')을 비교식에 넣는 순간 Postgres가 거절한다(2026-10-01 실측).
      .neq('status', 'completed')
      .not('assigned_employee_id', 'is', null)
      .not('assigned_employee_id', 'in', notIn),
    admin.from('inspection_plan_items')
      .select('id, customers:customer_id!inner(is_active)', { count: 'exact', head: true })
      .eq('customers.is_active', true)
      .not('status', 'in', '(completed,cancelled)')
      .not('assigned_employee_id', 'is', null)
      .not('assigned_employee_id', 'in', notIn),
  ])
  if (a.error || b.error) console.error('[calendar] 퇴사 담당 집계 실패:', a.error?.message, b.error?.message)
  return (a.count ?? 0) + (b.count ?? 0)
}

/** 고객 검색창의 후보 목록 — **활성 고객 전부**. 종전엔 실린 일정에서 뽑아 창 밖 고객이 검색되지 않았다. */
export async function listCalendarCustomerOptions(admin: Admin): Promise<Array<{ id: string; name: string; code: string }>> {
  const res = await fetchAllRows<{ id: string; customer_name: string; customer_code: string }>((from, to) => admin
    .from('customers').select('id, customer_name, customer_code').eq('is_active', true)
    .order('customer_name').order('id').range(from, to))
  if (res.error) console.error('[calendar] 고객 후보 조회 실패:', res.error)
  return res.rows.map(c => ({ id: c.id, name: c.customer_name, code: c.customer_code }))
}
