import { redirect } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { LeaveCalendar, type CalendarLeave } from '@/components/leaves/leave-calendar'

export default async function LeaveCalendarPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const { data: leavesRaw } = await supabase
    .from('leaves')
    .select('id, employee_id, leave_type, start_date, end_date, days_count')
    .eq('status', 'approved')
    .order('start_date', { ascending: true })

  const leaves = (leavesRaw ?? []) as Array<Omit<CalendarLeave, 'employee_name'> & { employee_id: string }>

  const employeeIds = [...new Set(leaves.map(l => l.employee_id))]
  let nameMap = new Map<string, string>()

  if (employeeIds.length > 0) {
    const { data: profilesRaw } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', employeeIds)
    ;((profilesRaw ?? []) as Array<{ id: string; name: string }>).forEach(p => nameMap.set(p.id, p.name))
  }

  const calendarLeaves: CalendarLeave[] = leaves.map(l => ({
    ...l,
    employee_name: nameMap.get(l.employee_id) ?? '알 수 없음',
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CalendarDays className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">팀 휴가 캘린더</h1>
          <p className="text-sm text-[#514b81] mt-0.5">승인된 휴가가 표시됩니다</p>
        </div>
      </div>

      <LeaveCalendar leaves={calendarLeaves} />
    </div>
  )
}
