'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, Calendar, List, Plus,
  Filter, AlertTriangle, ChevronDown,
  PlayCircle, ExternalLink, Pencil, AlertCircle, Check,
} from 'lucide-react'
import Link from 'next/link'
import type { InspectionPlan, InspectionType, PlanItemStatus } from '@/types'
import type { OverdueItem } from '@/app/(dashboard)/inspection-plans/page'
import {
  createInspectionPlanAction,
  startInspectionAction, updatePlanItemAction,
  confirmPlanItemStageOneAction,
} from '@/app/(dashboard)/inspection-plans/actions'
import { PlanItemSlidePanel } from './plan-item-slide-panel'
import { TableScroll } from '@/components/ui/table-scroll'
import { AddPlanItemModal } from './add-plan-item-modal'
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

const PLAN_TYPE_STYLE: Record<string, string> = {
  special_종합: 'bg-purple-100 text-purple-700',
  special_작동: 'bg-blue-100 text-blue-700',
  monthly:      'bg-gray-100 text-gray-500',
  event:        'bg-orange-50 text-orange-600',
}
const PLAN_TYPE_LABEL: Record<string, string> = {
  special_종합: '종합특별',
  special_작동: '작동특별',
  monthly:      '정기',
  event:        '일반관리',
}

type Employee = { id: string; name: string; position: string | null }
type PlanType = 'special_종합' | 'special_작동' | 'monthly' | 'event' | null
type ItemView = Record<string, unknown> & {
  id: string
  customer_id: string
  inspection_type: InspectionType
  inspection_category: string | null
  inspection_sub_type: string | null
  plan_type: PlanType
  sequence_num: 1 | 2
  scheduled_date: string | null
  planned_date: string | null
  status: PlanItemStatus
  notes: string | null
  inspection_id: string | null
  customers: { customer_name: string; customer_code: string; is_active?: boolean } | null
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
  /** 공휴일 이름 표시용 (관리자>공휴일 관리) */
  holidayInfos?: Array<{ date: string; name: string }>
  canManage: boolean
  isEmployee?: boolean
  /** 월 이동 시 보기 모드 유지 — URL ?view= 에서 복원 (key 리마운트 대응) */
  initialViewMode?: 'calendar' | 'list'
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
  holidayInfos = [],
  canManage,
  isEmployee = false,
  initialViewMode = 'list',
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const holidayMap = new Map(holidayInfos.map(h => [h.date, h.name]))

  const [viewYear,  setViewYear]  = useState(initialYear)
  const [viewMonth, setViewMonth] = useState(initialMonth)
  const [viewMode,  setViewMode]  = useState<'calendar' | 'list'>(initialViewMode)

  const [items, setItems]     = useState<ItemView[]>(initialItems as ItemView[])
  const [plans, setPlans]     = useState<InspectionPlan[]>(initialPlans)

  // 서버 재렌더링(router.push) 후 props가 바뀌면 로컬 state에 동기화
  useEffect(() => { setItems(initialItems as ItemView[]) }, [initialItems])
  useEffect(() => { setPlans(initialPlans) }, [initialPlans])
  const [filterEmployee, setFilterEmployee] = useState<string>('all')
  const [filterStatus,   setFilterStatus]   = useState<string>('planned')
  const [filterPlanType, setFilterPlanType] = useState<string>('all')

  const [selectedItem, setSelectedItem]     = useState<ItemView | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedDate, setSelectedDate]     = useState<string | null>(null)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [pickerYear, setPickerYear]           = useState(initialYear)
  const monthPickerRef = useRef<HTMLDivElement>(null)

  const currentPlan = plans.find(p => p.year === viewYear && p.month === viewMonth) ?? null

  // 상태 매칭 (ADD-9: '취소' = 항목 취소 + 고객 비활성/삭제 포함)
  function matchStatus(item: ItemView, status: string) {
    const isCancelledLike = item.status === 'cancelled' || item.customers?.is_active === false
    if (status === 'all') return true
    if (status === 'cancelled') return isCancelledLike
    return item.status === status && item.customers?.is_active !== false
  }

  // 담당자 + 점검유형까지만 적용한 기준 집합 (상태별 현황 카운트는 이 위에서 계산)
  const baseItems = items.filter(item => {
    if (filterEmployee !== 'all' && item.assigned_employee_id !== filterEmployee) return false
    if (filterPlanType !== 'all' && (item.plan_type ?? 'monthly') !== filterPlanType) return false
    return true
  })

  const statusCounts: Record<string, number> = {
    all:       baseItems.length,
    planned:   baseItems.filter(i => matchStatus(i, 'planned')).length,
    confirmed: baseItems.filter(i => matchStatus(i, 'confirmed')).length,
    completed: baseItems.filter(i => matchStatus(i, 'completed')).length,
    cancelled: baseItems.filter(i => matchStatus(i, 'cancelled')).length,
  }

  // 목록 뷰 최종 필터 (상태까지 적용)
  const filteredItems = baseItems.filter(item => matchStatus(item, filterStatus))

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
    // view 파라미터 유지 — 월 변경 시 key 리마운트로 상태가 초기화되므로 URL로 복원
    router.push(`/inspection-plans?year=${y}&month=${m}&view=${viewMode}`)
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
    startTransition(() => router.push(`/inspection-plans?year=${viewYear}&month=${viewMonth}&view=${viewMode}`))
  }, [router, viewYear, viewMonth, viewMode])

  useEffect(() => {
    if (!showMonthPicker) return
    function onDown(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node))
        setShowMonthPicker(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showMonthPicker])

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* 왼쪽: 제목 + 월 네비 + 상태 */}
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-[#090c1d]">월간 점검계획 확정</h1>

          {/* 월 네비게이션 */}
          <div className="relative flex items-center gap-0.5 bg-white border border-[#c8c4d0] rounded-lg px-1 py-1 shadow-sm" ref={monthPickerRef}>
            <button
              onClick={() => navigateMonth(-1)}
              className="p-1 hover:bg-[#f5f4ff] rounded transition-colors"
              title="이전 달"
            >
              <ChevronLeft className="size-4 text-[#514b81]" />
            </button>
            <button
              onClick={() => { setPickerYear(viewYear); setShowMonthPicker(o => !o) }}
              className="text-sm font-semibold text-[#090c1d] min-w-[88px] text-center px-1 py-0.5 rounded hover:bg-[#f5f4ff] transition-colors"
              title="연/월 바로가기"
            >
              {viewYear}년 {viewMonth}월
            </button>
            <button
              onClick={() => navigateMonth(1)}
              className="p-1 hover:bg-[#f5f4ff] rounded transition-colors"
              title="다음 달"
            >
              <ChevronRight className="size-4 text-[#514b81]" />
            </button>

            {/* 연/월 빠른 선택 팝업 */}
            {showMonthPicker && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[#d0ccf5] rounded-xl shadow-xl p-3 w-56">
                {/* 연도 선택 */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setPickerYear(y => y - 1)}
                    className="p-1 hover:bg-[#f5f4ff] rounded transition-colors"
                  >
                    <ChevronLeft className="size-3.5 text-[#514b81]" />
                  </button>
                  <span className="text-sm font-semibold text-[#090c1d]">{pickerYear}년</span>
                  <button
                    onClick={() => setPickerYear(y => y + 1)}
                    className="p-1 hover:bg-[#f5f4ff] rounded transition-colors"
                  >
                    <ChevronRight className="size-3.5 text-[#514b81]" />
                  </button>
                </div>
                {/* 월 그리드 */}
                <div className="grid grid-cols-4 gap-1">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                    const isActive = m === viewMonth && pickerYear === viewYear
                    return (
                      <button
                        key={m}
                        onClick={() => {
                          setShowMonthPicker(false)
                          router.push(`/inspection-plans?year=${pickerYear}&month=${m}&view=${viewMode}`)
                        }}
                        className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          isActive
                            ? 'bg-[#7b68ee] text-white'
                            : 'hover:bg-[#f5f4ff] text-[#090c1d]'
                        }`}
                      >
                        {m}월
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* 오른쪽: 뷰 모드 토글 */}
        <div className="flex items-center bg-[#f5f4ff] rounded-lg p-0.5">
          {(['calendar', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => {
                setViewMode(mode)
                // 새로고침·월이동 후에도 유지되도록 URL에 기록 (서버 왕복 없이)
                const sp = new URLSearchParams(window.location.search)
                sp.set('view', mode)
                window.history.replaceState(null, '', `?${sp.toString()}`)
              }}
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

      {/* 현황 요약 + 필터 카드 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
        {/* 상태별 현황 칩 — 클릭 = 상태 필터 */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-[#eeecfa] flex-wrap">
          <span className="text-xs font-semibold text-[#8b87b8] mr-1.5">현황</span>
          {([['all','전체'],['planned','계획 중'],['confirmed','확정'],['completed','완료'],['cancelled','취소']] as [string, string][]).map(([val, label]) => {
            const active = filterStatus === val
            return (
              <button
                key={val}
                onClick={() => setFilterStatus(val)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active ? 'bg-[#7b68ee] text-white' : 'text-[#514b81] hover:bg-[#f5f4ff] hover:text-[#7b68ee]'
                }`}
              >
                {label}
                <span className={`text-[11px] font-bold px-1.5 py-px rounded-full min-w-[20px] text-center ${
                  active ? 'bg-white/25 text-white' : 'bg-[#f0eefc] text-[#7b68ee]'
                }`}>{statusCounts[val]}</span>
              </button>
            )
          })}
        </div>

        {/* 담당자 + 점검유형 필터 */}
        <div className="flex items-center gap-2 px-4 py-2 flex-wrap">
          {/* 담당자 필터 — B안: 전 직원 표시 */}
          <select
            value={filterEmployee}
            onChange={e => setFilterEmployee(e.target.value)}
            className="text-xs border border-[#c8c4d0] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#7b68ee] text-[#514b81]"
          >
            <option value="all">담당자 전체</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <div className="w-px h-5 bg-[#e0ddf5]" />

          {/* 점검유형 필터 */}
          <span className="text-xs font-semibold text-[#8b87b8]">유형</span>
          <div className="flex items-center gap-1 flex-wrap">
            {([['all','전체'],['special_종합','종합특별'],['special_작동','작동특별'],['monthly','정기'],['event','일반관리']] as [string, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilterPlanType(val)}
                className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors font-medium border ${
                  filterPlanType === val
                    ? val === 'special_종합' ? 'bg-purple-100 text-purple-700 border-purple-200'
                      : val === 'special_작동' ? 'bg-blue-100 text-blue-700 border-blue-200'
                      : val === 'monthly' ? 'bg-gray-100 text-gray-600 border-gray-200'
                      : val === 'event' ? 'bg-orange-50 text-orange-600 border-orange-200'
                      : 'bg-[#7b68ee] text-white border-[#7b68ee]'
                    : 'text-[#514b81] border-transparent hover:bg-[#f5f4ff] hover:text-[#7b68ee]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
            holidayMap={holidayMap}
            onDateClick={handleDateClick}
            onItemClick={setSelectedItem}
          />
        ) : (
          <ListView
            items={filteredItems}
            customers={customers}
            canManage={canManage}
            isEmployee={isEmployee}
            isPending={isPending}
            onItemClick={setSelectedItem}
            onStart={handleStartItem}
            onRefresh={refresh}
            planYear={viewYear}
            planMonth={viewMonth}
            holidays={holidays}
          />
        )}
      </div>

      {/* 슬라이드 패널 (항목 상세·날짜 수정) */}
      {selectedItem && (
        <PlanItemSlidePanel
          item={selectedItem}
          employees={employees}
          canManage={canManage}
          canAssign={!isEmployee}
          canEditOwnItem={isEmployee}
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

    </div>
  )
}

// ── 달력 뷰 ──────────────────────────────────────────────────
function CalendarView({
  year, month, firstDay, daysInMonth, itemsByDate, todayStr, canManage, customers, holidayMap, onDateClick, onItemClick,
}: {
  year: number; month: number; firstDay: number; daysInMonth: number
  itemsByDate: Record<string, ItemView[]>; todayStr: string; canManage: boolean
  customers: CustomerOption[]
  holidayMap?: Map<string, string>
  onDateClick: (d: string) => void; onItemClick: (item: ItemView) => void
}) {
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // 6주 맞추기
  while (cells.length % 7 !== 0) cells.push(null)

  // 점검달력과 동일한 시각 언어 — 상태별 단색 칩 (한 줄, 흰 글자 / 완료·취소는 연회색+취소선)
  function chipStyle(item: ItemView, itemOverdue: boolean): React.CSSProperties {
    if (item.customers?.is_active === false || item.status === 'cancelled')
      return { backgroundColor: '#e5e7eb', color: '#9ca3af', textDecoration: 'line-through' }
    if (item.status === 'completed')
      return { backgroundColor: '#d1fae5', color: '#065f46', textDecoration: 'line-through' }
    if (itemOverdue)
      return { backgroundColor: '#b91c1c', color: '#fee2e2', fontWeight: 600 }
    if (item.status === 'confirmed')
      return { backgroundColor: '#7b68ee', color: '#ffffff' }
    return { backgroundColor: '#93a5c8', color: '#ffffff' } // planned — 차분한 회청색
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[#c8c4d0] bg-[#f8f9fa]">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`text-center text-xs font-semibold py-2 ${i === 0 ? 'text-red-600' : i === 6 ? 'text-blue-600' : 'text-[#514b81]'}`}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="h-32 border-b border-r border-[#e0ddf5] bg-[#fafafa]" />
          const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const dayItems = itemsByDate[dateStr] ?? []
          const isToday = dateStr === todayStr
          const isPast  = dateStr < todayStr
          const dow = idx % 7
          const holiday = holidayMap?.get(dateStr)

          return (
            <div
              key={idx}
              className={`h-32 border-b border-r border-[#e0ddf5] px-1.5 py-1 cursor-pointer transition-colors ${
                isToday ? 'bg-[#f5f4ff]' : holiday ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-[#fafafa]'
              }`}
              onClick={() => canManage && onDateClick(dateStr)}
              title={holiday ? `${holiday} (공휴일)` : undefined}
            >
              <div className="flex items-center justify-between gap-1 min-w-0 mb-1">
                {holiday
                  ? <span className="text-[10px] text-red-500 truncate leading-tight">{holiday}</span>
                  : <span />}
                <span className={`text-xs shrink-0 ${
                  isToday ? 'bg-[#7b68ee] text-white font-bold rounded-full w-5 h-5 flex items-center justify-center' :
                  holiday || dow === 0 ? 'text-red-600 font-medium' : dow === 6 ? 'text-blue-600 font-medium' : 'text-[#292d34]'
                }`}>{day}</span>
              </div>
              <div className="space-y-[3px] overflow-hidden">
                {dayItems.slice(0, 3).map(item => {
                  const itemOverdue = isPast && item.status !== 'completed' && item.status !== 'cancelled'
                  const custName = (item.customers as { customer_name: string } | null)?.customer_name ?? '—'
                  return (
                    <div
                      key={item.id}
                      onClick={e => { e.stopPropagation(); onItemClick(item) }}
                      title={`${custName} · ${PLAN_TYPE_LABEL[(item.plan_type ?? 'monthly') as string] ?? ''} · ${STATUS_LABEL[item.status]}${itemOverdue ? ' (지연)' : ''}`}
                      style={chipStyle(item, itemOverdue)}
                      className="text-[11px] leading-[1.2] px-1.5 py-[2px] rounded-[5px] cursor-pointer hover:opacity-85 truncate"
                    >
                      {itemOverdue && '⚠ '}{custName}
                    </div>
                  )
                })}
                {dayItems.length > 3 && (
                  <div className="text-[11px] text-[#7b68ee] pl-1">+{dayItems.length - 3}개 더 보기</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* 범례 — 점검달력과 동일한 톤 */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-[#e0ddf5] text-[10px] text-[#514b81]">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#93a5c8' }} />계획</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#7b68ee]" />확정</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#d1fae5' }} />완료</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#b91c1c' }} />지연</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-300" />취소·비활성</span>
        {canManage && <span className="ml-auto text-[#b0acd6]">빈 날짜 클릭 = 항목 추가</span>}
      </div>
    </div>
  )
}

// ── 인라인 날짜 셀 (미니 달력 팝업) ─────────────────────────
function InlineDateCell({
  itemId, value, canManage, status, onSaved, planYear, planMonth, holidays,
}: {
  itemId: string; value: string | null; canManage: boolean; status: string; onSaved: () => void
  planYear: number; planMonth: number; holidays: string[]
}) {
  const todayStr = new Date().toISOString().split('T')[0]
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 })
  // 팝업에 표시 중인 연/월 — 계획 월 외 날짜(예: 익월 초 점검)도 확정 가능하도록 이동 지원
  const [viewYM, setViewYM] = useState({ year: planYear, month: planMonth })
  const triggerRef = useRef<HTMLDivElement>(null)
  const popupRef   = useRef<HTMLDivElement>(null)

  const isOverdue = !!value && value < todayStr && status !== 'completed' && status !== 'cancelled'
  const holidaySet = new Set(holidays)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (
        popupRef.current  && !popupRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function handleToggle(e: React.MouseEvent) {
    if (!canManage || isPending) return
    e.stopPropagation()
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // 뷰포트 경계 보정: 아래 공간 부족 시 셀 위쪽으로, 좌우도 화면 안으로 클램프
      const POPUP_H = 270
      const POPUP_W = 208
      let top = rect.bottom + 4
      if (top + POPUP_H > window.innerHeight) top = Math.max(8, rect.top - POPUP_H - 4)
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPUP_W - 8)
      setPopupPos({ top, left })
      setViewYM({ year: planYear, month: planMonth })
    }
    setOpen(o => !o)
  }

  function moveViewMonth(delta: number) {
    setViewYM(({ year, month }) => {
      const m = month + delta
      if (m < 1)  return { year: year - 1, month: 12 }
      if (m > 12) return { year: year + 1, month: 1 }
      return { year, month: m }
    })
  }

  function handleSelectDay(day: number) {
    const dateStr = `${viewYM.year}-${String(viewYM.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    startTransition(async () => {
      const res = await confirmPlanItemStageOneAction(itemId, dateStr)
      if (!res.error) { setOpen(false); onSaved() }
    })
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    startTransition(async () => {
      const res = await updatePlanItemAction({ itemId, scheduledDate: null })
      if (!res.error) { setOpen(false); onSaved() }
    })
  }

  const daysInMonth = new Date(viewYM.year, viewYM.month, 0).getDate()
  const firstDay    = new Date(viewYM.year, viewYM.month - 1, 1).getDay()
  const planMonthPrefix = `${viewYM.year}-${String(viewYM.month).padStart(2,'0')}-`
  const selectedDay = value?.startsWith(planMonthPrefix)
    ? parseInt(value.slice(-2), 10) : null

  return (
    <div className="relative" ref={triggerRef}>
      {/* 표시 영역 */}
      <div
        className={`flex items-center gap-1 group ${canManage ? 'cursor-pointer' : ''}`}
        onClick={handleToggle}
      >
        {isOverdue ? (
          <span className="flex items-center gap-1 text-red-500 font-semibold" title="점검 예정일이 지났습니다">
            <AlertCircle className="size-3.5 shrink-0" />
            {value}
          </span>
        ) : value ? (
          <span>{value}</span>
        ) : (
          <span className="text-[#b0acd6] italic text-xs">점검일자확정</span>
        )}
        {canManage && (
          <Pencil className="size-3 text-[#b0acd6] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        )}
      </div>

      {/* 미니 달력 팝업 — fixed 위치로 overflow 클리핑 없음 */}
      {open && (
        <div
          ref={popupRef}
          style={{ position: 'fixed', top: popupPos.top, left: popupPos.left }}
          className="z-[9999] bg-white rounded-xl border border-[#d0ccf5] shadow-xl p-3 w-52"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => moveViewMonth(-1)}
                className="p-0.5 rounded hover:bg-[#f5f4ff] text-[#8b87b8] hover:text-[#7b68ee] transition-colors"
                title="이전 달"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="text-xs font-semibold text-[#090c1d] min-w-[68px] text-center">{viewYM.year}년 {viewYM.month}월</span>
              <button
                onClick={() => moveViewMonth(1)}
                className="p-0.5 rounded hover:bg-[#f5f4ff] text-[#8b87b8] hover:text-[#7b68ee] transition-colors"
                title="다음 달"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
            {value && (
              <button onClick={handleClear} className="text-[10px] text-[#b0acd6] hover:text-red-500 transition-colors">
                지우기
              </button>
            )}
          </div>
          <div className="grid grid-cols-7 mb-1">
            {['일','월','화','수','목','금','토'].map((d, i) => (
              <div key={d} className={`text-center text-[10px] font-medium py-0.5 ${
                i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-[#b0acd6]'
              }`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array(firstDay).fill(null).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const dateStr = `${planMonthPrefix}${String(day).padStart(2,'0')}`
              const dow = (firstDay + day - 1) % 7
              const isHoliday = holidaySet.has(dateStr)
              const isSel   = selectedDay === day
              const isToday = dateStr === todayStr
              return (
                <button
                  key={day}
                  onClick={() => handleSelectDay(day)}
                  disabled={isPending}
                  className={`h-6 w-6 mx-auto text-[11px] rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
                    isSel    ? 'bg-[#7b68ee] text-white font-semibold' :
                    isToday  ? 'ring-1 ring-[#7b68ee] text-[#7b68ee] font-semibold' :
                    isHoliday || dow === 0 ? 'text-red-400 hover:bg-red-50' :
                    dow === 6  ? 'text-blue-400 hover:bg-blue-50' :
                                 'text-[#090c1d] hover:bg-[#f5f4ff]'
                  }`}
                >
                  {day}
                </button>
              )
            })}
          </div>
          {isPending && (
            <div className="flex items-center justify-center gap-1.5 mt-2">
              <div className="animate-spin rounded-full h-3 w-3 border border-[#7b68ee] border-t-transparent" />
              <span className="text-[10px] text-[#514b81]">저장 중…</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 목록 뷰 ──────────────────────────────────────────────────
function ListView({
  items, customers, canManage, isEmployee, isPending, onItemClick, onStart, onRefresh, planYear, planMonth, holidays,
}: {
  items: ItemView[]; customers: CustomerOption[]; canManage: boolean; isEmployee: boolean; isPending: boolean
  onItemClick: (item: ItemView) => void; onStart: (item: ItemView) => void
  onRefresh: () => void; planYear: number; planMonth: number; holidays: string[]
}) {
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set())
  const [bulkPending, startBulkTransition]  = useTransition()
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]))
  const todayStr = new Date().toISOString().split('T')[0]

  // 확정 가능한 '계획 중' 항목만 선택 대상 — 완료/확정/취소 선택 시 막다른 길 방지
  const selectableItems     = items.filter(i => i.status === 'planned')
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
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-12 text-center">
        <Calendar className="size-8 text-[#b0acd6] mx-auto mb-3" />
        <p className="text-sm text-[#514b81]">이 달의 점검 계획이 없습니다.</p>
      </div>
    )
  }

  return (
    <>
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
      <TableScroll offset={360}>
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
        <thead className="sticky top-0 z-10 bg-[#fafafa] shadow-[0_1px_0_0_#e0ddf5]">
          <tr className="border-b border-[#e0ddf5] bg-[#fafafa]">
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
            <th className="text-left text-xs font-medium text-[#514b81] px-3 py-3">점검일자 확정</th>
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
            const isSelectable = item.status === 'planned'
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
                    canManage={canManage || isEmployee}
                    onSaved={onRefresh}
                    planYear={planYear}
                    planMonth={planMonth}
                    holidays={holidays}
                  />
                </td>
                <td className={`px-3 py-2.5 font-medium truncate ${item.customers?.is_active === false ? 'text-gray-400 line-through' : 'text-[#090c1d]'}`}>
                  {(item.customers as { customer_name: string } | null)?.customer_name ?? '—'}
                  {item.customers?.is_active === false && (
                    <span className="ml-1.5 text-[9px] font-medium px-1 py-0.5 rounded bg-gray-100 text-gray-500 inline-block align-middle">비활성/삭제</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[#514b81] whitespace-nowrap">
                  {approvalLabel ?? <span className="text-[#b0acd6]">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    PLAN_TYPE_STYLE[item.plan_type ?? 'monthly']
                  }`}>{PLAN_TYPE_LABEL[item.plan_type ?? 'monthly'] ?? item.inspection_type}</span>
                </td>
                <td className="px-3 py-2.5 text-[#514b81] text-center">
                  {item.plan_type === 'monthly' || item.plan_type === 'event'
                    ? <span className="text-xs text-gray-400">정기</span>
                    : `${item.sequence_num}차`}
                </td>
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
      </TableScroll>
    </div>

    {/* 하단 고정 확정 바 — 선택 시 화면 하단에 고정 노출 */}
    {someSelected && canManage && (
      <>
        <div className="h-20" />
        <div className="fixed bottom-0 left-56 right-0 z-30 border-t border-[#c8c4d0] bg-white/95 backdrop-blur shadow-[0_-4px_12px_rgba(18,43,165,0.08)]">
          <div className="flex items-center justify-between px-6 py-3">
            <span className="text-sm text-[#514b81]">
              <span className="font-semibold text-[#7b68ee]">{selectedIds.size}건</span> 선택됨
              {confirmableSelected.length > 0 && (
                <span className="text-xs text-[#b0acd6] ml-2">확정 가능 {confirmableSelected.length}건</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-[#514b81] hover:text-[#7b68ee] transition-colors px-3 py-1.5"
              >
                선택 해제
              </button>
              <button
                onClick={handleBulkConfirm}
                disabled={bulkPending || confirmableSelected.length === 0}
                className="flex items-center gap-1.5 text-sm px-4 py-2 bg-[#7b68ee] text-white rounded-lg font-medium hover:bg-[#6a5acd] transition-colors disabled:opacity-50"
              >
                <Check className="size-3.5" />
                {bulkPending ? '처리 중…' : `${confirmableSelected.length}건 확정`}
              </button>
            </div>
          </div>
        </div>
      </>
    )}
    </>
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
                        item.inspection_type === '작동' ? 'bg-blue-50 text-blue-600' :
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
