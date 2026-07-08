'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, FileText, CheckSquare, CalendarDays, Palmtree, ShieldCheck,
  Users, UserPlus, Building2, Landmark, ClipboardList, Settings, Umbrella,
  Flame, BookUser, TableProperties, BarChart2, FileCheck2, ClipboardCheck,
  Wallet, Receipt, CalendarCheck, ListTodo, MessageSquare, MessageCircle,
  FileSpreadsheet, ShoppingCart, BookOpen, TrendingUp, Scale, ReceiptText,
  Banknote, Handshake, LayoutList, BookMarked, NotebookPen, Car, Route,
  StickyNote, Award, Users2, PackagePlus, PackageMinus, BarChart3, RefreshCw,
  Tag, Package, PenLine, Mic, ChevronDown, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'

// ── 그룹 정의 ───────────────────────────────────────────────────────────────
type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  roles: UserRole[]
}

type NavGroup = {
  key: string
  label: string
  icon: React.ElementType
  roles: UserRole[]
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  // ── My Page ─────────────────────────────────────────────────────────────
  {
    key: 'mypage',
    label: 'My Page',
    icon: CalendarCheck,
    roles: ['employee', 'manager', 'admin'],
    items: [
      { label: '일정 관리',    href: '/my/schedules',   icon: CalendarCheck, roles: ['employee', 'manager', 'admin'] },
      { label: 'ToDo 목록',   href: '/my/todos',        icon: ListTodo,      roles: ['employee', 'manager', 'admin'] },
      { label: '주소록',      href: '/my/address-book', icon: Users2,        roles: ['employee', 'manager', 'admin'] },
      { label: '쪽지함',      href: '/my/messages',     icon: MessageSquare, roles: ['employee', 'manager', 'admin'] },
      { label: '노트',        href: '/my/notes',        icon: StickyNote,    roles: ['employee', 'manager', 'admin'] },
      { label: '녹음메모장',  href: '/my/voice-memos',  icon: Mic,           roles: ['employee', 'manager', 'admin'] },
      { label: '결재서명',    href: '/my/signature',    icon: PenLine,       roles: ['employee', 'manager', 'admin'] },
    ],
  },
  // ── 전자결재 ─────────────────────────────────────────────────────────────
  {
    key: 'approval',
    label: '전자결재',
    icon: CheckSquare,
    roles: ['employee', 'manager', 'admin'],
    items: [
      { label: '문서함',   href: '/documents', icon: FileText,    roles: ['employee', 'manager', 'admin'] },
      { label: '결재함',   href: '/approvals', icon: CheckSquare, roles: ['manager', 'admin'] },
    ],
  },
  // ── 인사/휴가 ────────────────────────────────────────────────────────────
  {
    key: 'hr',
    label: '인사 / 휴가',
    icon: Palmtree,
    roles: ['employee', 'manager', 'admin'],
    items: [
      { label: '휴가 신청',       href: '/leaves',          icon: Palmtree,   roles: ['employee', 'manager', 'admin'] },
      { label: '팀 휴가 캘린더',  href: '/leaves/calendar', icon: CalendarDays, roles: ['employee', 'manager', 'admin'] },
      { label: '휴가 승인',       href: '/leaves/manage',   icon: ShieldCheck, roles: ['manager', 'admin'] },
      { label: '급여 등록',       href: '/hr/payroll',      icon: Banknote,   roles: ['manager', 'admin'] },
      { label: '증명서 발급',     href: '/hr/certificates', icon: Award,      roles: ['manager', 'admin'] },
    ],
  },
  // ── 소방안전관리 ─────────────────────────────────────────────────────────
  {
    key: 'fire',
    label: '소방안전관리',
    icon: Flame,
    roles: ['employee', 'manager', 'admin'],
    items: [
      { label: '고객 관리',        href: '/customers',                  icon: BookUser,       roles: ['employee', 'manager', 'admin'] },
      { label: '건물 관리',        href: '/buildings',                  icon: Landmark,       roles: ['employee', 'manager', 'admin'] },
      { label: '지역별 담당 배정', href: '/customers/regional-assign',  icon: Users2,         roles: ['manager', 'admin'] },
      { label: '점검표 관리',      href: '/inspection-sheets',          icon: ClipboardList,  roles: ['employee', 'manager', 'admin'] },
      { label: '점검확정',          href: '/inspection-plans',           icon: TableProperties, roles: ['employee', 'manager', 'admin'] },
      { label: '점검 업무',        href: '/inspections',                icon: Flame,          roles: ['employee', 'manager', 'admin'] },
      { label: '점검 달력',        href: '/inspections/calendar',       icon: CalendarDays,   roles: ['employee', 'manager', 'admin'] },
      { label: '점검현황 모니터링',href: '/inspection-plans/monitor',   icon: BarChart2,      roles: ['employee', 'manager', 'admin'] },
      { label: '보고서 제출현황',  href: '/inspection-reports/status',  icon: FileCheck2,     roles: ['employee', 'manager', 'admin'] },
      { label: '이행계획서 등록',  href: '/action-plans',               icon: ClipboardList,  roles: ['employee', 'manager', 'admin'] },
      { label: '이행계획 제출현황',href: '/action-plans/status',        icon: ClipboardCheck, roles: ['employee', 'manager', 'admin'] },
      { label: '문의요청',         href: '/inquiries',                  icon: MessageCircle,  roles: ['employee', 'manager', 'admin'] },
      { label: '정산현황',         href: '/billing/status',             icon: Wallet,         roles: ['manager', 'admin'] },
      { label: '세금계산서 발행',  href: '/tax-invoices',               icon: Receipt,        roles: ['manager', 'admin'] },
    ],
  },
  // ── 업무관리 ─────────────────────────────────────────────────────────────
  {
    key: 'task',
    label: '업무관리',
    icon: NotebookPen,
    roles: ['employee', 'manager', 'admin'],
    items: [
      { label: '업무지시',    href: '/tasks',         icon: ClipboardCheck, roles: ['employee', 'manager', 'admin'] },
      { label: '업무일지',    href: '/tasks/journal', icon: NotebookPen,    roles: ['employee', 'manager', 'admin'] },
      { label: '차량 관리',  href: '/vehicles',       icon: Car,            roles: ['employee', 'manager', 'admin'] },
      { label: '차량운행일지',href: '/vehicles/log',  icon: Route,          roles: ['employee', 'manager', 'admin'] },
    ],
  },
  // ── 영업관리 ─────────────────────────────────────────────────────────────
  {
    key: 'sales',
    label: '영업관리',
    icon: FileSpreadsheet,
    roles: ['employee', 'manager', 'admin'],
    items: [
      { label: '견적 관리', href: '/quotes',          icon: FileSpreadsheet, roles: ['employee', 'manager', 'admin'] },
      { label: '수주 관리', href: '/orders',           icon: ShoppingCart,   roles: ['manager', 'admin'] },
      { label: '거래처 관리',href: '/partners',        icon: Handshake,      roles: ['manager', 'admin'] },
    ],
  },
  // ── 구매/재고 ─────────────────────────────────────────────────────────────
  {
    key: 'stock',
    label: '구매 / 재고',
    icon: Package,
    roles: ['manager', 'admin'],
    items: [
      { label: '발주 관리',  href: '/purchase-orders', icon: ShoppingCart,  roles: ['manager', 'admin'] },
      { label: '품목 관리',  href: '/items',            icon: Package,       roles: ['manager', 'admin'] },
      { label: '품목 분류',  href: '/item-categories',  icon: Tag,           roles: ['manager', 'admin'] },
      { label: '입고 등록',  href: '/stock/in',         icon: PackagePlus,   roles: ['manager', 'admin'] },
      { label: '출고 등록',  href: '/stock/out',        icon: PackageMinus,  roles: ['manager', 'admin'] },
      { label: '재고 현황',  href: '/stock/status',     icon: BarChart3,     roles: ['manager', 'admin'] },
      { label: '재고 조정',  href: '/stock/adjust',     icon: RefreshCw,     roles: ['manager', 'admin'] },
    ],
  },
  // ── 회계관리 ─────────────────────────────────────────────────────────────
  {
    key: 'accounting',
    label: '회계관리',
    icon: BookOpen,
    roles: ['manager', 'admin'],
    items: [
      { label: '전표 등록',     href: '/accounting/vouchers',          icon: BookOpen,    roles: ['manager', 'admin'] },
      { label: '손익계산서',    href: '/accounting/income-statement',  icon: TrendingUp,  roles: ['manager', 'admin'] },
      { label: '재무상태표',    href: '/accounting/balance-sheet',     icon: Scale,       roles: ['manager', 'admin'] },
      { label: '부가가치세',    href: '/accounting/vat',               icon: ReceiptText, roles: ['manager', 'admin'] },
    ],
  },
  // ── 게시판 ───────────────────────────────────────────────────────────────
  {
    key: 'board',
    label: '게시판',
    icon: LayoutList,
    roles: ['employee', 'manager', 'admin'],
    items: [
      { label: '게시판', href: '/board',               icon: LayoutList,  roles: ['employee', 'manager', 'admin'] },
      { label: '회의록', href: '/board/meeting-notes', icon: BookMarked,  roles: ['employee', 'manager', 'admin'] },
    ],
  },
  // ── 관리자 ───────────────────────────────────────────────────────────────
  {
    key: 'admin',
    label: '관리자',
    icon: Users,
    roles: ['admin'],
    items: [
      { label: '관리자 현황', href: '/admin',             icon: Users,      roles: ['admin'] },
      { label: '직원 관리',  href: '/admin/users',        icon: UserPlus,   roles: ['admin'] },
      { label: '부서 관리',  href: '/admin/departments',  icon: Building2,  roles: ['admin'] },
      { label: '공휴일 관리',href: '/admin/holidays',     icon: Umbrella,   roles: ['admin'] },
      { label: '본사 정보',  href: '/company',            icon: Building2,  roles: ['admin'] },
      { label: '활동 로그',  href: '/admin/logs',         icon: ClipboardList, roles: ['admin'] },
    ],
  },
]

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────
interface SidebarProps {
  role: UserRole
  /** 점검 달력 뱃지 — 지연/D-Day 건수 */
  redCount?: number
  /** 점검현황 모니터링 뱃지 — D-3 이내 건수 */
  orangeCount?: number
  /** 회사 정보(company_profile)의 업체명 — 미설정 시 기본 브랜드명 */
  companyName?: string
  /** 회사 정보의 로고 URL — 있으면 기본 아이콘 대신 표시 */
  logoUrl?: string | null
}

// href → 뱃지 매핑 (Victory10 §6 사이드바 카운터)
const BADGE_HREFS: Record<string, 'red' | 'orange'> = {
  '/inspections/calendar': 'red',
  '/inspection-plans/monitor': 'orange',
}

export function Sidebar({ role, redCount = 0, orangeCount = 0, companyName = '승진소방 ERP', logoUrl }: SidebarProps) {
  const pathname = usePathname()

  // 현재 경로가 속한 그룹 key 계산
  function getActiveGroup(): string {
    for (const g of NAV_GROUPS) {
      if (g.items.some(item => pathname === item.href || pathname.startsWith(item.href + '/'))) {
        return g.key
      }
    }
    return ''
  }

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set([getActiveGroup()]))

  useEffect(() => {
    const active = getActiveGroup()
    if (active) setOpenGroups(prev => new Set([...prev, active]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  function toggleGroup(key: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const isDashboard = pathname === '/dashboard'

  return (
    <aside className="w-56 shrink-0 flex flex-col h-full bg-white border-r-2 border-[#d4d0f0]">
      {/* 로고 */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b-2 border-[#d4d0f0]">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={companyName} className="size-7 rounded-lg object-contain shrink-0" />
        ) : (
          <div className="size-7 rounded-lg bg-[#7b68ee] flex items-center justify-center shrink-0">
            <svg className="size-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M4 6h16M4 18h16" />
            </svg>
          </div>
        )}
        <span className="font-bold text-[#090c1d] text-[14px] tracking-tight truncate">{companyName}</span>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto py-2">
        {/* 대시보드 — 단독 항목 */}
        <div className="px-2 mb-1">
          <Link
            href="/dashboard"
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isDashboard
                ? 'bg-[#7b68ee]/10 text-[#7b68ee]'
                : 'text-[#514b81] hover:bg-[#f5f4ff] hover:text-[#7b68ee]'
            )}
          >
            <LayoutDashboard className={cn('size-4 shrink-0', isDashboard ? 'text-[#7b68ee]' : 'text-[#b0acd6]')} />
            대시보드
          </Link>
        </div>

        {/* 그룹 목록 */}
        {NAV_GROUPS.map(group => {
          // 권한 필터
          if (!group.roles.includes(role)) return null
          const visibleItems = group.items.filter(item => item.roles.includes(role))
          if (visibleItems.length === 0) return null

          const isOpen = openGroups.has(group.key)
          const isGroupActive = visibleItems.some(
            item => pathname === item.href || pathname.startsWith(item.href + '/')
          )

          return (
            <div key={group.key} className="px-2">
              {/* 그룹 헤더 */}
              <button
                onClick={() => toggleGroup(group.key)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors mt-0.5',
                  isGroupActive
                    ? 'text-[#7b68ee] bg-[#f5f4ff]'
                    : 'text-[#374151] hover:bg-[#f5f4ff] hover:text-[#7b68ee]'
                )}
              >
                <group.icon className={cn('size-4 shrink-0', isGroupActive ? 'text-[#7b68ee]' : 'text-[#7c85a0]')} />
                <span className="flex-1 text-left">{group.label}</span>
                {isOpen
                  ? <ChevronDown className="size-3.5 text-[#8b87b8]" />
                  : <ChevronRight className="size-3.5 text-[#8b87b8]" />
                }
              </button>

              {/* 그룹 아이템 */}
              {isOpen && (
                <div className="ml-3 pl-3 border-l-2 border-[#c4bff5] mt-0.5 mb-1 space-y-0.5">
                  {visibleItems.map(item => {
                    const exactOnly = item.href === '/dashboard' || item.href === '/admin'
                    const isActive =
                      pathname === item.href ||
                      (!exactOnly && pathname.startsWith(item.href + '/'))

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors',
                          isActive
                            ? 'bg-[#7b68ee]/10 text-[#7b68ee]'
                            : 'text-[#6b7280] hover:bg-[#f5f4ff] hover:text-[#7b68ee]'
                        )}
                      >
                        <item.icon className={cn('size-3.5 shrink-0', isActive ? 'text-[#7b68ee]' : 'text-[#8b87b8]')} />
                        <span className="flex-1">{item.label}</span>
                        {BADGE_HREFS[item.href] === 'red' && redCount > 0 && (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                            {redCount > 99 ? '99+' : redCount}
                          </span>
                        )}
                        {BADGE_HREFS[item.href] === 'orange' && orangeCount > 0 && (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-400 text-white text-[10px] font-bold flex items-center justify-center">
                            {orangeCount > 99 ? '99+' : orangeCount}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* 하단 설정 */}
      <div className="px-2 py-2 border-t-2 border-[#d4d0f0]">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-[#6b7280] hover:bg-[#f5f4ff] hover:text-[#7b68ee] transition-colors"
        >
          <Settings className="size-4 text-[#8b87b8]" />
          설정
        </Link>
      </div>
    </aside>
  )
}
