import { redirect } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SchedulesClient } from '@/components/my/schedules-client'
import type { InspectionDeadline } from '@/components/my/schedules-client'

export default async function SchedulesPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const admin = createAdminClient()
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 1)
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()).padStart(2, '0')}-28`

  // 기본 ±2개월 범위 로드
  const rangeStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    .toISOString().split('T')[0]
  const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 3, 0)
    .toISOString().split('T')[0]

  const { data: schedules } = await supabase
    .from('schedules')
    .select('id, title, description, start_date, end_date, start_time, end_time, schedule_type, all_day, created_at')
    .gte('end_date', rangeStart)
    .lte('start_date', rangeEnd)
    .order('start_date')

  // 내 담당 점검 마감일 오버레이
  let inspectionDeadlines: InspectionDeadline[] = []

  const { data: inspRaw } = await admin
    .from('inspections')
    .select('id, customer_id')
    .eq('assigned_employee_id', profile.id)
    .neq('status', 'completed')

  const myInspections = (inspRaw ?? []) as Array<{ id: string; customer_id: string }>

  if (myInspections.length > 0) {
    const inspIds = myInspections.map(i => i.id)
    const custIds = [...new Set(myInspections.map(i => i.customer_id))]

    const [stepsRes, customersRes] = await Promise.all([
      admin.from('inspection_steps')
        .select('id, inspection_id, step_num, name_ko, due_date')
        .in('inspection_id', inspIds)
        .neq('status', 'completed')
        .gte('due_date', rangeStart)
        .lte('due_date', rangeEnd)
        .order('due_date'),
      admin.from('customers')
        .select('id, customer_name')
        .in('id', custIds),
    ])

    const custMap = new Map(
      ((customersRes.data ?? []) as Array<{ id: string; customer_name: string }>)
        .map(c => [c.id, c])
    )
    const inspMap = new Map(myInspections.map(i => [i.id, i]))

    type StepRow = { id: string; inspection_id: string; step_num: number; name_ko: string; due_date: string }

    inspectionDeadlines = ((stepsRes.data ?? []) as StepRow[]).map(s => {
      const insp = inspMap.get(s.inspection_id)
      const cust = insp ? custMap.get(insp.customer_id) : undefined
      const dDays = Math.round(
        (new Date(s.due_date).getTime() - new Date(todayStr).getTime()) / 86400000
      )
      return {
        stepId: s.id,
        inspectionId: s.inspection_id,
        customerName: cust?.customer_name ?? '—',
        stepNum: s.step_num,
        stepName: s.name_ko,
        dueDate: s.due_date,
        dDays,
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CalendarDays className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">일정 관리</h1>
      </div>

      <SchedulesClient
        initialSchedules={(schedules ?? []) as Record<string, unknown>[]}
        today={todayStr}
        inspectionDeadlines={inspectionDeadlines}
      />
    </div>
  )
}
