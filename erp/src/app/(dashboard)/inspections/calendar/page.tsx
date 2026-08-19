import { redirect } from 'next/navigation'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { InspectionCalendarClient } from '@/components/inspections/inspection-calendar-client'
import type { CalendarInspection, CalendarPlanItem } from '@/components/inspections/inspection-calendar-client'
import type { InspectionType, InspectionStatus, UserRole } from '@/types'

export default async function InspectionCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; cust?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const initialFilter = (['all', 'today', 'week', 'overdue'].includes(params.filter ?? '')
    ? params.filter
    : 'all') as 'all' | 'today' | 'week' | 'overdue'
  // 고객명 검색어 — 필터링은 클라이언트가 한다(달력에 실린 고객에서 고르므로). 여기선 복원만.
  const initialCustomerQuery = (params.cust ?? '').slice(0, 100)

  const admin = createAdminClient()
  const currentYear = new Date().getFullYear()

  // B안: 일반직원도 전체 조회 가능 — 기본 표시는 클라이언트에서 본인 담당만 체크
  const inspQuery = admin
    .from('inspections')
    .select('id, customer_id, inspection_type, year, sequence_num, inspection_start_date, status, assigned_employee_id')
    .gte('year', currentYear - 1)
    .lte('year', currentYear + 1)
    .order('inspection_start_date')

  // 이름 해석은 퇴사자 포함 전체 — 사이드바 직원 목록만 활성·비시스템으로 제한
  const profilesQuery = admin.from('profiles').select('id, name, position, is_active, is_system').order('name')

  // 주말·공휴일 표시용 (전년~익년)
  const holidaysQuery = admin
    .from('holidays')
    .select('date, name')
    .gte('date', `${currentYear - 1}-01-01`)
    .lte('date', `${currentYear + 1}-12-31`)

  // 정기(monthly)·일반관리(event) 계획 항목 — 자체점검 6단계와 달리 계획 예정일 1건짜리 일정
  // 확정 전 항목은 scheduled_date가 없으므로 planned_date(예정일)로도 표시
  const rangeStart = `${currentYear - 1}-01-01`
  const rangeEnd   = `${currentYear + 1}-12-31`
  // 1000행씩 끝까지 받아온다 — PostgREST 요청당 상한이 1000이라 한 번에 받으면 조용히 잘린다
  // (2026-08-19 실측: 조건에 맞는 1425건 중 1000건만 실려, 나머지 425건이 달력·데이 패널에서 통째로 빠졌다).
  // planned_date는 동점·NULL이 많아 그것만으로 페이지를 나누면 건너뛰거나 중복된다 → id를 2차 정렬로 고정.
  const planItemsQuery = fetchAllRows((from, to) => admin
    .from('inspection_plan_items')
    .select('id, customer_id, plan_type, inspection_sub_type, scheduled_date, planned_date, status, assigned_employee_id, inspection_id, customers(customer_name, customer_code)')
    .in('plan_type', ['monthly', 'event'])
    .neq('status', 'cancelled')
    .or(`and(scheduled_date.gte.${rangeStart},scheduled_date.lte.${rangeEnd}),and(scheduled_date.is.null,planned_date.gte.${rangeStart},planned_date.lte.${rangeEnd})`)
    .order('planned_date')
    .order('id')
    .range(from, to))

  const [inspRes, profilesRes, holidaysRes, planItemsRes] = await Promise.all([inspQuery, profilesQuery, holidaysQuery, planItemsQuery])
  if (planItemsRes.error || planItemsRes.truncated) {
    // 조용히 적게 그리지 않는다 — 빠진 게 있으면 서버 로그에 남긴다
    console.error('[calendar] 계획 항목 로드 이상:', planItemsRes.error ?? `${planItemsRes.rows.length}건에서 상한 도달`)
  }

  type InspRow = {
    id: string; customer_id: string; inspection_type: string; year: number
    sequence_num: number; inspection_start_date: string; status: string
    assigned_employee_id: string
  }

  const rawInspections = (inspRes.data ?? []) as InspRow[]
  type ProfileRow = { id: string; name: string; position: string | null; is_active: boolean; is_system: boolean }
  const allProfiles = (profilesRes.data ?? []) as ProfileRow[]
  const employees = allProfiles
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

    const [stepsRes, customersRes] = await Promise.all([
      admin
        .from('inspection_steps')
        .select('id, inspection_id, step_num, name_ko, due_date, status, completed_at')
        .in('inspection_id', inspIds)
        .order('step_num'),
      admin.from('customers').select('id, customer_name, customer_code, is_active').in('id', custIds),
    ])

    type StepRow = {
      id: string; inspection_id: string; step_num: number; name_ko: string
      due_date: string | null; status: string; completed_at: string | null
    }

    const stepsMap = new Map<string, StepRow[]>()
    for (const s of (stepsRes.data ?? []) as StepRow[]) {
      if (!stepsMap.has(s.inspection_id)) stepsMap.set(s.inspection_id, [])
      stepsMap.get(s.inspection_id)!.push(s)
    }

    const customerMap = new Map(
      ((customersRes.data ?? []) as Array<{ id: string; customer_name: string; customer_code: string; is_active: boolean }>)
        .map(c => [c.id, c])
    )

    calendarData = rawInspections.map(insp => {
      const cust = customerMap.get(insp.customer_id)
      return {
        id: insp.id,
        customer_id: insp.customer_id,
        customer_name: cust?.customer_name ?? '—',
        customer_code: cust?.customer_code ?? '',
        inspection_type: insp.inspection_type as InspectionType,
        year: insp.year,
        sequence_num: insp.sequence_num as 1 | 2,
        inspection_start_date: insp.inspection_start_date,
        status: insp.status as InspectionStatus,
        assigned_employee_id: insp.assigned_employee_id,
        assigned_employee_name: empName(insp.assigned_employee_id),
        customer_inactive: cust ? cust.is_active === false : false,
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

  const holidays = ((holidaysRes.data ?? []) as Array<{ date: string; name: string }>)

  type PlanItemRow = {
    id: string; customer_id: string; plan_type: 'monthly' | 'event'
    inspection_sub_type: string | null
    scheduled_date: string | null; planned_date: string | null
    status: string; assigned_employee_id: string | null; inspection_id: string | null
    customers: { customer_name: string; customer_code: string } | null
  }
  const planItems: CalendarPlanItem[] = (planItemsRes.rows as unknown as PlanItemRow[]).flatMap(p => {
    const date = p.scheduled_date ?? p.planned_date
    if (!date) return []
    return [{
      id: p.id,
      customer_id: p.customer_id,
      customer_name: p.customers?.customer_name ?? '—',
      customer_code: p.customers?.customer_code ?? '',
      plan_type: p.plan_type,
      sub_type: p.inspection_sub_type === '종합' || p.inspection_sub_type === '작동' ? p.inspection_sub_type : null,
      scheduled_date: date,
      status: p.status as CalendarPlanItem['status'],
      assigned_employee_id: p.assigned_employee_id,
      assigned_employee_name: empName(p.assigned_employee_id),
      inspection_id: p.inspection_id,
    }]
  })

  return (
    <InspectionCalendarClient
      inspections={calendarData}
      planItems={planItems}
      employees={employees}
      currentUserId={profile.id}
      currentUserRole={profile.role as UserRole}
      initialFilter={initialFilter}
      initialCustomerQuery={initialCustomerQuery}
      holidays={holidays}
      canMovePlan={can(profile.role as UserRole, 'inspection_plan_manage')}
      canSendSms={can(profile.role as UserRole, 'inspection_sms_send')}
    />
  )
}
