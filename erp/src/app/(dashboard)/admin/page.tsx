import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileText, CalendarDays, Users, ClipboardList, ArrowRight, TrendingUp } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const DOC_STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft:    { label: '임시저장', color: 'bg-gray-100 text-gray-600' },
  pending:  { label: '결재 중',   color: 'bg-blue-50 text-blue-600' },
  approved: { label: '승인완료', color: 'bg-green-50 text-green-700' },
  rejected: { label: '반려',     color: 'bg-red-50 text-red-600' },
  recalled: { label: '회수됨',   color: 'bg-orange-50 text-orange-600' },
}

type DocStatusCount = { status: string; count: number }
type DeptLeaveRow = {
  dept_name: string
  dept_id: string | null
  total: number
  approved: number
  pending: number
}

export default async function AdminPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const admin = createAdminClient()

  const [
    totalDocsRes,
    allDocsStatusRes,
    totalEmployeesRes,
    allLeavesRes,
    deptRes,
    recentDocsRes,
  ] = await Promise.all([
    admin.from('documents').select('id', { count: 'exact', head: true }),
    admin.from('documents').select('status'),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
    admin.from('leaves').select('employee_id, leave_type, days_count, status'),
    admin.from('departments').select('id, name'),
    admin.from('documents')
      .select('id, title, template_type, status, submitted_at, author_id')
      .order('updated_at', { ascending: false })
      .limit(8),
  ])

  const docStatusCounts: DocStatusCount[] = []
  const statusGroups: Record<string, number> = {}
  ;((allDocsStatusRes.data ?? []) as Array<{ status: string }>).forEach(d => {
    statusGroups[d.status] = (statusGroups[d.status] ?? 0) + 1
  })
  for (const [status, count] of Object.entries(statusGroups)) {
    docStatusCounts.push({ status, count })
  }
  docStatusCounts.sort((a, b) => b.count - a.count)

  type LeaveRow = { employee_id: string; leave_type: string; days_count: number; status: string }
  const allLeaves = (allLeavesRes.data ?? []) as LeaveRow[]

  const { data: profilesRaw } = await admin
    .from('profiles')
    .select('id, name, department_id')
    .eq('is_active', true)
  const profiles = (profilesRaw ?? []) as Array<{ id: string; name: string; department_id: string | null }>
  const empDeptMap = new Map(profiles.map(p => [p.id, p.department_id]))

  const depts = (deptRes.data ?? []) as Array<{ id: string; name: string }>
  const deptNameMap = new Map(depts.map(d => [d.id, d.name]))
  void deptNameMap

  const deptLeaveMap = new Map<string, DeptLeaveRow>()
  const NODEPT = '__no_dept__'
  deptLeaveMap.set(NODEPT, { dept_name: '부서 없음', dept_id: null, total: 0, approved: 0, pending: 0 })
  depts.forEach(d => deptLeaveMap.set(d.id, { dept_name: d.name, dept_id: d.id, total: 0, approved: 0, pending: 0 }))

  allLeaves.forEach(l => {
    const deptId = empDeptMap.get(l.employee_id) ?? null
    const key = deptId ?? NODEPT
    const row = deptLeaveMap.get(key)
    if (!row) return
    row.total++
    if (l.status === 'approved') row.approved++
    if (l.status === 'pending' || l.status === 'manager_approved') row.pending++
  })

  const deptLeaves = [...deptLeaveMap.values()].filter(r => r.total > 0)

  type DocRow = { id: string; title: string; template_type: string; status: string; submitted_at: string | null; author_id: string }
  const recentDocs = (recentDocsRes.data ?? []) as DocRow[]
  const authorIds = [...new Set(recentDocs.map(d => d.author_id))]
  const authorMap = new Map<string, string>()
  if (authorIds.length > 0) {
    const { data: authRaw } = await admin.from('profiles').select('id, name').in('id', authorIds)
    ;((authRaw ?? []) as Array<{ id: string; name: string }>).forEach(p => authorMap.set(p.id, p.name))
  }

  const totalDocs = totalDocsRes.count ?? 0
  const totalEmployees = totalEmployeesRes.count ?? 0
  const totalApprovedLeaves = allLeaves.filter(l => l.status === 'approved').length
  const totalPendingLeaves = allLeaves.filter(l => ['pending', 'manager_approved'].includes(l.status)).length

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <TrendingUp className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">관리자 현황</h1>
          <p className="text-sm text-[#514b81] mt-0.5">전체 현황을 한눈에 확인하세요</p>
        </div>
      </div>

      {/* 상단 KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '전체 기안서', value: totalDocs, icon: FileText, sub: '건', color: 'text-[#7b68ee]' },
          { label: '활성 직원', value: totalEmployees, icon: Users, sub: '명', color: 'text-[#090c1d]' },
          { label: '승인된 휴가', value: totalApprovedLeaves, icon: CalendarDays, sub: '건', color: 'text-green-600' },
          { label: '승인 대기 휴가', value: totalPendingLeaves, icon: ClipboardList, sub: '건', color: 'text-orange-500' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-[#c8c4d0] p-5 shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-[#514b81]">{card.label}</p>
              <card.icon className="size-4 text-[#c4bff5]" />
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>
              {card.value}
              <span className="text-sm font-normal ml-1 text-[#514b81]">{card.sub}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 문서 상태별 현황 */}
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-[#7b68ee]" />
              <h2 className="text-sm font-semibold text-[#090c1d]">전체 문서 현황</h2>
            </div>
          </div>
          <div className="px-5 py-4 space-y-3">
            {docStatusCounts.length === 0 ? (
              <p className="text-sm text-[#514b81] text-center py-6">문서가 없습니다</p>
            ) : (
              <>
                {docStatusCounts.map(({ status, count }) => {
                  const s = DOC_STATUS_MAP[status] ?? { label: status, color: 'bg-gray-100 text-gray-600' }
                  const pct = totalDocs > 0 ? Math.round((count / totalDocs) * 100) : 0
                  return (
                    <div key={status} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
                        <span className="text-[#514b81]">{count}건 ({pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-[#c8c4d0] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#7b68ee] rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>

        {/* 부서별 휴가 현황 */}
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-[#7b68ee]" />
              <h2 className="text-sm font-semibold text-[#090c1d]">부서별 휴가 현황</h2>
            </div>
            <Link href="/leaves/manage" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
              승인관리 <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="divide-y divide-[#c8c4d0]">
            {deptLeaves.length === 0 ? (
              <p className="text-sm text-[#514b81] text-center py-8">휴가 신청이 없습니다</p>
            ) : (
              deptLeaves.map(row => (
                <div key={row.dept_id ?? 'none'} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm font-medium text-[#090c1d]">{row.dept_name}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-[#514b81]">전체 {row.total}건</span>
                    <span className="text-green-600 font-medium">승인 {row.approved}</span>
                    {row.pending > 0 && (
                      <span className="text-orange-500 font-medium">대기 {row.pending}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 최근 기안서 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-4 text-[#7b68ee]" />
            <h2 className="text-sm font-semibold text-[#090c1d]">최근 기안서</h2>
          </div>
          <Link href="/admin/logs" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
            활동 로그 <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="divide-y divide-[#c8c4d0]">
          {recentDocs.length === 0 ? (
            <p className="text-sm text-[#514b81] text-center py-8">기안서가 없습니다</p>
          ) : (
            recentDocs.map(doc => {
              const s = DOC_STATUS_MAP[doc.status] ?? { label: doc.status, color: '' }
              return (
                <Link
                  key={doc.id}
                  href={`/documents/${doc.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-[#f8f9fa] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#090c1d] truncate">{doc.title}</p>
                    <p className="text-xs text-[#514b81] mt-0.5">
                      {authorMap.get(doc.author_id) ?? '알 수 없음'}
                      {doc.submitted_at && ` · ${new Date(doc.submitted_at).toLocaleDateString('ko-KR')}`}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ml-4 ${s.color}`}>
                    {s.label}
                  </span>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
