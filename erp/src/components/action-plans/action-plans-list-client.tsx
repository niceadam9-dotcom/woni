'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Search, ChevronRight, Check, Clock, AlertTriangle } from 'lucide-react'
import { inspectionTypeLabel } from '@/types'

function fmt(d: string | null | undefined) { return d ? d.slice(0, 10) : '' }

type PlanRow = {
  id: string
  completion_target_date: string | null
  submitted_at: string | null
  sent_at: string | null
  inspections: {
    id: string
    inspection_type: string
    sequence_num: number
    year: number
    customers: { customer_name: string; customer_code: string } | null
    profiles: { name: string } | null
  } | null
  action_plan_status: {
    fire_station_submitted_at: string | null
    defect_certificate_count: number
  } | null
  action_complete_reports: { id: string; submitted_at: string | null } | null
}

function PlanStatusChip({ plan }: { plan: PlanRow }) {
  if (plan.action_complete_reports?.submitted_at)
    return <span className="px-2 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-medium">이행완료</span>
  if (plan.submitted_at)
    return <span className="px-2 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700 font-medium">이행계획제출</span>
  return <span className="px-2 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 font-medium">제출대기</span>
}

export function ActionPlansListClient({ plans }: { plans: Record<string, unknown>[] }) {
  const rows = plans as unknown as PlanRow[]

  const [nameFilter,   setNameFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (nameFilter) {
        const nm = (r.inspections?.customers?.customer_name ?? '').toLowerCase()
        if (!nm.includes(nameFilter.toLowerCase())) return false
      }
      if (statusFilter === 'pending'  && r.submitted_at)                          return false
      if (statusFilter === 'submitted' && (!r.submitted_at || r.action_complete_reports?.submitted_at)) return false
      if (statusFilter === 'complete' && !r.action_complete_reports?.submitted_at) return false
      return true
    })
  }, [rows, nameFilter, statusFilter])

  const overdueCount = rows.filter(r =>
    !r.submitted_at &&
    r.completion_target_date &&
    new Date(r.completion_target_date) < new Date()
  ).length

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h1 className="text-xl font-bold">이행계획서 등록</h1>
          <p className="text-xs text-gray-400 mt-0.5">불량내역 기반 이행계획 관리</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">전체 <strong className="text-gray-800">{rows.length}</strong></span>
          {overdueCount > 0 && (
            <span className="text-red-500 flex items-center gap-1">
              <AlertTriangle size={12} /> 기한초과 <strong>{overdueCount}</strong>
            </span>
          )}
        </div>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="all">전체</option>
          <option value="pending">제출대기</option>
          <option value="submitted">이행계획제출</option>
          <option value="complete">이행완료</option>
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            placeholder="건물명 검색"
            className="border rounded pl-7 pr-3 py-1.5 text-sm w-40"
          />
        </div>
        <span className="ml-auto text-xs text-gray-400">{filtered.length}건</span>
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Clock className="size-10 mx-auto mb-2 text-gray-200" />
            이행계획서가 없습니다.
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map(plan => {
              const insp = plan.inspections
              const target = plan.completion_target_date
              const isOverdue = target && !plan.submitted_at && new Date(target) < new Date()

              return (
                <li key={plan.id}>
                  <Link
                    href={`/action-plans/${plan.id}`}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-sm truncate">
                          {insp?.customers?.customer_name ?? '—'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {inspectionTypeLabel(insp?.inspection_type)} {insp?.year}년 {insp?.sequence_num}차
                        </span>
                        <PlanStatusChip plan={plan} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>담당: {insp?.profiles?.name ?? '-'}</span>
                        {target && (
                          <span className={isOverdue ? 'text-red-500 font-medium' : ''}>
                            완료목표: {fmt(target)}
                          </span>
                        )}
                        {plan.submitted_at && (
                          <span className="text-blue-500 flex items-center gap-0.5">
                            <Check size={10} /> 이행계획제출 {fmt(plan.submitted_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 shrink-0" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
