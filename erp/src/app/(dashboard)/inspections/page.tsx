import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, Plus, AlertTriangle } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InspectionStatus, InspectionType, UserRole } from '@/types'

const TYPE_COLORS: Record<InspectionType, string> = {
  '종합': 'bg-[#f5f4ff] text-[#7b68ee]',
  '최초': 'bg-blue-50 text-blue-600',
  '기타': 'bg-gray-100 text-gray-600',
}

const STATUS_LABELS: Record<InspectionStatus, string> = {
  scheduled: '예정',
  in_progress: '진행중',
  completed: '완료',
  overdue: '기한초과',
}

const STATUS_COLORS: Record<InspectionStatus, string> = {
  scheduled: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-[#f5f4ff] text-[#7b68ee]',
  completed: 'bg-green-50 text-green-700',
  overdue: 'bg-red-50 text-red-600',
}

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; status?: string; employee?: string; page?: string; per_page?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const yearFilter = params.year ?? ''
  const statusFilter = params.status ?? ''
  const employeeFilter = params.employee ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = Math.max(0, parseInt(params.per_page ?? '25', 10))  // 0 = 전체

  const admin = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  const currentYear = new Date().getFullYear()

  const from = pageSize > 0 ? (page - 1) * pageSize : 0
  const to = pageSize > 0 ? from + pageSize - 1 : 99999

  // 검색 쿼리 구성 — 필터는 DB에서, 페이지 단위로만 가져옴
  let query = admin.from('inspections').select(
    'id, year, sequence_num, inspection_type, inspection_start_date, status, assigned_employee_id, customer_id',
    { count: 'exact' }
  )
  if (yearFilter) query = query.eq('year', parseInt(yearFilter))
  if (statusFilter) query = query.eq('status', statusFilter)
  if (employeeFilter) query = query.eq('assigned_employee_id', employeeFilter)

  const [inspRes, customersRes, profilesRes] = await Promise.all([
    query.order('year', { ascending: false }).order('inspection_start_date', { ascending: false }).range(from, to),
    admin.from('customers').select('id, customer_name, customer_code'),
    admin.from('profiles').select('id, name, position').eq('is_active', true).order('name'),
  ])

  type InspRow = {
    id: string; year: number; sequence_num: number; inspection_type: InspectionType
    inspection_start_date: string; status: InspectionStatus
    assigned_employee_id: string; customer_id: string
  }

  const inspections = (inspRes.data ?? []) as InspRow[]
  const totalCount = inspRes.count ?? 0
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalCount / pageSize)
  const customerMap = new Map(
    ((customersRes.data ?? []) as Array<{ id: string; customer_name: string; customer_code: string }>)
      .map(c => [c.id, c])
  )
  const employees = (profilesRes.data ?? []) as Array<{ id: string; name: string; position: string | null }>
  const empMap = new Map(employees.map(e => [e.id, e]))

  // 단계 진행률 및 마감임박 정보 로드
  const stepSummary: Record<string, { total: number; completed: number; hasDueSoon: boolean; hasOverdue: boolean }> = {}
  if (inspections.length > 0) {
    const { data: steps } = await admin
      .from('inspection_steps')
      .select('inspection_id, status, due_date')
      .in('inspection_id', inspections.map(i => i.id))

    for (const s of steps ?? []) {
      const row = s as { inspection_id: string; status: string; due_date: string | null }
      if (!stepSummary[row.inspection_id]) {
        stepSummary[row.inspection_id] = { total: 0, completed: 0, hasDueSoon: false, hasOverdue: false }
      }
      const sum = stepSummary[row.inspection_id]
      sum.total++
      if (row.status === 'completed') sum.completed++
      if (row.status !== 'completed' && row.due_date) {
        if (row.due_date < today) sum.hasOverdue = true
        else if (row.due_date <= in7Days) sum.hasDueSoon = true
      }
    }
  }

  const canCreate = (profile.role as UserRole) !== 'employee'
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

  function buildPageUrl(p: number) {
    const sp = new URLSearchParams()
    if (yearFilter) sp.set('year', yearFilter)
    if (statusFilter) sp.set('status', statusFilter)
    if (employeeFilter) sp.set('employee', employeeFilter)
    if (pageSize !== 25) sp.set('per_page', String(pageSize))
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return `/inspections${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">점검 업무</h1>
            <p className="text-sm text-[#514b81] mt-0.5">소방 점검 업무 현황을 관리합니다</p>
          </div>
        </div>
        {canCreate && (
          <Link
            href="/inspections/new"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />
            점검 배정
          </Link>
        )}
      </div>

      {/* 필터 */}
      <form method="GET" action="/inspections" className="flex flex-wrap items-center gap-2">
        <select
          name="year"
          defaultValue={yearFilter}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 연도</option>
          {yearOptions.map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={statusFilter}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 상태</option>
          <option value="scheduled">예정</option>
          <option value="in_progress">진행중</option>
          <option value="completed">완료</option>
          <option value="overdue">기한초과</option>
        </select>
        <select
          name="employee"
          defaultValue={employeeFilter}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 담당자</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <select
          name="per_page"
          defaultValue={String(pageSize)}
          className="h-9 rounded-lg border border-[#e5e3f8] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="25">25건</option>
          <option value="50">50건</option>
          <option value="0">전체</option>
        </select>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          검색
        </button>
        {(yearFilter || statusFilter || employeeFilter) && (
          <a
            href="/inspections"
            className="h-9 px-3 rounded-lg border border-[#e8e8e8] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center"
          >
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {totalCount}건</span>
      </form>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px,rgba(18,43,165,0.04)_0px_6px_6px_-3px,rgba(18,43,165,0.04)_0px_12px_12px_-6px] overflow-hidden">
        {inspections.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">
            검색된 점검 업무가 없습니다
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8e8e8] bg-[#f8f9fa]">
                  {['고객명', '유형/차수', '시작일', '담당자', '진행 단계', '상태', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e8e8]">
                {inspections.map(insp => {
                  const customer = customerMap.get(insp.customer_id)
                  const emp = empMap.get(insp.assigned_employee_id)
                  const steps = stepSummary[insp.id] ?? { total: 0, completed: 0, hasDueSoon: false, hasOverdue: false }
                  const pct = steps.total > 0 ? (steps.completed / steps.total) * 100 : 0

                  return (
                    <tr key={insp.id} className="hover:bg-[#f8f9fa] transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#090c1d]">{customer?.customer_name ?? '—'}</p>
                        <p className="text-xs text-[#b0acd6] font-mono mt-0.5">{customer?.customer_code}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[insp.inspection_type]}`}>
                            {insp.inspection_type}
                          </span>
                          <span className="text-xs text-[#514b81]">{insp.sequence_num}차</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#292d34] whitespace-nowrap">
                        {insp.inspection_start_date}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#090c1d]">
                        {emp ? (
                          <span>{emp.name}{emp.position ? <span className="text-[#b0acd6] ml-1">({emp.position})</span> : null}</span>
                        ) : (
                          <span className="text-red-500">미배정</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {steps.total > 0 ? (
                          <div className="flex items-center gap-2">
                            {(steps.hasOverdue || steps.hasDueSoon) && (
                              <AlertTriangle className={`size-3.5 shrink-0 ${steps.hasOverdue ? 'text-red-500' : 'text-amber-500'}`} />
                            )}
                            <div className="w-20 h-1.5 bg-[#f0eff8] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${steps.completed === steps.total ? 'bg-green-500' : 'bg-[#7b68ee]'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-[#514b81] whitespace-nowrap">
                              {steps.completed}/{steps.total}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-[#b0acd6]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[insp.status]}`}>
                          {STATUS_LABELS[insp.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/inspections/${insp.id}`}
                          className="text-xs text-[#7b68ee] hover:underline font-medium"
                        >
                          상세보기
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {page > 1 && (
            <a href={buildPageUrl(page - 1)}
              className="h-8 px-3 rounded-lg border border-[#e5e3f8] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
              이전
            </a>
          )}
          <span className="text-sm text-[#514b81]">{page} / {totalPages}</span>
          {page < totalPages && (
            <a href={buildPageUrl(page + 1)}
              className="h-8 px-3 rounded-lg border border-[#e5e3f8] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
              다음
            </a>
          )}
        </div>
      )}
    </div>
  )
}
