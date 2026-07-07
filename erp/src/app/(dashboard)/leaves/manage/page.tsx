import { redirect } from 'next/navigation'
import { CalendarDays, ShieldCheck } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ManageActions } from '@/components/leaves/manage-actions'

const LEAVE_LABELS: Record<string, string> = {
  annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)',
  sick: '병가', special: '특별휴가',
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:          { label: '대기 중',   className: 'bg-blue-50 text-blue-600' },
  manager_approved: { label: '1차 승인', className: 'bg-yellow-50 text-yellow-700' },
}

type LeaveRow = {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  days_count: number
  status: string
  reason: string | null
  created_at: string
  employee_id: string
}

export default async function LeaveManagePage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  if (!['manager', 'admin'].includes(profile.role)) redirect('/leaves')

  const admin = createAdminClient()

  const targetStatus = profile.role === 'manager' ? 'pending' : 'manager_approved'

  const { data: leavesRaw } = await admin
    .from('leaves')
    .select('id, employee_id, leave_type, start_date, end_date, days_count, status, reason, created_at')
    .eq('status', targetStatus)
    .order('created_at', { ascending: true })

  const leaves = (leavesRaw ?? []) as LeaveRow[]

  const employeeIds = [...new Set(leaves.map(l => l.employee_id))]
  const employeeMap = new Map<string, { name: string; department?: string }>()

  if (employeeIds.length > 0) {
    const { data: profilesRaw } = await admin
      .from('profiles')
      .select('id, name, department_id')
      .in('id', employeeIds)

    const profiles = (profilesRaw ?? []) as Array<{ id: string; name: string; department_id: string | null }>

    const deptIds = [...new Set(profiles.map(p => p.department_id).filter(Boolean))] as string[]
    const deptMap = new Map<string, string>()

    if (deptIds.length > 0) {
      const { data: deptsRaw } = await admin
        .from('departments')
        .select('id, name')
        .in('id', deptIds)
      ;((deptsRaw ?? []) as Array<{ id: string; name: string }>).forEach(d => deptMap.set(d.id, d.name))
    }

    profiles.forEach(p => employeeMap.set(p.id, {
      name: p.name,
      department: p.department_id ? deptMap.get(p.department_id) : undefined,
    }))
  }

  const title = profile.role === 'manager' ? '휴가 승인 관리 (팀장)' : '휴가 최종 승인 (관리자)'
  const subtitle = profile.role === 'manager'
    ? '팀원의 휴가 신청을 1차 승인합니다'
    : '팀장 승인된 휴가를 최종 승인합니다'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">{title}</h1>
          <p className="text-sm text-[#514b81] mt-0.5">{subtitle}</p>
        </div>
      </div>

      {leaves.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#c8c4d0] py-16 text-center">
          <CalendarDays className="size-10 text-[#c4bff5] mx-auto mb-3" />
          <p className="text-sm text-[#514b81]">대기 중인 휴가 신청이 없습니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
          <div className="divide-y divide-[#c8c4d0]">
            {leaves.map(leave => {
              const emp = employeeMap.get(leave.employee_id)
              const s = STATUS_MAP[leave.status] ?? { label: leave.status, className: '' }
              return (
                <div key={leave.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <CalendarDays className="size-4 text-[#7b68ee] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-[#090c1d]">
                            {emp?.name ?? '알 수 없음'}
                          </p>
                          {emp?.department && (
                            <span className="text-xs text-[#514b81]">{emp.department}</span>
                          )}
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.className}`}>
                            {s.label}
                          </span>
                        </div>
                        <p className="text-sm text-[#292d34] mt-0.5">
                          {LEAVE_LABELS[leave.leave_type] ?? leave.leave_type}
                          <span className="text-[#514b81] font-normal ml-2">{leave.days_count}일</span>
                        </p>
                        <p className="text-xs text-[#514b81] mt-0.5">
                          {leave.start_date} ~ {leave.end_date}
                          {' · '}
                          신청일 {new Date(leave.created_at).toLocaleDateString('ko-KR')}
                        </p>
                        {leave.reason && (
                          <p className="text-xs text-[#514b81] mt-1 bg-[#f8f9fa] rounded px-2 py-1">
                            사유: {leave.reason}
                          </p>
                        )}
                      </div>
                    </div>
                    <ManageActions leaveId={leave.id} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
