'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, Calendar, List, Plus,
  Filter, Lightbulb, AlertTriangle, ChevronDown,
  PlayCircle, ExternalLink, Pencil, AlertCircle, Check,
} from 'lucide-react'
import Link from 'next/link'
import type { InspectionPlan, InspectionType, PlanItemStatus } from '@/types'
import type { OverdueItem } from '@/app/(dashboard)/inspection-plans/page'
import {
  createInspectionPlanAction,
  startInspectionAction, updatePlanItemAction,
} from '@/app/(dashboard)/inspection-plans/actions'
import { PlanItemSlidePanel } from './plan-item-slide-panel'
import { AddPlanItemModal } from './add-plan-item-modal'
import { SmartSuggestModal } from './smart-suggest-modal'
import { OverdueResolveModal } from './overdue-resolve-modal'

type CustomerOption = { id: string; customer_name: string; inspection_type: InspectionType; assigned_employee_id: string | null; address: string | null; use_approval_date: string | null }

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
  overdueItems: OverdueItem[]
  holidays: string[]
  canManage: boolean
}

export function InspectionPlansClient({
  initialPlans,
  initialItems,
  initialYear,
  initialMonth,
  employees,
  customers,
  overdueItems,
  holidays,
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
  const [filterStatus,   setFilterStatus]   = useState<string>('planned')

  const [selectedItem, setSelectedItem]     = useState<ItemView | null>(null)
  const [showAddModal, setShowAddModal]     = useState(false)
  const [showSmartModal, setShowSmartModal] = useState(false)
  const [selectedDate, setSelectedDate]     = useState<string | null>(null)

  const currentPlan = plans.find(p => p.year === viewYear && p.month === viewMonth) ?? null

  // 목록 뷰 필터 (상태 + 담당자 모두 적용)
  const filteredItems = items.filter(item => {
    if (filterEmployee !== 'all' && item.assigned_employee_id !== filterEmployee) return false
    if (filterStatus   !== 'all' && item.status !== filterStatus)                 return false
    return true
  })

  // 달력 뷰 필터 (담당자만 적용, 상태 필터 무시 — 달력은 전체 일정을 보여줌)
  const calendarItems = items.filter(item =>
    filterEmployee === 'all' || item.assigned_employee_id === filterEmployee
  )
  const itemsByDate = calendarItems.reduce<Record<string, ItemView[]>>((acc, item) => {
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

  // 항목 추가 모달 열기 — 플랜이 없으면 자동 생성 후 모달 표시
  async function handleOpenAddModal(date: string | null = null) {
    setSelectedDate(date)
    if (!currentPlan) {
      const res = await createInspectionPlanAction({ year: viewYear, month: viewMonth })
      if (res.error && !res.planId) { alert(res.error); return }
      setShowAddModal(true)
      startTransition(() => router.push(`/inspection-plans?year=${viewYear}&month=${viewMonth}`))
      return
    }
    setShowAddModal(true)
  }

  // 목록 뷰에서 직접 점검 시작
  function handleStartItem(item: ItemView) {
    startTransition(async () => {
      const res = await startInspectionAction(item.id)
      if (res.error) { alert(res.error); return }
      router.push(`/inspections/${res.inspectionId}`)
    })
  }

  function handleDateClick(dateStr: string) {
    handleOpenAddModal(dateStr)
  }

  const refresh = useCallback(() => {
    startTransition(() => router.push(`/inspection-plans?year=${viewYear}&month=${viewMonth}`))
  }, [router, viewYear, viewMonth])

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* 왼쪽: 제목 + 월 네비 + 상태 */}
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-[#090c1d]">월간 점검계획</h1>

          {/* 월 네비게이션 */}
          <div className="flex items-center gap-0.5 bg-white border border-[#e8e8e8] rounded-lg px-1 py-1 shadow-sm">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-1 hover:bg-[#f5f4ff] rounded transition-colors"
            >
              <ChevronLeft className="size-4 text-[#514b81]" />
            </button>
            <span className="text-sm font-semibold text-[#090c1d] min-w-[80px] text-center px-1">
              {viewYear}년 {viewMonth}월
            </span>
            <button
              onClick={() => navigateMonth(1)}
              className="p-1 hover:bg-[#f5f4ff] rounded transition-colors"
            >
              <ChevronRight className="size-4 text-[#514b81]" />
            </button>
          </div>

        </div>

        {/* 오른쪽: 액션 버튼 */}
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSmartModal(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-amber-400 text-amber-600 hover:bg-amber-50 transition-colors"
            >
              <Lightbulb className="size-3.5" />일정 제안
            </button>
            <button
              onClick={() => handleOpenAddModal(null)}
              disabled={isPending}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#7b68ee] text-white hover:bg-[#6a5acd] transition-colors disabled:opacity-50"
            >
              <Plus className="size-3.5" />항목 추가
            </button>
          </div>
        )}
      </div>

      {/* 초과 점검 경보 */}
      {overdueItems.length > 0 && (
        <OverduePanel
          items={overdueItems}
          year={viewYear}
          month={viewMonth}
          onResolved={refresh}
        />
      )}

      {/* 필터 툴바 */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 뷰 모드 토글 */}
        <div className="flex items-center bg-[#f5f4ff] rounded-lg p-0.5">
          {(['calendar', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${
                viewMode === mode
                  ? 'bg-white text-[#7b68ee] shadow-sm'
                  : 'text-[#514b81] hover:text-[#7b68ee]'
              }`}
            >
              {mode === 'calendar' ? <Calendar className="size-3.5" /> : <List className="size-3.5" />}
              {mode === 'calendar' ? '달력' : '목록'}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-[#e8e8e8]" />

        {/* 담당자 필터 */}
        <select
          value={filterEmployee}
          onChange={e => setFilterEmployee(e.target.value)}
          className="text-xs border border-[#e8e8e8] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#7b68ee] text-[#514b81]"
        >
          <option value="all">담당자 전체</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>

        <div className="w-px h-5 bg-[#e8e8e8]" />

        {/* 상태 필터 */}
        <div className="flex items-center gap-1">
          {[['planned','계획 중'],['confirmed','확정'],['completed','완료'],['cancelled','취소'],['all','전체']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilterStatus(val)}
              className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors font-medium ${
                filterStatus === val
                  ? 'bg-[#7b68ee] text-white'
                  : 'text-[#514b81] hover:bg-[#f5f4ff] hover:text-[#7b68ee]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 메인 뷰 (전체 너비) */}
      <div>
        {viewMode === 'calendar' ? (
          <CalendarView
            year={viewYear}
            month={viewMonth}
            firstDay={firstDay}
            daysInMonth={daysInMonth}
            itemsByDate={itemsByDate}
            todayStr={todayStr}
            canManage={canManage}
            customers={customers}
            onDateClick={handleDateClick}
            onItemClick={setSelectedItem}
          />
        ) : (
          <ListView
            items={filteredItems}
            customers={customers}
            canManage={canManage}
            isPending={isPending}
            onItemClick={setSelectedItem}
            onStart={handleStartItem}
            onRefresh={refresh}
          />
        )}
      </div>

      {/* 슬라이드 패널 (항목 상세·날짜 수정) */}
      {selectedItem && (
        <PlanItemSlidePanel
          item={selectedItem}
          employees={employees}
          canManage={canManage}
          onClose={() => setSelectedItem(null)}
          onSaved={() => { setSelectedItem(null); refresh() }}
        />
      )}

      {/* 항목 추가 모달 */}
      {showAddModal && currentPlan && (
        <AddPlanItemModal
          planId={currentPlan.id}
          planYear={viewYear}
          defaultDate={selectedDate}
          employees={employees}
          customers={customers}
          holidays={holidays}
          onClose={() => { setShowAddModal(false); setSelectedDate(null) }}
          onSaved={() => { setShowAddModal(false); setSelectedDate(null); refresh() }}
        />
      )}

      {/* 사용승인일 기반 일정 제안 모달 */}
      {showSmartModal && (
        <SmartSuggestModal
          year={viewYear}
          month={viewMonth}
          planId={currentPlan?.id ?? null}
          holidays={holidays}
          onClose={() => setShowSmartModal(false)}
          onAdded={() => { setShowSmartModal(false); refresh() }}
        />
      )}

    </div>
  )
}

// ── 달력 뷰 ──────────────────────────────────────────────────
function CalendarView({
  year, month, firstDay, daysInMonth, itemsByDate, todayStr, canManage, customers, onDateClick, onItemClick,
}: {
  year: number; month: number; firstDay: number; daysInMonth: number
  itemsByDate: Record<string, ItemView[]>; todayStr: string; canManage: boolean
  customers: CustomerOption[]
  onDateClick: (d: string) => void; onItemClick: (item: ItemView) => void
}) {
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]))

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
          if (!day) return <div key={idx} className="h-28 border-b border-r border-[#f8f9fa] bg-[#fafafa]" />
          const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const dayItems = itemsByDate[dateStr] ?? []
          const isToday = dateStr === todayStr
          const isPast  = dateStr < todayStr
          const dow = idx % 7
          const hasOverdue = isPast && dayItems.some(
            i => i.status !== 'completed' && i.status !== 'cancelled'
          )

          return (
            <div
              key={idx}
              className={`h-28 border-b border-r border-[#f0eff8] p-1 cursor-pointer hover:bg-[#fafafa] transition-colors ${
                isToday ? 'bg-[#f5f4ff]' : hasOverdue ? 'bg-red-50/50' : ''
              }`}
              onClick={() => canManage && onDateClick(dateStr)}
            >
              <span className={`text-xs font-medium ${
                isToday ? 'bg-[#7b68ee] text-white rounded-full w-5 h-5 flex items-center justify-center' :
                dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-[#090c1d]'
              }`}>{day}</span>
              <div className="mt-0.5 space-y-0.5 overflow-hidden">
                {dayItems.slice(0, 2).map(item => {
                  const approvalDate = customerMap[item.customer_id]?.use_approval_date
                  const approvalLabel = approvalDate
                    ? (() => { const d = new Date(approvalDate); return `${d.getMonth()+1}/${d.getDate()} 사용승인` })()
                    : null
                  const itemOverdue = isPast && item.status !== 'completed' && item.status !== 'cancelled'
                  return (
                    <div
                      key={item.id}
                      onClick={e => { e.stopPropagation(); onItemClick(item) }}
                      className={`text-[10px] px-1 py-0.5 rounded cursor-pointer hover:opacity-80 ${
                        itemOverdue ? 'bg-red-100 text-red-600 border border-red-200' : STATUS_STYLE[item.status]
                      }`}
                    >
                      <div className="truncate font-medium flex items-center gap-0.5">
                        {itemOverdue && <AlertCircle className="size-2.5 shrink-0" />}
                        {(item.customers as { customer_name: string } | null)?.customer_name ?? '—'}
                      </div>
                      {approvalLabel && (
                        <div className="opacity-70 truncate">{approvalLabel}</div>
                      )}
                    </div>
                  )
                })}
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

// ── 인라인 날짜 셀 ────────────────────────────────────────────
function InlineDateCell({
  itemId, value, canManage, status, onSaved,
}: {
  itemId: string; value: string | null; canManage: boolean; status: string; onSaved: () => void
}) {
  const todayStr = new Date().toISOString().split('T')[0]
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(value ?? todayStr)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editing])

  const isOverdue = !!value && value < todayStr && status !== 'completed' && status !== 'cancelled'

  function handleSave() {
    startTransition(async () => {
      const res = await updatePlanItemAction({ itemId, scheduledDate: date || null })
      if (!res.error) { setEditing(false); onSaved() }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); handleSave() }
    if (e.key === 'Escape') { setDate(value ?? ''); setEditing(false) }
  }

  if (!canManage || !editing) {
    return (
      <div
        className="flex items-center gap-1 group"
        onClick={e => { if (canManage) { e.stopPropagation(); setEditing(true) } }}
      >
        {isOverdue ? (
          <span
            className={`flex items-center gap-1 text-red-500 font-semibold ${canManage ? 'cursor-pointer' : ''}`}
            title="점검 예정일이 지났습니다"
          >
            <AlertCircle className="size-3.5 shrink-0" />
            {value}
          </span>
        ) : value ? (
          <span className={canManage ? 'cursor-pointer' : ''}>{value}</span>
        ) : (
          <span className={`text-[#b0acd6] italic text-xs ${canManage ? 'cursor-pointer' : ''}`}>
            클릭하여 날짜 입력
          </span>
        )}
        {canManage && (
          <Pencil className="size-3 text-[#b0acd6] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        )}
      </div>
    )
  }

  return (
    <div onClick={e => e.stopPropagation()} className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        disabled={isPending}
        className="text-xs border border-[#7b68ee] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
      />
    </div>
  )
}

// ── 목록 뷰 ──────────────────────────────────────────────────
function ListView({
  items, customers, canManage, isPending, onItemClick, onStart, onRefresh,
}: {
  items: ItemView[]; customers: CustomerOption[]; canManage: boolean; isPending: boolean
  onItemClick: (item: ItemView) => void; onStart: (item: ItemView) => void
  onRefresh: () => void
}) {
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set())
  const [bulkPending, startBulkTransition]  = useTransition()
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]))
  const todayStr = new Date().toISOString().split('T')[0]

  const selectableItems     = items.filter(i => i.status !== 'cancelled')
  const confirmableSelected = items.filter(i => selectedIds.has(i.id) && i.status === 'planned')
  const allSelected = selectableItems.length > 0 && selectableItems.every(i => selectedIds.has(i.id))
  const someSelected = selectedIds.size > 0

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableItems.map(i => i.id)))
  }

  function toggleItem(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleBulkConfirm() {
    startBulkTransition(async () => {
      for (const item of confirmableSelected) {
        await updatePlanItemAction({ itemId: item.id, status: 'confirmed' })
      }
      setSelectedIds(new Set())
      onRefresh()
    })
  }

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
      {/* 일괄 액션 바 */}
      {someSelected && canManage && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#f5f4ff] border-b border-[#dddaf8]">
          <span className="text-sm text-[#514b81]">
            <span className="font-semibold text-[#7b68ee]">{selectedIds.size}건</span> 선택됨
            {confirmableSelected.length > 0 && (
              <span className="text-xs text-[#b0acd6] ml-2">확정 가능 {confirmableSelected.length}건</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-[#514b81] hover:text-[#7b68ee] transition-colors px-2 py-1"
            >
              선택 해제
            </button>
            <button
              onClick={handleBulkConfirm}
              disabled={bulkPending || confirmableSelected.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#7b68ee] text-white rounded-lg font-medium hover:bg-[#6a5acd] transition-colors disabled:opacity-50"
            >
              <Check className="size-3" />
              {bulkPending ? '처리 중…' : `${confirmableSelected.length}건 확정`}
            </button>
          </div>
        </div>
      )}

      <table className="w-full text-sm table-fixed">
        <colgroup>
          {canManage && <col className="w-10" />}
          <col className="w-36" />{/* 점검예정일 */}
          <col />{/* 건물명 — 나머지 공간 차지 */}
          <col className="w-28" />{/* 사용승인일 */}
          <col className="w-20" />{/* 점검유형 */}
          <col className="w-12" />{/* 차수 */}
          <col className="w-24" />{/* 담당직원 */}
          <col className="w-20" />{/* 상태 */}
          <col className="w-24" />{/* 액션 */}
        </colgroup>
        <thead>
          <tr className="border-b border-[#f0eff8] bg-[#fafafa]">
            {canManage && (
              <th className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-[#7b68ee] cursor-pointer"
                  title="전체 선택"
                />
              </th>
            )}
            <th className="text-left text-xs font-medium text-[#514b81] px-3 py-3">점검예정일</th>
            <th className="text-left text-xs font-medium text-[#514b81] px-3 py-3">건물명</th>
            <th className="text-left text-xs font-medium text-[#514b81] px-3 py-3">사용승인일</th>
            <th className="text-left text-xs font-medium text-[#514b81] px-3 py-3">점검유형</th>
            <th className="text-left text-xs font-medium text-[#514b81] px-3 py-3">차수</th>
            <th className="text-left text-xs font-medium text-[#514b81] px-3 py-3">담당직원</th>
            <th className="text-left text-xs font-medium text-[#514b81] px-3 py-3">상태</th>
            <th className="px-3 py-3" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const approvalRaw = customerMap[item.customer_id]?.use_approval_date
            const approvalLabel = approvalRaw
              ? (() => {
                  const d = new Date(approvalRaw)
                  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`
                })()
              : null
            const canStart = canManage
              && !item.inspection_id
              && item.status !== 'cancelled'
              && !!item.assigned_employee_id
              && !!item.scheduled_date
            const isRowOverdue = !!item.scheduled_date
              && item.scheduled_date < todayStr
              && item.status !== 'completed'
              && item.status !== 'cancelled'
            const isSelected   = selectedIds.has(item.id)
            const isSelectable = item.status !== 'cancelled'
            return (
              <tr
                key={item.id}
                className={`border-b border-[#f8f9fa] last:border-0 transition-colors cursor-pointer ${
                  isSelected    ? 'bg-[#f5f4ff] hover:bg-[#eeebff]' :
                  isRowOverdue  ? 'bg-red-50/60 hover:bg-red-50' :
                                  'hover:bg-[#fafafa]'
                }`}
                onClick={() => onItemClick(item)}
              >
                {canManage && (
                  <td className="px-3 py-2.5" onClick={e => isSelectable && toggleItem(e, item.id)}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      disabled={!isSelectable}
                      className="accent-[#7b68ee] cursor-pointer disabled:opacity-30"
                    />
                  </td>
                )}
                <td className="px-3 py-2.5 text-[#514b81]">
                  <InlineDateCell
                    itemId={item.id}
                    value={item.scheduled_date}
                    status={item.status}
                    canManage={canManage}
                    onSaved={onRefresh}
                  />
                </td>
                <td className="px-3 py-2.5 font-medium text-[#090c1d] truncate">
                  {(item.customers as { customer_name: string } | null)?.customer_name ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-[#514b81] whitespace-nowrap">
                  {approvalLabel ?? <span className="text-[#b0acd6]">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    item.inspection_type === '종합' ? 'bg-[#f5f4ff] text-[#7b68ee]' :
                    item.inspection_type === '최초' ? 'bg-blue-50 text-blue-600' :
                    'bg-gray-100 text-gray-600'
                  }`}>{item.inspection_type}</span>
                </td>
                <td className="px-3 py-2.5 text-[#514b81] text-center">{item.sequence_num}차</td>
                <td className="px-3 py-2.5 text-[#514b81] truncate">
                  {(item.profiles as { name: string } | null)?.name ?? <span className="text-[#b0acd6]">미배정</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </td>
                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                  {item.inspection_id ? (
                    <Link
                      href={`/inspections/${item.inspection_id as string}`}
                      className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium whitespace-nowrap"
                    >
                      <ExternalLink className="size-3" />점검 보기
                    </Link>
                  ) : canStart ? (
                    <button
                      onClick={() => onStart(item)}
                      disabled={isPending}
                      className="flex items-center gap-1 text-xs px-2 py-1 bg-[#202023] text-white rounded-lg hover:bg-[#292d34] transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      <PlayCircle className="size-3" />시작
                    </button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 초과 점검 경보 패널 ───────────────────────────────────────
function OverduePanel({
  items, year, month, onResolved,
}: {
  items: OverdueItem[]; year: number; month: number; onResolved: () => void
}) {
  const [collapsed, setCollapsed]   = useState(false)
  const [showModal, setShowModal]   = useState(false)

  // 담당자별 그룹
  const byEmployee = items.reduce<Record<string, { name: string | null; items: OverdueItem[] }>>(
    (acc, item) => {
      const key = item.assigned_employee_id ?? '__none__'
      if (!acc[key]) acc[key] = { name: item.assigned_employee_name, items: [] }
      acc[key].items.push(item)
      return acc
    },
    {}
  )

  return (
    <>
      <div className="rounded-xl border border-orange-200 bg-orange-50 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => setCollapsed(v => !v)}
            className="flex items-center gap-2 flex-1 text-left"
          >
            <AlertTriangle className="size-4 text-orange-500 shrink-0" />
            <span className="text-sm font-semibold text-orange-700">
              미점검 초과 {items.length}건
            </span>
            <span className="text-xs text-orange-500">
              — {year}년 {month}월 기준 계획 미등록
            </span>
            <ChevronDown
              className={`size-4 text-orange-400 transition-transform ml-1 ${collapsed ? '' : 'rotate-180'}`}
            />
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="shrink-0 ml-4 px-3 py-1.5 text-xs font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            자동 해결
          </button>
        </div>

        {/* 본문 — 담당자별 목록 */}
        {!collapsed && (
          <div className="px-4 pb-4 space-y-3">
            {Object.entries(byEmployee).map(([key, group]) => (
              <div key={key}>
                <p className="text-xs font-semibold text-orange-600 mb-1.5">
                  담당: {group.name ?? '미배정'}
                  <span className="ml-1.5 font-normal text-orange-400">({group.items.length}건)</span>
                </p>
                <div className="space-y-1">
                  {group.items.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 bg-white rounded-lg border border-orange-100 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-[#090c1d] flex-1 truncate min-w-0">
                        {item.customer_name}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                        item.inspection_type === '종합' ? 'bg-[#f5f4ff] text-[#7b68ee]' :
                        item.inspection_type === '최초' ? 'bg-blue-50 text-blue-600' :
                        'bg-gray-100 text-gray-600'
                      }`}>{item.inspection_type}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium shrink-0">
                        {item.sequence_num}차
                      </span>
                      <span className="text-xs text-orange-600 font-medium shrink-0">
                        {item.due_month}월 예정
                      </span>
                      <span className="text-[11px] text-[#b0acd6] shrink-0">
                        사용승인 {(() => { const d = new Date(item.use_approval_date); return `${d.getMonth()+1}/${d.getDate()}` })()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 자동 해결 모달 */}
      {showModal && (
        <OverdueResolveModal
          year={year}
          items={items}
          onClose={() => setShowModal(false)}
          onResolved={() => { setShowModal(false); onResolved() }}
        />
      )}
    </>
  )
}
