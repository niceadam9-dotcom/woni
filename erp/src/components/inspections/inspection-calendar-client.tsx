'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, dateFnsLocalizer, Views, type View, type ToolbarProps } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import { format, parse, startOfWeek, getDay, addDays } from 'date-fns'
import { ko } from 'date-fns/locale/ko'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import Link from 'next/link'
import {
  CalendarDays, Check, X, AlertTriangle, Loader2,
  Users, Building2, ChevronRight, ChevronLeft,
  SlidersHorizontal, Info, Search, PlayCircle, ExternalLink,
} from 'lucide-react'
import { completeStepAction } from '@/app/(dashboard)/inspections/actions'
import { moveMonthlyPlanItemAction, startInspectionAction } from '@/app/(dashboard)/inspection-plans/actions'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
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
  /** 점검이 시작된 경우 연결된 inspections.id — 데이 패널 '점검 보기' 링크용 */
  inspection_id?: string | null
}

type CalEventResource = {
  /** 'step'(자체점검 6단계) | 'plan'(지연 계획 칩) | 'plan-group'(정기·일반 일별 집계 칩) */
  kind?: 'step' | 'plan' | 'plan-group'
  /** plan-group: 묶인 건수 */
  groupCount?: number
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

// 정기 칩 드래그 이동용 DnD 달력 (react-big-calendar 내장 애드온 — 추가 의존성 없음)
const DnDCalendar = withDragAndDrop(Calendar)

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

// 2차 색 체계 (2026-07-14): 배경 = 유형(옅은 색), 좌측 4px 바 = 긴급도, 완료 = 흐림
// — 기존 "긴급도 7색 단색 칩"에서 유형·긴급도를 분리해 한 칩에 둘 다 담는다
function urgencyBarColor(diff: number, isCompleted: boolean): string {
  if (isCompleted) return '#d1d5db'   // 완료 — 흐림
  if (diff < 0)    return '#b91c1c'   // 지연 — 진빨강
  if (diff === 0)  return '#ef4444'   // D-Day — 빨강
  if (diff <= 2)   return '#f97316'   // D-1~2 — 주황
  return '#22c55e'                    // 여유(3일+) — 초록
}

/** 유형별 칩 배경·텍스트 (옅은 배경 + 진한 텍스트 — 흰 바탕에 읽히는 칩) */
const TYPE_CHIP: Record<InspectionType, { bg: string; text: string }> = {
  '종합':    { bg: '#f0edff', text: '#5b4bc4' },
  '작동':    { bg: '#e8f2fe', text: '#1d4ed8' },
  '일반관리': { bg: '#e6f6fd', text: '#0369a1' },
}

/** 칩 스타일 단일 소스 — 월 뷰(eventPropGetter)와 주간 카드 뷰가 공유 */
function chipStyle(r: CalEventResource): React.CSSProperties {
  // 일별 집계 칩 (정기 N건·일반 N건) — 지연 포함=빨강, 전건 완료=연회색
  if (r.kind === 'plan-group') {
    const allDone = r.planStatus === 'completed'
    return {
      backgroundColor: r.isOverdue ? '#b91c1c' : allDone ? '#e5e7eb' : r.color,
      color: r.isOverdue ? '#fee2e2' : allDone ? '#6b7280' : '#ffffff',
      border: 'none',
      fontWeight: 600,
    }
  }
  // 지연 계획 칩 — 단색 (회색/하늘) + 빨간 테두리
  if (r.kind === 'plan') {
    const done = r.planStatus === 'completed'
    return {
      backgroundColor: done ? '#e5e7eb' : r.color,
      color: done ? '#6b7280' : '#ffffff',
      border: r.isOverdue ? '2px solid #b91c1c' : 'none',
      textDecoration: done ? 'line-through' : 'none',
      fontWeight: 'normal',
    }
  }
  // ADD-11: 비활성/삭제 고객 건은 완료처럼 회색 취소선
  if (r.customerInactive) {
    return {
      backgroundColor: '#e5e7eb',
      color: '#9ca3af',
      border: 'none',
      opacity: 0.8,
      textDecoration: 'line-through',
      fontWeight: 'normal',
    }
  }
  // 단계 칩 — 배경=유형(옅은 색), 좌측 4px 바=긴급도, 완료=흐림, 지연=연빨강 배경 강조
  const isDone = r.stepStatus === 'completed'
  const typeChip = TYPE_CHIP[r.inspectionType] ?? TYPE_CHIP['일반관리']
  return {
    backgroundColor: isDone ? '#f3f4f6' : r.isOverdue ? '#fef2f2' : typeChip.bg,
    color: isDone ? '#9ca3af' : r.isOverdue ? '#b91c1c' : typeChip.text,
    border: 'none',
    borderLeft: `4px solid ${r.color}`,
    opacity: 1,
    textDecoration: isDone ? 'line-through' : 'none',
    fontWeight: r.isOverdue ? '600' : 'normal',
  }
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
  /** 정기 칩 드래그 이동 권한 (inspection_plan_manage) */
  canMovePlan?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────
export function InspectionCalendarClient({ inspections, planItems = [], employees, currentUserId, currentUserRole, initialFilter = 'all', holidays = [], canMovePlan = false }: Props) {
  const router = useRouter()

  // 공휴일 맵 + 날짜 클릭 안내 상태
  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])
  const [holidayInfo, setHolidayInfo] = useState<{ date: string; name: string } | null>(null)

  // 달력 모드: 전체 | 종합(6단계) | 작동(6단계) | 정기(monthly) | 일반(event)
  const [calMode, setCalMode] = useState<'all' | 'comp' | 'oper' | 'regular' | 'event'>('all')
  // 데이 패널 — 날짜·집계 칩 클릭 시 그날 전체 일정 (기존 "+N개 더 보기" 팝업·안내 배너 대체)
  const [dayPanelDate, setDayPanelDate] = useState<string | null>(null)
  const [daySearch, setDaySearch] = useState('')
  // 툴바 팝오버 (필터·범례) — 사이드바 제거 후 통합
  const [filterOpen, setFilterOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
      if (legendRef.current && !legendRef.current.contains(e.target as Node)) setLegendOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

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
  // 재배정 배너 카운트 — 완료·취소 항목은 이력이므로 재배정 대상에서 제외
  const orphanCount = useMemo(() => {
    const needsReassign = (status: string, employeeId: string | null) =>
      status !== 'completed' && status !== 'cancelled'
      && !!employeeId && !knownEmployeeIds.has(employeeId)
    return inspections.filter(i => needsReassign(i.status, i.assigned_employee_id)).length
      + planItems.filter(p => needsReassign(p.status, p.assigned_employee_id)).length
  }, [inspections, planItems, knownEmployeeIds])

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

          const barColor = urgencyBarColor(diff, isCompleted)
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
              color: barColor,
              customerInactive: (insp as { customer_inactive?: boolean }).customer_inactive === true,
            } satisfies CalEventResource,
          }]
        })
    })
  }, [inspections, calMode, viewMode, selectedEmployeeIds, selectedCustomerIds, knownEmployeeIds, typeFilters, statusFilters, today, quickFilter, weekEnd])

  // 정기(monthly)·일반(event) 계획 항목 — 현재 필터가 적용된 표시 대상 (달력 집계 칩 + 데이 패널 공용)
  const visiblePlanItems = useMemo<CalendarPlanItem[]>(() => {
    if (calMode === 'comp' || calMode === 'oper') return []
    return planItems.filter(p => {
      // 모드별 계획 유형 필터 — 정기점검 탭=monthly, 일반관리 탭=event
      if (calMode === 'regular' && p.plan_type !== 'monthly') return false
      if (calMode === 'event' && p.plan_type !== 'event') return false
      // 담당자 미배정·퇴사자 담당 항목은 담당자 필터와 무관하게 표시
      if (viewMode === 'employee' && p.assigned_employee_id && knownEmployeeIds.has(p.assigned_employee_id) && !selectedEmployeeIds.has(p.assigned_employee_id)) return false
      if (viewMode === 'customer' && !selectedCustomerIds.has(p.customer_id)) return false

      const isCompleted = p.status === 'completed'
      const isOverdue = !isCompleted && p.scheduled_date < today
      const isIncomplete = !isCompleted && !isOverdue

      if (!statusFilters.has('completed') && isCompleted) return false
      if (!statusFilters.has('overdue') && isOverdue) return false
      if (!statusFilters.has('incomplete') && isIncomplete) return false

      if (quickFilter === 'today' && p.scheduled_date !== today) return false
      if (quickFilter === 'overdue' && !isOverdue) return false
      if (quickFilter === 'week' && (p.scheduled_date < today || p.scheduled_date > weekEnd)) return false
      return true
    })
  }, [planItems, calMode, viewMode, selectedEmployeeIds, selectedCustomerIds, knownEmployeeIds, statusFilters, today, quickFilter, weekEnd])

  // 계획 이벤트 — 날짜·유형별 집계 칩 1개 (지연은 ⚠건수로 표시, 지연 있으면 빨간 칩)
  // (하루 100건+ 정기가 "+N개 더 보기"로 숨겨지던 문제 해소 — 상세·이동·시작은 날짜 클릭 데이 패널)
  const planEvents = useMemo<CalEvent[]>(() => {
    const groups = new Map<string, { date: string; planType: 'monthly' | 'event'; count: number; done: number; overdue: number }>()
    for (const p of visiblePlanItems) {
      const isCompleted = p.status === 'completed'
      const isOverdue = !isCompleted && p.scheduled_date < today
      const key = `${p.scheduled_date}|${p.plan_type}`
      const g = groups.get(key) ?? { date: p.scheduled_date, planType: p.plan_type, count: 0, done: 0, overdue: 0 }
      g.count += 1
      if (isCompleted) g.done += 1
      if (isOverdue) g.overdue += 1
      groups.set(key, g)
    }

    return Array.from(groups.values()).map(g => {
      const typeLabel = g.planType === 'monthly' ? '정기' : '일반'
      const eventDate = new Date(g.date + 'T12:00:00')
      const allDone = g.done === g.count
      const suffix = g.overdue > 0 ? ` ⚠${g.overdue}` : allDone ? ' ✓' : g.done > 0 ? ` ✓${g.done}` : ''
      return {
        id: `plangroup-${g.date}-${g.planType}`,
        title: `${typeLabel} ${g.count}건${suffix}`,
        start: eventDate,
        end: eventDate,
        allDay: true as const,
        resource: {
          kind: 'plan-group' as const,
          groupCount: g.count,
          planType: g.planType,
          planStatus: allDone ? 'completed' as const : 'planned' as const,
          inspectionId: '',
          stepId: `group-${g.date}-${g.planType}`,
          stepNum: 0,
          stepStatus: 'group',
          dueDate: g.date,
          completedAt: null,
          customerName: '',
          inspectionType: '일반관리' as InspectionType,
          year: parseInt(g.date.slice(0, 4), 10),
          sequenceNum: 1,
          assignedEmployeeId: '',
          assignedEmployeeName: '',
          isOverdue: g.overdue > 0,
          isReceiveStep: false,
          color: g.planType === 'monthly' ? '#6b7280' : '#0ea5e9',
        } satisfies CalEventResource,
      }
    })
  }, [visiblePlanItems, today])

  const allEvents = useMemo<CalEvent[]>(() => [...events, ...planEvents], [events, planEvents])

  const selectedInspection = useMemo(
    () => selectedInspectionId ? (inspections.find(i => i.id === selectedInspectionId) ?? null) : null,
    [selectedInspectionId, inspections]
  )

  const panelCompletedCount = selectedInspection?.steps.filter(s => s.status === 'completed').length ?? 0
  const panelTotalCount = selectedInspection?.steps.length ?? 0
  const panelProgressPct = panelTotalCount > 0 ? Math.round((panelCompletedCount / panelTotalCount) * 100) : 0

  // ── 정기 칩 드래그 이동 (드롭=즉시 확정, 같은 달 한정, 2026-07-13 확정 설계) ──
  const [moveConfirm, setMoveConfirm] = useState<{ planItemId: string; customerName: string; from: string; to: string } | null>(null)
  const [isMoving, startMoving] = useTransition()

  const draggableAccessor = useCallback((event: object) => {
    const e = event as CalEvent
    return canMovePlan
      && e.resource.kind === 'plan'
      && e.resource.planType === 'monthly'
      && (e.resource.planStatus === 'planned' || e.resource.planStatus === 'confirmed')
  }, [canMovePlan])

  const handleEventDrop = useCallback((args: { event: object; start: Date | string }) => {
    const e = args.event as CalEvent
    const r = e.resource
    if (!draggableAccessor(e)) return
    const from = r.dueDate
    const to = format(new Date(args.start), 'yyyy-MM-dd')
    if (to === from) return
    if (to.slice(0, 7) !== from.slice(0, 7)) { alert('같은 달 안에서만 이동할 수 있습니다.'); return }
    setMoveConfirm({ planItemId: r.inspectionId, customerName: r.customerName, from, to })
  }, [draggableAccessor])

  function handleMoveConfirm() {
    if (!moveConfirm) return
    startMoving(async () => {
      const res = await moveMonthlyPlanItemAction(moveConfirm.planItemId, moveConfirm.to)
      setMoveConfirm(null)
      if (res.error) { alert(res.error); return }
      router.refresh()
    })
  }

  const handleSelectEvent = useCallback((event: object) => {
    const e = event as CalEvent
    if (e.resource.kind === 'plan' || e.resource.kind === 'plan-group') {
      // 계획 칩(개별 지연·일별 집계) → 그날 전체 일정 데이 패널
      setDayPanelDate(e.resource.dueDate)
      setDaySearch('')
      return
    }
    setSelectedInspectionId(e.resource.inspectionId)
    setStepError(null)
  }, [])

  // ── 데이 패널 데이터 — 현재 필터가 그대로 적용된 그날의 단계·계획 일정 ──
  const dayPanelSteps = useMemo(
    () => dayPanelDate ? events.filter(e => e.resource.dueDate === dayPanelDate) : [],
    [events, dayPanelDate]
  )
  const dayPanelPlans = useMemo(() => {
    if (!dayPanelDate) return []
    return visiblePlanItems
      .filter(p => p.scheduled_date === dayPanelDate)
      .sort((a, b) => {
        const aOver = a.status !== 'completed' && a.scheduled_date < today ? 0 : 1
        const bOver = b.status !== 'completed' && b.scheduled_date < today ? 0 : 1
        if (aOver !== bOver) return aOver - bOver
        return a.customer_name.localeCompare(b.customer_name, 'ko')
      })
  }, [visiblePlanItems, dayPanelDate, today])

  // 데이 패널: 날짜 이동 인라인 입력 (정기 항목, 드래그 없는 이동)
  const [movePickId, setMovePickId] = useState<string | null>(null)
  const [movePickVal, setMovePickVal] = useState('')
  function handlePanelMove(p: CalendarPlanItem) {
    if (!isCompleteDate(movePickVal)) { alert('YYYY-MM-DD 형식으로 입력해주세요.'); return }
    if (movePickVal === p.scheduled_date) { setMovePickId(null); return }
    if (movePickVal.slice(0, 7) !== p.scheduled_date.slice(0, 7)) { alert('같은 달 안에서만 이동할 수 있습니다.'); return }
    setMovePickId(null)
    setMoveConfirm({ planItemId: p.id, customerName: p.customer_name, from: p.scheduled_date, to: movePickVal })
  }

  // 툴바 필터 배지 — 기본값에서 벗어난 필터 수
  const activeFilterCount =
    (viewMode === 'customer' ? 1 : 0)
    + (viewMode === 'employee' && selectedEmployeeIds.size < employees.length ? 1 : 0)
    + (viewMode === 'customer' && selectedCustomerIds.size < uniqueCustomers.length ? 1 : 0)
    + (calMode === 'all' && typeFilters.size < 3 ? 1 : 0)
    + (statusFilters.size < 3 ? 1 : 0)

  // 데이 패널: 정기 항목 점검 시작 (점검확정과 동일 액션)
  const [startingPlanId, setStartingPlanId] = useState<string | null>(null)
  async function handleStartFromPanel(p: CalendarPlanItem) {
    if (!confirm(`${p.customer_name} 점검을 시작할까요?${p.assigned_employee_id ? '' : '\n담당자가 미배정이라 본인이 담당으로 배정됩니다.'}`)) return
    setStartingPlanId(p.id)
    const res = await startInspectionAction(p.id)
    setStartingPlanId(null)
    if (res.error) { alert(res.error); return }
    router.push(`/inspections/${res.inspectionId}`)
  }

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
  // 날짜 숫자 클릭 = 그날 전체 일정 데이 패널, 공휴일 라벨 클릭 = 안내 배너 (전파 차단)
  const MonthDateHeader = useCallback(({ date, label }: {
    date: Date; label: string
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
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setDayPanelDate(iso); setDaySearch('') }}
          title="이 날짜의 전체 일정 보기"
          className="rbc-button-link"
          style={{ color }}
        >
          {label}
        </button>
      </div>
    )
  }, [holidayMap])

  // 이번달 요약 스탯 — 현재 필터 기준 표시 달의 단계+계획 건수 (툴바 표시)
  const monthStats = useMemo(() => {
    const key = format(calDate, 'yyyy-MM')
    let total = 0, done = 0, overdue = 0
    for (const e of events) {
      if (!e.resource.dueDate.startsWith(key)) continue
      total++
      if (e.resource.stepStatus === 'completed') done++
      else if (e.resource.isOverdue) overdue++
    }
    for (const p of visiblePlanItems) {
      if (!p.scheduled_date.startsWith(key)) continue
      total++
      if (p.status === 'completed') done++
      else if (p.scheduled_date < today) overdue++
    }
    return { total, done, overdue }
  }, [events, visiblePlanItems, calDate, today])

  // 칩 내용 — 담당자 뷰에서 단계 칩 앞에 담당자 색 도트 (필터 팝오버 직원 색과 동일)
  const EventChip = useCallback(({ event }: { event: object }) => {
    const e = event as CalEvent
    const r = e.resource
    const showDot = viewMode === 'employee' && r.kind !== 'plan-group' && !!r.assignedEmployeeId
    return (
      <span className="flex items-center gap-1 min-w-0">
        {showDot && (
          <span
            className="size-2 rounded-full shrink-0"
            style={{ backgroundColor: getColor(r.assignedEmployeeId) }}
            title={`담당 ${r.assignedEmployeeName}`}
          />
        )}
        <span className="truncate">{e.title}</span>
      </span>
    )
  }, [viewMode])

  // 커스텀 툴바 — 월간 점검계획과 동일한 ‹ 2026년 7월 › 네비게이션 + 이번달 요약 스탯
  // 주간 카드 뷰(rbc 밖 렌더링)와 월/목록(rbc 안)이 같은 툴바를 공유
  const renderCalToolbar = useCallback((label: string, onNavigate: (action: 'TODAY' | 'PREV' | 'NEXT') => void) => (
    <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onNavigate('TODAY')}
          className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs font-medium text-[#514b81] bg-white hover:bg-[#f5f4ff] hover:text-[#7b68ee] transition-colors"
        >
          오늘
        </button>
        {/* 이번달 요약 — 모니터링 안 가도 현황 파악 */}
        <span className="text-[11px] text-[#514b81] hidden sm:flex items-center gap-2">
          이번달 <b className="text-[#090c1d]">{monthStats.total}건</b>
          <span className="text-green-600">완료 {monthStats.done}</span>
          <span className={monthStats.overdue > 0 ? 'text-red-600 font-semibold' : 'text-[#b0acd6]'}>지연 {monthStats.overdue}</span>
        </span>
      </div>
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
            onClick={() => setCalView(v as View)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              calView === v ? 'bg-white text-[#7b68ee] shadow-sm' : 'text-[#514b81] hover:text-[#7b68ee]'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  ), [monthStats, calView])

  const CalToolbar = useCallback(({ label, onNavigate }: ToolbarProps<CalEvent, object>) =>
    renderCalToolbar(label, action => onNavigate(action)), [renderCalToolbar])

  return (
    <div className="space-y-4">
      {/* 페이지 타이틀은 글로벌 바 브레드크럼으로 이동 (2026-07-14 A안) — 본문은 툴바부터 시작 */}
      {/* ── 툴바: 모드 탭 | 퀵필터 | 필터·범례 팝오버 (사이드바 통합 — 달력 중심 1차, 2026-07-14) ── */}
      <div className="flex items-center gap-2 flex-wrap">
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
        <div className="ml-auto flex items-center gap-2">
          {/* 필터 팝오버 — 보기·직원/고객·유형·상태 (구 사이드바) */}
          <div ref={filterRef} className="relative">
            <button
              onClick={() => setFilterOpen(v => !v)}
              className={`h-8 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${filterOpen || activeFilterCount > 0 ? 'border-[#c3bdf5] bg-[#f5f4ff] text-[#7b68ee]' : 'border-[#c8c4d0] bg-white text-[#514b81] hover:bg-[#f8f9fa]'}`}
            >
              <SlidersHorizontal className="size-3.5" />
              필터
              {activeFilterCount > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-[#7b68ee] text-white text-[10px] font-semibold flex items-center justify-center">{activeFilterCount}</span>
              )}
            </button>
            {filterOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl border border-[#d0ccf5] shadow-[0_8px_24px_rgba(18,43,165,0.14)] z-30 overflow-hidden select-none">
            <div className="max-h-[70vh] overflow-y-auto">

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
            </div>
            )}
          </div>
          {/* 범례 팝오버 */}
          <div ref={legendRef} className="relative">
            <button
              onClick={() => setLegendOpen(v => !v)}
              title="색상 범례"
              className="h-8 w-8 rounded-lg border border-[#c8c4d0] bg-white text-[#514b81] hover:bg-[#f8f9fa] flex items-center justify-center transition-colors"
            >
              <Info className="size-4" />
            </button>
            {legendOpen && (
              <div className="absolute right-0 top-full mt-1 w-60 bg-white rounded-xl border border-[#d0ccf5] shadow-[0_8px_24px_rgba(18,43,165,0.14)] z-30 p-3 space-y-1.5 text-[11px] text-[#514b81]">
                <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider">칩 배경 = 점검유형</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-4 h-2.5 rounded-sm" style={{ backgroundColor: '#f0edff' }} />종합</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-4 h-2.5 rounded-sm" style={{ backgroundColor: '#e8f2fe' }} />작동</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-4 h-2.5 rounded-sm" style={{ backgroundColor: '#e6f6fd' }} />일반관리</p>
                <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider pt-1.5">좌측 바 = 마감 긴급도</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-green-500" />여유 (3일 이상)</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-orange-500" />1~2일</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-red-500" />D-Day</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-[#b91c1c]" />지연 (연빨강 배경 + ⚠)</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-gray-300" />완료 (흐림 + ✓)</p>
                <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider pt-1.5">계획 일정 (일별 집계)</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-500" />정기 N건</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500" />일반 N건</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#b91c1c]" />⚠N = 지연 포함</p>
                <p className="text-[10px] text-[#b0acd6] pt-1">담당자 뷰에서는 칩 앞 색 도트가 담당 직원(필터의 직원 색과 동일)입니다. 집계 칩·날짜 숫자를 클릭하면 그날 전체 일정이 열립니다.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 달력 ──────────────────────────────────────────── */}
      <div className="space-y-3">
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

          <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4">
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
            /* 빈 주 압축 — 일정 없는 주는 최소 높이로 (:has 미지원 브라우저는 균등 높이 유지) */
            .rbc-month-row:not(:has(.rbc-event)) { flex: 0 0 88px; }
            .rbc-show-more { color:#7b68ee; font-size:11px; }
            .rbc-toolbar button { color:#514b81; border-color:#c8c4d0; border-radius:8px; font-size:13px; }
            .rbc-toolbar button:hover { background:#f5f4ff; color:#7b68ee; }
            .rbc-toolbar button.rbc-active { background:#7b68ee; color:white; border-color:#7b68ee; }
            .rbc-toolbar button.rbc-active:hover { background:#6647f0; }
            .rbc-date-cell { padding:4px 6px; font-size:12px; color:#292d34; }
            .rbc-date-cell.rbc-now { font-weight:700; color:#7b68ee; }
            .rbc-agenda-date-cell,.rbc-agenda-time-cell,.rbc-agenda-event-cell { font-size:12px; padding:6px 8px; border-color:#e0ddf5; }
            .rbc-overlay { border:1px solid #d0ccf5; border-radius:12px; box-shadow:0 8px 24px rgba(18,43,165,0.14); padding:8px; }
            .rbc-overlay-header { border-bottom:1px solid #e0ddf5; font-size:12px; font-weight:600; color:#514b81; padding:4px 6px 8px; margin:-2px -2px 6px; }
            .rbc-overlay .rbc-event { font-size:11px; border-radius:5px; padding:2px 6px; margin-bottom:3px; cursor:pointer; }
          `}</style>
          {calView === 'week' ? (() => {
            // 주간 카드 뷰 — 시간축 대신 요일별 일정 카드 (날짜 단위 점검 업무에 맞춤, 3차 2026-07-14)
            const weekStart = startOfWeek(calDate, { weekStartsOn: 0 })
            const weekLabel = `${format(weekStart, 'M월 d일', { locale: ko })} – ${format(addDays(weekStart, 6), 'M월 d일', { locale: ko })}`
            return (
              <>
                {renderCalToolbar(weekLabel, action => setCalDate(
                  action === 'TODAY' ? new Date() : addDays(calDate, action === 'PREV' ? -7 : 7)
                ))}
                <div className="grid grid-cols-7 gap-2" style={{ minHeight: 'calc(100vh - 280px)' }}>
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = addDays(weekStart, i)
                    const iso = format(d, 'yyyy-MM-dd')
                    const dayEvents = allEvents
                      .filter(ev => ev.resource.dueDate === iso)
                      .sort((a, b) => (a.resource.kind === 'plan-group' ? 1 : 0) - (b.resource.kind === 'plan-group' ? 1 : 0))
                    const holiday = holidayMap.get(iso)
                    const dow = d.getDay()
                    const isToday = iso === today
                    return (
                      <div
                        key={iso}
                        className={`rounded-xl border flex flex-col overflow-hidden ${isToday ? 'border-[#7b68ee] ring-1 ring-[#7b68ee]' : 'border-[#e0ddf5]'} ${holiday ? 'bg-red-50/30' : 'bg-white'}`}
                      >
                        <button
                          onClick={() => { setDayPanelDate(iso); setDaySearch('') }}
                          title="이 날짜의 전체 일정 보기"
                          className="px-2 py-1.5 border-b border-[#f0eefb] text-left hover:bg-[#f8f9fa] transition-colors shrink-0"
                        >
                          <span className={`text-xs font-semibold ${holiday || dow === 0 ? 'text-red-600' : dow === 6 ? 'text-blue-600' : isToday ? 'text-[#7b68ee]' : 'text-[#090c1d]'}`}>
                            {format(d, 'd일 (EEE)', { locale: ko })}
                          </span>
                          {holiday && <span className="block text-[10px] text-red-500 truncate">{holiday}</span>}
                        </button>
                        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                          {dayEvents.length === 0 ? (
                            <p className="text-[10px] text-[#d5d2ea] text-center pt-6">일정 없음</p>
                          ) : dayEvents.map(ev => (
                            <button
                              key={ev.id}
                              onClick={() => handleSelectEvent(ev)}
                              style={chipStyle(ev.resource)}
                              className="w-full text-left rounded-md px-1.5 py-1 text-[11px] leading-tight cursor-pointer"
                            >
                              <EventChip event={ev} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })() : (
          <DnDCalendar
            localizer={localizer}
            events={allEvents}
            view={calView}
            onView={v => setCalView(v)}
            date={calDate}
            onNavigate={d => setCalDate(d)}
            onSelectEvent={handleSelectEvent}
            // 정기(monthly) 칩만 드래그 이동 — 드롭하면 확인 팝업 후 즉시 확정
            draggableAccessor={draggableAccessor}
            resizableAccessor={() => false}
            resizable={false}
            onEventDrop={handleEventDrop}
            popup // "+N개 더 보기" 클릭 시 해당 날짜 전체 일정 오버레이 표시 (day 뷰가 없어 popup 필수)
            style={{ height: 'calc(100vh - 190px)', minHeight: 600 }}
            views={[Views.MONTH, Views.AGENDA]}
            components={{ toolbar: CalToolbar, event: EventChip, month: { dateHeader: MonthDateHeader } }}
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
            eventPropGetter={(event: object) => ({ style: chipStyle((event as CalEvent).resource) })}
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
          )}
          </div>
      </div>

      {/* ── 데이 패널: 날짜·집계 칩 클릭 → 그날 전체 일정 ───────── */}
      {dayPanelDate && (() => {
        const d = new Date(dayPanelDate + 'T12:00:00')
        const holiday = holidayMap.get(dayPanelDate)
        const q = daySearch.trim().toLowerCase()
        const panelSteps = q ? dayPanelSteps.filter(e => e.resource.customerName.toLowerCase().includes(q)) : dayPanelSteps
        const panelPlans = q ? dayPanelPlans.filter(p => p.customer_name.toLowerCase().includes(q)) : dayPanelPlans
        return (
          <>
            <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setDayPanelDate(null)} />
            <div className="fixed top-0 right-0 bottom-0 w-[400px] bg-white shadow-2xl z-50 flex flex-col">
              {/* 헤더 */}
              <div className="px-5 py-4 border-b border-[#e0ddf5] shrink-0">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[#090c1d]">
                    {format(d, 'M월 d일 (EEE)', { locale: ko })}
                    {holiday && <span className="ml-2 text-xs text-red-500 font-medium">{holiday}</span>}
                  </p>
                  <button onClick={() => setDayPanelDate(null)} className="text-[#b0acd6] hover:text-[#514b81] transition-colors">
                    <X className="size-5" />
                  </button>
                </div>
                <p className="text-xs text-[#514b81] mt-0.5">단계 일정 {dayPanelSteps.length}건 · 계획 일정 {dayPanelPlans.length}건</p>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
                  <input
                    value={daySearch}
                    onChange={e => setDaySearch(e.target.value)}
                    placeholder="고객명 검색..."
                    className="w-full h-8 pl-8 pr-2 text-xs border border-[#d0ccf5] rounded-lg outline-none focus:border-[#7b68ee] transition"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {/* 단계 일정 (종합·작동 6단계) */}
                {panelSteps.length > 0 && (
                  <div className="px-5 py-3 border-b border-[#f0eefb]">
                    <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider mb-2">단계 일정 (종합·작동)</p>
                    <div className="space-y-0.5">
                      {panelSteps.map(e => (
                        <button
                          key={e.id}
                          onClick={() => { setDayPanelDate(null); setSelectedInspectionId(e.resource.inspectionId); setStepError(null) }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#f8f9fa] text-left transition-colors"
                        >
                          <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: e.resource.color }} />
                          <span className="text-xs text-[#090c1d] flex-1 min-w-0 truncate">{e.title}</span>
                          <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 계획 일정 (정기·일반) */}
                {panelPlans.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-[10px] font-semibold text-[#b0acd6] uppercase tracking-wider mb-2">계획 일정 (정기·일반)</p>
                    <div className="space-y-0.5">
                      {panelPlans.map(p => {
                        const isCompleted = p.status === 'completed'
                        const isOverdue = !isCompleted && p.scheduled_date < today
                        const canAct = canMovePlan && !isCompleted && !p.inspection_id
                        return (
                          <div key={p.id}>
                            <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${isOverdue ? 'bg-red-50/60' : 'hover:bg-[#f8f9fa]'}`}>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${p.plan_type === 'monthly' ? 'bg-gray-100 text-gray-600' : 'bg-sky-50 text-sky-600'}`}>
                                {p.plan_type === 'monthly' ? '정기' : '일반'}
                              </span>
                              <span className={`text-xs flex-1 min-w-0 truncate ${isCompleted ? 'text-[#b0acd6] line-through' : 'text-[#090c1d]'}`} title={`담당 ${p.assigned_employee_name}`}>
                                {p.customer_name}
                              </span>
                              {isOverdue && <span className="text-[10px] text-red-600 font-semibold shrink-0">지연⚠</span>}
                              {isCompleted && <Check className="size-3.5 text-green-600 shrink-0" />}
                              {p.inspection_id ? (
                                <Link href={`/inspections/${p.inspection_id}`} className="shrink-0 text-[10px] text-green-600 hover:underline flex items-center gap-0.5">
                                  <ExternalLink className="size-3" />점검 보기
                                </Link>
                              ) : canAct ? (
                                <span className="flex items-center gap-0.5 shrink-0">
                                  {p.plan_type === 'monthly' && (
                                    <button
                                      title="날짜 이동 (같은 달, 이동=즉시 확정)"
                                      onClick={() => { setMovePickId(movePickId === p.id ? null : p.id); setMovePickVal(p.scheduled_date) }}
                                      className={`p-1 rounded transition-colors ${movePickId === p.id ? 'bg-[#f5f4ff] text-[#7b68ee]' : 'text-[#b0acd6] hover:bg-[#f5f4ff] hover:text-[#7b68ee]'}`}
                                    >
                                      <CalendarDays className="size-3.5" />
                                    </button>
                                  )}
                                  <button
                                    title="점검 시작"
                                    disabled={startingPlanId === p.id}
                                    onClick={() => handleStartFromPanel(p)}
                                    className="p-1 rounded text-[#b0acd6] hover:bg-[#f5f4ff] hover:text-[#7b68ee] transition-colors disabled:opacity-50"
                                  >
                                    {startingPlanId === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
                                  </button>
                                </span>
                              ) : null}
                            </div>
                            {movePickId === p.id && (
                              <div className="flex items-center gap-1.5 pl-9 pr-2 pb-1.5">
                                <DateInput
                                  value={movePickVal}
                                  onChange={e => setMovePickVal(e.target.value)}
                                  className="w-32 h-7 text-xs border border-[#c8c4d0] rounded-lg px-2"
                                />
                                <button
                                  onClick={() => handlePanelMove(p)}
                                  className="h-7 px-2.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium transition-colors"
                                >
                                  이동
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {panelSteps.length === 0 && panelPlans.length === 0 && (
                  <p className="text-xs text-[#b0acd6] text-center py-10">
                    {q ? '검색 결과가 없습니다.' : '이 날짜에 표시할 일정이 없습니다.'}
                  </p>
                )}
              </div>

              <div className="px-5 py-3 border-t border-[#e0ddf5] shrink-0">
                <Link href="/inspection-plans" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
                  점검확정에서 관리 <ChevronRight className="size-3" />
                </Link>
              </div>
            </div>
          </>
        )
      })()}

      {/* ── 정기 칩 드래그 이동 확인 팝업 ─────────────────────── */}
      {moveConfirm && (() => {
        const toDate = new Date(moveConfirm.to + 'T12:00:00')
        const toDow = toDate.getDay()
        const toHoliday = holidayMap.get(moveConfirm.to)
        const warnings = [
          toHoliday ? `${format(toDate, 'M월 d일', { locale: ko })}은 ${toHoliday}(공휴일)입니다.` : null,
          !toHoliday && (toDow === 0 || toDow === 6) ? '주말 날짜입니다.' : null,
          moveConfirm.to < today ? '오늘 이전 날짜라 이동 시 지연⚠으로 표시됩니다.' : null,
        ].filter(Boolean) as string[]
        return (
          <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4" onClick={() => !isMoving && setMoveConfirm(null)}>
            <div className="bg-white rounded-xl border border-[#d0ccf5] shadow-xl w-full max-w-xs p-4" onClick={e => e.stopPropagation()}>
              <p className="text-sm font-semibold text-[#090c1d] mb-1">정기점검 일자 이동</p>
              <p className="text-xs text-[#514b81]">
                {moveConfirm.customerName} · {moveConfirm.from} → <span className="font-semibold text-[#7b68ee]">{moveConfirm.to}</span>
              </p>
              <p className="text-[11px] text-[#b0acd6] mt-1">이동하면 해당 날짜로 즉시 확정되고 1~6단계 마감일이 재계산됩니다.</p>
              {warnings.map(w => (
                <p key={w} className="text-[11px] text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="size-3 shrink-0" />{w}</p>
              ))}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setMoveConfirm(null)}
                  disabled={isMoving}
                  className="flex-1 h-8 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={handleMoveConfirm}
                  disabled={isMoving}
                  className="flex-1 h-8 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors flex items-center justify-center disabled:opacity-50"
                >
                  {isMoving ? <Loader2 className="size-3.5 animate-spin" /> : '이동 확정'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

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
                  step.due_date <= new Date(new Date(today + 'T00:00:00Z').getTime() + 7 * 86400000).toISOString().split('T')[0]
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
