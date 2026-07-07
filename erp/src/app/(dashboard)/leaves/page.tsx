import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, CalendarDays } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:          { label: '대기 중',     className: 'bg-blue-50 text-blue-600' },
  manager_approved: { label: '1차 승인',   className: 'bg-yellow-50 text-yellow-700' },
  approved:         { label: '승인 완료',   className: 'bg-green-50 text-green-700' },
  rejected:         { label: '반려',       className: 'bg-red-50 text-red-600' },
}

const LEAVE_LABELS: Record<string, string> = {
  annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)',
  sick: '병가', special: '특별휴가',
}

type LeaveRow = {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  days_count: number
  status: string
  created_at: string
}

export default async function LeavesPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const admin = createAdminClient()
  const year = new Date().getFullYear()

  const [{ data: leavesRaw }, { data: balRaw }] = await Promise.all([
    supabase
      .from('leaves')
      .select('id, leave_type, start_date, end_date, days_count, status, created_at')
      .eq('employee_id', profile.id)
      .order('created_at', { ascending: false }),
    admin
      .from('leave_balances')
      .select('total_days, used_days')
      .eq('employee_id', profile.id)
      .eq('year', year)
      .single(),
  ])

  const leaves = (leavesRaw ?? []) as LeaveRow[]
  const bal = balRaw as { total_days: number; used_days: number } | null
  const totalDays = bal?.total_days ?? 15
  const usedDays = bal?.used_days ?? 0
  const remaining = totalDays - usedDays

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">휴가 신청</h1>
          <p className="text-sm text-[#514b81] mt-1">내 휴가 신청 현황</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/leaves/calendar"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[#c8c4d0] text-[#514b81] hover:bg-[#f8f9fa] text-sm font-medium transition-colors"
          >
            <CalendarDays className="size-4" />
            팀 캘린더
          </Link>
          <Link
            href="/leaves/new"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />
            휴가 신청
          </Link>
        </div>
      </div>

      {/* 연차 현황 */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '총 연차', value: totalDays, unit: '일', color: 'text-[#090c1d]' },
          { label: '사용 연차', value: usedDays, unit: '일', color: 'text-orange-500' },
          { label: '잔여 연차', value: remaining, unit: '일', color: 'text-[#7b68ee]' },
        ].map(item => (
          <div
            key={item.label}
            className="bg-white rounded-xl border border-[#c8c4d0] px-5 py-4 shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]"
          >
            <p className="text-xs text-[#514b81]">{item.label}</p>
            <p className={`text-2xl font-bold mt-1 ${item.color}`}>
              {item.value}
              <span className="text-sm font-normal ml-1">{item.unit}</span>
            </p>
          </div>
        ))}
      </div>

      {leaves.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#c8c4d0] py-16 text-center">
          <CalendarDays className="size-10 text-[#c4bff5] mx-auto mb-3" />
          <p className="text-sm text-[#514b81]">신청한 휴가가 없습니다</p>
          <Link href="/leaves/new" className="mt-3 inline-block text-sm text-[#7b68ee] hover:underline">
            휴가 신청하기
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
          <div className="divide-y divide-[#c8c4d0]">
            {leaves.map(leave => {
              const s = STATUS_MAP[leave.status] ?? { label: leave.status, className: '' }
              return (
                <div
                  key={leave.id}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <CalendarDays className="size-4 text-[#7b68ee] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#090c1d]">
                        {LEAVE_LABELS[leave.leave_type] ?? leave.leave_type}
                        <span className="ml-2 text-[#514b81] font-normal">
                          {leave.days_count}일
                        </span>
                      </p>
                      <p className="text-xs text-[#514b81] mt-0.5">
                        {leave.start_date} ~ {leave.end_date}
                        {' · '}
                        신청일 {new Date(leave.created_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ml-4 ${s.className}`}>
                    {s.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
