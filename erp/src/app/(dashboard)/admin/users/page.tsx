import { redirect } from 'next/navigation'
import { Users } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { UserManageClient } from '@/components/admin/user-manage-client'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; dept?: string; active?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const params = await searchParams
  const q = params.q ?? ''
  const roleFilter = params.role ?? ''
  const deptFilter = params.dept ?? ''
  const activeFilter = params.active ?? 'all'

  const admin = createAdminClient()
  const year = new Date().getFullYear()

  const [profilesRes, deptsRes, balancesRes] = await Promise.all([
    admin.from('profiles').select('*').order('name'),
    admin.from('departments').select('id, name').order('name'),
    admin.from('leave_balances').select('employee_id, total_days, used_days').eq('year', year),
  ])

  type ProfileRow = {
    id: string; employee_id: string; name: string; email: string
    role: 'employee' | 'manager' | 'admin'; department_id: string | null
    position: string | null; hire_date: string | null; is_active: boolean
  }

  let users = (profilesRes.data ?? []) as ProfileRow[]
  const depts = (deptsRes.data ?? []) as Array<{ id: string; name: string }>
  const balances = (balancesRes.data ?? []) as Array<{ employee_id: string; total_days: number; used_days: number }>
  const balMap = new Map(balances.map(b => [b.employee_id, b]))

  if (q) {
    const lq = q.toLowerCase()
    users = users.filter(u =>
      u.name.toLowerCase().includes(lq) ||
      u.email.toLowerCase().includes(lq) ||
      u.employee_id.toLowerCase().includes(lq)
    )
  }
  if (roleFilter) users = users.filter(u => u.role === roleFilter)
  if (deptFilter) users = users.filter(u => u.department_id === deptFilter)
  if (activeFilter === 'active') users = users.filter(u => u.is_active)
  if (activeFilter === 'inactive') users = users.filter(u => !u.is_active)

  const usersWithBalance = users.map(u => ({
    ...u,
    total_days: balMap.get(u.id)?.total_days ?? 15,
    used_days: balMap.get(u.id)?.used_days ?? 0,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">직원 관리</h1>
          <p className="text-sm text-[#514b81] mt-0.5">직원 계정을 생성하고 관리합니다</p>
        </div>
      </div>

      {/* 검색/필터 */}
      <form method="GET" action="/admin/users" className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="이름, 이메일, 사번 검색"
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-52"
        />
        <select
          name="role"
          defaultValue={roleFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 역할</option>
          <option value="employee">일반직원</option>
          <option value="manager">팀장</option>
          <option value="admin">관리자</option>
        </select>
        <select
          name="dept"
          defaultValue={deptFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 부서</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select
          name="active"
          defaultValue={activeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          검색
        </button>
        {(q || roleFilter || deptFilter || activeFilter !== 'all') && (
          <a href="/admin/users" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {usersWithBalance.length}명</span>
      </form>

      <UserManageClient users={usersWithBalance} depts={depts} />
    </div>
  )
}
