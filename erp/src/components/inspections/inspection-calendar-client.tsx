'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, dateFnsLocalizer, Views, type View, type ToolbarProps } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ko } from 'date-fns/locale/ko'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import Link from 'next/link'
import {
  CalendarDays, Check, X, AlertTriangle, Loader2,
  Users, Building2, ChevronRight, ChevronLeft,
} from 'lucide-react'
import { completeStepAction } from '@/app/(dashboard)/inspections/actions'
import type { InspectionType, InspectionStatus, UserRole } from '@/types'
import { inspectionTypeLabel } from '@/types'

// ─── Types ───────────────────────────────────────────────────────────────────
export type CalendarStep = {
  id: string
  step_num: number
  name_ko: string
  due_date: string | null
  status: 'pending' | 'completed' | 'overdue'
  completed_at: string | null
}

export type CalendarInspection = {
  id: string
  customer_id: string
  customer_name: string
  customer_code: string
  customer_inactive?: boolean
  inspection_type: InspectionType
  year: number
  sequence_num: 1 | 2
  inspection_start_date: string
  status: InspectionStatus
  assigned_employee_id: string
  assigned_employee_name: string
  steps: CalendarStep[]
}

/** 정기(monthly)·일반관리(event) 계획 항목 — 6단계 없이 예정일 1건짜리 일정 */
export type CalendarPlanItem = {
  id: string
  customer_id: string
  customer_name: string
  customer_code: string
  plan_type: 'monthly' | 'event'
  scheduled_date: string
  status: 'planned' | 'confirmed' | 'completed'
  assigned_employee_id: string | null
  assigned_employee_name: string
}

type CalEventResource = {
  /** 'step'(자체점검 6단계, 기본) | 'plan'(정기·일반관리 계획) */
  kind?: 'step' | 'plan'
  planType?: 'monthly' | 'event'
  planStatus?: 'planned' | 'confirmed' | 'completed'
  inspectionId: string
  stepId: string
  stepNum: number
  stepStatus: string
  dueDate: string
  completedAt: string | null
  customerName: string
  inspectionType: InspectionType
  year: number
  sequenceNum: number
  assignedEmployeeId: string
  assignedEmployeeName: string
  isOverdue: boolean
  isReceiveStep: boolean
  color: string
  customerInactive?: boolean
}

type CalEvent = {
  id: string
  title: string
  start: Date
  end: Date
  allDay: true
  resource: CalEventResource
}

// ─── Constants ───────────────────────────────────────────────────────────────
const COLORS = [
  '#7b68ee', '#0091ff', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
  '#6647f0', '#14b8a6',
]

const TYPE_COLORS: Record<InspectionType, string> = {
  '종합':   'bg-[#f5f4ff] text-[#7b68ee]',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

const STEP_STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:   { label: '대기',     cls: 'bg-gray-100 text-gray-500' },
  completed: { label: '완료',     cls: 'bg-green-50 text-green-700' },
  overdue:   { label: '기한초과', cls: 'bg-red-100 text-red-700 font-semibold' },
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }), // 일요일 시작 (일·월·화…)
  getDay,
  locales: { ko },
})

function getColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash |= 0
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

function dayDiff(dueDate: string, today: string): number {
  return Math.ceil(
    (new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000
  )
}

function getDDayLabel(diff: number): string {
  if (diff > 0) return `D-${diff}`
  if (diff === 0) return 'D-Day'
  return `D+${Math.abs(diff)}`
}

// urgency 기반 배경색 (react-big-calendar inline style용)
function urgencyColor(diff: number, isCompleted: boolean): { bg: string; text: string } {
  if (isCompleted) return { bg: '#d1fae5', text: '#065f46' }   // 완료 — 연초록
  if (diff < 0)    return { bg: '#b91c1c', text: '#fee2e2' }   // 지연 — 진빨강
  if (diff === 0)  return { bg: '#ef4444', text: '#ffffff' }   // D-Day — 빨강
  if (diff <= 2)   return { bg: '#f97316', text: '#ffffff' }   // D-1~2 — 주황
  if (diff <= 6)   return { bg: '#eab308', text: '#ffffff' }   // D-3~6 — 노랑
  return { bg: '#22c55e', text: '#ffffff' }                    // D-7+ — 초록
}

// ─── Props ───────────────────────────────────────────────────────────────────
type QuickFilter = 'all' | 'today' | 'week' | 'overdue'

interface Props {
  inspections: CalendarInspection[]
  /** 정기·일반관리 계획 항목 (전체/정기점검 모드에서 표시) */
  planItems?: CalendarPlanItem[]
  employees: Array<{ id: string; name: string; position: string | null }>
  currentUserId: string
  currentUserRole: UserRole
  initialFilter?: QuickFilter
  /** 주말·공휴일 표시용 (YYYY-MM-DD + 이름) */
  holidays?: Array<{ date: string; name: string }>
}

// ─── Component ───────────────────────────────────────────────────────────────
export function InspectionCalendarClient({ inspections, planItems = [], employees, currentUserId, currentUserRole, initialFilter = 'all', holidays = [] }: Props) {
  const router = useRouter()

  // 공휴일 맵 + 날짜 클릭 안내 상태
  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])
  const [holidayInfo, setHolidayInfo] = useState<{ date: string; name: string } | null>(null)

  // 달력 모드: 전체 | 종합(6단계) | 작동(6단계) | 정기(monthly) | 일반(event)
  const [calMode, setCalMode] = useState<'all' | 'comp' | 'oper' | 'regular' | 'event'>('all')
  // 정기 칩 클릭 안내 배너
  const [planInfo, setPlanInfo] = useState<CalendarPlanItem | null>(null)

  // Calendar view state
  const [calView, setCalView] = useState<View>(initialFilter === 'overdue' ? Views.AGENDA : Views.MONTH)
  const [calDate, setCalDate] = useState(() => {
    if (initialFilter === 'overdue') {
      const todayStr = new Date().toISOString().split('T')[0]
      let earliest: string | null = null
      for (const insp of inspections) {
        for (const s of insp.steps) {
          if (s.due_date && s.status !== 'completed' && s.due_date < todayStr) {
            if (!earliest || s.due_date < earliest) earliest = s.due_date
          }
        }
      }
      if (earliest) return new Date(earliest + 'T12:00:00')
    }
    return new Date()
  })
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialFilter)

  // Filter state
  const [viewMode, setViewMode] = useState<'employee' | 'customer'>('employee')
  // B안: 일반직원은 본인 담당만 기본 체크 (체크박스로 전체 확장 가능)
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(
    () => currentUserRole === 'employee' ? new Set([currentUserId]) : new Set(employees.map(e => e.id))
  )
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(
    () => new Set([...inspections.map(i => i.customer_id), ...planItems.map(p => p.customer_id)])
  )
  const [typeFilters, setTypeFilters] = useState<Set<string>>(
    () => new Set(['종합', '작동', '일반관리'])
  )
  const [statusFilters, setStatusFilters] = useState<Set<string>>(
    () => new Set(['incomplete', 'completed', 'overdue'])
  )

  // Slide panel state
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null)
  const [completingStepId, setCompletingStepId] = useState<string | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)

  const today = useMemo(() => new Date().toISOString().split('T')[0], [])

  // 사이드바 직원 목록(활성)에 없는 담당(퇴사자 등) 항목은 필터로 숨기지 않고 항상 표시
  const knownEmployeeIds = useMemo(() => new Set(employees.map(e => e.id)), [employees])
  const orphanCount = useMemo(() =>
    inspections.filter(i => i.assigned_employee_id && !knownEmployeeIds.has(i.assigned_employee_id)).length
    + planItems.filter(p => p.assigned_employee_id && !knownEmployeeIds.has(p.assigned_employee_id)).length,
  [inspections, planItems, knownEmployeeIds])

  // Unique customers derived from inspection + plan item data
  const uniqueCustomers = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string }>()
    for (const insp of inspections) {
      if (!map.has(insp.customer_id)) {
        map.set(insp.customer_id, { id: insp.customer_id, name: insp.customer_name, code: insp.customer_code })
      }
    }
    for (const p of planItems) {
      if (!map.has(p.customer_id)) {
        map.set(p.customer_id, { id: p.customer_id, name: p.customer_name, code: p.customer_code })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [inspections, planItems])

  const filteredCustomerList = useMemo(() => {
    if (!customerSearch) return uniqueCustomers
    const q = customerSearch.toLowerCase()
    return uniqueCustomers.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
  }, [uniqueCustomers, customerSearch])

  // 퀵필터 적용 범위 계산
  const weekEnd = useMemo(() => {
    const d = new Date(today)
    d.setDate(d.getDate() + 6)
    return d.toISOString().split('T')[0]
  }, [today])

  // Calendar events — 자체점검 6단계 (정기·일반 모드에서는 숨김)
  const events = useMemo<CalEvent[]>(() => {
    if (calMode === 'regular' || calMode === 'event') return []
    return inspections.flatMap(insp => {
      if (viewMode === 'employee' && knownEmployeeIds.has(insp.assigned_employee_id) && !selectedEmployeeIds.has(insp.assigned_employee_id)) return []
      if (viewMode === 'customer' && !selectedCustomerIds.has(insp.customer_id)) return []
      // 종합/작동 탭 = 해당 유형만 — 일반관리 6단계는 전체 탭에서만 표시
      if (calMode === 'comp' && insp.inspection_type !== '종합') return []
      if (calMode === 'oper' && insp.inspection_type !== '작동') return []
      if (!typeFilters.has(insp.inspection_type)) return []

      return insp.steps
        .filter(s => s.due_date !== null)
        .flatMap(s => {
          const isOverdue = s.status !== 'completed' && s.due_date! < today
          const isCompleted = s.status === 'completed'
          const isIncomplete = !isCompleted && !isOverdue
          const diff = dayDiff(s.due_date!, today)

          if (!statusFilters.has('completed') && isCompleted) return []
          if (!statusFilters.has('overdue') && isOverdue) return []
          if (!statusFilters.has('incomplete') && isIncomplete) return []

          // 퀵필터
          if (quickFilter === 'today' && s.due_date !== today) return []
          if (quickFilter === 'overdue' && !isOverdue) return []
          if (quickFilter === 'week' && (s.due_date! < today || s.due_date! > weekEnd)) return []

          const uc = urgencyColor(diff, isCompleted)
          const ddayLabel = isCompleted ? ' ✓' : isOverdue ? ` ⚠${getDDayLabel(diff)}` : ` [${getDDayLabel(diff)}]`
          const typeTag = `[${inspectionTypeLabel(insp.inspection_type)}] `
          const eventDate = new Date(s.due_date! + 'T12:00:00')
          const endDate = new Date(s.due_date! + 'T12:00:00')

          return [{
            id: `${insp.id}-${s.id}`,
            title: viewMode === 'employee'
              ? `${typeTag}${insp.customer_name} · ${s.name_ko}${ddayLabel}`
              : `${typeTag}${s.name_ko}${ddayLabel} — ${insp.assigned_employee_name}`,
            start: eventDate,
            end: endDate,
            allDay: true as const,
            resource: {
              inspectionId: insp.id,
              stepId: s.id,
              stepNum: s.step_num,
              stepStatus: s.status,
              dueDate: s.due_date!,
              completedAt: s.completed_at,
              customerName: insp.customer_name,
              inspectionType: insp.inspection_type,
              year: insp.year,
              sequenceNum: insp.sequence_num,
              assignedEmployeeId: insp.assigned_employee_id,
              assignedEmployeeName: insp.assigned_employee_name,
              isOverdue,
              isReceiveStep: false,
              color: uc.bg,
              customerInactive: (insp as { customer_inactive?: boolean }).customer_inactive === true,
            } satisfies CalEventResource,
          }]
        })
    })
  }, [inspections, calMode, viewMode, selectedEmployeeIds, selectedCustomerIds, knownEmployeeIds, typeFilters, statusFilters, today, quickFilter, weekEnd])

  // 정기(monthly)·일반(event) 계획 이벤트 (종합/작동 모드에서는 숨김)
  const planEvents = useMemo<CalEvent[]>(() => {
    if (calMode === 'comp' || calMode === 'oper') return []
    return planItems.flatMap(p => {
      // 모드별 계획 유형 필터 — 정기점검 탭=monthly, 일반관리 탭=event
      if (calMode === 'regular' && p.plan_type !== 'monthly') return []
      if (calMode === 'event' && p.plan_type !== 'event') return []
      // 담당자 미배정·퇴사자 담당 항목은 담당자 필터와 무관하게 표시
      if (viewMode === 'employee' && p.assigned_employee_id && knownEmployeeIds.has(p.assigned_employee_id) && !selectedEmployeeIds.has(p.assigned_employee_id)) return []
      if (viewMode === 'customer' && !selectedCustomerIds.has(p.customer_id)) return []

      const isCompleted = p.status === 'completed'
      const isOverdue = !isCompleted && p.scheduled_date < today
      const isIncomplete = !isCompleted && !isOverdue

      if (!statusFilters.has('completed') && isCompleted) return []
      if (!statusFilters.has('overdue') && isOverdue) return []
      if (!statusFilters.has('incomplete') && isIncomplete) return []

      if (quickFilter === 'today' && p.scheduled_date !== today) return []
      if (quickFilter === 'overdue' && !isOverdue) return []
      if (quickFilter === 'week' && (p.scheduled_date < today || p.scheduled_date > weekEnd)) return []

      const typeLabel = p.plan_type === 'monthly' ? '정기' : '일반'
      const marker = isCompleted ? ' ✓' : isOverdue ? ' ⚠' : ''
      const eventDate = new Date(p.scheduled_date + 'T12:00:00')

      return [{
        id: `plan-${p.id}`,
        title: viewMode === 'employee'
          ? `${p.customer_name} · ${typeLabel}${marker}`
          : `${typeLabel}${marker} — ${p.assigned_employee_name}`,
        start: eventDate,
        end: eventDate,
        allDay: true as const,
        resource: {
          kind: 'plan' as const,
          planType: p.plan_type,
          planStatus: p.status,
          inspectionId: p.id, // plan item id (슬라이드 패널 대신 안내 배너에 사용)
          stepId: p.id,
          stepNum: 0,
          stepStatus: p.status,
          dueDate: p.scheduled_date,
          completedAt: null,
          customerName: p.customer_name,
          inspectionType: '일반관리' as InspectionType,
          year: parseInt(p.scheduled_date.slice(0, 4), 10),
          sequenceNum: 1,
          assignedEmployeeId: p.assigned_employee_id ?? '',
          assignedEmployeeName: p.assigned_employee_name,
          isOverdue,
          isReceiveStep: false,
          color: p.plan_type === 'monthly' ? '#6b7280' : '#0ea5e9',
        } satisfies CalEventResource,
      }]
    })
  }, [planItems, calMode, viewMode, selectedEmployeeIds, selectedCustomerIds, knownEmployeeIds, statusFilters, today, quickFilter, weekEnd])

  const allEvents = useMemo<CalEvent[]>(() => [...events, ...planEvents], [events, planEvents])

  const selectedInspection = useMemo(
    () => selectedInspectionId ? (inspections.find(i => i.id === selectedInspectionId) ?? null) : null,
    [selectedInspectionId, inspections]
  )

  const panelCompletedCount = selectedInspection?.steps.filter(s => s.status === 'completed').length ?? 0
  const panelTotalCount = selectedInspection?.steps.length ?? 0
  const panelProgressPct = panelTotalCount > 0 ? Math.round((panelCompletedCount / panelTotalCount) * 100) : 0

  const handleSelectEvent = useCallback((event: object) => {
    const e = event as CalEvent
    if (e.resource.kind === 'plan') {
      // 정기·일반관리 칩 → 슬라이드 패널 대신 안내 배너 (상세는 점검계획 화면)
      const p = planItems.find(x => x.id === e.resource.inspectionId)
      if (p) setPlanInfo(p)
      return
    }
    setSelectedInspectionId(e.resource.inspectionId)
    setStepError(null)
  }, [planItems])

  async function handleCompleteStep(stepId: string, inspId: string) {
    setCompletingStepId(stepId)
    setStepError(null)
    const result = await completeStepAction(stepId, inspId)
    setCompletingStepId(null)
    if (result.error) {
      setStepError(result.error)
    } else {
      router.refresh()
    }
  }

  function canCompleteInspection(insp: CalendarInspection) {
    return insp.assigned_employee_id === currentUserId ||
      currentUserRole === 'manager' ||
      currentUserRole === 'admin'
  }

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleCustomer(id: string) {
    setSelectedCustomerIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleType(type: string) {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      return next
    })
  }
  function toggleStatus(status: string) {
    setStatusFilters(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status); else next.add(status)
      return next
    })
  }

  // 월 뷰 날짜 헤더 — 토(파랑)/일·공휴일(빨강) + 공휴일명 표시
  // 클릭 충돌 방지: 날짜 숫자 클릭 = 기존 이동(드릴다운) 유지, 공휴일 라벨 클릭 = 안내 배너 (전파 차단)
  const MonthDateHeader = useCallback(({ date, label, onDrillDown }: {
    date: Date; label: string; onDrillDown?: React.MouseEventHandler
  }) => {
    const iso = format(date, 'yyyy-MM-dd')
    const holiday = holidayMap.get(iso)
    const dow = date.getDay()
    const color = holiday || dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : undefined
    return (
      <div className="flex items-center justify-between gap-1 min-w-0">
        {holiday ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); e.preventDefault(); setHolidayInfo({ date: iso, name: holiday }) }}
            title={`${holiday} (공휴일)`}
            className="text-[10px] text-red-500 truncate leading-tight hover:underline cursor-pointer bg-transparent border-0 p-0 text-left"
          >
            {holiday}
          </button>
        ) : <span />}
        <button type="button" onClick={onDrillDown} className="rbc-button-link" style={{ color }}>
          {label}
        </button>
      </div>
    )
  }, [holidayMap])

  // 커스텀 툴바 — 월간 점검계획과 동일한 ‹ 2026년 7월 › 네비게이션
  const CalToolbar = useCallback(({ label, view, onNavigate, onView }: ToolbarProps<CalEvent, object>) => (
    <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
      <button
        onClick={() => onNavigate('TODAY')}
        className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs font-medium text-[#514b81] bg-white hover:bg-[#f5f4ff] hover:text-[#7b68ee] transition-colors"
      >
        오늘
      </button>
      <div className="flex items-center gap-0.5 bg-white border border-[#c8c4d0] rounded-lg px-1 py-1 shadow-sm">
        <button
          onClick={() => onNavigate('PREV')}
          className="p-1 hover:bg-[#f5f4ff] rounded transition-colors"
          title="이전"
        >
          <ChevronLeft className="size-4 text-[#514b81]" />
        </button>
        <span className="text-sm font-semibold text-[#090c1d] min-w-[88px] text-center px-1">{label}</span>
        <button
          onClick={() => onNavigate('NEXT')}
          className="p-1 hover:bg-[#f5f4ff] rounded transition-colors"
          title="다음"
        >
          <ChevronRight className="size-4 text-[#514b81]" />
        </button>
      </div>
      <div className="flex items-center bg-[#f5f4ff] rounded-lg p-0.5">
        {([['month', '월'], ['week', '주'], ['agenda', '목록']] as const).map(([v, l]) => (
          <button
            key={v}
            onClick={() => onView(v as View)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              view === v ? 'bg-white text-[#7b68ee] shadow-sm' : 'text-[#514b81] hover:text-[#7b68ee]'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  ), [])

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <CalendarDays className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">점검 달력</h1>
          <p className="text-sm text-[#514b81] mt-0.5">단계 마감일 기준 점검 업무 현황</p>
        </div>
      </div>

      <div className="flex gap-4 items-start">
        {/* ── 왼쪽 필터 패널 ────────────────────────────────── */}
        <div className="w-[220px] shrink-0 bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden select-none sticky top-4">

          {/* 보기 토글 */}
          <div className="px-4 pt-4 pb-3 border-b border-[#e0ddf5]">
            <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider mb-2">보기</p>
            <div className="space-y-1">
              {(['employee', 'customer'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors text-left ${viewMode === mode ? 'bg-[#f5f4ff] text-[#7b68ee] font-semibold' : 'text-[#514b81] hover:bg-[#f8f9fa]'}`}
                >
                  {mode === 'employee'
                    ? <><Users className="size-3.5 shrink-0" />담당자 뷰</>
                    : <><Building2 className="size-3.5 shrink-0" />고객 뷰</>}
                </button>
              ))}
            </div>
          </div>

          {/* 직원 목록 (담당자 뷰) — B안: 전 직원 표시 (일반직원은 본인만 기본 체크) */}
          {viewMode === 'employee' && (
            <div className="px-4 py-3 border-b border-[#e0ddf5]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider">직원</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSelectedEmployeeIds(new Set(employees.map(e => e.id)))}
                    className="text-[10px] text-[#7b68ee] hover:underline"
                  >전체</button>
                  <span className="text-[#b0acd6]">·</span>
                  <button
                    onClick={() => setSelectedEmployeeIds(new Set())}
                    className="text-[10px] text-[#b0acd6] hover:text-[#514b81]"
                  >해제</button>
                </div>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {employees.map(emp => (
                  <label key={emp.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[#f8f9fa] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedEmployeeIds.has(emp.id)}
                      onChange={() => toggleEmployee(emp.id)}
                      className="sr-only"
                    />
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ backgroundColor: getColor(emp.id) }}
                    />
                    <span className={`text-xs flex-1 truncate ${selectedEmployeeIds.has(emp.id) ? 'text-[#090c1d]' : 'text-[#b0acd6] line-through'}`}>
                      {emp.name}
                    </span>
                    {selectedEmployeeIds.has(emp.id)
                      ? <Check className="size-3 text-[#7b68ee] shrink-0" />
                      : <span className="size-3 shrink-0" />}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 고객 목록 (고객 뷰) */}
          {viewMode === 'customer' && (
            <div className="px-4 py-3 border-b border-[#e0ddf5]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider">고객</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSelectedCustomerIds(new Set(uniqueCustomers.map(c => c.id)))}
                    className="text-[10px] text-[#7b68ee] hover:underline"
                  >전체</button>
                  <span className="text-[#b0acd6]">·</span>
                  <button
                    onClick={() => setSelectedCustomerIds(new Set())}
                    className="text-[10px] text-[#b0acd6] hover:text-[#514b81]"
                  >해제</button>
                </div>
              </div>
              <input
                type="text"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                placeholder="고객 검색..."
                className="w-full h-7 px-2 text-xs border border-[#d0ccf5] rounded-md mb-2 outline-none focus:border-[#7b68ee] transition"
              />
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredCustomerList.map(cust => (
                  <label key={cust.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[#f8f9fa] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCustomerIds.has(cust.id)}
                      onChange={() => toggleCustomer(cust.id)}
                      className="sr-only"
                    />
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ backgroundColor: getColor(cust.id) }}
                    />
                    <span className={`text-xs flex-1 truncate ${selectedCustomerIds.has(cust.id) ? 'text-[#090c1d]' : 'text-[#b0acd6] line-through'}`}>
                      {cust.name}
                    </span>
                    {selectedCustomerIds.has(cust.id)
                      ? <Check className="size-3 text-[#7b68ee] shrink-0" />
                      : <span className="size-3 shrink-0" />}
                  </label>
                ))}
                {filteredCustomerList.length === 0 && (
                  <p className="text-xs text-[#b0acd6] text-center py-2">결과 없음</p>
                )}
              </div>
            </div>
          )}

          {/* 점검유형 필터 — 전체 탭에서만 (종합/작동/정기/일반 탭은 자체가 유형 필터) */}
          {calMode === 'all' && (
          <div className="px-4 py-3 border-b border-[#e0ddf5]">
            <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider mb-2">점검유형</p>
            <div className="space-y-1">
              {(['종합', '작동', '일반관리'] as InspectionType[]).map(type => (
                <label key={type} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[#f8f9fa] cursor-pointer">
                  <input type="checkbox" checked={typeFilters.has(type)} onChange={() => toggleType(type)} className="sr-only" />
                  <span className={`size-3.5 rounded border flex items-center justify-center transition-colors ${typeFilters.has(type) ? 'bg-[#7b68ee] border-[#7b68ee]' : 'border-[#c3bdf5]'}`}>
                    {typeFilters.has(type) && <Check className="size-2.5 text-white" />}
                  </span>
                  <span className="text-xs text-[#090c1d]">{inspectionTypeLabel(type)}</span>
                </label>
              ))}
            </div>
          </div>
          )}

          {/* 상태 필터 */}
          <div className="px-4 py-3">
            <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider mb-2">상태</p>
            <div className="space-y-1">
              {[
                { key: 'incomplete', label: '미완료', color: 'text-[#090c1d]' },
                { key: 'completed',  label: '완료',   color: 'text-green-700' },
                { key: 'overdue',    label: '기한초과', color: 'text-red-600' },
              ].map(({ key, label, color }) => (
                <label key={key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[#f8f9fa] cursor-pointer">
                  <input type="checkbox" checked={statusFilters.has(key)} onChange={() => toggleStatus(key)} className="sr-only" />
                  <span className={`size-3.5 rounded border flex items-center justify-center transition-colors ${statusFilters.has(key) ? 'bg-[#7b68ee] border-[#7b68ee]' : 'border-[#c3bdf5]'}`}>
                    {statusFilters.has(key) && <Check className="size-2.5 text-white" />}
                  </span>
                  <span className={`text-xs ${color}`}>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── 달력 ──────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* 퇴사자 담당 재배정 안내 */}
          {orphanCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="size-4 shrink-0 text-amber-500" />
              <span>퇴사(비활성) 직원 담당 일정이 <strong>{orphanCount}건</strong> 있습니다. 달력에는 계속 표시되며, 담당자 재배정이 필요합니다.</span>
              <Link href="/inspection-plans" className="ml-auto shrink-0 text-xs text-amber-700 font-medium hover:underline flex items-center gap-0.5">
                점검확정에서 재배정 <ChevronRight className="size-3" />
              </Link>
            </div>
          )}

          {/* 달력 모드: 전체 | 종합(6단계) | 작동(6단계) | 정기 | 일반 */}
          <div className="flex items-center gap-1 bg-white border border-[#c8c4d0] rounded-lg p-1 w-fit">
            {([
              { key: 'all',     label: '전체' },
              { key: 'comp',    label: '종합' },
              { key: 'oper',    label: '작동' },
              { key: 'regular', label: '정기' },
              { key: 'event',   label: '일반' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setCalMode(key)}
                className={`h-8 px-4 rounded-md text-sm font-medium transition-colors ${
                  calMode === key ? 'bg-[#7b68ee] text-white' : 'text-[#514b81] hover:bg-[#f5f4ff]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 퀵필터 바 */}
          <div className="flex items-center gap-2">
            {([
              { key: 'all',     label: '전체',      color: 'text-[#7b68ee] bg-[#f5f4ff] border-[#c3bdf5]' },
              { key: 'today',   label: '오늘 마감', color: 'text-red-600 bg-red-50 border-red-200' },
              { key: 'week',    label: '이번 주',   color: 'text-amber-600 bg-amber-50 border-amber-200' },
              { key: 'overdue', label: '지연',      color: 'text-gray-500 bg-gray-100 border-gray-200' },
            ] as const).map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setQuickFilter(key)}
                className={`h-8 px-3 rounded-lg border text-xs font-medium transition-colors ${quickFilter === key ? color : 'border-[#c8c4d0] text-[#514b81] bg-white hover:bg-[#f8f9fa]'}`}
              >
                {label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-[10px] text-[#b0acd6]">
              {(calMode === 'all' || calMode === 'comp' || calMode === 'oper') && (
                <>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />7일+</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-400" />3~6일</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500" />1~2일</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" />D-Day</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-400" />지연</span>
                </>
              )}
              {(calMode === 'all' || calMode === 'regular') && (
                <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-500" />정기</span>
              )}
              {(calMode === 'all' || calMode === 'event') && (
                <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500" />일반</span>
              )}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4">
          {/* 정기·일반관리 칩 클릭 안내 배너 */}
          {planInfo && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-[#292d34]">
              <CalendarDays className="size-4 shrink-0 text-gray-500" />
              <span className="min-w-0 truncate">
                <strong>{planInfo.customer_name}</strong>
                {' — '}{planInfo.plan_type === 'monthly' ? '정기' : '일반'}
                {' · 예정일 '}{planInfo.scheduled_date}
                {' · '}{planInfo.status === 'completed' ? '완료' : planInfo.status === 'confirmed' ? '확정' : '계획'}
                {' · 담당 '}{planInfo.assigned_employee_name}
              </span>
              <Link href="/inspection-plans" className="ml-auto shrink-0 text-xs text-[#7b68ee] hover:underline flex items-center gap-0.5">
                점검계획에서 관리 <ChevronRight className="size-3" />
              </Link>
              <button onClick={() => setPlanInfo(null)} className="shrink-0 text-gray-400 hover:text-gray-600">
                <X className="size-4" />
              </button>
            </div>
          )}
          {/* 공휴일 클릭 안내 배너 */}
          {holidayInfo && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <CalendarDays className="size-4 shrink-0" />
              <span>
                <strong>{format(new Date(holidayInfo.date + 'T00:00:00'), 'M월 d일 (EEE)', { locale: ko })}</strong>
                {' — '}{holidayInfo.name} (공휴일)
              </span>
              <button onClick={() => setHolidayInfo(null)} className="ml-auto text-red-400 hover:text-red-600">
                <X className="size-4" />
              </button>
            </div>
          )}
          <style>{`
            .rbc-calendar { font-family: inherit; }
            .rbc-header { background:#f8f9fa; border-color:#c8c4d0; padding:8px 4px; font-size:12px; font-weight:600; color:#514b81; }
            .rbc-header:nth-child(1) { color:#dc2626; } /* 일 — 일요일 시작 */
            .rbc-header:nth-child(7) { color:#2563eb; } /* 토 */
            .rbc-day-bg { border-color:#c8c4d0; }
            .rbc-month-view,.rbc-time-view,.rbc-agenda-view { border-color:#c8c4d0; }
            .rbc-today { background:#f5f4ff; }
            .rbc-off-range-bg { background:#fafafa; }
            .rbc-event { border-radius:5px !important; padding:1px 5px !important; font-size:11px !important; cursor:pointer; }
            .rbc-event:focus { outline:none; }
            .rbc-show-more { color:#7b68ee; font-size:11px; }
            .rbc-toolbar button { color:#514b81; border-color:#c8c4d0; border-radius:8px; font-size:13px; }
            .rbc-toolbar button:hover { background:#f5f4ff; color:#7b68ee; }
            .rbc-toolbar button.rbc-active { background:#7b68ee; color:white; border-color:#7b68ee; }
            .rbc-toolbar button.rbc-active:hover { background:#6647f0; }
            .rbc-date-cell { padding:4px 6px; font-size:12px; color:#292d34; }
            .rbc-date-cell.rbc-now { font-weight:700; color:#7b68ee; }
            .rbc-agenda-date-cell,.rbc-agenda-time-cell,.rbc-agenda-event-cell { font-size:12px; padding:6px 8px; border-color:#e0ddf5; }
          `}</style>
          <Calendar
            localizer={localizer}
            events={allEvents}
            view={calView}
            onView={v => setCalView(v)}
            date={calDate}
            onNavigate={d => setCalDate(d)}
            onSelectEvent={handleSelectEvent}
            style={{ height: 640 }}
            views={[Views.MONTH, Views.WEEK, Views.AGENDA]}
            components={{ toolbar: CalToolbar, month: { dateHeader: MonthDateHeader } }}
            dayPropGetter={(date: Date) => {
              const iso = format(date, 'yyyy-MM-dd')
              return holidayMap.has(iso) ? { style: { backgroundColor: '#fef2f2' } } : {}
            }}
            messages={{
              month: '월', week: '주', day: '일', agenda: '목록',
              today: '오늘', previous: '‹', next: '›',
              date: '날짜', time: '시간', event: '일정',
              noEventsInRange: '이 기간에 점검 일정이 없습니다.',
              showMore: (total) => `+${total}개 더 보기`,
            }}
            eventPropGetter={(event: object) => {
              const e = event as CalEvent
              const r = e.resource
              // 정기·일반관리 계획 칩 — 단색 (회색/하늘), 완료 시 연회색 취소선
              if (r.kind === 'plan') {
                const done = r.planStatus === 'completed'
                return {
                  style: {
                    backgroundColor: done ? '#e5e7eb' : r.color,
                    color: done ? '#6b7280' : '#ffffff',
                    border: r.isOverdue ? '2px solid #b91c1c' : 'none',
                    textDecoration: done ? 'line-through' : 'none',
                    fontWeight: 'normal',
                  },
                }
              }
              const isDone = r.stepStatus === 'completed'
              const isOverdue = r.isOverdue
              // ADD-11: 비활성/삭제 고객 건은 완료처럼 회색 취소선
              if (r.customerInactive) {
                return {
                  style: {
                    backgroundColor: '#e5e7eb',
                    color: '#9ca3af',
                    border: 'none',
                    opacity: 0.8,
                    textDecoration: 'line-through',
                    fontWeight: 'normal',
                  },
                }
              }
              return {
                style: {
                  backgroundColor: r.color,
                  color: isDone ? '#065f46' : r.color === '#b91c1c' ? '#fee2e2' : '#ffffff',
                  border: isOverdue ? '2px solid #7f1d1d' : 'none',
                  opacity: 1,
                  textDecoration: isDone ? 'line-through' : 'none',
                  fontWeight: isOverdue ? '600' : 'normal',
                },
              }
            }}
            formats={{
              weekdayFormat: d => ['일', '월', '화', '수', '목', '금', '토'][d.getDay()],
              dayFormat: d => format(d, 'M/d (EEE)', { locale: ko }),
              monthHeaderFormat: d => format(d, 'yyyy년 M월', { locale: ko }),
              dayRangeHeaderFormat: ({ start, end }) =>
                `${format(start, 'M월 d일', { locale: ko })} – ${format(end, 'M월 d일', { locale: ko })}`,
              dayHeaderFormat: d => format(d, 'M월 d일(EEE)', { locale: ko }),
              agendaDateFormat: d => format(d, 'M월 d일(EEE)', { locale: ko }),
            }}
          />
          </div>
        </div>
      </div>

      {/* ── 슬라이드 패널 backdrop ────────────────────────────── */}
      {selectedInspectionId && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={() => setSelectedInspectionId(null)}
        />
      )}

      {/* ── 슬라이드 패널 ─────────────────────────────────────── */}
      <div
        className={`fixed top-0 right-0 bottom-0 w-[380px] bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out ${selectedInspectionId ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {selectedInspection && (
          <>
            {/* 패널 헤더 */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-[#c8c4d0] shrink-0">
              <div className="flex-1 min-w-0 pr-3">
                <p className="font-semibold text-[#090c1d] truncate">{selectedInspection.customer_name}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TYPE_COLORS[selectedInspection.inspection_type]}`}>
                    {inspectionTypeLabel(selectedInspection.inspection_type)}
                  </span>
                  <span className="text-xs text-[#514b81]">{selectedInspection.year}년 {selectedInspection.sequence_num}차</span>
                  <ChevronRight className="size-3 text-[#b0acd6]" />
                  <span className="text-xs text-[#514b81]">시작 {selectedInspection.inspection_start_date}</span>
                </div>
                <p className="text-xs text-[#514b81] mt-1">담당: {selectedInspection.assigned_employee_name}</p>
              </div>
              <button
                onClick={() => setSelectedInspectionId(null)}
                className="text-[#b0acd6] hover:text-[#514b81] transition-colors shrink-0"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* 진행률 바 */}
            <div className="px-5 py-3 border-b border-[#e0ddf5] shrink-0">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-[#514b81]">전체 진행률</span>
                <span className="font-medium text-[#7b68ee]">{panelCompletedCount}/{panelTotalCount} 단계 ({panelProgressPct}%)</span>
              </div>
              <div className="w-full h-2 bg-[#e0ddf5] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${panelProgressPct === 100 ? 'bg-green-500' : 'bg-[#7b68ee]'}`}
                  style={{ width: `${panelProgressPct}%` }}
                />
              </div>
            </div>

            {/* 7단계 목록 */}
            <div className="flex-1 overflow-y-auto">
              {selectedInspection.steps.map(step => {
                const isStepOverdue = step.status !== 'completed' && step.due_date !== null && step.due_date < today
                const actualStatus = isStepOverdue ? 'overdue' : step.status
                const cfg = STEP_STATUS_CFG[actualStatus] ?? STEP_STATUS_CFG.pending
                const isDueSoon = step.status !== 'completed' && step.due_date !== null &&
                  step.due_date >= today &&
                  step.due_date <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
                // 현재 진행 단계(미완료 중 가장 낮은 step_num)에만 완료 버튼 표시
                const isCurrentStep = step.status !== 'completed'
                  && selectedInspection.steps.every(s => s.step_num >= step.step_num || s.status === 'completed')
                const canCompleteThis = canCompleteInspection(selectedInspection) && isCurrentStep

                return (
                  <div
                    key={step.id}
                    className={`flex items-start gap-3 px-5 py-3 border-b border-[#f8f9fa] last:border-0 ${isStepOverdue ? 'bg-red-50/40 border-l-4 border-l-red-400' : isDueSoon ? 'bg-amber-50/30 border-l-4 border-l-amber-400' : ''}`}
                  >
                    <div className={`size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${step.status === 'completed' ? 'bg-green-100' : isStepOverdue ? 'bg-red-100' : 'bg-[#f5f4ff]'}`}>
                      {step.status === 'completed'
                        ? <Check className="size-3 text-green-600" />
                        : isStepOverdue
                        ? <AlertTriangle className="size-3 text-red-500" />
                        : <span className="text-[10px] font-bold text-[#7b68ee]">{step.step_num}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-sm ${step.status === 'completed' ? 'text-[#514b81] line-through' : 'text-[#090c1d]'}`}>
                          {step.name_ko}
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
                          {cfg.label}
                        </span>
                        {isDueSoon && (
                          <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">마감임박</span>
                        )}
                      </div>
                      {step.due_date ? (
                        <p className={`text-xs mt-0.5 ${isStepOverdue ? 'text-red-500 font-medium' : 'text-[#514b81]'}`}>
                          마감: {step.due_date}
                        </p>
                      ) : (
                        <p className="text-xs text-[#b0acd6] mt-0.5">마감일 없음</p>
                      )}
                      {step.completed_at && (
                        <p className="text-xs text-green-600 mt-0.5">완료: {step.completed_at.split('T')[0]}</p>
                      )}
                    </div>
                    {canCompleteThis && (
                      <button
                        onClick={() => handleCompleteStep(step.id, selectedInspection.id)}
                        disabled={completingStepId === step.id}
                        className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors ${isStepOverdue ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' : 'bg-[#f5f4ff] text-[#7b68ee] hover:bg-[#ede9ff] border border-[#c3bdf5]'}`}
                      >
                        {completingStepId === step.id
                          ? <Loader2 className="size-3 animate-spin" />
                          : <Check className="size-3" />}
                        완료
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {stepError && (
              <div className="px-5 py-3 bg-red-50 border-t border-red-100 shrink-0">
                <p className="text-xs text-red-500">{stepError}</p>
              </div>
            )}

            {/* 상세 페이지 링크 */}
            <div className="px-5 py-3 border-t border-[#c8c4d0] shrink-0">
              <Link
                href={`/inspections/${selectedInspection.id}`}
                className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1"
              >
                상세 페이지로 이동
                <ChevronRight className="size-3" />
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
