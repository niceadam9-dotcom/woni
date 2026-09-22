'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
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
  SlidersHorizontal, Info, Search, PlayCircle, ExternalLink, PenLine, MessageSquare, Plus,
} from 'lucide-react'
import { InspectionSmsModal, type SmsModalSource } from '@/components/sms/inspection-sms-modal'
import { completeStepAction, bulkCompleteStepsAction, bulkStartCompletePlanItemsAction } from '@/app/(dashboard)/inspections/actions'
import { moveMonthlyPlanItemAction, previewInspectionDateChangeAction, changeInspectionDateAction } from '@/app/(dashboard)/inspections/plan-date-actions'
import { getCustomerNewFormDataAction } from '@/app/(dashboard)/customers/actions'
import { parseWorkbookNotice, workbookFixHref, type WorkbookNoticePart } from '@/lib/workbook-notice'
import { takePendingDoc, writePendingDoc } from '@/lib/pending-doc-intent'
import { DocNoticeList } from '@/components/ui/doc-notice-list'
import { FirePlanXlsxButton } from '@/components/customers/fire-plan-xlsx-button'
import { parseFirePlanNotice } from '@/lib/fire-plan-notice'
import { tabOfForm } from '@/lib/fire-plan-sections'
import { firePlanNoticeHref } from '@/lib/fire-plan-chip-target'
/* 등록 폼은 877줄 + 우편번호 스크립트를 쓴다 — 달력 초기 번들에 얹지 않고 **열 때** 받는다.
   ssr:false는 폼이 lazy 초기값에서 localStorage를 읽기 때문이다(클라이언트에서만 마운트). */
const CustomerNewClient = dynamic(
  () => import('@/components/customers/customer-new-client').then(m => m.CustomerNewClient),
  { ssr: false, loading: () => <p className="text-xs text-ink-meta p-4">등록 폼을 불러오는 중…</p> },
)
// 여러 건 날짜 이동은 문자 발송 화면이 쓰는 액션을 **그대로 태운다** — 같은 달·미시작·1단계 완료
// 가드가 그 경로에만 있으므로 여기서 복제하면 두 곳이 갈라진다(sms-actions.ts:391-394의 교훈)
import { bulkMovePlanDatesAction } from '@/app/(dashboard)/inspections/sms-actions'
import { stepInputLink } from '@/lib/inspection-step-links'
import { planRowInspectionEntry } from '@/lib/calendar-plan-row'
import { layoutPlanChips } from '@/lib/calendar-chips'
import { canDragCalendarChip } from '@/lib/calendar-drag'
import { hangulMatch } from '@/lib/hangul'
import { kstDate, todayKst } from '@/lib/kst-date'
/** 일수는 **여기서 세지 않는다** — 별지 9호에 인쇄되는 값과 같은 셈법(양끝 포함)이어야 한다.
 *  이 저장소에서 날짜 사본은 세 벌까지 갔고 조용히 어긋났다(lib/inspection-period 머리 주석). */
import { periodSummary } from '@/lib/inspection-period'
import { CustomerFilterSearch } from '@/components/ui/customer-filter-search'
import { AddressMapButton } from '@/components/ui/address-map-button'
import { WorkbookXlsxButton, WORKBOOK_LABEL } from '@/components/inspections/workbook-xlsx-button'
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
  /** 방문 준비 지도용 (S5-7 확산) — 없을 수 있고, 없으면 버튼이 안 그려진다 */
  customer_address?: string | null
  inspection_type: InspectionType
  year: number
  sequence_num: 1 | 2
  inspection_start_date: string
  /** 다일 점검 종료일 — **NULL이면 당일**(마이그레이션 079의 표기). 빈 값을 시작일로 메우지 않는다:
   *  「당일이라 비었다」와 「다일인데 안 적혔다」는 다른 사실이고, 메우면 둘이 구별 불가능해진다. */
  inspection_end_date?: string | null
  /** **저장된** 점검 소요일수(1~5). 기간에서 다시 센 값과 어긋날 수 있어 화면이 둘을 맞대 본다(R3) */
  inspection_days?: number | null
  status: InspectionStatus
  assigned_employee_id: string
  assigned_employee_name: string
  steps: CalendarStep[]
  /** 1.4 소방시설을 **아직 확인하지 않았는가**(활성 건물 중 하나라도 미확인) — 2026-09-21 A.
   *  ① 링크의 목적지를 가른다: 미확인이면 설비 확인부터, 확인됐으면 바로 점검표로.
   *  판정은 `lib/facility-verify-gate` 한 곳 — 서버가 재 보내고 여기서 다시 세지 않는다. */
  facilitiesUnverified?: boolean
  /** 결과보고서(별지 9/10/11호 + 갑지)가 **있는 건인가** — 하단 [보고서 엑셀]이 뜨는 유일한 조건.
   *  판정은 서버의 `isSelfInspection(plan_type)` 한 곳이다. 여기서 다시 세지 않는다.
   *  🚨 badge(`inspection_type`)로 가르면 안 된다 — 1단계짜리 정기 230건이 badge를
   *    「작동」·「종합」으로 달고 있어 그 칩으로도 이 패널이 열린다(2026-09-21 실측). */
  hasResultReport?: boolean
  /** 점검일자를 옮길 수 있는가 — **서버가 의무 축(거르기 전 전 단계)으로** 판정해 실어 보낸다.
   *  🚨 여기서 `steps`로 다시 세면 안 된다: 그건 표시 축이라 불량 0이면 ⑤⑥이 빠져 있어
   *    **숨겨진 단계의 완료를 못 보고 날짜 변경을 통과시킨다**. 판정식은
   *    `lib/inspection-date-change` 한 벌이고 서버 액션도 같은 함수를 쓴다. */
  dateChange?: { allowed: boolean; reason?: string; blockedBy?: number }
  /** 한 바퀴가 **끝났는가**(R7) — 서버가 **의무 축**으로 판정해 실어 보낸다.
   *  🚨 여기서 `steps`로 다시 세면 안 된다(dateChange와 **같은 함정**): 그건 표시 축이라
   *    불량 0이면 ⑤⑥이 빠져 4/4가 되고, **숨겨진 미완을 「종료됨」으로** 그린다.
   *    판정식은 `lib/inspection-closed` 한 벌이다. */
  closed?: { closed: boolean; closedAt?: string | null; remaining?: number }
}

/** 정기(monthly)·일반관리(event) 계획 항목 — 6단계 없이 예정일 1건짜리 일정 */
export type CalendarPlanItem = {
  id: string
  customer_id: string
  customer_name: string
  customer_code: string
  /** 방문 준비 지도용 (S5-7 확산) */
  customer_address?: string | null
  plan_type: PlanType
  /** 일반관리 세부 유형(종합/작동) — 일반(종합)/일반(작동) 라벨용 (2026-08-04) */
  sub_type?: '종합' | '작동' | null
  scheduled_date: string
  status: 'planned' | 'confirmed' | 'completed'
  assigned_employee_id: string | null
  assigned_employee_name: string
  /** 점검이 시작된 경우 연결된 inspections.id — 데이 패널 '점검 보기' 링크용 */
  inspection_id?: string | null
}

/** 일반(event) 계획 라벨 — 일반관리도 종합/작동 구분 병기 (2026-08-04 사용자 확정) */
export function eventPlanLabel(subType?: '종합' | '작동' | null): string {
  return subType ? `일반(${subType})` : '일반'
}

/** 달력이 싣는 계획 유형 — 정기·일반에 더해 **자체점검(special_*)** 까지 (2026-09-14).
 *  종전엔 자체점검 계획이 달력에 아예 안 실려, [종합]·[작동] 탭에서는 점검이 실제로 시작돼
 *  `inspections` 행이 생기기 전까지 그 고객이 어느 날짜에도 나타나지 않았다. */
export type PlanType = 'monthly' | 'event' | 'special_종합' | 'special_작동'

/** 계획 유형 라벨 — 달력 칩·데이 패널·배지가 **한 곳에서** 읽는다.
 *  🚨 종전엔 `plan_type === 'monthly' ? '정기' : eventPlanLabel(sub)` 삼항이 **네 군데**에 흩어져
 *  있었다. 자체점검을 더하는 순간 그 네 곳이 전부 자체점검을 '일반(종합)'이라 답한다 —
 *  사본이 아니라 같은 파일 안의 드리프트라 눈으로는 안 잡힌다. */
export function planTypeLabel(planType: PlanType, subType?: '종합' | '작동' | null): string {
  if (planType === 'monthly') return '정기'
  if (planType === 'special_종합') return '종합'
  if (planType === 'special_작동') return '작동'
  return eventPlanLabel(subType)
}

/** 자체점검 계획인가 — 문자열 비교를 여기저기 흩지 않는다 */
export const isSpecialPlan = (t: PlanType) => t === 'special_종합' || t === 'special_작동'

/** 데이 패널 유형 배지 색 — 라벨과 짝이라 같은 자리에 둔다(한쪽만 늘어나면 색이 거짓말을 한다) */
export function planTypeBadgeClass(planType: PlanType): string {
  if (planType === 'monthly') return 'bg-gray-100 text-gray-600'
  if (isSpecialPlan(planType)) return 'bg-violet-50 text-violet-600'
  return 'bg-sky-50 text-sky-600'
}

/** 데이 패널 정기 이동 버튼 — 클릭하면 네이티브 달력이 바로 열리고 날짜 선택 즉시 이동
 *  (2026-08-05 사용자 확정: 클릭 최소화 — 인라인 입력줄·[이동] 버튼 제거). min·max로 같은 달만 선택 가능 */
function PanelMoveButton({ scheduledDate, moving, onPick, label, disabled = false, title, testId }: {
  scheduledDate: string
  moving: boolean
  onPick: (to: string) => void
  /** 주면 아이콘 대신 [라벨] 버튼 모양 — 일괄 이동 바에서 같은 min·max 클램프를 그대로 쓰기 위한 것 */
  label?: string
  disabled?: boolean
  title?: string
  testId?: string
}) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const ym = scheduledDate.slice(0, 7)
  const lastDay = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()
  return (
    <span className="relative inline-flex">
      <button
        title={title ?? '날짜 이동 — 달력에서 선택 즉시 이동 (같은 달, 이동=즉시 확정)'}
        data-testid={testId}
        disabled={moving || disabled}
        onClick={() => {
          const p = pickerRef.current
          if (!p) return
          p.value = scheduledDate
          if (typeof p.showPicker === 'function') p.showPicker()
          else { p.focus(); p.click() }
        }}
        className={label
          ? 'h-7 px-2.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1'
          : 'p-1 rounded text-ink-faint hover:bg-brand-tint hover:text-brand transition-colors disabled:opacity-50'}
      >
        {moving ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarDays className="size-3.5" />}
        {label}
      </button>
      {/* 달력 팝업 전용 히든 입력 — 선택값만 onPick으로 전달 */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={testId ? `${testId}-input` : undefined}
        min={`${ym}-01`}
        max={`${ym}-${String(lastDay).padStart(2, '0')}`}
        onChange={e => { if (e.target.value) onPick(e.target.value) }}
        className="absolute right-0 bottom-0 h-0 w-0 p-0 border-0 opacity-0 pointer-events-none"
      />
    </span>
  )
}

type CalEventResource = {
  /** 'step'(자체점검 6단계) | 'plan'(지연 계획 칩) | 'plan-group'(정기·일반 일별 집계 칩) */
  kind?: 'step' | 'plan' | 'plan-group'
  /** plan-group: 묶인 건수 */
  groupCount?: number
  planType?: PlanType
  planStatus?: 'planned' | 'confirmed' | 'completed'
  inspectionId: string
  stepId: string
  stepNum: number
  stepStatus: string
  dueDate: string
  completedAt: string | null
  customerName: string
  customerAddress?: string | null
  inspectionType: InspectionType
  year: number
  sequenceNum: number
  assignedEmployeeId: string
  assignedEmployeeName: string
  isOverdue: boolean
  isReceiveStep: boolean
  color: string
  /** R8b — 이 칩을 끌어 **점검일자**를 옮길 수 있는가. 서버가 의무 축으로 판정한 값 그대로다.
   *  1단계 칩에만 싣는다(나머지 단계는 마감일이라 끌 대상이 아니다 — 서버가 다시 깔아 준다). */
  dateChange?: { allowed: boolean; reason?: string; blockedBy?: number }
  /** R8b — 모달이 보여 줄 **현재 점검일자**. 칩이 앉은 `dueDate`와 같아야 정상이지만,
   *  서버가 실제로 바꾸는 값은 이쪽이므로 「지금」 칸엔 이 값을 쓴다(추정하지 않는다). */
  inspectionStartDate?: string
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
  '종합':   'bg-brand-tint text-brand',
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
// 값은 팔레트 var — light는 종전 hex와 동일, 다크는 .dark 재정의를 따라 범례(팔레트 클래스)와 일치한다
function urgencyBarColor(diff: number, isCompleted: boolean): string {
  if (isCompleted) return 'var(--color-gray-300)'      // 완료 — 흐림 (#d1d5db)
  if (diff < 0)    return 'var(--chip-over-solid-bg)'  // 지연 — 진빨강 (#b91c1c)
  if (diff === 0)  return 'var(--color-red-500)'       // D-Day — 빨강 (#ef4444)
  if (diff <= 2)   return 'var(--color-orange-500)'    // D-1~2 — 주황 (#f97316)
  return 'var(--color-green-500)'                      // 여유(3일+) — 초록 (#22c55e)
}

/** 유형별 칩 배경·텍스트.
 *  ⚠ 값을 리터럴 hex로 두지 말 것 — 인라인 style이라 클래스 코드모드가 닿지 않아
 *  다크에서 달력만 밝은 블록으로 남는다(소방계획서_29 S3-1). 실값은 globals.css의
 *  --chip-* 토큰이 라이트/다크 각각 정의한다(라이트=옅은 배경+진한 글자, 다크=역전). */
const TYPE_CHIP: Record<InspectionType, { bg: string; text: string }> = {
  '종합':    { bg: 'var(--chip-compre-bg)', text: 'var(--chip-compre-fg)' },
  '작동':    { bg: 'var(--chip-oper-bg)',   text: 'var(--chip-oper-fg)' },
  '일반관리': { bg: 'var(--chip-gen-bg)',    text: 'var(--chip-gen-fg)' },
}

/** 칩 스타일 단일 소스 — 월 뷰(eventPropGetter)와 주간 카드 뷰가 공유 */
function chipStyle(r: CalEventResource): React.CSSProperties {
  // 일별 집계 칩 (정기 N건·일반 N건) — 지연 포함=빨강, 전건 완료=연회색
  if (r.kind === 'plan-group') {
    const allDone = r.planStatus === 'completed'
    return {
      backgroundColor: r.isOverdue ? 'var(--chip-over-solid-bg)' : allDone ? 'var(--chip-muted-bg)' : r.color,
      color: r.isOverdue ? 'var(--chip-over-solid-fg)' : allDone ? 'var(--chip-muted-fg)' : '#ffffff',
      border: 'none',
      fontWeight: 600,
    }
  }
  // 지연 계획 칩 — 단색 (회색/하늘) + 빨간 테두리
  if (r.kind === 'plan') {
    const done = r.planStatus === 'completed'
    return {
      backgroundColor: done ? 'var(--chip-muted-bg)' : r.color,
      color: done ? 'var(--chip-muted-fg)' : '#ffffff',
      border: r.isOverdue ? '2px solid var(--chip-over-solid-bg)' : 'none',
      textDecoration: done ? 'line-through' : 'none',
      fontWeight: 'normal',
    }
  }
  // ADD-11 폐지(D-8, 2026-08-29): 비활성/삭제 고객 건은 calendar/page.tsx에서 아예 실리지 않으므로
  // '회색 취소선' 분기는 도달 불가 죽은 코드였다 — 제거. 취소선으로 흐리는 게 아니라 조회 자체가 없다.
  // 단계 칩 — 배경=유형(옅은 색), 좌측 4px 바=긴급도, 완료=흐림, 지연=연빨강 배경 강조
  const isDone = r.stepStatus === 'completed'
  const typeChip = TYPE_CHIP[r.inspectionType] ?? TYPE_CHIP['일반관리']
  return {
    backgroundColor: isDone ? 'var(--chip-done-bg)' : r.isOverdue ? 'var(--chip-over-bg)' : typeChip.bg,
    color: isDone ? 'var(--chip-done-fg)' : r.isOverdue ? 'var(--chip-over-fg)' : typeChip.text,
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
  /** 고객명 검색어 복원 — URL ?cust= (새로고침·링크 공유에도 유지) */
  initialCustomerQuery?: string
  /** 단계 사이드 패널 복원 — URL ?insp= (점검표 입력에서 [←]로 돌아오면 그 패널이 다시 열린다) */
  initialInspectionId?: string
  /** 주말·공휴일 표시용 (YYYY-MM-DD + 이름) */
  holidays?: Array<{ date: string; name: string }>
  /** 정기 칩 드래그 이동 권한 (inspection_plan_manage) */
  canMovePlan?: boolean
  /** 사전 안내 문자 발송 권한 (inspection_sms_send) — 소방계획서_24 S9 */
  canSendSms?: boolean
  /** 달력에서 고객 등록 권한 (customer_manage) — 2026-09-22. 버튼 자체를 가린다 */
  canCreateCustomer?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────
export function InspectionCalendarClient({ inspections, planItems = [], employees, currentUserId, currentUserRole, initialFilter = 'all', initialCustomerQuery = '', initialInspectionId = '', holidays = [], canMovePlan = false, canSendSms = false, canCreateCustomer = false }: Props) {
  const router = useRouter()
  // B-3 복귀 경로 재료 — 지금 보고 있는 달까지 포함해 되돌아가려고 쓴다(하이드레이션 안전)
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // 사전 안내 문자 — 날짜만 넘기고 서버가 대상을 계산한다(Q-14). 달력 쪽 상태는 이 하나뿐이다.
  const [smsSource, setSmsSource] = useState<SmsModalSource | null>(null)

  // 공휴일 맵 + 날짜 클릭 안내 상태
  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])
  const [holidayInfo, setHolidayInfo] = useState<{ date: string; name: string } | null>(null)

  // 달력 모드: 전체 | 종합(6단계) | 작동(6단계) | 정기(monthly) | 일반(event)
  const [calMode, setCalMode] = useState<'all' | 'comp' | 'oper' | 'regular' | 'event'>('all')
  // 데이 패널 — 날짜·집계 칩 클릭 시 그날 전체 일정 (기존 "+N개 더 보기" 팝업·안내 배너 대체)
  const [dayPanelDate, setDayPanelDate] = useState<string | null>(null)
  const [daySearch, setDaySearch] = useState('')
  // 같은 날 일괄 완료 (2026-08-04) — 모달·선택 상태. 기본 체크 = 1단계형(정기·일반), 자체점검 단계는 기본 해제
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkChecked, setBulkChecked] = useState<Set<string>>(new Set())
  const [isBulkRunning, startBulk] = useTransition()
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  // 정기 여러 건 날짜 이동 (선택 모드) — 말일에 몰린 28건을 아이콘 28번 눌러 옮기던 것을 한 번에
  const [moveSelectMode, setMoveSelectMode] = useState(false)
  const [moveChecked, setMoveChecked] = useState<Set<string>>(new Set())   // plan_item id
  const [isBulkMoving, startBulkMove] = useTransition()
  const [bulkMoveResult, setBulkMoveResult] = useState<{ ok: boolean; text: string } | null>(null)
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

  // 기한초과 진입 시 가장 오래된 미완료 초과 마감 — 초기 점프·안내 배너 공용
  const earliestOverdue = useMemo(() => {
    if (initialFilter !== 'overdue') return null
    const todayStr = todayKst()
    let earliest: string | null = null
    for (const insp of inspections) {
      for (const s of insp.steps) {
        if (s.due_date && s.status !== 'completed' && s.due_date < todayStr) {
          if (!earliest || s.due_date < earliest) earliest = s.due_date
        }
      }
    }
    return earliest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Calendar view state
  const [calView, setCalView] = useState<View>(initialFilter === 'overdue' ? Views.AGENDA : Views.MONTH)
  const [calDate, setCalDate] = useState(() =>
    earliestOverdue ? new Date(earliestOverdue + 'T12:00:00') : new Date())
  // 과거 달로 점프했을 때만 안내 배너 — "8월인데 왜 7월?" 혼동 방지 (2026-08-04)
  const [overdueJumpNotice, setOverdueJumpNotice] = useState(() =>
    // F-14 잔여 축 — **월** 비교도 같은 결함이다. 상대(earliestOverdue)는 due_date(DATE=달력
    // 날짜)에서 왔으므로 KST 기준 월과 견줘야 한다. 매월 1일 00:00~09:00 KST에만 어긋나
    // 재현이 더 드물 뿐, 축은 같다 — 그래서 todayKst()에서 잘라 쓴다.
    !!earliestOverdue && earliestOverdue.slice(0, 7) !== todayKst().slice(0, 7))
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialFilter)

  // Filter state
  const [viewMode, setViewMode] = useState<'employee' | 'customer'>('employee')
  // B안: 일반직원은 본인 담당만 기본 체크 (체크박스로 전체 확장 가능)
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(
    () => currentUserRole === 'employee' ? new Set([currentUserId]) : new Set(employees.map(e => e.id))
  )
  // 고객명 검색 — 툴바 단일 입력. 종전엔 필터 팝오버 안(고객 뷰 전용)에 있어 **체크박스 목록만**
  // 걸렀다: 검색해 찾아도 체크를 다시 눌러야 달력이 바뀌고, 기본값인 담당자 뷰에서는 아예 무시됐다.
  // 이제 뷰 모드와 무관하게 달력을 직접 거르고, 팝오버 목록은 같은 질의로 함께 좁아진다(입력 하나).
  const [customerSearch, setCustomerSearch] = useState(initialCustomerQuery)
  const custQuery = customerSearch.trim()

  /* 검색어를 URL에 기록 — 새로고침·뒤로가기·링크 공유에도 유지 (점검확정 ?cust= 와 같은 규약)
   *
   * 🚨 첫 인자는 **`window.history.state`다(`null`이 아니다)** — 2026-09-21 실측으로 잡았다.
   *   App Router는 자기 라우팅 정보를 `history.state`에 둔다. `null`로 덮으면 그게 사라져
   *   **브라우저 뒤로가기가 주소만 바꾸고 화면은 그대로** 남는다(달력으로 돌아왔는데 점검표가
   *   계속 보였다 — reload해야 고쳐졌다). 상태를 그대로 실어 주면 주소만 갈리고 라우터는 멀쩡하다.
   *   같은 결함이 이 파일 2곳·점검표 입력·소방계획서 트리·공통 트리·fields에 있었다(전부 수리). */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (!custQuery) sp.delete('cust'); else sp.set('cust', custQuery)
    const qs = sp.toString()
    window.history.replaceState(window.history.state, '', qs ? `?${qs}` : window.location.pathname)
  }, [custQuery])
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(
    () => new Set([...inspections.map(i => i.customer_id), ...planItems.map(p => p.customer_id)])
  )
  const [typeFilters, setTypeFilters] = useState<Set<string>>(
    () => new Set(['종합', '작동', '일반관리'])
  )
  const [statusFilters, setStatusFilters] = useState<Set<string>>(
    () => new Set(['incomplete', 'completed', 'overdue'])
  )

  /* Slide panel state.
   *
   *  초기값을 URL(?insp=)에서 받는다 — 점검표 입력에서 [←]로 돌아왔을 때 **떠나기 직전 그 패널**이
   *  다시 열려 있어야 한다(2026-09-21 사용자 요청). 종전엔 로컬 state뿐이라 돌아오면 달력만 남고
   *  사용자가 날짜 → 단계를 처음부터 다시 짚어 들어가야 했다.
   *  ⚠ 서버가 형식만 검증해 넘긴다 — 실재 여부는 아래 `selectedInspection`이 목록에서 찾는다.
   *    없는 id면 패널이 안 열리고 조용히 달력만 보인다(그게 옳다: 남의 링크·지난 회차일 수 있다). */
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(initialInspectionId || null)
  const [completingStepId, setCompletingStepId] = useState<string | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)

  /* 열린 패널을 URL에 기록 — 위 `?cust=`와 **같은 규약**(서버 왕복 없는 replaceState).
   *
   *  이게 있어야 점검표 입력으로 넘어갈 때 붙이는 복귀 주소(`?from=`)가 «지금 이 패널»을 가리킨다.
   *  🚨 `router.replace`를 쓰지 않는다 — 서버 컴포넌트를 다시 태우면 달력 전체가 재조회되고
   *    (이 페이지는 점검·계획·공휴일을 한꺼번에 읽는다) 패널을 열 때마다 화면이 깜빡인다. */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (selectedInspectionId) sp.set('insp', selectedInspectionId)
    else sp.delete('insp')
    const qs = sp.toString()
    window.history.replaceState(window.history.state, '', qs ? `?${qs}` : window.location.pathname)
  }, [selectedInspectionId])

  const today = useMemo(() => todayKst(), [])

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
    if (!custQuery) return uniqueCustomers
    // 달력 필터와 **같은 규칙**(부분 일치 + 초성) — 목록에 보이는데 달력엔 없는 어긋남을 막는다
    return uniqueCustomers.filter(c => hangulMatch(c.name, custQuery) || hangulMatch(c.code, custQuery))
  }, [uniqueCustomers, custQuery])

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
      // 고객명 검색은 뷰 모드와 무관하게 적용 — 담당자 뷰에서도 "이 고객만 보기"가 통한다
      if (custQuery && !hangulMatch(insp.customer_name, custQuery)) return []
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
              /* R8b — 여태 **비어 있었다**. 타입은 'step'을 선언해 뒀는데 실제로 안 실어서
                 단계 칩의 kind는 undefined였다(그래도 `=== 'plan'`·`=== 'plan-group'` 검사만
                 있어 아무도 안 넘어졌다). 이제 드래그가 **이 축으로 갈리므로** 명시한다. */
              kind: 'step' as const,
              inspectionId: insp.id,
              stepId: s.id,
              stepNum: s.step_num,
              stepStatus: s.status,
              dueDate: s.due_date!,
              completedAt: s.completed_at,
              /* R8b — 1단계 칩만 끌 수 있게 하는 판정. 서버가 의무 축으로 이미 내줬다
                 (`lib/inspection-date-change`). 여기서 `insp.steps`로 다시 세면 표시 축이라
                 숨겨진 ⑤⑥ 완료를 못 보고 **이미 나간 서류의 날짜를 끌 수 있게** 된다. */
              dateChange: insp.dateChange,
              inspectionStartDate: insp.inspection_start_date,
              customerName: insp.customer_name,
              customerAddress: insp.customer_address ?? null,
              inspectionType: insp.inspection_type,
              year: insp.year,
              sequenceNum: insp.sequence_num,
              assignedEmployeeId: insp.assigned_employee_id,
              assignedEmployeeName: insp.assigned_employee_name,
              isOverdue,
              isReceiveStep: false,
              color: barColor,
            } satisfies CalEventResource,
          }]
        })
    })
  }, [inspections, calMode, viewMode, selectedEmployeeIds, selectedCustomerIds, knownEmployeeIds, typeFilters, statusFilters, today, quickFilter, weekEnd, custQuery])

  // 정기(monthly)·일반(event) 계획 항목 — 현재 필터가 적용된 표시 대상 (달력 집계 칩 + 데이 패널 공용)
  const visiblePlanItems = useMemo<CalendarPlanItem[]>(() => {
    return planItems.filter(p => {
      // 모드별 계획 유형 필터 — 정기 탭=monthly, 일반 탭=event, 종합·작동 탭=자체점검 계획.
      // 종전엔 종합·작동 탭에서 계획을 통째로 버렸다(`return []`) — 그래서 자체점검 예정일이
      // 잡혀 있어도 그 탭에서는 아무 날짜에도 안 보였다(2026-09-14 지평리56 신고).
      if (calMode === 'regular' && p.plan_type !== 'monthly') return false
      if (calMode === 'event' && p.plan_type !== 'event') return false
      if (calMode === 'comp' && p.plan_type !== 'special_종합') return false
      if (calMode === 'oper' && p.plan_type !== 'special_작동') return false
      if (custQuery && !hangulMatch(p.customer_name, custQuery)) return false
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
  }, [planItems, calMode, viewMode, selectedEmployeeIds, selectedCustomerIds, knownEmployeeIds, statusFilters, today, quickFilter, weekEnd, custQuery])

  // 계획 이벤트 — 정기(monthly)=날짜별 집계 칩 1개 (하루 100건+ "+N개 더 보기" 방지),
  // 일반(event)=개별 이벤트 (종합/작동처럼 건별 표시·완료 취소선, 라벨 일반(종합)/일반(작동) — 2026-08-04 사용자 확정)
  const planEvents = useMemo<CalEvent[]>(() => {
    /** 계획 1건 = **고객 이름이 보이는** 개별 칩 (kind 'plan': 완료=취소선, 클릭=데이 패널) */
    const asIndividual = (p: CalendarPlanItem): CalEvent => {
      const isCompleted = p.status === 'completed'
      const isOverdue = !isCompleted && p.scheduled_date < today
      const suffix = isCompleted ? ' ✓' : isOverdue ? ' ⚠' : ''
      const eventDate = new Date(p.scheduled_date + 'T12:00:00')
      const label = planTypeLabel(p.plan_type, p.sub_type)
      return {
        id: `planitem-${p.id}`,
        // 담당 미배정은 칩에서 바로 보이게(2026-09-07 미배정 표면화 — 자동 배정 없이 알 수 있게만)
        title: `[${label}${p.assigned_employee_id ? '' : '·미배정'}] ${p.customer_name}${suffix}`,
        start: eventDate,
        end: eventDate,
        allDay: true as const,
        resource: {
          kind: 'plan' as const,
          planType: p.plan_type,
          planStatus: p.status,
          inspectionId: p.inspection_id ?? p.id,
          stepId: `plan-${p.id}`,
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
          color: p.plan_type === 'monthly' ? '#6b7280' : isSpecialPlan(p.plan_type) ? '#7c3aed' : '#0ea5e9',
        } satisfies CalEventResource,
      }
    }

    // 개별 칩 / 날짜별 집계 칩을 가르는 규칙은 **화면 밖 순수 모듈**이 단일 원천이다.
    // (`lib/calendar-chips.ts` — 왜 꺼냈는지·두 결함의 내력이 거기 적혀 있다.)
    //  · 일반(event)·자체점검(special_*) = 언제나 건별
    //  · 정기(monthly) = 날짜별로 모으되 검색 중이거나 상한 이하면 펴서 이름을 보여준다
    const { individuals, groups } = layoutPlanChips(visiblePlanItems, { searching: Boolean(custQuery) })

    const planChips: CalEvent[] = individuals.map(asIndividual)

    planChips.push(...groups.map(g => {
      // 집계는 정기만 도달한다(layoutPlanChips가 monthly만 묶는다) — 타입으로도 못 박는다
      const planType = 'monthly' as const
      const count = g.items.length
      const done = g.items.filter(p => p.status === 'completed').length
      const overdue = g.items.filter(p => p.status !== 'completed' && p.scheduled_date < today).length
      const eventDate = new Date(g.date + 'T12:00:00')
      const allDone = done === count
      const suffix = overdue > 0 ? ` ⚠${overdue}` : allDone ? ' ✓' : done > 0 ? ` ✓${done}` : ''
      return {
        id: `plangroup-${g.date}-${planType}`,
        title: `정기 ${count}건${suffix}`,
        start: eventDate,
        end: eventDate,
        allDay: true as const,
        resource: {
          kind: 'plan-group' as const,
          groupCount: count,
          planType,
          planStatus: allDone ? 'completed' as const : 'planned' as const,
          inspectionId: '',
          stepId: `group-${g.date}-${planType}`,
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
          isOverdue: overdue > 0,
          isReceiveStep: false,
          color: '#6b7280',
        } satisfies CalEventResource,
      }
    }))

    return planChips
  }, [visiblePlanItems, today, custQuery])

  const allEvents = useMemo<CalEvent[]>(() => [...events, ...planEvents], [events, planEvents])

  const selectedInspection = useMemo(
    () => selectedInspectionId ? (inspections.find(i => i.id === selectedInspectionId) ?? null) : null,
    [selectedInspectionId, inspections]
  )

  /** R7 — **종료된 회차 id 집합**. 데이 패널 목록이 회차 패널을 열지 않고도 「끝났다」를 말하게 한다.
   *  날짜를 짚었을 때 그날 걸린 일이 아직 할 일인지 이미 끝난 일인지가 **한눈에** 갈려야 한다.
   *  ⚠ 판정은 서버가 의무 축으로 준 `closed` 하나다 — 여기서 `steps`로 다시 세지 않는다. */
  const closedInspectionIds = useMemo(
    () => new Set(inspections.filter(i => i.closed?.closed).map(i => i.id)),
    [inspections]
  )

  const panelCompletedCount = selectedInspection?.steps.filter(s => s.status === 'completed').length ?? 0
  const panelTotalCount = selectedInspection?.steps.length ?? 0
  const panelProgressPct = panelTotalCount > 0 ? Math.round((panelCompletedCount / panelTotalCount) * 100) : 0

  /* ── R3 — 1단계 점검기간 한 줄 (2026-09-22 사용자 요청) ────────────────────────────
     패널은 여태 「9/14 시작」까지만 말했다. **며칠짜리인지, 언제 끝나는지**가 달력 어디에도
     없어서, 다일 점검을 보던 사용자는 종료일을 확인하러 점검 상세까지 갔다.

     🚨 저장된 일수를 **그냥 찍지 않는다** — `inspection_days`가 실제 기간과 어긋난 행이 실재하고
       (2026-09-21 실측: 다일 3건 중 **3건 전부**) 그 값은 별지 9호에 그대로 인쇄된다.
     ⚠ 셈도 문장도 **여기서 만들지 않는다** — `periodSummary`(lib/inspection-period) 한 벌이다.
       인라인으로 두면 「어긋남을 본다」는 약속을 `false`로 바꿔 놔도 소스 단언이 초록이다
       (변이 M14가 실제로 그렇게 뚫었다). 순수 함수로 밀어 두면 그 약속을 값으로 셀 수 있다. */
  const period = periodSummary(
    selectedInspection?.inspection_start_date,
    selectedInspection?.inspection_end_date,
    selectedInspection?.inspection_days,
  )

  /** B-2 — 패널 하단 링크가 착지할 단계. **기한초과 먼저, 없으면 첫 미완**.
   *  화면이 붉게 칠한 그 줄이 곧 사용자가 누르려던 자리다. 전부 완료면 null(기본 칸으로).
   *  ⚠ `steps`는 서버가 **표시 축으로 이미 걸러** 보낸 목록이다(lib/active-steps) — 불량 0건이면
   *    ⑤⑥이 아예 없다. 여기서 다시 판정하지 않는다. */
  const panelEntryStep = (() => {
    const ss = selectedInspection?.steps ?? []
    const pending = ss.filter(s => s.status !== 'completed')
    if (pending.length === 0) return null
    const overdue = pending.filter(s => s.due_date !== null && s.due_date < today)
    const pick = (overdue.length ? overdue : pending)
      .reduce((a, b) => (a.step_num <= b.step_num ? a : b))
    return pick.step_num
  })()
  /** 달력으로 되돌아올 **복귀 주소** — 패널에서 나가는 링크들이 **여기 한 곳에서** 받는다(B-3).
   *
   *  ⚠ 지금 보고 있는 **달 파라미터까지** 넘긴다: 그냥 `/inspections/calendar`로 보내면
   *    다른 달을 보던 사용자가 이번 달로 튕긴다(돌아왔는데 자리가 다른 부류).
   *  ⚠ `window.location`을 쓰지 않는다 — 서버 렌더와 값이 달라 하이드레이션이 어긋난다.
   *    라우터 훅은 양쪽에서 같은 값을 준다.
   *
   *  🚨 2026-09-21 — `searchParams`**만으로는 모자란다.** `cust`·`insp`는 위 두 effect가
   *    `replaceState`로 쓰는 값이라 **라우터를 거치지 않아** `useSearchParams`에 안 잡힌다.
   *    그래서 여기서 지금 상태로 덮어쓴다.
   *    실측으로 잡힌 결함: 단계 줄의 [입력] 링크는 이 보정을 **자기 자리에서** 했는데
   *    패널 하단 링크에는 빠져 있어, **하단으로 들어간 사용자만** 돌아왔을 때 우측바가 닫혀
   *    있었다(같은 패널의 두 링크가 규약이 갈렸다 · `cust`는 양쪽 다 흘리고 있었다).
   *  ⚠ 그래서 합치는 지점을 **하나로** 둔다 — 두 벌이면 한쪽만 고쳐져 또 갈라진다. */
  const calendarBackHref = useMemo(() => {
    const sp = new URLSearchParams(searchParams.toString())
    if (custQuery) sp.set('cust', custQuery); else sp.delete('cust')
    if (selectedInspectionId) sp.set('insp', selectedInspectionId); else sp.delete('insp')
    const qs = sp.toString()
    return `${pathname}${qs ? `?${qs}` : ''}`
  }, [searchParams, pathname, custQuery, selectedInspectionId])

  const panelEntryQuery = (() => {
    const q = new URLSearchParams()
    if (panelEntryStep) q.set('step', String(panelEntryStep))
    q.set('from', calendarBackHref)
    return `?${q.toString()}`
  })()

  // ── 정기 칩 드래그 이동 (드롭=즉시 확정, 같은 달 한정, 2026-07-13 확정 설계) ──
  /** 단건(드래그·행 아이콘)과 일괄(데이 패널 선택 모드)이 **같은 확인 팝업**을 쓴다 —
   *  공휴일·주말·과거일 경고를 두 벌 만들면 그 순간 갈라진다. 건수가 아니라 **진입 경로**로
   *  구분하는 이유는 과거 날짜 규칙이 다르기 때문이다(단건=경고 후 허용, 일괄=서버가 배치 전체를 거부). */
  const [moveConfirm, setMoveConfirm] = useState<
    | { mode: 'single'; planItemId: string; customerName: string; from: string; to: string }
    | { mode: 'bulk'; itemIds: string[]; names: string[]; from: string; to: string }
    | null
  >(null)
  const [isMoving, startMoving] = useTransition()

  /* ── 점검일자 변경 (2026-09-22) ──────────────────────────────────────
     계획 이동(moveConfirm)과 **다른 축**이라 상태를 따로 둔다: 저쪽은 미시작 계획을 옮기고,
     이쪽은 **이미 시작된 점검**의 기산일을 옮겨 1~6단계 마감을 통째로 다시 깐다.
     한 상태로 합치면 확인 문구·거부 규칙이 섞여 「어느 쪽 규칙으로 막혔나」를 못 가른다. */
  const [dateChange, setDateChange] = useState<
    | { inspectionId: string; from: string; to: string
        rows?: Array<{ stepNum: number; nameKo: string; from: string | null; to: string | null; done: boolean }>
        blocked?: string; error?: string; loading: boolean }
    | null
  >(null)
  const [isChangingDate, startChangingDate] = useTransition()

  /* ── 달력에서 고객 등록 (2026-09-22 사용자 요청) ──────────────────────────
     등록은 **이미 달력 일정을 만든다**(`_autoCreatePlanItemsForNewCustomer` — 롤링 계획 +
     과거·오늘이면 1차 즉시 시작). 그래서 여기서 등록하면 그 자리에 칩이 바로 뜬다.
     날짜를 짚어 들어왔으면 그 날짜가 **점검일자**로 프리필된다 — 달력의 단위가 곧 그 칸이다. */
  const [newCustomerDate, setNewCustomerDate] = useState<string | null>(null)
  const [newFormData, setNewFormData] = useState<
    { employees: Array<{ id: string; name: string; position: string | null }>; defaultRegionSi: string; purposes: string[] } | null
  >(null)
  const [newFormError, setNewFormError] = useState('')
  /** 등록 직후 달력에 남기는 띠 — 이동하지 않으므로 「무엇이 생겼는지」를 여기서 말해야 한다 */
  const [created, setCreated] = useState<
    { customerId: string; customerName: string; anchorDate: string
      anchorApplied: boolean; startedInspectionId?: string } | null
  >(null)

  /** 폼이 요구하는 서버 데이터는 **모달을 열 때** 받는다 — 달력 초기 로드에 얹지 않는다 */
  /* ── 문서 고지를 **채우러 가는 입구**로 (2026-09-22) ───────────────────────
     라우트는 이미 무엇이 비었는지 말한다. 종전엔 읽기 전용 토스트로 흘러가고 끝났다.
     이제 조각별로 목적지를 달아 주고, 채우고 돌아오면 **자동으로 다시 발행**한다.
     ⚠ 발행 가드(window.confirm)는 여전히 안 붙인다 — 이 패널의 방침이다(문서 줄 주석 참조).
       문서는 이미 받았고, 이건 다음 발행을 위한 안내다. */
  const [wbNotice, setWbNotice] = useState<WorkbookNoticePart[]>([])
  const [wbError, setWbError] = useState('')
  /** 소방계획서 고지 — 보고서와 **다른 축**이라 따로 든다(고객 단위 문서다) */
  const [fpNotice, setFpNotice] = useState<WorkbookNoticePart[]>([])
  const [fpError, setFpError] = useState('')
  /** 채우고 돌아왔다 — 쪽지를 소비했으면 「지금 받기」를 띄운다 */
  const [resumedDoc, setResumedDoc] = useState(false)
  const resumeRef = useRef<string | null>(null)

  /* 회차가 바뀌면 이전 회차의 고지를 들고 있으면 안 된다 — 남의 빈칸을 이 회차 것으로 읽게 된다.
     그리고 **채우고 돌아온 경우**(?insp= 복귀) 쪽지를 소비해 [지금 받기]를 띄운다.
     ⚠ 자동 다운로드는 브라우저가 막을 수 있어 **배너가 보장 경로**다
       (`plan-annex-round-card.tsx:196` 실측 교훈 — 자동만 두면 막혔을 때 아무 일도 안 일어난다). */
  useEffect(() => {
    setWbNotice([]); setWbError(''); setResumedDoc(false); setFpNotice([]); setFpError('')
    const id = selectedInspectionId
    if (!id) { resumeRef.current = null; return }
    if (resumeRef.current === id) return      // 이 회차에 대해선 이미 소비했다
    resumeRef.current = id
    if (takePendingDoc(id, Date.now())) setResumedDoc(true)
  }, [selectedInspectionId])

  const openNewCustomer = useCallback((date: string) => {
    setNewCustomerDate(date)
    setCreated(null)
    setNewFormError('')
    setNewFormData(prev => {
      if (prev) return prev                       // 한 번 받아 두면 다시 받지 않는다
      void getCustomerNewFormDataAction().then(res => {
        if (res.error) { setNewFormError(res.error); return }
        setNewFormData({
          employees: res.employees ?? [],
          defaultRegionSi: res.defaultRegionSi ?? '',
          purposes: res.purposes ?? [],
        })
      })
      return prev
    })
  }, [])

  const openDateChange = useCallback((inspectionId: string, from: string) => {
    setDateChange({ inspectionId, from, to: from, loading: false })
  }, [])

  /** 날짜를 고르면 **저장 전에** 무엇이 바뀌는지 서버에 묻는다.
   *  ⚠ 마감일을 화면에서 계산하지 않는다 — 공휴일·영업일 보정은 `resolveStepDates`가 정본이고
   *    여기서 흉내 내면 미리보기와 실제 저장값이 갈린다(그 어긋남은 저장한 뒤에야 보인다). */
  /** 미리보기 조회 본체 — **점검 id를 인자로 받는다.**
   *  ⚠ 상태(`dateChange?.inspectionId`)에서 읽으면 안 되는 경로가 생겼다(R8b): 드래그 드롭은
   *    모달을 **여는 동시에** 미리보기를 띄워야 하는데, 그 순간 상태는 아직 이전 값(또는 null)이라
   *    같은 렌더에서 읽으면 조회가 통째로 건너뛰어진다. 그래서 id를 넘겨받는 한 벌로 두고
   *    입력칸·드롭 **두 경로가 같은 함수**를 쓴다 — 두 벌이면 한쪽만 고쳐져 갈라진다. */
  const fetchDateChangePreview = useCallback((id: string, to: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) { setDateChange(d => (d ? { ...d, loading: false } : d)); return }
    void previewInspectionDateChangeAction(id, to).then(res => {
      setDateChange(d => {
        if (!d || d.inspectionId !== id || d.to !== to) return d   // 늦게 온 응답이 최신 선택을 덮지 않게
        if (res.error) return { ...d, loading: false, error: res.error }
        if (!res.allowed) return { ...d, loading: false, blocked: res.reason ?? '변경할 수 없습니다' }
        return { ...d, loading: false, rows: res.rows }
      })
    })
  }, [])

  const previewDateChange = useCallback((to: string) => {
    const id = dateChange?.inspectionId
    setDateChange(d => (d ? { ...d, to, rows: undefined, blocked: undefined, error: undefined, loading: true } : d))
    if (!id) return
    fetchDateChangePreview(id, to)
  }, [dateChange?.inspectionId, fetchDateChangePreview])

  /** R8b — 드롭 한 번으로 **모달을 열면서 그 날짜의 미리보기까지** 받는다.
   *  드래그는 이미 「이 날짜로」라는 의도를 말했으므로 날짜를 다시 고르게 하지 않는다.
   *  ⚠ 그래도 **저장은 사람이 누른다**: 드롭=즉시 적용인 정기 칩과 다르게, 이쪽은 1~6단계
   *    마감일을 통째로 다시 깔고 그중엔 이미 나간 서류가 걸릴 수 있다. 미리보기를 보고 누르는
   *    한 박자가 그 차이를 감당하는 값이다(모달 본문이 그걸 설명한다). */
  const openDateChangeAt = useCallback((inspectionId: string, from: string, to: string) => {
    setDateChange({ inspectionId, from, to, loading: true })
    fetchDateChangePreview(inspectionId, to)
  }, [fetchDateChangePreview])

  /** 끌 수 있는 칩인가 — 판정은 `lib/calendar-drag` 한 벌이다(R8b, 2026-09-22).
   *  여기 인라인으로 두면 달력을 띄워 마우스로 끌어 봐야만 단언할 수 있어서 밖으로 뺐다.
   *  ⛔ `onSelectSlot`(빈 칸 드래그)은 켜지 않는다 — `onEventDrop` 제스처와 충돌한다. */
  const draggableAccessor = useCallback(
    (event: object) => canDragCalendarChip((event as CalEvent).resource, canMovePlan),
    [canMovePlan],
  )

  const handleEventDrop = useCallback((args: { event: object; start: Date | string }) => {
    const e = args.event as CalEvent
    const r = e.resource
    if (!draggableAccessor(e)) return
    const to = format(new Date(args.start), 'yyyy-MM-dd')

    /* ① 1단계 칩 = 점검일자 이동. **같은 달 제약이 없다** — 정기의 「같은 달」은 월 단위 의무에서
       오는 규칙인데(그 달이 비고 옮겨간 달이 2회가 된다), 이쪽은 이미 시작된 점검의 기산일을
       정정하는 일이라 달을 넘는 정정이 실제로 일어난다(2026-09-20 「해오름 9/12→9/18」).
       판정·산식은 전부 서버(R8a) 것을 그대로 쓴다 — 여기서 규칙을 새로 짜지 않는다. */
    if (r.kind === 'step') {
      // 서버가 실제로 바꾸는 값을 「지금」으로 삼는다(칩이 앉은 due_date를 점검일자로 추정하지 않는다)
      const from = r.inspectionStartDate ?? r.dueDate
      if (to === from) return
      openDateChangeAt(r.inspectionId, from, to)
      return
    }

    // ② 미시작 정기 계획 칩 — 종전 경로 그대로
    const from = r.dueDate
    if (to === from) return
    if (to.slice(0, 7) !== from.slice(0, 7)) { alert('같은 달 안에서만 이동할 수 있습니다.'); return }
    setMoveConfirm({ mode: 'single', planItemId: r.inspectionId, customerName: r.customerName, from, to })
  }, [draggableAccessor, openDateChangeAt])

  function handleMoveConfirm() {
    if (!moveConfirm) return
    if (moveConfirm.mode === 'bulk') { runBulkMove(moveConfirm.itemIds, moveConfirm.to); return }
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

  // 고객명 검색 필터 — 렌더 안이 아니라 여기서 계산한다. [전체 선택]이 **보이는 행만** 담아야 하는데
  // 렌더 IIFE 안에 있으면 핸들러가 그 목록을 볼 수 없다.
  const daySearchQ = daySearch.trim().toLowerCase()
  const panelSteps = useMemo(
    () => daySearchQ ? dayPanelSteps.filter(e => e.resource.customerName.toLowerCase().includes(daySearchQ)) : dayPanelSteps,
    [dayPanelSteps, daySearchQ]
  )
  const panelPlans = useMemo(
    () => daySearchQ ? dayPanelPlans.filter(p => p.customer_name.toLowerCase().includes(daySearchQ)) : dayPanelPlans,
    [dayPanelPlans, daySearchQ]
  )

  // 일괄 이동 대상 = 행의 [날짜 이동] 아이콘이 붙는 조건과 **같은 판정**(canAct + 정기)
  const isMovablePlan = useCallback(
    (p: CalendarPlanItem) => canMovePlan && p.plan_type === 'monthly' && p.status !== 'completed' && !p.inspection_id,
    [canMovePlan]
  )
  // 토글 노출 판정은 검색과 무관한 그날 전체로 — 검색을 타이핑하는 중에 버튼이 사라지지 않게
  const movableDayPlans = useMemo(() => dayPanelPlans.filter(isMovablePlan), [dayPanelPlans, isMovablePlan])
  // [전체]가 담는 범위는 **지금 화면에 보이는 것만** (검색 = 사용자가 명시한 범위)
  const movableVisibleIds = useMemo(() => panelPlans.filter(isMovablePlan).map(p => p.id), [panelPlans, isMovablePlan])
  // 선택 건수·대상은 **살아 있는 행에서 다시 만든다** — 이동 후 router.refresh()로 행이 그 날짜를
  // 떠나면 체크 Set에 id가 남아 있어도 여기서 빠진다 ("N건 선택"이 거짓말을 하지 않게)
  const moveCheckedItems = useMemo(() => movableDayPlans.filter(p => moveChecked.has(p.id)), [movableDayPlans, moveChecked])

  // 같은 날 일괄 완료 후보 — 그 날짜 마감·미완료 단계 전부 (1단계형=정기·일반은 기본 체크, 자체점검 6단계는 기본 해제)
  const bulkCandidates = useMemo(() => {
    if (!dayPanelDate) return []
    return inspections.flatMap(insp =>
      insp.steps
        .filter(s => s.due_date === dayPanelDate && s.status !== 'completed')
        .map(s => ({
          stepId: s.id,
          inspectionId: insp.id,
          label: `${insp.customer_name} · ${s.name_ko}`,
          oneStep: insp.steps.length === 1,   // migration 111: 정기·event=1단계, 자체점검=6단계
        })))
      .sort((a, b) => (a.oneStep === b.oneStep ? a.label.localeCompare(b.label, 'ko') : a.oneStep ? -1 : 1))
  }, [inspections, dayPanelDate])

  // 미시작 정기·일반 계획 항목 후보 — 시작+1단계 완료까지 일괄 처리 (권한은 [점검 시작]과 동일, 2026-08-05)
  const bulkPlanCandidates = useMemo(() => {
    if (!dayPanelDate || !canMovePlan) return []
    return planItems
      .filter(p => p.scheduled_date === dayPanelDate && p.status !== 'completed' && !p.inspection_id)
      .map(p => ({
        itemId: p.id,
        typeLabel: planTypeLabel(p.plan_type, p.sub_type),
        label: p.customer_name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  }, [planItems, dayPanelDate, canMovePlan])

  const bulkTotal = bulkCandidates.length + bulkPlanCandidates.length

  // 체크 키 — 단계 s:, 계획 항목 p: 접두로 한 Set에서 관리
  function openBulkModal() {
    setBulkChecked(new Set([
      ...bulkPlanCandidates.map(c => `p:${c.itemId}`),
      ...bulkCandidates.filter(c => c.oneStep).map(c => `s:${c.stepId}`),
    ]))
    setBulkResult(null)
    setBulkOpen(true)
  }

  function toggleBulkChecked(key: string, checked: boolean) {
    setBulkChecked(prev => {
      const next = new Set(prev)
      if (checked) next.add(key); else next.delete(key)
      return next
    })
  }

  function runBulkComplete() {
    const stepItems = bulkCandidates.filter(c => bulkChecked.has(`s:${c.stepId}`))
      .map(({ stepId, inspectionId, label }) => ({ stepId, inspectionId, label }))
    const planSel = bulkPlanCandidates.filter(c => bulkChecked.has(`p:${c.itemId}`))
      .map(({ itemId, label }) => ({ itemId, label }))
    if (stepItems.length + planSel.length === 0) { setBulkResult('선택된 건이 없습니다.'); return }
    // 사유 입력 팝업 폐지 (2026-08-13 사용자 요청) — 이 모달에서 대상을 눈으로 확인하고 누르는 구조라
    // 확인 절차는 이미 있다. 다만 서버는 사유를 필수로 요구하고(R4-9·D34-2: 근거 없는 완료는 증거 기반
    // 동기화가 되돌린다) 사유가 곧 증빙이므로, **경로와 날짜를 담은 사유를 자동으로 남긴다.**
    const reason = `${dayPanelDate ?? ''} 점검 달력 [이날 전체 완료]로 일괄 확인`.trim()
    startBulk(async () => {
      let done = 0
      const failed: Array<{ label: string; error: string }> = []
      // 39 S3-2 — 단계는 완료됐으나 점검 완료 전환이 보류된 건. 실패가 아니라 '남은 일'이라
      // 따로 세서 모달에 남긴다(전건 성공처럼 모달을 닫아 버리면 보류를 아무도 못 본다)
      const heldRows: Array<{ label: string; required: number; comp: number }> = []
      if (planSel.length > 0) {
        const res = await bulkStartCompletePlanItemsAction(planSel, reason)
        if (res.error) { setBulkResult(`❌ ${res.error}`); return }
        done += res.done
        failed.push(...res.failed)
      }
      if (stepItems.length > 0) {
        const res = await bulkCompleteStepsAction(stepItems, reason)
        if (res.error) { setBulkResult(`❌ ${res.error}`); return }
        done += res.done
        failed.push(...res.failed)
        heldRows.push(...res.held)
      }
      // 전건 성공이면 모달을 바로 닫는다 — 결과 확인용으로 남겨두면 완료 후에도 팝업이 계속 떠 있음 (2026-08-05)
      if (failed.length === 0 && heldRows.length === 0) {
        setBulkOpen(false)
      } else {
        const heldMsg = heldRows.length === 0 ? '' :
          ` · ⏸ 점검 완료 보류 ${heldRows.length}건(설치 설비 점검표 미입력) — `
          + heldRows.map(h => `${h.label}(${h.required}건${h.comp > 0 ? `, ● ${h.comp}` : ''})`).join(' / ')
        setBulkResult(
          `✅ ${done}건 완료 처리`
          + (failed.length > 0 ? ` · 실패 ${failed.length}건 — ${failed.map(f => `${f.label}(${f.error})`).join(' / ')}` : '')
          + heldMsg)
      }
      router.refresh()
    })
  }

  // 데이 패널: 정기 이동 — 달력 선택 즉시 이동, 주말·공휴일·과거 날짜만 확인 팝업 (2026-08-05)
  const [movingPlanId, setMovingPlanId] = useState<string | null>(null)
  async function handlePanelPick(p: CalendarPlanItem, to: string) {
    if (to === p.scheduled_date) return
    if (to.slice(0, 7) !== p.scheduled_date.slice(0, 7)) { alert('같은 달 안에서만 이동할 수 있습니다.'); return }
    const dow = new Date(to + 'T12:00:00').getDay()
    if (holidayMap.has(to) || dow === 0 || dow === 6 || to < today) {
      setMoveConfirm({ mode: 'single', planItemId: p.id, customerName: p.customer_name, from: p.scheduled_date, to })
      return
    }
    setMovingPlanId(p.id)
    const res = await moveMonthlyPlanItemAction(p.id, to)
    setMovingPlanId(null)
    if (res.error) { alert(res.error); return }
    router.refresh()
  }

  // ── 데이 패널: 정기 여러 건 날짜 이동 (선택 모드) ─────────────
  function toggleMoveChecked(id: string, checked: boolean) {
    setMoveChecked(prev => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }
  /** [전체]는 **보이는 행만** 담는다 — 검색은 사용자가 명시한 범위이고, 안 보이는 행까지 담으면
   *  본 적 없는 레코드를 조용히 고치게 된다. 검색어를 바꿔도 선택은 유지한다
   *  ('가' 검색→체크→'나' 검색→체크→한 번에 이동'은 정당한 동선). 비우려면 [해제]. */
  function selectAllVisibleForMove() {
    setMoveChecked(prev => new Set([...prev, ...movableVisibleIds]))
  }

  function handleBulkMovePick(to: string) {
    if (!dayPanelDate || moveCheckedItems.length === 0) return
    setBulkMoveResult(null)
    if (to === dayPanelDate) return
    // min·max로 이미 막히지만, 규칙을 화면에도 남긴다 (정기는 월 단위 의무)
    if (to.slice(0, 7) !== dayPanelDate.slice(0, 7)) {
      setBulkMoveResult({ ok: false, text: '같은 달 안에서만 이동할 수 있습니다.' }); return
    }
    // 과거 날짜는 **부르기 전에** 막는다 — 서버(bulkMovePlanDatesAction)가 배치 전체를 거부해
    // 한 건도 안 옮겨진다. 단건 이동은 종전대로 경고 후 허용이라 막다른 길이 아님을 문구로 알린다.
    if (to < today) {
      setBulkMoveResult({ ok: false, text: '지난 날짜로는 일괄 이동할 수 없습니다 — 한 건씩(행의 달력 아이콘) 이동은 가능합니다.' }); return
    }
    if (moveCheckedItems.length > 200) {
      setBulkMoveResult({ ok: false, text: '한 번에 200건까지 이동할 수 있습니다.' }); return
    }
    setMoveConfirm({
      mode: 'bulk',
      itemIds: moveCheckedItems.map(p => p.id),
      names: moveCheckedItems.map(p => p.customer_name),
      from: dayPanelDate,
      to,
    })
  }

  function runBulkMove(itemIds: string[], to: string) {
    startBulkMove(async () => {
      const res = await bulkMovePlanDatesAction(itemIds, to)
      setMoveConfirm(null)
      setMoveChecked(new Set())   // 선택만 비우고 선택 모드는 유지 — 이어서 다른 묶음을 옮길 수 있게
      // 건별 실패를 삼키지 않는다. 문자 발송 화면(sms-status-client)과 **같은 문구**로 보고한다
      setBulkMoveResult(res.failed.length === 0
        ? { ok: true, text: `${res.moved}건을 ${to}로 이동했습니다.` }
        : { ok: false, text: `${res.moved}건 이동 · ${res.failed.length}건 실패 — ${res.failed.map(f => `${f.name}(${f.reason})`).join(' / ')}` })
      router.refresh()
    })
  }

  // 패널을 닫거나(dayPanelDate=null) 다른 날짜로 옮기면 선택 모드 초기화 — effect가 아니라
  // 렌더 중 조정(React 공식 '값이 바뀌면 state 조정' 패턴). 이렇게 해야 setDayPanelDate 호출처
  // 네 곳에 초기화를 흩뿌리지 않고 한 곳에서 끝난다.
  const [moveModeDate, setMoveModeDate] = useState<string | null>(dayPanelDate)
  if (moveModeDate !== dayPanelDate) {
    setMoveModeDate(dayPanelDate)
    setMoveSelectMode(false)
    setMoveChecked(new Set())
    setBulkMoveResult(null)
  }

  // 툴바 필터 배지 — 기본값에서 벗어난 필터 수
  const activeFilterCount =
    (viewMode === 'customer' ? 1 : 0)
    + (viewMode === 'employee' && selectedEmployeeIds.size < employees.length ? 1 : 0)
    + (viewMode === 'customer' && selectedCustomerIds.size < uniqueCustomers.length ? 1 : 0)
    + (calMode === 'all' && typeFilters.size < 3 ? 1 : 0)
    + (statusFilters.size < 3 ? 1 : 0)

  // 데이 패널: 정기 항목 시작+완료 — 확인창 없이 클릭 즉시 완료 처리, 점검업무 이동 없음 (2026-08-05 사용자 확정)
  const [startingPlanId, setStartingPlanId] = useState<string | null>(null)
  async function handleStartFromPanel(p: CalendarPlanItem) {
    const reason = window.prompt(
      `${p.customer_name} — 점검을 시작하고 ① 단계를 완료 처리합니다.\n`
      + '외관점검표를 입력하면 ①은 자동으로 완료됩니다.\n\n완료 사유를 입력하세요 (5자 이상 — 증빙으로 남습니다):',
    )
    if (reason === null) return
    setStartingPlanId(p.id)
    const res = await bulkStartCompletePlanItemsAction([{ itemId: p.id, label: p.customer_name }], reason)
    setStartingPlanId(null)
    if (res.error) { alert(res.error); return }
    if (res.failed.length > 0) { alert(res.failed[0].error); return }
    router.refresh()
  }

  async function handleCompleteStep(stepId: string, inspId: string) {
    // R4-9(소방계획서_21): 달력의 '완료'는 증거가 아니라 사람의 확인이다 — 사유를 남겨야 증거 기반
    // 동기화가 되돌리지 않는다(D34-2). 점검표·파일·제출일이 들어오면 그때는 사유 없이 자동 완료된다.
    const reason = window.prompt(
      '이 단계를 완료 처리합니다.\n점검표 응답·파일·제출일이 등록되면 자동으로 완료되니, 그 경로를 먼저 확인해주세요.\n\n'
      + '완료 사유를 입력하세요 (5자 이상 — 증빙으로 남습니다):',
    )
    if (reason === null) return
    setCompletingStepId(stepId)
    setStepError(null)
    const result = await completeStepAction(stepId, inspId, reason)
    setCompletingStepId(null)
    if (result.error) {
      setStepError(result.error)
    } else {
      // 39 S3-2 — 단계는 완료됐지만 필수 미입력으로 점검 완료 전환이 보류된 경우, 지금이
      // "왜 완료가 안 되지?"의 유일한 순간이다 — 사유와 출구(입력 화면)를 함께 말한다
      if (result.completionHeld) {
        window.alert(
          `단계는 완료됐지만 점검 완료 전환은 보류되었습니다.\n\n`
          + `필수 미입력 항목 ${result.completionHeld.required}건`
          + `${result.completionHeld.comp > 0 ? ` (종합 필수 ● ${result.completionHeld.comp}건 포함)` : ''}이 남아 있습니다.\n`
          + `설치된 설비의 점검표는 항목마다 ○/✕/／ 중 하나를 기재해야 합니다 — 점검표 입력 화면에서 채우면 자동으로 완료됩니다.`)
      }
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
    // 팔레트 var — light는 종전 hex(#dc2626/#2563eb) 그대로, 다크는 .dark 재정의로 헤더 요일 색과 일치
    const color = holiday || dow === 0 ? 'var(--color-red-600)' : dow === 6 ? 'var(--color-blue-600)' : undefined
    return (
      <div className="flex items-center justify-between gap-1 min-w-0">
        {holiday ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); e.preventDefault(); setHolidayInfo({ date: iso, name: holiday }) }}
            title={`${holiday} (공휴일)`}
            className="text-form-2xs text-red-500 truncate leading-tight hover:underline cursor-pointer bg-transparent border-0 p-0 text-left"
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
          className="h-8 px-3 rounded-lg border border-line text-xs font-medium text-ink-sub bg-surface hover:bg-brand-tint hover:text-brand transition-colors"
        >
          오늘
        </button>
        {/* 이번달 요약 — 모니터링 안 가도 현황 파악 */}
        <span className="text-form-xs text-ink-sub hidden sm:flex items-center gap-2">
          이번달 <b className="text-ink">{monthStats.total}건</b>
          <span className="text-green-600">완료 {monthStats.done}</span>
          <span className={monthStats.overdue > 0 ? 'text-red-600 font-semibold' : 'text-ink-meta'}>지연 {monthStats.overdue}</span>
        </span>
      </div>
      <div className="flex items-center gap-0.5 bg-surface border border-line rounded-lg px-1 py-1 shadow-sm">
        <button
          onClick={() => onNavigate('PREV')}
          className="p-1 hover:bg-brand-tint rounded transition-colors"
          title="이전"
        >
          <ChevronLeft className="size-4 text-ink-sub" />
        </button>
        <span className="text-sm font-semibold text-ink min-w-[88px] text-center px-1">{label}</span>
        <button
          onClick={() => onNavigate('NEXT')}
          className="p-1 hover:bg-brand-tint rounded transition-colors"
          title="다음"
        >
          <ChevronRight className="size-4 text-ink-sub" />
        </button>
      </div>
      <div className="flex items-center bg-brand-tint rounded-lg p-0.5">
        {([['month', '월'], ['week', '주'], ['agenda', '목록']] as const).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setCalView(v as View)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              calView === v ? 'bg-surface text-brand shadow-sm' : 'text-ink-sub hover:text-brand'
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
        <div className="flex items-center gap-1 bg-surface border border-line rounded-lg p-1 w-fit">
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
                calMode === key ? 'bg-brand text-white' : 'text-ink-sub hover:bg-brand-tint'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {([
          { key: 'all',     label: '전체',      color: 'text-brand bg-brand-tint border-brand-line' },
          { key: 'today',   label: '오늘 마감', color: 'text-red-600 bg-red-50 border-red-200' },
          { key: 'week',    label: '이번 주',   color: 'text-amber-600 bg-amber-50 border-amber-200' },
          { key: 'overdue', label: '지연',      color: 'text-gray-500 bg-gray-100 border-gray-200' },
        ] as const).map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setQuickFilter(key)}
            className={`h-8 px-3 rounded-lg border text-xs font-medium transition-colors ${quickFilter === key ? color : 'border-line text-ink-sub bg-surface hover:bg-paper'}`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {/* 툴바 진입 — 기본은 내일이지만 모달 안에서 기간을 바꿀 수 있다(주간 지역 순회 준비) */}
          {canSendSms && (
            <button
              data-testid="calendar-sms-toolbar"
              onClick={() => {
                const t = new Date(Date.now() + 9 * 3600_000 + 86400_000).toISOString().slice(0, 10)
                setSmsSource({ kind: 'range', from: t, to: t, title: '내일 방문 — 사전 안내' })
              }}
              title="내일 방문하는 고객에게 사전 안내 문자를 보냅니다"
              className="h-8 px-3 rounded-lg border border-line bg-surface text-xs font-medium text-ink-sub hover:bg-paper flex items-center gap-1.5 transition-colors"
            >
              <MessageSquare className="size-3.5" /> 사전안내 문자
            </button>
          )}
          {/* 툴바 등록 — 날짜를 안 짚고 들어오므로 **오늘**로 프리필한다.
              실측상 점검일자는 315건 중 314건이 과거이고 최근 20건은 등록일과 같은 날이었다 */}
          {canCreateCustomer && (
            <button
              data-testid="calendar-new-customer"
              onClick={() => openNewCustomer(today)}
              title="새 고객을 등록합니다 (점검일자는 오늘로 시작 — 폼에서 바꿀 수 있습니다)"
              className="h-8 px-3 rounded-lg border border-line bg-surface text-xs font-medium text-ink-sub hover:bg-paper flex items-center gap-1.5 transition-colors"
            >
              <Plus className="size-3.5" /> 고객 등록
            </button>
          )}
          {/* 고객명 검색 — 달력에 실린 고객에서 바로 고른다(서버 왕복 없음). 뷰 모드와 무관하게 적용 */}
          <CustomerFilterSearch
            customers={uniqueCustomers.map(c => ({ id: c.id, name: c.name, sub: c.code }))}
            value={customerSearch}
            onChange={setCustomerSearch}
            testId="cal-customer-search"
          />
          {/* 필터 팝오버 — 보기·직원/고객·유형·상태 (구 사이드바) */}
          <div ref={filterRef} className="relative">
            <button
              onClick={() => setFilterOpen(v => !v)}
              className={`h-8 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${filterOpen || activeFilterCount > 0 ? 'border-brand-line bg-brand-tint text-brand' : 'border-line bg-surface text-ink-sub hover:bg-paper'}`}
            >
              <SlidersHorizontal className="size-3.5" />
              필터
              {activeFilterCount > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-brand text-white text-form-2xs font-semibold flex items-center justify-center">{activeFilterCount}</span>
              )}
            </button>
            {filterOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-surface rounded-xl border border-brand-line shadow-[0_8px_24px_rgba(18,43,165,0.14)] z-30 overflow-hidden select-none">
            <div className="max-h-[70vh] overflow-y-auto">

          {/* 보기 토글 */}
          <div className="px-4 pt-4 pb-3 border-b border-brand-line-soft">
            <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider mb-2">보기</p>
            <div className="space-y-1">
              {(['employee', 'customer'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors text-left ${viewMode === mode ? 'bg-brand-tint text-brand font-semibold' : 'text-ink-sub hover:bg-paper'}`}
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
            <div className="px-4 py-3 border-b border-brand-line-soft">
              <div className="flex items-center justify-between mb-2">
                <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider">직원</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSelectedEmployeeIds(new Set(employees.map(e => e.id)))}
                    className="text-form-2xs text-brand hover:underline"
                  >전체</button>
                  <span className="text-ink-meta">·</span>
                  <button
                    onClick={() => setSelectedEmployeeIds(new Set())}
                    className="text-form-2xs text-ink-meta hover:text-ink-sub"
                  >해제</button>
                </div>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {employees.map(emp => (
                  <label key={emp.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-paper cursor-pointer">
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
                    <span className={`text-xs flex-1 truncate ${selectedEmployeeIds.has(emp.id) ? 'text-ink' : 'text-ink-meta line-through'}`}>
                      {emp.name}
                    </span>
                    {selectedEmployeeIds.has(emp.id)
                      ? <Check className="size-3 text-brand shrink-0" />
                      : <span className="size-3 shrink-0" />}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 고객 목록 (고객 뷰) */}
          {viewMode === 'customer' && (
            <div className="px-4 py-3 border-b border-brand-line-soft">
              <div className="flex items-center justify-between mb-2">
                <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider">고객</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSelectedCustomerIds(new Set(uniqueCustomers.map(c => c.id)))}
                    className="text-form-2xs text-brand hover:underline"
                  >전체</button>
                  <span className="text-ink-meta">·</span>
                  <button
                    onClick={() => setSelectedCustomerIds(new Set())}
                    className="text-form-2xs text-ink-meta hover:text-ink-sub"
                  >해제</button>
                </div>
              </div>
              {/* 검색 입력은 툴바 하나로 통일 — 여기 있던 입력은 이 목록만 걸러서 달력이 안 바뀌었다 */}
              {custQuery && (
                <p className="text-form-2xs text-brand mb-2">
                  &lsquo;{custQuery}&rsquo; 검색 중 — 목록도 함께 좁혀졌습니다.
                </p>
              )}
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredCustomerList.map(cust => (
                  <label key={cust.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-paper cursor-pointer">
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
                    <span className={`text-xs flex-1 truncate ${selectedCustomerIds.has(cust.id) ? 'text-ink' : 'text-ink-meta line-through'}`}>
                      {cust.name}
                    </span>
                    {selectedCustomerIds.has(cust.id)
                      ? <Check className="size-3 text-brand shrink-0" />
                      : <span className="size-3 shrink-0" />}
                  </label>
                ))}
                {filteredCustomerList.length === 0 && (
                  <p className="text-xs text-ink-meta text-center py-2">결과 없음</p>
                )}
              </div>
            </div>
          )}

          {/* 점검유형 필터 — 전체 탭에서만 (종합/작동/정기/일반 탭은 자체가 유형 필터) */}
          {calMode === 'all' && (
          <div className="px-4 py-3 border-b border-brand-line-soft">
            <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider mb-2">점검유형</p>
            <div className="space-y-1">
              {(['종합', '작동', '일반관리'] as InspectionType[]).map(type => (
                <label key={type} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-paper cursor-pointer">
                  <input type="checkbox" checked={typeFilters.has(type)} onChange={() => toggleType(type)} className="sr-only" />
                  <span className={`size-3.5 rounded border flex items-center justify-center transition-colors ${typeFilters.has(type) ? 'bg-brand border-brand' : 'border-brand-line'}`}>
                    {typeFilters.has(type) && <Check className="size-2.5 text-white" />}
                  </span>
                  <span className="text-xs text-ink">{inspectionTypeLabel(type)}</span>
                </label>
              ))}
            </div>
          </div>
          )}

          {/* 상태 필터 */}
          <div className="px-4 py-3">
            <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider mb-2">상태</p>
            <div className="space-y-1">
              {[
                { key: 'incomplete', label: '미완료', color: 'text-ink' },
                { key: 'completed',  label: '완료',   color: 'text-green-700' },
                { key: 'overdue',    label: '기한초과', color: 'text-red-600' },
              ].map(({ key, label, color }) => (
                <label key={key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-paper cursor-pointer">
                  <input type="checkbox" checked={statusFilters.has(key)} onChange={() => toggleStatus(key)} className="sr-only" />
                  <span className={`size-3.5 rounded border flex items-center justify-center transition-colors ${statusFilters.has(key) ? 'bg-brand border-brand' : 'border-brand-line'}`}>
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
              className="h-8 w-8 rounded-lg border border-line bg-surface text-ink-sub hover:bg-paper flex items-center justify-center transition-colors"
            >
              <Info className="size-4" />
            </button>
            {legendOpen && (
              <div className="absolute right-0 top-full mt-1 w-60 bg-surface rounded-xl border border-brand-line shadow-[0_8px_24px_rgba(18,43,165,0.14)] z-30 p-3 space-y-1.5 text-form-xs text-ink-sub">
                <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider">칩 배경 = 점검유형</p>
                {/* 범례 스와치는 실제 칩과 **같은 토큰**을 써야 한다 — 리터럴로 두면 다크에서 안내와 화면이 갈린다 */}
                <p className="flex items-center gap-1.5"><span className="inline-block w-4 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--chip-compre-bg)' }} />종합</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-4 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--chip-oper-bg)' }} />작동</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-4 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--chip-gen-bg)' }} />일반관리</p>
                <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider pt-1.5">좌측 바 = 마감 긴급도</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-green-500" />여유 (3일 이상)</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-orange-500" />1~2일</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-red-500" />D-Day</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-[var(--chip-over-solid-bg)]" />지연 (연빨강 배경 + ⚠)</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-1 h-3 rounded-sm bg-gray-300" />완료 (흐림 + ✓)</p>
                <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider pt-1.5">계획 일정 (일별 집계)</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-500" />정기 N건</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500" />일반 N건</p>
                <p className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--chip-over-solid-bg)]" />⚠N = 지연 포함</p>
                <p className="text-form-2xs text-ink-meta pt-1">담당자 뷰에서는 칩 앞 색 도트가 담당 직원(필터의 직원 색과 동일)입니다. 집계 칩·날짜 숫자를 클릭하면 그날 전체 일정이 열립니다.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 달력 ──────────────────────────────────────────── */}
      <div className="space-y-3">
          {/* 검색 중 안내 — 빈 달력이 '일정 없음'으로 보이는 오해를 막고, 해제 수단을 그 자리에 둔다 */}
          {custQuery && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-tint border border-brand-line text-xs text-ink-sub">
              <Search className="size-3.5 text-brand shrink-0" />
              <span>
                &lsquo;<b className="text-ink">{custQuery}</b>&rsquo; 검색 중 — 이 고객의 일정만 표시됩니다.
                {events.length + planEvents.length === 0 && ' 이 달에는 해당 일정이 없습니다.'}
              </span>
              <button
                onClick={() => setCustomerSearch('')}
                data-testid="cal-clear-search"
                className="ml-auto shrink-0 underline hover:text-brand"
              >
                검색 해제
              </button>
            </div>
          )}

          {/* 기한초과 진입 과거 달 점프 안내 — 오늘 달이 아닌 이유를 설명 (2026-08-04) */}
          {overdueJumpNotice && earliestOverdue && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="size-4 shrink-0 text-red-500" />
              <span>
                기한초과 항목이 있는 <strong>{earliestOverdue.slice(0, 4)}년 {parseInt(earliestOverdue.slice(5, 7))}월</strong>(가장 오래된 미완료 마감 {earliestOverdue.slice(5, 10).replace('-', '/')})로 이동했습니다.
              </span>
              <span className="ml-auto shrink-0 flex items-center gap-2">
                <button
                  onClick={() => { setCalDate(new Date()); setOverdueJumpNotice(false) }}
                  className="text-xs font-medium text-red-700 underline hover:text-red-900">
                  이번 달 보기
                </button>
                <button onClick={() => setOverdueJumpNotice(false)} className="text-red-400 hover:text-red-600" title="닫기">
                  <X className="size-3.5" />
                </button>
              </span>
            </div>
          )}

          {/* 등록 완료 띠 (2026-09-22) — 달력에 **머물기로** 했으므로(사용자 확정) 이동 대신
              여기서 무엇이 생겼는지 말하고, 다음 걸음 두 개를 링크로 준다.
              ⚠ 「나머지 채우기」의 목적지 탭은 **서버(lib/onboarding-steps)가 첫 미완 탭으로** 정한다 —
                폼 state로 고르면 대장 자동값·부분 실패와 어긋난다. 그래서 여기선 고객 id만 넘긴다. */}
          {created && (
            <div data-testid="calendar-created-banner"
                 className="flex items-center gap-2 flex-wrap rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
              <Check className="size-4 shrink-0 text-green-600" />
              {/* 🚨 두 갈래를 **서버가 준 anchorApplied로** 가른다. 화면이 날짜를 다시 비교해
                  추측하면 서버의 실제 결과(예: 적용 대상 회차가 없어 실패)와 어긋난다. */}
              {created.anchorApplied ? (
                <span data-testid="created-started">
                  <strong>{created.customerName}</strong> 등록 완료 — {created.anchorDate}에 <b>1~4단계</b>가 생겼습니다
                </span>
              ) : (
                <span data-testid="created-planned">
                  <strong>{created.customerName}</strong> 등록 완료 — {created.anchorDate}에 <b>계획</b>이 잡혔습니다
                  <span className="text-green-700"> (1~4단계는 점검 당일에 열립니다)</span>
                </span>
              )}
              {/* 화면을 **떠나지 않고** 그 자리로 간다 — 이게 「달력에 머문다」의 실체다 */}
              {created.anchorApplied && created.startedInspectionId ? (
                <button
                  data-testid="created-open-step1"
                  onClick={() => { setSelectedInspectionId(created.startedInspectionId!); setStepError(null) }}
                  className="ml-auto shrink-0 text-xs text-green-700 font-medium hover:underline flex items-center gap-0.5">
                  1단계 열기 <ChevronRight className="size-3" />
                </button>
              ) : (
                <button
                  data-testid="created-open-plan"
                  onClick={() => { setDayPanelDate(created.anchorDate); setDaySearch('') }}
                  className="ml-auto shrink-0 text-xs text-green-700 font-medium hover:underline flex items-center gap-0.5">
                  계획 확인 <ChevronRight className="size-3" />
                </button>
              )}
              <Link
                href={`/customers/${created.customerId}?created=1&onboarding=1&from=${encodeURIComponent(calendarBackHref)}`}
                data-testid="created-fill-rest"
                className="shrink-0 text-xs text-green-700 font-medium hover:underline flex items-center gap-0.5">
                나머지 채우기 <ChevronRight className="size-3" />
              </Link>
              <button onClick={() => setCreated(null)} className="shrink-0 text-green-700 hover:text-green-900">
                <X className="size-4" />
              </button>
            </div>
          )}

          {/* 퇴사자 담당 재배정 안내 */}
          {orphanCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="size-4 shrink-0 text-amber-500" />
              <span>퇴사(비활성) 직원 담당 일정이 <strong>{orphanCount}건</strong> 있습니다. 달력에는 계속 표시되며, 담당자 재배정이 필요합니다.</span>
              {/* 담당은 고객관리가 단일 소스 — 점검확정 화면 폐지(2026-09-12)로 재배정 창구도 고객관리로 */}
              <Link href="/customers" className="ml-auto shrink-0 text-xs text-amber-700 font-medium hover:underline flex items-center gap-0.5">
                고객 관리에서 재배정 <ChevronRight className="size-3" />
              </Link>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4">
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
          {/* rbc 공용 스킨은 globals.css 한 곳(소방계획서_29 S3-4). 여기 남긴 것은 **이 화면 고유 규칙**뿐 —
              이벤트 밀도(!important로 공용값 덮기)와 빈 주 압축이다. */}
          <style>{`
            .rbc-event { border-radius:5px !important; padding:1px 5px !important; font-size:calc(11px * var(--fs-scale)) !important; cursor:pointer; }
            /* 빈 주 압축 — 일정 없는 주는 최소 높이로 (:has 미지원 브라우저는 균등 높이 유지).
               ⚠ 배율을 곱한다 — 글자만 키우고 이 값을 고정하면 빈 주가 상대적으로 납작해져
                 배율이 올라갈수록 달력이 들쭉날쭉해진다. */
            .rbc-month-row:not(:has(.rbc-event)) { flex: 0 0 calc(88px * var(--fs-scale)); }
            .rbc-overlay .rbc-event { cursor:pointer; }
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
                        className={`rounded-xl border flex flex-col overflow-hidden ${isToday ? 'border-brand ring-1 ring-brand' : 'border-brand-line-soft'} ${holiday ? 'bg-red-50/30' : 'bg-surface'}`}
                      >
                        <button
                          onClick={() => { setDayPanelDate(iso); setDaySearch('') }}
                          title="이 날짜의 전체 일정 보기"
                          className="px-2 py-1.5 border-b border-brand-line-soft text-left hover:bg-paper transition-colors shrink-0"
                        >
                          <span className={`text-xs font-semibold ${holiday || dow === 0 ? 'text-red-600' : dow === 6 ? 'text-blue-600' : isToday ? 'text-brand' : 'text-ink'}`}>
                            {format(d, 'd일 (EEE)', { locale: ko })}
                          </span>
                          {holiday && <span className="block text-form-2xs text-red-500 truncate">{holiday}</span>}
                        </button>
                        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                          {dayEvents.length === 0 ? (
                            <p className="text-form-2xs text-ink-meta text-center pt-6">일정 없음</p>
                          ) : dayEvents.map(ev => (
                            <button
                              key={ev.id}
                              onClick={() => handleSelectEvent(ev)}
                              style={chipStyle(ev.resource)}
                              className="w-full text-left rounded-md px-1.5 py-1 text-form-xs leading-tight cursor-pointer"
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
            // 칸 높이도 배율을 탄다 (2026-09-07 사용자 결정). 월 뷰는 컨테이너 높이를 6주로
            // 나눠 쓰므로, 높이를 고정한 채 글자만 키우면 칸당 보이는 일정 수가 **줄어든다**
            // ("+N개 더 보기"로 숨는다). 배율만큼 늘려 화면 밖으로 넘치면 페이지가 스크롤된다 —
            // 일정이 잘려 안 보이는 것보다 스크롤이 낫다는 판단.
            style={{ height: 'calc((100vh - 190px) * var(--fs-scale))', minHeight: 'calc(600px * var(--fs-scale))' }}
            views={[Views.MONTH, Views.AGENDA]}
            components={{ toolbar: CalToolbar, event: EventChip, month: { dateHeader: MonthDateHeader } }}
            dayPropGetter={(date: Date) => {
              const iso = format(date, 'yyyy-MM-dd')
              // 인라인 style은 클래스 코드모드가 닿지 않는 축(소방계획서_29 S3-1) —
              // 리터럴 #fef2f2를 쓰면 다크에서 공휴일 칸만 흰 판으로 남는다. 팔레트 변수로 건넨다.
              return holidayMap.has(iso) ? { style: { backgroundColor: 'var(--color-red-50)' } } : {}
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
        // panelSteps·panelPlans·daySearchQ는 컴포넌트 상단 메모에서 계산 ([전체 선택]이 같은 목록을 봐야 한다)
        return (
          <>
            <div className="fixed inset-0 bg-black/20 dark:bg-black/60 z-40" onClick={() => { if (!isBulkMoving) setDayPanelDate(null) }} />
            <div className="fixed top-0 right-0 bottom-0 w-[400px] bg-surface shadow-2xl z-50 flex flex-col">
              {/* 헤더 */}
              <div className="px-5 py-4 border-b border-brand-line-soft shrink-0">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-ink">
                    {format(d, 'M월 d일 (EEE)', { locale: ko })}
                    {holiday && <span className="ml-2 text-xs text-red-500 font-medium">{holiday}</span>}
                  </p>
                  <button onClick={() => setDayPanelDate(null)} disabled={isBulkMoving}
                    className="text-ink-faint hover:text-ink-sub transition-colors disabled:opacity-40">
                    <X className="size-5" />
                  </button>
                </div>
                {/* 버튼이 셋이라 한 줄에 같이 두면 400px에서 요약 글자가 3줄로 접힌다 → 줄을 나눈다 */}
                <div className="mt-0.5">
                  <p className="text-xs text-ink-sub">단계 일정 {dayPanelSteps.length}건 · 계획 일정 {dayPanelPlans.length}건</p>
                  <span className="flex items-center gap-1 flex-wrap mt-1.5">
                    {/* 사전 안내 문자 — **주 발송 경로**(소방계획서_24 Q-14·Q-15).
                        칩을 체크하지 않고 **날짜만 넘긴다**: 서버가 그날 방문 전 건을 계산하므로
                        ①달력 쪽 신규 상태가 0개이고 ②②~⑥ 서류 마감 칩에 "내일 방문" 문자가
                        나가는 사고가 원천 차단되며 ③달력이 로드하지 않는 자체점검도 목록에 든다. */}
                    {canSendSms && (
                      <button
                        data-testid="calendar-sms-day"
                        onClick={() => setSmsSource({ kind: 'range', from: dayPanelDate, to: dayPanelDate, title: `${format(d, 'M월 d일', { locale: ko })} 방문 — 사전 안내` })}
                        className="text-form-xs font-medium text-brand border border-brand-line rounded-lg px-2 py-0.5 hover:bg-brand-tint transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                        title="이 날짜에 방문하는 고객에게 사전 안내 문자를 보냅니다">
                        <MessageSquare className="size-3" /> 사전안내 문자
                      </button>
                    )}
                    {/* 이 날짜로 고객 등록 (2026-09-22) — 달력의 단위가 곧 점검일자 칸이라
                        짚은 날짜가 그대로 프리필된다. 등록하면 그 자리에 칩이 바로 뜬다. */}
                    {canCreateCustomer && (
                      <button
                        data-testid="daypanel-new-customer"
                        disabled={moveSelectMode}
                        onClick={() => { const dt = dayPanelDate; setDayPanelDate(null); openNewCustomer(dt) }}
                        className="text-form-xs font-medium text-brand border border-brand-line rounded-lg px-2 py-0.5 hover:bg-brand-tint transition-colors inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-40"
                        title={moveSelectMode ? '날짜 이동 선택 중에는 사용할 수 없습니다' : '이 날짜를 점검일자로 하여 새 고객을 등록합니다'}>
                        <Plus className="size-3" /> 이 날짜로 고객 등록
                      </button>
                    )}
                    {bulkTotal > 0 && (
                      <button
                        onClick={openBulkModal}
                        disabled={moveSelectMode}
                        className="text-form-xs font-medium text-brand border border-brand-line rounded-lg px-2 py-0.5 hover:bg-brand-tint transition-colors inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-40"
                        title={moveSelectMode ? '날짜 이동 선택 중에는 사용할 수 없습니다' : '이 날짜의 미완료 단계·미시작 정기·일반 계획을 한 번에 완료 처리'}>
                        <Check className="size-3" /> 이날 전체 완료 ({bulkTotal})
                      </button>
                    )}
                    {/* 정기 여러 건 날짜 이동 — 켜면 이동 가능한 정기 행에 체크박스가 생긴다 */}
                    {movableDayPlans.length > 0 && (
                      <button
                        data-testid="day-move-toggle"
                        onClick={() => {
                          setMoveSelectMode(v => !v)
                          setMoveChecked(new Set())
                          setBulkMoveResult(null)
                        }}
                        disabled={isBulkMoving}
                        className={`text-form-xs font-medium border rounded-lg px-2 py-0.5 transition-colors inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-50 ${
                          moveSelectMode
                            ? 'bg-brand border-brand text-white'
                            : 'text-brand border-brand-line hover:bg-brand-tint'}`}
                        title="정기 일정 여러 건을 같은 달 다른 날짜로 한 번에 옮깁니다">
                        <CalendarDays className="size-3" /> {moveSelectMode ? '이동 취소' : '날짜 이동'}
                      </button>
                    )}
                  </span>
                </div>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
                  <input
                    value={daySearch}
                    onChange={e => setDaySearch(e.target.value)}
                    placeholder="고객명 검색..."
                    className="w-full h-8 pl-8 pr-2 text-xs border border-brand-line rounded-lg outline-none focus:border-brand transition"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {/* 단계 일정 (종합·작동 6단계) */}
                {panelSteps.length > 0 && (
                  <div className="px-5 py-3 border-b border-brand-line-soft">
                    <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider mb-2">단계 일정 (종합·작동)</p>
                    <div className="space-y-0.5">
                      {panelSteps.map(e => (
                        // 지도 버튼을 행 버튼 **밖**에 둔다 — button 안의 button은 중첩이 안 된다
                        <div key={e.id} className="flex items-center gap-1 rounded-lg hover:bg-paper transition-colors">
                          {/* 선택 모드에선 클릭을 막는다 — 이 버튼은 패널을 닫아버려 고른 선택이 날아간다 */}
                          <button
                            disabled={moveSelectMode}
                            /* 데이 패널 → 회차 패널로 가는 **주 동선**이다(달력에서 작업대까지의 유일한 길).
                               표식이 없으면 왕복 검사가 화면 구조를 추측해야 한다 — 그 추측이 곧 썩는다. */
                            data-testid="daypanel-step-row"
                            onClick={() => { setDayPanelDate(null); setSelectedInspectionId(e.resource.inspectionId); setStepError(null) }}
                            className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left disabled:opacity-50 disabled:cursor-default"
                          >
                            <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: e.resource.color }} />
                            <span className="text-xs text-ink flex-1 min-w-0 truncate">{e.title}</span>
                            {/* R7 — 이 회차는 이미 한 바퀴가 끝났다. 줄을 지우지 않고 **표식만** 붙인다:
                                끝난 일도 그날 있었던 일이라 달력에서 사라지면 안 된다. */}
                            {closedInspectionIds.has(e.resource.inspectionId) && (
                              <span
                                data-testid="daypanel-row-closed"
                                className="shrink-0 text-form-2xs font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-700"
                              >
                                종료됨
                              </span>
                            )}
                            <ChevronRight className="size-3.5 text-ink-faint shrink-0" />
                          </button>
                          <AddressMapButton customerName={e.resource.customerName} address={e.resource.customerAddress} iconOnly className="mr-2" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 계획 일정 (정기·일반) */}
                {panelPlans.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-form-2xs font-semibold text-ink-meta uppercase tracking-wider mb-2">계획 일정 (정기·일반)</p>
                    <div className="space-y-0.5">
                      {panelPlans.map(p => {
                        const isCompleted = p.status === 'completed'
                        const isOverdue = !isCompleted && p.scheduled_date < today
                        const canAct = canMovePlan && !isCompleted && !p.inspection_id
                        const movable = isMovablePlan(p)
                        const entry = planRowInspectionEntry(p, { canAct, moveSelectMode })
                        // [날짜 이동] 아이콘 조건 = 일괄 이동 대상 판정과 **같은 식**(:724 주석의 약속).
                        // 종전엔 `plan_type === 'monthly' && canAct`를 여기 따로 적어 두 벌이었다 — 같은 값이라
                        // 어긋난 적은 없지만, 한쪽만 고치면 조용히 갈라지는 자리라 원천 하나로 합친다.
                        const showMove = movable && !moveSelectMode
                        return (
                          <div key={p.id}>
                            <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${isOverdue ? 'bg-red-50/60' : 'hover:bg-paper'}`}>
                              {/* 선택 모드: 이동 가능한 정기만 체크박스, 나머지는 자리만 비워 이름 정렬을 유지 */}
                              {moveSelectMode && (movable ? (
                                <input
                                  type="checkbox"
                                  data-testid="day-move-check"
                                  data-plan-id={p.id}
                                  disabled={isBulkMoving}
                                  checked={moveChecked.has(p.id)}
                                  onChange={ev => toggleMoveChecked(p.id, ev.target.checked)}
                                  className="accent-brand shrink-0"
                                />
                              ) : (
                                <span className="size-3.5 shrink-0" title="이동 대상이 아닙니다 (정기·미시작 항목만 이동)" />
                              ))}
                              <span className={`text-form-2xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${planTypeBadgeClass(p.plan_type)}`}>
                                {planTypeLabel(p.plan_type, p.sub_type)}
                              </span>
                              <span className={`text-xs flex-1 min-w-0 truncate ${isCompleted ? 'text-ink-meta line-through' : 'text-ink'}`} title={`담당 ${p.assigned_employee_name}`}>
                                {p.customer_name}
                              </span>
                              {/* 방문 준비 지도(S5-7 확산) — 이름 span 밖에 둔다. 안에 넣으면
                                  이름이 길 때 truncate에 아이콘까지 잘려 나간다.
                                  시작·완료된 건에도 남는다: 순회 준비는 그때도 필요하다 */}
                              <AddressMapButton customerName={p.customer_name} address={p.customer_address} iconOnly />
                              {/* 담당 미배정 표면화(2026-09-07) — 완료 건은 이력이라 제외 */}
                              {!p.assigned_employee_id && !isCompleted && <span className="text-form-2xs text-red-500 font-semibold shrink-0">미배정</span>}
                              {isOverdue && <span className="text-form-2xs text-red-600 font-semibold shrink-0">지연⚠</span>}
                              {isCompleted && <Check className="size-3.5 text-green-600 shrink-0" />}
                              {/* 🚨 정기(monthly)는 점검표 입력을 하지 않는다 (2026-09-14 사용자 확정) —
                                  ▶[시작·완료]와 [점검 보기]가 **둘 다** 점검 레코드=점검표 입력 화면으로 가는
                                  입구라 정기 행에서는 둘 다 붙이지 않는다. 판정은 JSX가 아니라
                                  lib/calendar-plan-row.ts가 한다(여기 묻어 두면 아무도 단언하지 못한다).
                                  [날짜 이동]은 그 함수 밖 — isMovablePlan(:724)이 단일 원천이다. */}
                              {entry.viewInspection ? (
                                <Link href={`/inspections/${p.inspection_id}`} className="shrink-0 text-form-2xs text-green-600 hover:underline flex items-center gap-0.5">
                                  <ExternalLink className="size-3" />점검 보기
                                </Link>
                              ) : null}
                              {(showMove || entry.startComplete) && (
                                <span className="flex items-center gap-0.5 shrink-0">
                                  {showMove && (
                                    <PanelMoveButton
                                      scheduledDate={p.scheduled_date}
                                      moving={movingPlanId === p.id}
                                      onPick={to => handlePanelPick(p, to)}
                                    />
                                  )}
                                  {entry.startComplete && (
                                    <button
                                      title="점검 시작·완료 처리"
                                      disabled={startingPlanId === p.id}
                                      onClick={() => handleStartFromPanel(p)}
                                      className="p-1 rounded text-ink-faint hover:bg-brand-tint hover:text-brand transition-colors disabled:opacity-50"
                                    >
                                      {startingPlanId === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
                                    </button>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {panelSteps.length === 0 && panelPlans.length === 0 && (
                  <p className="text-xs text-ink-meta text-center py-10">
                    {daySearchQ ? '검색 결과가 없습니다.' : '이 날짜에 표시할 일정이 없습니다.'}
                  </p>
                )}
              </div>

              {/* 선택 모드 하단 바 — 목록이 flex-1 overflow-y-auto라 여기가 자연스럽게 고정된다 */}
              {moveSelectMode && (() => {
                const outsideSearch = moveCheckedItems.filter(p => !movableVisibleIds.includes(p.id)).length
                return (
                  <div data-testid="day-move-bar" className="px-5 py-2.5 border-t border-brand-line-soft bg-brand-tint shrink-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <p className="text-form-xs text-ink-sub flex-1 min-w-0">
                        <strong className="text-ink">{moveCheckedItems.length}건</strong> 선택
                        {outsideSearch > 0 && <span className="text-ink-soft"> (검색 밖 {outsideSearch}건 포함)</span>}
                      </p>
                      <button data-testid="day-move-all" onClick={selectAllVisibleForMove} disabled={isBulkMoving}
                        className="h-7 px-2 rounded-lg border border-brand-line text-form-xs text-ink-sub hover:bg-surface transition-colors disabled:opacity-50"
                        title="화면에 보이는 정기 일정만 선택합니다">
                        전체
                      </button>
                      <button data-testid="day-move-clear" onClick={() => setMoveChecked(new Set())} disabled={isBulkMoving}
                        className="h-7 px-2 rounded-lg border border-brand-line text-form-xs text-ink-sub hover:bg-surface transition-colors disabled:opacity-50">
                        해제
                      </button>
                      <PanelMoveButton
                        scheduledDate={dayPanelDate}
                        moving={isBulkMoving}
                        disabled={moveCheckedItems.length === 0}
                        onPick={handleBulkMovePick}
                        label="날짜 선택"
                        title="선택한 정기 일정을 같은 달 다른 날짜로 옮깁니다"
                        testId="day-move-pick"
                      />
                    </div>
                    {bulkMoveResult && (
                      <p data-testid="day-move-result"
                        className={`text-form-xs whitespace-pre-wrap ${bulkMoveResult.ok ? 'text-ink-sub' : 'text-red-600'}`}>
                        {bulkMoveResult.text}
                      </p>
                    )}
                  </div>
                )
              })()}

              {/* 「점검확정에서 관리」 링크 자리 — 점검확정 화면 폐지(2026-09-12)로 제거.
                  날짜 이동·시작+완료는 이 데이 패널이, 담당 변경은 고객관리가 담당한다 */}
            </div>

            {/* 같은 날 일괄 완료 모달 (2026-08-04) — 기본 체크: 1단계형(정기·일반), 자체점검 단계는 해제 */}
            {bulkOpen && (
              <>
                <div className="fixed inset-0 bg-black/30 dark:bg-black/60 z-[60]" onClick={() => !isBulkRunning && setBulkOpen(false)} />
                <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-h-[80vh] bg-surface rounded-2xl shadow-2xl z-[70] flex flex-col">
                  <div className="px-5 py-4 border-b border-brand-line-soft">
                    <p className="font-semibold text-ink">{format(new Date(dayPanelDate + 'T12:00:00'), 'M월 d일 (EEE)', { locale: ko })} 일괄 완료</p>
                    <p className="text-xs text-ink-sub mt-0.5">
                      미완료 {bulkTotal}건 중 <strong>{bulkChecked.size}건</strong> 선택 — 정기·일반은 기본 선택, 자체점검 단계는 확인 후 체크하세요
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto px-5 py-3 space-y-0.5">
                    {/* 미시작 정기·일반 계획 — 시작+완료까지 한 번에 처리 */}
                    {bulkPlanCandidates.map(c => (
                      <label key={`p:${c.itemId}`} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-paper cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bulkChecked.has(`p:${c.itemId}`)}
                          onChange={e => toggleBulkChecked(`p:${c.itemId}`, e.target.checked)}
                          className="accent-brand"
                        />
                        <span className={`text-form-2xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${c.typeLabel === '정기' ? 'bg-gray-100 text-gray-600' : 'bg-sky-50 text-sky-600'}`}>
                          {c.typeLabel}
                        </span>
                        <span className="text-xs text-ink flex-1 min-w-0 truncate">{c.label}</span>
                        <span className="text-form-2xs text-ink-meta shrink-0" title="점검 시작과 완료 처리를 함께 진행합니다">시작+완료</span>
                      </label>
                    ))}
                    {bulkCandidates.map(c => (
                      <label key={`s:${c.stepId}`} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-paper cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bulkChecked.has(`s:${c.stepId}`)}
                          onChange={e => toggleBulkChecked(`s:${c.stepId}`, e.target.checked)}
                          className="accent-brand"
                        />
                        <span className={`text-form-2xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${c.oneStep ? 'bg-gray-100 text-gray-600' : 'bg-brand-tint text-brand'}`}>
                          {c.oneStep ? '정기·일반' : '자체점검'}
                        </span>
                        <span className="text-xs text-ink flex-1 min-w-0 truncate">{c.label}</span>
                      </label>
                    ))}
                  </div>
                  {bulkResult && <p className="px-5 pb-1 text-xs text-ink-sub whitespace-pre-wrap">{bulkResult}</p>}
                  <div className="px-5 py-3 border-t border-brand-line-soft flex items-center justify-end gap-2">
                    <button onClick={() => setBulkOpen(false)} disabled={isBulkRunning}
                      className="h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-paper transition-colors disabled:opacity-50">
                      닫기
                    </button>
                    <button onClick={runBulkComplete} disabled={isBulkRunning || bulkChecked.size === 0}
                      className="h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1">
                      {isBulkRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      {bulkChecked.size}건 완료 처리
                    </button>
                  </div>
                </div>
              </>
            )}
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
        const busy = isMoving || isBulkMoving
        const names = moveConfirm.mode === 'bulk' ? moveConfirm.names : [moveConfirm.customerName]
        return (
          <div className="fixed inset-0 bg-black/20 dark:bg-black/60 z-[80] flex items-center justify-center p-4" onClick={() => !busy && setMoveConfirm(null)}>
            <div className="bg-surface rounded-xl border border-brand-line shadow-xl w-full max-w-xs p-4" onClick={e => e.stopPropagation()}>
              <p className="text-sm font-semibold text-ink mb-1">
                {moveConfirm.mode === 'bulk' ? `정기점검 일자 일괄 이동 (${moveConfirm.itemIds.length}건)` : '정기점검 일자 이동'}
              </p>
              <p className="text-xs text-ink-sub">
                {moveConfirm.from} → <span className="font-semibold text-brand">{moveConfirm.to}</span>
              </p>
              {/* 고객명을 반드시 보여준다 — 검색 밖에서 고른 건이 섞여 있어도 눈으로 확인하고 누르게 */}
              <p className="text-form-xs text-ink-sub mt-1 break-keep">
                {names.slice(0, 10).join(', ')}{names.length > 10 ? ` 외 ${names.length - 10}건` : ''}
              </p>
              <p className="text-form-xs text-ink-meta mt-1">이동하면 해당 날짜로 즉시 확정되고 1~6단계 마감일이 재계산됩니다.</p>
              {warnings.map(w => (
                <p key={w} className="text-form-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="size-3 shrink-0" />{w}</p>
              ))}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setMoveConfirm(null)}
                  disabled={busy}
                  className="flex-1 h-8 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  data-testid="day-move-confirm"
                  onClick={handleMoveConfirm}
                  disabled={busy}
                  className="flex-1 h-8 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium transition-colors flex items-center justify-center disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : '이동 확정'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 고객 등록 모달 (2026-09-22) ─────────────────────────────
          ⚠ **폼을 복제하지 않는다.** `CustomerNewClient`를 그대로 띄운다 — 그 안에 필수 6칸 판정,
            고객코드 자동생성 대기, 주소·고객명 중복검사, 건축물대장 자동조회가 다 들어 있다.
            「달력용 간단 폼」을 새로 짜면 두 벌이 되고 한쪽만 고쳐진다.
          ⚠ 우편번호 레이어는 body에 z-index 9999로 붙으므로(use-daum-postcode) 이 모달(z-[60])
            위에 정상적으로 뜬다 — 착수 전 실측으로 확인했다. */}
      {newCustomerDate && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/60 z-[60] flex items-start justify-center p-4 overflow-y-auto"
             onClick={() => setNewCustomerDate(null)}>
          <div data-testid="calendar-new-customer-modal"
               className="bg-surface rounded-xl shadow-2xl w-full max-w-5xl my-6 p-5 space-y-4"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-ink">고객 등록</p>
                <p className="text-xs text-ink-sub mt-0.5">
                  점검일자 <b>{newCustomerDate}</b>로 시작합니다 — 폼에서 바꿀 수 있습니다.
                </p>
              </div>
              <button onClick={() => setNewCustomerDate(null)} className="text-ink-meta hover:text-ink-sub">
                <X className="size-5" />
              </button>
            </div>
            {newFormError && <p className="text-xs text-red-600">{newFormError}</p>}
            {!newFormData && !newFormError && <p className="text-xs text-ink-meta">등록 폼을 준비하는 중…</p>}
            {newFormData && (
              <CustomerNewClient
                employees={newFormData.employees}
                defaultRegionSi={newFormData.defaultRegionSi}
                purposes={newFormData.purposes}
                initialAnchorDate={newCustomerDate}
                onCreated={r => { setNewCustomerDate(null); setCreated(r); router.refresh() }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── 점검일자 변경 모달 (2026-09-22) ───────────────────────
          패널(z-50) 위에 떠야 하므로 z-[80] — 이동 확인 팝업과 같은 층. */}
      {dateChange && (
        <div className="fixed inset-0 bg-black/20 dark:bg-black/60 z-[80] flex items-center justify-center p-4"
             onClick={() => !isChangingDate && setDateChange(null)}>
          <div data-testid="anchor-date-modal"
               className="bg-surface rounded-xl shadow-2xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-ink">점검일자 고치기</p>
            <p className="text-xs text-ink-sub">
              점검을 한 사실은 그대로 남습니다 — 고치는 것은 <b>언제 했다고 적었는가</b>입니다.
              저장하면 <b>1~6단계 마감일이 이 날짜 기준으로 다시 계산</b>됩니다.
            </p>

            <label className="block text-xs text-ink-sub">
              새 점검일자
              <input
                type="date"
                data-testid="anchor-date-input"
                value={dateChange.to}
                onChange={e => previewDateChange(e.target.value)}
                className="mt-1 w-full h-9 px-2 rounded-lg border border-brand-line bg-paper text-sm text-ink"
              />
            </label>

            {dateChange.loading && <p className="text-xs text-ink-meta">재계산 미리보기를 받는 중…</p>}
            {dateChange.blocked && (
              <p data-testid="anchor-date-modal-blocked" className="text-xs text-amber-700">{dateChange.blocked}</p>
            )}
            {dateChange.error && <p className="text-xs text-red-600">{dateChange.error}</p>}

            {/* 재계산 미리보기 — 저장 전에 **무엇이 바뀌는지** 보여준다.
                마감일은 서버(resolveStepDates)가 계산한 값 그대로다(화면에서 흉내 내지 않는다). */}
            {dateChange.rows && dateChange.rows.length > 0 && (
              <div data-testid="anchor-date-preview" className="rounded-lg border border-brand-line-soft overflow-hidden">
                <table className="w-full text-form-2xs">
                  <thead className="bg-brand-tint text-ink-sub">
                    <tr><th className="text-left px-2 py-1">단계</th><th className="text-left px-2 py-1">지금</th><th className="text-left px-2 py-1">바뀜</th></tr>
                  </thead>
                  <tbody>
                    {dateChange.rows.map(r => (
                      <tr key={r.stepNum} className="border-t border-brand-line-soft">
                        <td className="px-2 py-1 text-ink">
                          {r.stepNum}단계{r.done && <span className="ml-1 text-green-600">✓</span>}
                        </td>
                        <td className="px-2 py-1 text-ink-meta">{r.from ?? '—'}</td>
                        <td className={`px-2 py-1 ${r.from !== r.to ? 'text-brand font-medium' : 'text-ink-meta'}`}>{r.to ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDateChange(null)} disabled={isChangingDate}
                      className="h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-brand-tint disabled:opacity-40">
                취소
              </button>
              <button
                data-testid="anchor-date-save"
                disabled={isChangingDate || dateChange.loading || !dateChange.rows || dateChange.to === dateChange.from}
                onClick={() => {
                  const { inspectionId, to } = dateChange
                  startChangingDate(async () => {
                    const res = await changeInspectionDateAction(inspectionId, to)
                    if (res.error) { setDateChange(d => (d ? { ...d, error: res.error } : d)); return }
                    setDateChange(null)
                    router.refresh()
                  })
                }}
                className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
                {isChangingDate ? <Loader2 className="size-3.5 animate-spin" /> : '이 날짜로 고치기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 슬라이드 패널 backdrop ────────────────────────────── */}
      {selectedInspectionId && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/60 z-40"
          onClick={() => setSelectedInspectionId(null)}
        />
      )}

      {/* ── 슬라이드 패널 ─────────────────────────────────────── */}
      <div
        className={`fixed top-0 right-0 bottom-0 w-[380px] bg-surface shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out ${selectedInspectionId ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {selectedInspection && (
          <>
            {/* 패널 헤더 */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-line shrink-0">
              <div className="flex-1 min-w-0 pr-3">
                <p className="font-semibold text-ink truncate">{selectedInspection.customer_name}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className={`text-form-2xs font-medium px-1.5 py-0.5 rounded-full ${TYPE_COLORS[selectedInspection.inspection_type]}`}>
                    {inspectionTypeLabel(selectedInspection.inspection_type)}
                  </span>
                  {/* R7 — 「종료됨」(2026-09-22 사용자 확정). 유형 badge 바로 옆에 둔다:
                      이 패널에서 가장 먼저 답해야 하는 물음이 「이거 끝난 건가」다.
                      ⚠ 값은 서버가 의무 축으로 판정한 `closed` 하나다 — 여기서 steps로 다시 세지 않는다. */}
                  {selectedInspection.closed?.closed && (
                    <span
                      data-testid="daypanel-closed"
                      className="text-form-2xs font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 inline-flex items-center gap-1"
                    >
                      <Check className="size-3" />
                      종료됨
                      {/* 「언제 끝났나」 — 없으면 말하지 않는다(과거 행은 completed_at이 빌 수 있다) */}
                      {selectedInspection.closed.closedAt && ` · ${selectedInspection.closed.closedAt.slice(0, 10)}`}
                    </span>
                  )}
                  <span className="text-xs text-ink-sub">{selectedInspection.year}년 {selectedInspection.sequence_num}차</span>
                  <ChevronRight className="size-3 text-ink-faint" />
                  <span className="text-xs text-ink-sub">시작 {selectedInspection.inspection_start_date}</span>
                </div>
                <p className="text-xs text-ink-sub mt-1">담당: {selectedInspection.assigned_employee_name}</p>
              </div>
              <button
                onClick={() => setSelectedInspectionId(null)}
                className="text-ink-meta hover:text-ink-sub transition-colors shrink-0"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* 진행률 바 */}
            <div className="px-5 py-3 border-b border-brand-line-soft shrink-0">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-ink-sub">전체 진행률</span>
                <span className="font-medium text-brand">{panelCompletedCount}/{panelTotalCount} 단계 ({panelProgressPct}%)</span>
              </div>
              <div className="w-full h-2 bg-brand-line-soft rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${panelProgressPct === 100 ? 'bg-green-500' : 'bg-brand'}`}
                  style={{ width: `${panelProgressPct}%` }}
                />
              </div>
            </div>

            {/* 점검일자 — 고치는 자리 (2026-09-22 사용자 요청).
                🚨 여태 **이 경로가 없었다**. 1단계가 완료되면 계획 쪽 재확정이 거부하면서
                  「날짜는 점검 상세에서 변경해주세요」라고 안내했는데 **점검 상세에 그런 칸이 없었다** —
                  실제 정정은 스크립트로 해 왔다(2026-09-20 「해오름 9/12→9/18」).
                ⚠ 가부는 서버가 준 `dateChange`를 그대로 쓴다. 여기서 `steps`로 다시 세지 않는다
                  (표시 축이라 불량 0이면 ⑤⑥이 빠져 숨겨진 완료를 못 본다). */}
            {selectedInspection.hasResultReport && (
              <div data-testid="daypanel-anchor-date" className="px-5 py-2.5 border-b border-brand-line-soft shrink-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-ink-sub shrink-0">점검일자</span>
                  <span className="font-medium text-ink">{selectedInspection.inspection_start_date}</span>
                  {selectedInspection.dateChange?.allowed ? (
                    <button
                      data-testid="anchor-date-edit"
                      onClick={() => openDateChange(selectedInspection.id, selectedInspection.inspection_start_date)}
                      className="ml-auto shrink-0 text-form-xs font-medium text-brand border border-brand-line rounded-lg px-2 py-0.5 hover:bg-brand-tint transition-colors">
                      고치기
                    </button>
                  ) : (
                    /* 막혔으면 **왜 막혔는지**를 그 자리에 적는다 — 버튼만 지우면 사용자는
                       「왜 나만 안 되나」를 물을 곳이 없다 */
                    <span data-testid="anchor-date-blocked" className="ml-auto text-form-2xs text-amber-700 text-right leading-tight">
                      {selectedInspection.dateChange?.reason ?? '변경할 수 없습니다'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* R3 — 점검기간 **접힌 한 줄** (2026-09-22 사용자 요청).
                기본이 접힘인 이유: 이 패널은 이미 진행률·점검일자·7단계·보고서·소방계획서·링크가
                세로로 쌓여 있다. 기간은 **평소엔 한 줄이면 충분하고**, 어긋났을 때만 펼쳐 읽으면 된다.
                ⚠ 축은 위 [점검일자]와 같은 `hasResultReport`(자체점검 = 별지 9호가 있는 건)다.
                  정기(monthly)는 종료일 개념 자체가 없어 늘 「당일」이라 한 줄이 소음이 된다. */}
            {selectedInspection.hasResultReport && (
              <details data-testid="daypanel-period" className="group px-5 py-2 border-b border-brand-line-soft shrink-0">
                <summary className="flex items-center gap-2 text-xs cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3 text-ink-faint shrink-0 transition-transform group-open:rotate-90" />
                  <span className="text-ink-sub shrink-0">점검기간</span>
                  <span data-testid="daypanel-period-text" className="font-medium text-ink truncate">{period.text}</span>
                  {/* 접힌 채로도 **어긋남은 보여야 한다** — 펼쳐야만 보이면 아무도 안 본다 */}
                  {period.mismatch && (
                    <span data-testid="daypanel-period-mismatch" className="ml-auto shrink-0 text-form-2xs text-amber-700">
                      저장값 {period.storedDays}일
                    </span>
                  )}
                </summary>
                <div className="mt-1.5 pl-5 space-y-1 text-form-2xs text-ink-meta leading-relaxed">
                  <p>종료일은 <span className="font-medium text-ink-sub">2단계(배치신고) 기산점</span>입니다 — 그 다음 5영업일이 마감입니다.</p>
                  <p>일수는 <span className="font-medium text-ink-sub">별지 9호</span>에 그대로 인쇄됩니다.</p>
                  {period.mismatch && (
                    <p data-testid="daypanel-period-mismatch-why" className="text-amber-700">
                      ⚠ 기간으로 세면 {period.days}일인데 저장된 일수는 {period.storedDays}일입니다.
                      이대로 별지 9호를 발행하면 <span className="font-medium">같은 종이에서 기간과 일수가 서로를 부정</span>합니다 —
                      점검 기간을 다시 저장하면 맞춰집니다.
                    </p>
                  )}
                </div>
              </details>
            )}

            {/* 7단계 목록 */}
            <div className="flex-1 overflow-y-auto">
              {selectedInspection.steps.map(step => {
                const isStepOverdue = step.status !== 'completed' && step.due_date !== null && step.due_date < today
                const actualStatus = isStepOverdue ? 'overdue' : step.status
                const cfg = STEP_STATUS_CFG[actualStatus] ?? STEP_STATUS_CFG.pending
                const isDueSoon = step.status !== 'completed' && step.due_date !== null &&
                  step.due_date >= today &&
                  step.due_date <= new Date(new Date(today + 'T00:00:00Z').getTime() + 7 * 86400000).toISOString().split('T')[0]
                // 현재 진행 단계(미완료 중 가장 낮은 step_num)에만 [사유 완료] 표시
                const isCurrentStep = step.status !== 'completed'
                  && selectedInspection.steps.every(s => s.step_num >= step.step_num || s.status === 'completed')
                const canCompleteThis = canCompleteInspection(selectedInspection) && isCurrentStep
                // [입력]은 **모든 미완료 단계**에 — 서버는 R4-4에서 순서 강제를 폐지했다(배치확인서는 협회에서
                // 늦게 오고 점검표는 먼저 채워진다). 정상 경로까지 ①에 막히면 뒤 단계를 영영 시작할 수 없다.
                const inputLink = step.status !== 'completed'
                  ? stepInputLink(selectedInspection.id, step.step_num,
                      { facilitiesUnverified: selectedInspection.facilitiesUnverified })
                  : null

                return (
                  <div
                    key={step.id}
                    className={`flex items-start gap-3 px-5 py-3 border-b border-paper last:border-0 ${isStepOverdue ? 'bg-red-50/40 border-l-4 border-l-red-400' : isDueSoon ? 'bg-amber-50/30 border-l-4 border-l-amber-400' : ''}`}
                  >
                    <div className={`size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${step.status === 'completed' ? 'bg-green-100' : isStepOverdue ? 'bg-red-100' : 'bg-brand-tint'}`}>
                      {step.status === 'completed'
                        ? <Check className="size-3 text-green-600" />
                        : isStepOverdue
                        ? <AlertTriangle className="size-3 text-red-500" />
                        : <span className="text-form-2xs font-bold text-brand">{step.step_num}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-sm ${step.status === 'completed' ? 'text-ink-sub line-through' : 'text-ink'}`}>
                          {step.name_ko}
                        </span>
                        <span className={`text-form-2xs font-medium px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
                          {cfg.label}
                        </span>
                        {isDueSoon && (
                          <span className="text-form-2xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">마감임박</span>
                        )}
                      </div>
                      {step.due_date ? (
                        <p className={`text-xs mt-0.5 ${isStepOverdue ? 'text-red-500 font-medium' : 'text-ink-sub'}`}>
                          마감: {step.due_date}
                        </p>
                      ) : (
                        <p className="text-xs text-ink-meta mt-0.5">마감일 없음</p>
                      )}
                      {/* F-14: completed_at은 UTC — 자르면 00:00~09:00 KST 완료분이 어제로 보인다 */}
                      {step.completed_at && (
                        <p className="text-xs text-green-600 mt-0.5">완료: {kstDate(step.completed_at)}</p>
                      )}
                    </div>
                    {/* 정상 경로가 위(채움), 예외 경로가 아래(테두리만) — 위계를 색으로 드러낸다.
                        종전엔 [완료] 하나뿐이라 증거 없는 강제 완료가 유일한 출구처럼 보였다. */}
                    {(inputLink || canCompleteThis) && (
                      <div className="shrink-0 flex flex-col items-stretch gap-1">
                        {inputLink && (
                          <Link
                            /* B-3 — 단계 링크에도 복귀 경로를 싣는다(패널 하단 링크와 같은 규약).
                               왕복이 닫히지 않으면 「들어가는 길만 여섯 개」가 된다. 링크가
                               이미 자기 쿼리를 들고 있을 수 있어 `?`/`&`를 보고 잇는다.

                               🚨 복귀 경로에 **열린 패널(`insp`)을 실어야** 한다(2026-09-21 사용자 요청:
                                 「돌아가면 단계별 클릭 사이드 화면이어야 한다」). 이게 없으면 달력까지는
                                 오지만 패널이 닫혀 있어, 사용자가 날짜→단계를 처음부터 다시 짚는다.
                               ⚠ 그 조립은 **`calendarBackHref` 한 곳**이 한다(위 정의) — 종전엔 여기서
                                 직접 `insp`를 덮어썼고, 그래서 패널 하단 링크만 보정을 못 받았다. */
                            href={`${inputLink.href}${inputLink.href.includes('?') ? '&' : '?'}from=${encodeURIComponent(calendarBackHref)}`}
                            title={inputLink.title}
                            data-testid="calendar-step-input"
                            /* 🚨 여기서 패널을 닫지 않는다(2026-09-21). 닫으면 위 effect가 주소에서
                               `?insp=`를 지워, **브라우저 뒤로가기**로 돌아왔을 때 패널이 안 열린다
                               ([←] 버튼만 살고 back은 죽는 어긋난 상태). 어차피 화면을 떠나므로
                               닫아서 얻는 것도 없다 — 돌아오면 그 패널이 그대로 있는 편이 옳다. */
                            className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand-strong transition-colors whitespace-nowrap"
                          >
                            <PenLine className="size-3" />
                            {inputLink.label}
                          </Link>
                        )}
                        {canCompleteThis && (
                          <button
                            onClick={() => handleCompleteStep(step.id, selectedInspection.id)}
                            disabled={completingStepId === step.id}
                            title="점검표·파일·제출일 같은 증거 없이 사람이 확정합니다 — 사유가 증빙으로 기록됩니다"
                            className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-line text-ink-soft hover:bg-brand-tint hover:text-ink-sub disabled:opacity-50 transition-colors whitespace-nowrap"
                          >
                            {completingStepId === step.id
                              ? <Loader2 className="size-3 animate-spin" />
                              : <Check className="size-3" />}
                            사유 완료
                          </button>
                        )}
                      </div>
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

            {/* 결과보고서 받기 — **떠나지 않고** 받는 자리(2026-09-21 사용자 요청).
                종전엔 [N단계로 이동]으로 작업대까지 나가야 이 문서를 받을 수 있었고, 받고 나면
                달력으로 되돌아와야 했다. 달력이 한 바퀴의 정본인데 문서만 밖에 있었다.

                ⚠ **새 버튼을 만들지 않는다** — `WorkbookXlsxButton`을 그대로 쓴다. 이 버튼이
                  `fetch`+`Blob`인 이유가 라우트의 `X-Workbook-Missing` 고지(무응답 항목이 ○(양호)로
                  인쇄됨·사진 실패·불량 접힘)를 화면에 붙들기 위해서다. `<a href>`로 짜면 그 고지가
                  새 탭과 함께 사라진다 — 종전 번들 패널 버튼이 정확히 그래서 고지가 **한 번도 닿은
                  적이 없었다**. 이름도 `WORKBOOK_LABEL` 한 벌을 따른다(여기 글씨를 또 적지 않는다).

                ⚠ 발행 가드(미입력이면 점검표로 보냄)는 **붙이지 않는다**. 그건 회차 카드 칩의 축이다.
                  달력은 착륙 화면이라 현장 흐름을 끊지 않고, 대신 위 고지로 알린다.

                ⚠ 줄은 flex-wrap이어야 한다 — 이 컴포넌트는 [버튼 + 고지/오류]를 함께 그린다. */}
            {selectedInspection.hasResultReport && (
              <div
                data-testid="daypanel-workbook"
                className="px-5 py-3 border-t border-line shrink-0 flex flex-wrap items-center gap-2 max-h-[40vh] overflow-y-auto"
              >
                <WorkbookXlsxButton
                  inspectionId={selectedInspection.id}
                  onNotice={raw => setWbNotice(parseWorkbookNotice(raw))}
                  onError={setWbError}
                />
                {resumedDoc && (
                  <p data-testid="daypanel-workbook-resume" className="text-form-2xs text-brand">
                    입력을 마치고 돌아오셨습니다 — 위 [{WORKBOOK_LABEL}]을 다시 누르면 반영된 문서를 받습니다.
                  </p>
                )}
                {wbError && <p className="text-form-2xs text-red-600 w-full">{wbError}</p>}
                <DocNoticeList
                  parts={wbNotice}
                  hrefOf={p => {
                    if (!p.target) return null
                    const base = workbookFixHref(
                      p.target,
                      { inspectionId: selectedInspection.id, customerId: selectedInspection.customer_id },
                      stepInputLink,
                    )
                    return `${base}${base.includes('?') ? '&' : '?'}from=${encodeURIComponent(calendarBackHref)}`
                  }}
                  /* 🚨 쪽지는 **이동 앞에서** 쓴다. `router.push` 뒤에 두면 실행되지 않는다
                     (`plan-annex-round-card.tsx:121`의 교훈). Link의 onClick은 이동 전에 돈다. */
                  onNavigate={() => writePendingDoc(selectedInspection.id, 'xlsx', Date.now())}
                />
              </div>
            )}

            {/* 소방계획서 엑셀 (2026-09-22) — **게이트를 걸지 않는다**(사용자 지시:
                「경우에 따라 만들 수도, 안 만들 수도」). 고객이 있으면 언제나 대상이고,
                비어 있다는 사실은 **고지가 말해 준다**(실측 채움률 3.2% — 12/12에 고지가 떴다).
                ⚠ 보고서와 **다른 축**이다: 이건 고객 단위 문서라 회차 쪽지(pendingDoc)를 쓰지 않는다. */}
            {true && (
              <div
                data-testid="daypanel-fireplan"
                className="px-5 py-3 border-t border-line shrink-0 flex flex-wrap items-center gap-2 max-h-[40vh] overflow-y-auto"
              >
                <FirePlanXlsxButton
                  customerId={selectedInspection.customer_id}
                  variant="outline"
                  onNotice={raw => setFpNotice(parseFirePlanNotice(raw).map(p => {
                    const hit = firePlanNoticeHref(p, selectedInspection.customer_id, tabOfForm)
                    return hit
                      ? { text: p.text, kind: 'fixable' as const, label: hit.label, scope: 'customer' as const }
                      : { text: p.text, kind: 'unknown' as const }
                  }))}
                  onError={setFpError}
                />
                {fpError && <p className="text-form-2xs text-red-600 w-full">{fpError}</p>}
                <DocNoticeList
                  parts={fpNotice}
                  hrefOf={p => {
                    const hit = firePlanNoticeHref(
                      { text: p.text }, selectedInspection.customer_id, tabOfForm)
                    if (!hit) return null
                    return `${hit.href}${hit.href.includes('?') ? '&' : '?'}from=${encodeURIComponent(calendarBackHref)}`
                  }}
                />
              </div>
            )}

            {/* 상세 페이지·소방계획서 링크 — 계획서는 착륙 화면(달력)에서 가장 잦은 목적지인데
                종전엔 작업대를 경유해야 했다(4클릭 → 3클릭, 2026-08-28 동선 검토) */}
            <div className="px-5 py-3 border-t border-line shrink-0 flex items-center gap-4">
              {/* 🚨 2026-09-21 B-2 — **지금 급한 단계로** 착지한다.
                  종전엔 `/inspections/{id}` 고정이라 작업대의 기본 칸으로 떨어졌다. 패널에서
                  「기한초과 2단계」를 보고 눌렀는데 스텝바에서 그 칸을 다시 찾아야 했다.
                  우선순위는 **기한초과 → 첫 미완** — 화면이 붉게 칠한 그 줄이 곧 목적지다.
                  ⚠ 판정 재료는 패널이 이미 그리는 값 그대로다(`steps`는 서버가 표시 축으로
                    걸러 보낸 것 — lib/active-steps). 여기서 다시 세지 않는다. */}
              <Link
                href={`/inspections/${selectedInspection.id}${panelEntryQuery}`}
                data-testid="daypanel-detail-link"
                title={panelEntryStep ? `${panelEntryStep}단계로 바로 이동` : '작업대로 이동'}
                className="text-xs text-brand hover:underline flex items-center gap-1"
              >
                {panelEntryStep ? `${panelEntryStep}단계로 이동` : '상세 페이지로 이동'}
                <ChevronRight className="size-3" />
              </Link>
              <Link
                href={`/customers/${selectedInspection.customer_id}?tab=annex`}
                title="회차 탭 · 회차별 별지 작성으로 바로가기"
                data-testid="daypanel-plan-link"
                className="text-xs text-brand hover:underline flex items-center gap-1"
              >
                소방계획서 트리
                <ChevronRight className="size-3" />
              </Link>
            </div>
          </>
        )}
      </div>

      {/* 사전 안내 문자 — 날짜만 넘긴다. 대상 계산·수신자·문구는 전부 서버가 만든다(Q-14).
          발송 결과는 여기 붙이지 않는다 — 결과 창구는 문자 발송 화면 하나뿐이다(Q-15).
          모달이 발송 후 [발송 결과 전체 보기] 링크로 그 화면에 이어 준다. */}
      {smsSource && (
        <InspectionSmsModal source={smsSource} onClose={() => setSmsSource(null)} />
      )}
    </div>
  )
}
