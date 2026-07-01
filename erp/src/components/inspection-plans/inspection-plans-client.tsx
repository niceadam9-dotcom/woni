'use client'

import { useState, useTransition, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, Calendar, List, Plus,
  RefreshCw, CheckCircle, Clock, XCircle, Filter, Lightbulb,
} from 'lucide-react'
import type { InspectionPlan, InspectionType, PlanItemStatus } from '@/types'
import { createInspectionPlanAction, autoGeneratePlanAction } from '@/app/(dashboard)/inspection-plans/actions'
import { PlanItemSlidePanel } from './plan-item-slide-panel'
import { AddPlanItemModal } from './add-plan-item-modal'
import { AutoGenerateModal } from './auto-generate-modal'
import { SmartSuggestModal } from './smart-suggest-modal'

type CustomerOption = { id: string; customer_name: string; inspection_type: InspectionType; assigned_employee_id: string | null }

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
const WEEKDAYS = ['일','월','화','수','목','금','토']

const STATUS_STYLE: Record<PlanItemStatus, string> = {
  planned:   'bg-blue-50 text-blue-600',
  confirmed: 'bg-[#f5f4ff] text-[#7b68ee]',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400',
}
const STATUS_LABEL: Record<PlanItemStatus, string> = {
  planned: '계획', confirmed: '확정', completed: '완료', cancelled: '취소',
}

type Employee = { id: string; name: string; position: string | null }
type ItemView = Record<string, unknown> & {
  id: string
  customer_id: string
  inspection_type: InspectionType
  sequence_num: 1 | 2
  scheduled_date: string | null
  status: PlanItemStatus
  notes: string | null
  inspection_id: string | null
  customers: { customer_name: string; customer_code: string } | null
  profiles: { name: string } | null
  assigned_employee_id: string | null
}

interface Props {
  initialPlans: InspectionPlan[]
  initialItems: Record<string, unknown>[]
  initialYear: number
  initialMonth: number
  employees: Employee[]
  customers: CustomerOption[]
  canManage: boolean
}

export function InspectionPlansClient({
  initialPlans,
  initialItems,
  initialYear,
  initialMonth,
  employees,
  customers,
  canManage,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [viewYear,  setViewYear]  = useState(initialYear)
  const [viewMonth, setViewMonth] = useState(initialMonth)
  const [viewMode,  setViewMode]  = useState<'calendar' | 'list'>('list')

  const [items, setItems]     = useState<ItemView[]>(initialItems as ItemView[])
  const [plans, setPlans]     = useState<InspectionPlan[]>(initialPlans)

  // 서버 재렌더링(router.push) 후 props가 바뀌면 로컬 state에 동기화
  useEffect(() => { setItems(initialItems as ItemView[]) }, [initialItems])
  useEffect(() => { setPlans(initialPlans) }, [initialPlans])
  const [filterEmployee, setFilterEmployee] = useState<string>('all')
  const [filterStatus,   setFilterStatus]   = useState<string>('all')

  const [selectedItem, setSelectedItem]     = useState<ItemView | null>(null)
  const [showAddModal, setShowAddModal]     = useState(false)
  const [showAutoModal, setShowAutoModal]   = useState(false)
  const [showSmartModal, setShowSmartModal] = useState(false)
  const [selectedDate, setSelectedDate]     = useState<string | null>(null)

  const currentPlan = plans.find(p => p.year === viewYear && p.month === viewMonth) ?? null

  // 필터 적용
  const filteredItems = items.filter(item => {
    if (filterEmployee !== 'all' && item.assigned_employee_id !== filterEmployee) return false
    if (filterStatus   !== 'all' && item.status !== filterStatus)                 return false
    return true
  })

  // 달력 날짜 → 항목 그룹
  const itemsByDate = filteredItems.reduce<Record<string, ItemView[]>>((acc, item) => {
    const d = item.scheduled_date
    if (d) { acc[d] = [...(acc[d] ?? []), item] }
    return acc
  }, {})

  // 달력 셀 생성
  const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()

  function navigateMonth(delta: number) {
    let y = viewYear, m = viewMonth + delta
    if (m > 12) { y++; m = 1 }
    if (m < 1)  { y--; m = 12 }
    router.push(`/inspection-plans?year=${y}&month=${m}`)
  }

  async function handleCreatePlan() {
    const res = await createInspectionPlanAction({ year: viewYear, month: viewMonth })
    if (res.error) { alert(res.error); return }
    startTransition(() => router.push(`/inspection-plans?year=${viewYear}&month=${viewMonth}`))
  }

  function handleDateClick(dateStr: string) {
    setSelectedDate(dateStr)
    setShowAddModal(true)
  }

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#090c1d]">월간 점검계획</h1>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAutoModal(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#7b68ee] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
            >
              <RefreshCw className="size-3.5" />자동 생성
            </button>
            <button
              onClick={() => setShowSmartModal(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-amber-400 text-amber-600 hover:bg-amber-50 transition-colors"
            >
              <Lightbulb className="size-3.5" />일정 제안
            </button>
            {currentPlan ? (
              <button
                onClick={() => { setSelectedDate(null); setShowAddModal(true) }}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#7b68ee] text-white hover:bg-[#6a5acd] transition-colors"
              >
                <Plus className="size-3.5" />항목 추가
              </button>
            ) : (
              <button
                onClick={handleCreatePlan}
                disabled={isPending}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#7b68ee] text-white hover:bg-[#6a5acd] transition-colors disabled:opacity-50"
              >
                <Plus className="size-3.5" />계획 생성
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-5">
        {/* 좌측 사이드바 */}
        <div className="col-span-1 space-y-4">
          {/* 월 네비게이션 */}
          <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px] p-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => navigateMonth(-1)} className="p-1 hover:bg-[#f5f4ff] rounded-lg transition-colors">
                <ChevronLeft className="size-4 text-[#514b81]" />
              </button>
              <span className="text-sm font-semibold text-[#090c1d]">
                {viewYear}년 {viewMonth}월
              </span>
              <button onClick={() => navigateMonth(1)} className="p-1 hover:bg-[#f5f4ff] rounded-lg transition-colors">
                <ChevronRight className="size-4 text-[#514b81]" />
              </button>
            </div>
            {/* 계획 상태 배지 */}
            {currentPlan ? (
              <div className={`text-xs text-center py-1 px-2 rounded-full font-medium ${
                currentPlan.status === 'confirmed' ? 'bg-green-50 text-green-700' :
                currentPlan.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                'bg-[#f5f4ff] text-[#7b68ee]'
              }`}>
                {currentPlan.status === 'confirmed' ? '✓ 확정' :
                 currentPlan.status === 'cancelled' ? '취소됨' : '초안'}
              </div>
            ) : (
              <div className="text-xs text-center py-1 text-[#b0acd6]">계획 없음</div>
            )}
          </div>

          {/* 뷰 전환 */}
          <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px] p-4">
            <p className="text-xs font-medium text-[#514b81] mb-2">보기 방식</p>
            <div className="flex flex-col gap-1">
              {(['calendar', 'list'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                    viewMode === mode ? 'bg-[#f5f4ff] text-[#7b68ee] font-medium' : 'text-[#514b81] hover:bg-[#f8f9fa]'
                  }`}
                >
                  {mode === 'calendar' ? <Calendar className="size-3.5" /> : <List className="size-3.5" />}
                  {mode === 'calendar' ? '달력 뷰' : '목록 뷰'}
                </button>
              ))}
            </div>
          </div>

          {/* 담당자 필터 */}
          <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px] p-4">
            <p className="text-xs font-medium text-[#514b81] mb-2 flex items-center gap-1">
              <Filter className="size-3" />담당자
            </p>
            <select
              value={filterEmployee}
              onChange={e => setFilterEmployee(e.target.value)}
              className="w-full text-xs border border-[#e8e8e8] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
            >
              <option value="all">전체</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          {/* 상태 필터 */}
          <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px] p-4">
            <p className="text-xs font-medium text-[#514b81] mb-2 flex items-center gap-1">
              <Filter className="size-3" />상태
            </p>
            <div className="flex flex-col gap-1">
              {[['all','전체'],['planned','계획'],['confirmed','확정'],['completed','완료'],['cancelled','취소']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFilterStatus(val)}
                  className={`text-xs text-left px-2 py-1 rounded transition-colors ${
                    filterStatus === val ? 'bg-[#f5f4ff] text-[#7b68ee] font-medium' : 'text-[#514b81] hover:bg-[#f8f9fa]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 우측 메인 뷰 */}
        <div className="col-span-3">
          {viewMode === 'calendar' ? (
            <CalendarView
              year={viewYear}
              month={viewMonth}
              firstDay={firstDay}
              daysInMonth={daysInMonth}
              itemsByDate={itemsByDate}
              todayStr={todayStr}
              canManage={canManage}
              onDateClick={handleDateClick}
              onItemClick={setSelectedItem}
            />
          ) : (
            <ListView
              items={filteredItems}
              canManage={canManage}
              onItemClick={setSelectedItem}
            />
          )}
        </div>
      </div>

      {/* 슬라이드 패널 (항목 상세·날짜 수정) */}
      {selectedItem && (
        <PlanItemSlidePanel
          item={selectedItem}
          employees={employees}
          canManage={canManage}
          onClose={() => setSelectedItem(null)}
          onSaved={() => { setSelectedItem(null); startTransition(() => router.push(`/inspection-plans?year=${viewYear}&month=${viewMonth}`)) }}
        />
      )}

      {/* 항목 추가 모달 */}
      {showAddModal && currentPlan && (
        <AddPlanItemModal
          planId={currentPlan.id}
          defaultDate={selectedDate}
          employees={employees}
          customers={customers}
          onClose={() => { setShowAddModal(false); setSelectedDate(null) }}
          onSaved={() => { setShowAddModal(false); setSelectedDate(null); startTransition(() => router.push(`/inspection-plans?year=${viewYear}&month=${viewMonth}`)) }}
        />
      )}

      {/* 사용승인일 기반 일정 제안 모달 */}
      {showSmartModal && (
        <SmartSuggestModal
          year={viewYear}
          month={viewMonth}
          planId={currentPlan?.id ?? null}
          onClose={() => setShowSmartModal(false)}
          onAdded={() => {
            setShowSmartModal(false)
            startTransition(() => router.push(`/inspection-plans?year=${viewYear}&month=${viewMonth}`))
          }}
        />
      )}

      {/* 자동 생성 모달 */}
      {showAutoModal && (
        <AutoGenerateModal
          year={viewYear}
          month={viewMonth}
          onClose={() => setShowAutoModal(false)}
          onGenerated={(planId) => {
            setShowAutoModal(false)
            startTransition(() => router.push(`/inspection-plans?year=${viewYear}&month=${viewMonth}`))
          }}
        />
      )}
    </div>
  )
}

// ── 달력 뷰 ──────────────────────────────────────────────────
function CalendarView({
  year, month, firstDay, daysInMonth, itemsByDate, todayStr, canManage, onDateClick, onItemClick,
}: {
  year: number; month: number; firstDay: number; daysInMonth: number
  itemsByDate: Record<string, ItemView[]>; todayStr: string; canManage: boolean
  onDateClick: (d: string) => void; onItemClick: (item: ItemView) => void
}) {
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // 6주 맞추기
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[#f0eff8]">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`text-center text-xs font-medium py-2 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-[#514b81]'}`}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="h-24 border-b border-r border-[#f8f9fa] bg-[#fafafa]" />
          const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const dayItems = itemsByDate[dateStr] ?? []
          const isToday = dateStr === todayStr
          const dow = idx % 7

          return (
            <div
              key={idx}
              className={`h-24 border-b border-r border-[#f0eff8] p-1 cursor-pointer hover:bg-[#fafafa] transition-colors ${isToday ? 'bg-[#f5f4ff]' : ''}`}
              onClick={() => canManage && onDateClick(dateStr)}
            >
              <span className={`text-xs font-medium ${
                isToday ? 'bg-[#7b68ee] text-white rounded-full w-5 h-5 flex items-center justify-center' :
                dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-[#090c1d]'
              }`}>{day}</span>
              <div className="mt-0.5 space-y-0.5 overflow-hidden">
                {dayItems.slice(0, 2).map(item => (
                  <div
                    key={item.id}
                    onClick={e => { e.stopPropagation(); onItemClick(item) }}
                    className={`text-[10px] px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80 ${STATUS_STYLE[item.status]}`}
                  >
                    {(item.customers as { customer_name: string } | null)?.customer_name ?? '—'}
                  </div>
                ))}
                {dayItems.length > 2 && (
                  <div className="text-[10px] text-[#b0acd6] pl-1">+{dayItems.length - 2}건</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 목록 뷰 ──────────────────────────────────────────────────
function ListView({
  items, canManage, onItemClick,
}: {
  items: ItemView[]; canManage: boolean; onItemClick: (item: ItemView) => void
}) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px] p-12 text-center">
        <Calendar className="size-8 text-[#b0acd6] mx-auto mb-3" />
        <p className="text-sm text-[#514b81]">이 달의 점검 계획이 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-[#e8e8e8] shadow-[rgba(18,43,165,0.04)_0px_1px_1px_-0.5px,rgba(18,43,165,0.04)_0px_3px_3px_-1.5px] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#f0eff8] bg-[#fafafa]">
            {['점검예정일','건물명','점검유형','차수','담당직원','상태'].map(h => (
              <th key={h} className="text-left text-xs font-medium text-[#514b81] px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr
              key={item.id}
              className="border-b border-[#f8f9fa] last:border-0 hover:bg-[#fafafa] transition-colors cursor-pointer"
              onClick={() => onItemClick(item)}
            >
              <td className="px-4 py-3 text-[#514b81]">
                {item.scheduled_date ?? <span className="text-[#b0acd6]">미정</span>}
              </td>
              <td className="px-4 py-3 font-medium text-[#090c1d]">
                {(item.customers as { customer_name: string } | null)?.customer_name ?? '—'}
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  item.inspection_type === '종합' ? 'bg-[#f5f4ff] text-[#7b68ee]' :
                  item.inspection_type === '최초' ? 'bg-blue-50 text-blue-600' :
                  'bg-gray-100 text-gray-600'
                }`}>{item.inspection_type}</span>
              </td>
              <td className="px-4 py-3 text-[#514b81]">{item.sequence_num}차</td>
              <td className="px-4 py-3 text-[#514b81]">
                {(item.profiles as { name: string } | null)?.name ?? <span className="text-[#b0acd6]">미배정</span>}
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[item.status]}`}>
                  {STATUS_LABEL[item.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
