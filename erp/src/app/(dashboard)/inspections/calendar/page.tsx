import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InspectionCalendarClient } from '@/components/inspections/inspection-calendar-client'
import type { CalendarInspection } from '@/components/inspections/inspection-calendar-client'
import type { InspectionType, InspectionStatus, UserRole } from '@/types'

export default async function InspectionCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const initialFilter = (['all', 'today', 'week', 'overdue'].includes(params.filter ?? '')
    ? params.filter
    : 'all') as 'all' | 'today' | 'week' | 'overdue'

  const admin = createAdminClient()
  const currentYear = new Date().getFullYear()

  const isEmployee = profile.role === 'employee'

  let inspQuery = admin
    .from('inspections')
    .select('id, customer_id, inspection_type, year, sequence_num, inspection_start_date, status, assigned_employee_id')
    .gte('year', currentYear - 1)
    .lte('year', currentYear + 1)
    .order('inspection_start_date')

  if (isEmployee) {
    inspQuery = inspQuery.eq('assigned_employee_id', profile.id) as typeof inspQuery
  }

  let profilesQuery = admin.from('profiles').select('id, name, position').eq('is_active', true).order('name')
  if (isEmployee) {
    profilesQuery = profilesQuery.eq('id', profile.id) as typeof profilesQuery
  }

  const [inspRes, profilesRes] = await Promise.all([inspQuery, profilesQuery])

  type InspRow = {
    id: string; customer_id: string; inspection_type: string; year: number
    sequence_num: number; inspection_start_date: string; status: string
    assigned_employee_id: string
  }

  const rawInspections = (inspRes.data ?? []) as InspRow[]
  const employees = (profilesRes.data ?? []) as Array<{ id: string; name: string; position: string | null }>
  const empMap = new Map(employees.map(e => [e.id, e]))

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
      admin.from('customers').select('id, customer_name, customer_code').in('id', custIds),
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
      ((customersRes.data ?? []) as Array<{ id: string; customer_name: string; customer_code: string }>)
        .map(c => [c.id, c])
    )

    calendarData = rawInspections.map(insp => {
      const cust = customerMap.get(insp.customer_id)
      const emp = empMap.get(insp.assigned_employee_id)
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
        assigned_employee_name: emp?.name ?? '미배정',
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

  return (
    <InspectionCalendarClient
      inspections={calendarData}
      employees={employees}
      currentUserId={profile.id}
      currentUserRole={profile.role as UserRole}
      initialFilter={initialFilter}
    />
  )
}
