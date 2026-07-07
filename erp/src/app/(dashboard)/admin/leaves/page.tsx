import { redirect } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:          { label: '대기 중',     className: 'bg-blue-50 text-blue-600' },
  manager_approved: { label: '1차 승인',   className: 'bg-yellow-50 text-yellow-700' },
  approved:         { label: '승인완료',   className: 'bg-green-50 text-green-700' },
  rejected:         { label: '반려',       className: 'bg-red-50 text-red-600' },
}

const LEAVE_LABELS: Record<string, string> = {
  annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)',
  sick: '병가', special: '특별휴가',
}

export default async function AdminLeavesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; leave_type?: string; page?: string; per_page?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const params = await searchParams
  const q = params.q ?? ''
  const statusFilter = params.status ?? ''
  const typeFilter = params.leave_type ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = Math.max(0, parseInt(params.per_page ?? '25', 10))  // 0 = 전체

  const admin = createAdminClient()

  const from = pageSize > 0 ? (page - 1) * pageSize : 0
  const to = pageSize > 0 ? page * pageSize - 1 : 99999

  let query = admin
    .from('leaves')
    .select(
      'id, employee_id, leave_type, start_date, end_date, days_count, status, reason, created_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  if (statusFilter) query = query.eq('status', statusFilter) as typeof query
  if (typeFilter) query = query.eq('leave_type', typeFilter) as typeof query

  const { data: leavesRaw, count } = await query

  type LeaveRow = {
    id: string; employee_id: string; leave_type: string
    start_date: string; end_date: string; days_count: number
    status: string; reason: string | null; created_at: string
  }

  let leaves = (leavesRaw ?? []) as LeaveRow[]

  const empIds = [...new Set(leaves.map(l => l.employee_id))]
  const empMap = new Map<string, { name: string; dept?: string }>()
  if (empIds.length > 0) {
    const { data: profilesRaw } = await admin
      .from('profiles')
      .select('id, name, department_id')
      .in('id', empIds)
    const profiles = (profilesRaw ?? []) as Array<{ id: string; name: string; department_id: string | null }>

    const deptIds = [...new Set(profiles.map(p => p.department_id).filter(Boolean))] as string[]
    const deptMap = new Map<string, string>()
    if (deptIds.length > 0) {
      const { data: deptsRaw } = await admin.from('departments').select('id, name').in('id', deptIds)
      ;((deptsRaw ?? []) as Array<{ id: string; name: string }>).forEach(d => deptMap.set(d.id, d.name))
    }

    profiles.forEach(p => empMap.set(p.id, {
      name: p.name,
      dept: p.department_id ? deptMap.get(p.department_id) : undefined,
    }))
  }

  if (q) {
    const lq = q.toLowerCase()
    leaves = leaves.filter(l => (empMap.get(l.employee_id)?.name ?? '').toLowerCase().includes(lq))
  }

  const totalPages = pageSize === 0 ? 1 : Math.ceil((count ?? 0) / pageSize)

  function buildUrl(p: number) {
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    if (statusFilter) qs.set('status', statusFilter)
    if (typeFilter) qs.set('leave_type', typeFilter)
    if (pageSize !== 25) qs.set('per_page', String(pageSize))
    if (p > 1) qs.set('page', String(p))
    return `/admin/leaves${qs.size ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CalendarDays className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">전체 휴가 현황</h1>
          <p className="text-sm text-[#514b81] mt-0.5">모든 휴가 신청을 조회하고 검색합니다</p>
        </div>
      </div>

      {/* 필터 */}
      <form method="GET" action="/admin/leaves" className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="직원 이름 검색"
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-44"
        />
        <select
          name="status"
          defaultValue={statusFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_MAP).map(([v, { label }]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <select
          name="leave_type"
          defaultValue={typeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 유형</option>
          {Object.entries(LEAVE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <select
          name="per_page"
          defaultValue={String(pageSize)}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="25">25건</option>
          <option value="50">50건</option>
          <option value="0">전체</option>
        </select>
        <button type="submit" className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
          검색
        </button>
        {(q || statusFilter || typeFilter) && (
          <a href="/admin/leaves" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] flex items-center">
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {count ?? 0}건</span>
      </form>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {leaves.length === 0 ? (
          <div className="py-16 text-center">
            <CalendarDays className="size-10 text-[#c4bff5] mx-auto mb-3" />
            <p className="text-sm text-[#514b81]">휴가 신청이 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                  {['직원', '부서', '유형', '기간', '일수', '상태', '신청일'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {leaves.map(l => {
                  const s = STATUS_MAP[l.status] ?? { label: l.status, className: '' }
                  const emp = empMap.get(l.employee_id)
                  return (
                    <tr key={l.id} className="hover:bg-[#f8f9fa] transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-[#090c1d]">
                        {emp?.name ?? '알 수 없음'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#514b81]">{emp?.dept ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-[#292d34]">
                        {LEAVE_LABELS[l.leave_type] ?? l.leave_type}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#292d34] whitespace-nowrap">
                        {l.start_date} ~ {l.end_date}
                      </td>
                      <td className="px-4 py-3 text-xs text-center font-semibold text-[#7b68ee]">
                        {l.days_count}일
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${s.className}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#514b81] whitespace-nowrap">
                        {new Date(l.created_at).toLocaleDateString('ko-KR')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <a href={buildUrl(page - 1)} className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] flex items-center">
              이전
            </a>
          )}
          <span className="text-sm text-[#514b81] px-2">{page} / {totalPages}</span>
          {page < totalPages && (
            <a href={buildUrl(page + 1)} className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] flex items-center">
              다음
            </a>
          )}
        </div>
      )}
    </div>
  )
}
