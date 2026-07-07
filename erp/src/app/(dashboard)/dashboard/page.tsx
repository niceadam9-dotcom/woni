import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  FileText, CalendarDays, CheckSquare, ArrowRight,
  Flame, AlertTriangle, ClipboardList, Clock,
  TrendingUp, Banknote, CircleDollarSign, BarChart2,
  FileCheck2, ClipboardCheck, Megaphone, Pin,
} from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const leaveStatusLabel: Record<string, string> = {
  pending: '대기',
  manager_approved: '1차 승인',
  approved: '승인',
  rejected: '반려',
}

const leaveTypeLabel: Record<string, string> = {
  annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)',
  sick: '병가', special: '특별휴가',
}

type DueSoonItem = {
  stepId: string
  inspectionId: string
  stepNum: number
  stepName: string
  dueDate: string
  dDays: number
  customerName: string
  year: number
  sequenceNum: number
}

function fmtMoney(n: number) {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`
  if (n >= 10000) return `${Math.floor(n / 10000)}만`
  return n.toLocaleString('ko-KR')
}

export default async function DashboardPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const admin = createAdminClient()

  const isManagerOrAdmin = profile.role === 'manager' || profile.role === 'admin'
  const isEmployee = profile.role === 'employee'
  const isAdmin = profile.role === 'admin'

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const in7DaysStr = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  const yearStart = `${today.getFullYear()}-01-01`
  const yearEnd = `${today.getFullYear()}-12-31`

  // ── 기존 ERP 데이터 조회 ─────────────────────────────────────────
  const [pendingApprovalsRes, myLeavesRes, myDocsRes] = await Promise.all([
    isManagerOrAdmin
      ? supabase
          .from('document_approvers')
          .select('id', { count: 'exact', head: true })
          .eq('approver_id', profile.id)
          .eq('status', 'pending')
      : Promise.resolve({ count: 0, data: null, error: null }),
    supabase
      .from('leaves')
      .select('id, leave_type, start_date, end_date, status')
      .eq('employee_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', profile.id),
  ])

  const pendingCount = pendingApprovalsRes.count ?? 0
  const myLeaves = (myLeavesRes.data ?? []) as Array<{
    id: string; leave_type: string; start_date: string; end_date: string; status: string
  }>
  const myDocCount = myDocsRes.count ?? 0

  // ── 소방 점검 데이터 조회 ────────────────────────────────────────
  const { data: myInspRaw } = await (
    isEmployee
      ? admin.from('inspections').select('id, status').eq('assigned_employee_id', profile.id)
      : admin.from('inspections').select('id, status')
  )

  type InspRow = { id: string; status: string }
  const myInspList = (myInspRaw ?? []) as InspRow[]
  const myInspIds = myInspList.map(i => i.id)

  const inspStats = { scheduled: 0, in_progress: 0, completed: 0, overdue: 0 }
  for (const i of myInspList) {
    const s = i.status as keyof typeof inspStats
    if (s in inspStats) inspStats[s]++
  }

  let dueSoonList: DueSoonItem[] = []
  let overdueStepCount = 0
  let todayStepCount = 0

  if (myInspIds.length > 0) {
    // inspection_steps → inspections → customers 를 JOIN 1회로 처리 (기존 직렬 3-hop 제거)
    type DueSoonRaw = {
      id: string; inspection_id: string; step_num: number; name_ko: string; due_date: string
      inspection: { id: string; year: number; sequence_num: number; customer: { customer_name: string } | null } | null
    }

    const [dueSoonRes, overdueRes, todayRes] = await Promise.all([
      admin.from('inspection_steps')
        .select('id, inspection_id, step_num, name_ko, due_date, inspection:inspections(id, year, sequence_num, customer:customers(customer_name))')
        .in('inspection_id', myInspIds)
        .gte('due_date', todayStr)
        .lte('due_date', in7DaysStr)
        .neq('status', 'completed')
        .order('due_date')
        .limit(7),
      admin.from('inspection_steps')
        .select('id, inspection_id')
        .in('inspection_id', myInspIds)
        .lt('due_date', todayStr)
        .neq('status', 'completed'),
      admin.from('inspection_steps')
        .select('id', { count: 'exact', head: true })
        .in('inspection_id', myInspIds)
        .eq('due_date', todayStr)
        .neq('status', 'completed'),
    ])

    const overdueSteps = (overdueRes.data ?? []) as Array<{ id: string; inspection_id: string }>
    overdueStepCount = overdueSteps.length
    // 기한 초과 단계가 있는 점검 건수 → 나의 점검현황 기한초과와 일치시킴
    inspStats.overdue = new Set(overdueSteps.map(s => s.inspection_id)).size
    todayStepCount = todayRes.count ?? 0

    dueSoonList = ((dueSoonRes.data ?? []) as unknown as DueSoonRaw[]).map(s => {
      const insp = s.inspection
      const dDays = Math.round(
        (new Date(s.due_date).getTime() - new Date(todayStr).getTime()) / 86400000
      )
      return {
        stepId: s.id, inspectionId: s.inspection_id,
        stepNum: s.step_num, stepName: s.name_ko,
        dueDate: s.due_date, dDays,
        customerName: insp?.customer?.customer_name ?? '—',
        year: insp?.year ?? 0, sequenceNum: insp?.sequence_num ?? 1,
      }
    })
  }

  // ── 공지사항 조회 (전체 역할) ───────────────────────────────────
  const { data: boardNoticesRaw } = await admin
    .from('board_posts')
    .select('id, title, created_at, author:author_id(name)')
    .eq('is_notice', true)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(5)

  type NoticeRow = { id: string; title: string; created_at: string; author: { name: string } | null }
  const boardNotices = (boardNoticesRaw ?? []) as unknown as NoticeRow[]

  // ── 관리자 전용 집계 ─────────────────────────────────────────────
  let adminStats: {
    totalDocs: number; pendingDocs: number
    totalEmployees: number; pendingLeaves: number
  } | null = null

  if (isAdmin) {
    const [totalDocsRes, pendingDocsRes, employeesRes, pendingLeavesRes] = await Promise.all([
      admin.from('documents').select('id', { count: 'exact', head: true }),
      admin.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
      admin.from('leaves').select('id', { count: 'exact', head: true }).in('status', ['pending', 'manager_approved']),
    ])
    adminStats = {
      totalDocs: totalDocsRes.count ?? 0,
      pendingDocs: pendingDocsRes.count ?? 0,
      totalEmployees: employeesRes.count ?? 0,
      pendingLeaves: pendingLeavesRes.count ?? 0,
    }
  }

  // ── 소방업무 KPI (manager/admin) ────────────────────────────────
  type BillKpi = { total_amount: number; paid_amount: number; paid_at: string | null; bill_date: string }
  type PendingReportRow = {
    id: string
    notification_due_date: string | null
    inspection_plan_items: {
      inspection_date: string | null
      customers: { customer_name: string } | null
    } | null
  }
  type PendingActionRow = {
    id: string
    completion_target_date: string | null
    inspections: {
      inspection_start_date: string | null
      customers: { customer_name: string } | null
    } | null
  }

  let kpiBills: BillKpi[] = []
  let pendingReports: PendingReportRow[] = []
  let pendingActions: PendingActionRow[] = []

  if (isManagerOrAdmin) {
    const [billsRes, reportsRes, actionsRes] = await Promise.all([
      admin
        .from('bills')
        .select('total_amount, paid_amount, paid_at, bill_date')
        .gte('bill_date', yearStart)
        .lte('bill_date', yearEnd),
      admin
        .from('inspection_report_status')
        .select(`
          id, notification_due_date,
          inspection_plan_items:plan_item_id (
            inspection_date,
            customers:customer_id ( customer_name )
          )
        `)
        .eq('fire_station_submitted', false)
        .not('inspection_completed_at', 'is', null)
        .order('notification_due_date', { ascending: true })
        .limit(5),
      admin
        .from('action_plans')
        .select(`
          id, completion_target_date,
          inspections:inspection_id (
            inspection_start_date,
            customers:customer_id ( customer_name )
          )
        `)
        .is('submitted_at', null)
        .order('completion_target_date', { ascending: true })
        .limit(5),
    ])

    kpiBills = (billsRes.data ?? []) as BillKpi[]
    pendingReports = (reportsRes.data ?? []) as unknown as PendingReportRow[]
    pendingActions = (actionsRes.data ?? []) as unknown as PendingActionRow[]
  }

  // 금년 매출누계 / 금년 미납누계 / 금월 미납건수
  const yearRevenue = kpiBills.reduce((s, b) => s + b.total_amount, 0)
  const yearUnpaid  = kpiBills
    .filter(b => b.paid_at === null)
    .reduce((s, b) => s + (b.total_amount - b.paid_amount), 0)
  const monthStr = todayStr.slice(0, 7)
  const monthUnpaidCount = kpiBills.filter(
    b => b.bill_date.startsWith(monthStr) && b.paid_at === null
  ).length

  const totalInsp = myInspList.length
  const inspLabel = isEmployee ? '나의 점검' : '전체 점검'

  const cardShadow = 'shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">안녕하세요, {profile.name}님</h1>
        <p className="text-sm text-[#514b81] mt-1">오늘의 업무 현황입니다.</p>
      </div>

      {/* ── 소방업무 KPI 카드 (manager/admin) ──────────── */}
      {isManagerOrAdmin && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: '금년 매출누계', value: fmtMoney(yearRevenue),
              sub: `${today.getFullYear()}년 청구 기준`, icon: TrendingUp, color: 'text-emerald-600',
            },
            {
              label: '금년 미납누계', value: fmtMoney(yearUnpaid),
              sub: '미입금 청구 합계', icon: CircleDollarSign, color: 'text-red-500',
            },
            {
              label: '금월 미납건수', value: `${monthUnpaidCount}건`,
              sub: `${monthStr} 미납`, icon: Banknote, color: 'text-amber-600',
            },
            {
              label: '이행보고서 대기', value: `${pendingActions.length}건`,
              sub: '소방서 제출 전', icon: BarChart2, color: 'text-[#7b68ee]',
            },
          ].map(k => (
            <div key={k.label} className={`bg-white rounded-xl border border-[#c8c4d0] p-5 ${cardShadow}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-[#514b81] uppercase tracking-wide">{k.label}</p>
                <k.icon className={`size-4 ${k.color}`} />
              </div>
              <p className={`text-3xl font-bold ${k.color} mt-1`}>{k.value}</p>
              <p className="text-xs text-[#b0acd6] mt-1">{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── 소방 단계 KPI (오늘 마감 / 지연) ──────────── */}
      {isManagerOrAdmin && (
        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/inspections/calendar?filter=today"
            className={`bg-white rounded-xl border border-[#c8c4d0] p-5 ${cardShadow} hover:border-orange-200 transition-colors`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-[#514b81] uppercase tracking-wide">오늘 마감</p>
              <Clock className={`size-4 ${todayStepCount > 0 ? 'text-orange-500' : 'text-[#b0acd6]'}`} />
            </div>
            <p className={`text-3xl font-bold mt-1 ${todayStepCount > 0 ? 'text-orange-500' : 'text-[#b0acd6]'}`}>
              {todayStepCount}<span className="text-base font-medium ml-1">건</span>
            </p>
            <p className="text-xs text-[#b0acd6] mt-1">오늘 마감 미완료 단계</p>
          </Link>
          <Link
            href="/inspections/calendar?filter=overdue"
            className={`bg-white rounded-xl border border-[#c8c4d0] p-5 ${cardShadow} hover:border-red-200 transition-colors`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-[#514b81] uppercase tracking-wide">지연</p>
              <AlertTriangle className={`size-4 ${overdueStepCount > 0 ? 'text-red-500' : 'text-[#b0acd6]'}`} />
            </div>
            <p className={`text-3xl font-bold mt-1 ${overdueStepCount > 0 ? 'text-red-500' : 'text-[#b0acd6]'}`}>
              {overdueStepCount}<span className="text-base font-medium ml-1">건</span>
            </p>
            <p className="text-xs text-[#b0acd6] mt-1">기한 초과 미완료 단계</p>
          </Link>
        </div>
      )}

      {/* ── 상단 ERP 카드 ─────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`bg-white rounded-xl border border-[#c8c4d0] p-5 ${cardShadow}`}>
          <p className="text-xs font-medium text-[#514b81] uppercase tracking-wide">내 문서</p>
          <p className="text-3xl font-bold text-[#7b68ee] mt-2">{myDocCount}</p>
          <p className="text-xs text-[#b0acd6] mt-1">기안서 전체</p>
        </div>

        {isManagerOrAdmin && (
          <div className={`bg-white rounded-xl border border-[#c8c4d0] p-5 ${cardShadow}`}>
            <p className="text-xs font-medium text-[#514b81] uppercase tracking-wide">미결재</p>
            <p className="text-3xl font-bold text-[#7b68ee] mt-2">{pendingCount}</p>
            <p className="text-xs text-[#b0acd6] mt-1">결재 대기 건</p>
          </div>
        )}

        <div className={`bg-white rounded-xl border border-[#c8c4d0] p-5 ${cardShadow}`}>
          <p className="text-xs font-medium text-[#514b81] uppercase tracking-wide">내 휴가</p>
          <p className="text-3xl font-bold text-[#7b68ee] mt-2">{myLeaves.length}</p>
          <p className="text-xs text-[#b0acd6] mt-1">최근 신청</p>
        </div>

        {isAdmin && adminStats && (
          <div className={`bg-white rounded-xl border border-[#c8c4d0] p-5 ${cardShadow}`}>
            <p className="text-xs font-medium text-[#514b81] uppercase tracking-wide">전체 직원</p>
            <p className="text-3xl font-bold text-[#7b68ee] mt-2">{adminStats.totalEmployees}</p>
            <p className="text-xs text-[#b0acd6] mt-1">활성 계정</p>
          </div>
        )}
      </div>

      {/* ── 나의 점검 현황 ────────────────────────────── */}
      <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow} overflow-hidden`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
          <div className="flex items-center gap-2">
            <Flame className="size-4 text-[#7b68ee]" />
            <h2 className="text-sm font-semibold text-[#090c1d]">{inspLabel} 현황</h2>
            <span className="text-xs text-[#b0acd6]">전체 {totalInsp}건</span>
          </div>
          <Link href="/inspections" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
            전체보기 <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="grid grid-cols-4 divide-x divide-[#e0ddf5]">
          {[
            { label: '예정', value: inspStats.scheduled, color: 'text-blue-600' },
            { label: '진행중', value: inspStats.in_progress, color: 'text-[#7b68ee]' },
            { label: '완료', value: inspStats.completed, color: 'text-green-700' },
            { label: '기한초과', value: inspStats.overdue, color: 'text-red-600', isAlert: true },
          ].map(({ label, value, color, isAlert }) => (
            <Link
              key={label}
              href={label === '기한초과' ? '/inspections/calendar?filter=overdue' : `/inspections?status=${label === '예정' ? 'scheduled' : label === '진행중' ? 'in_progress' : 'completed'}`}
              className="flex flex-col items-center py-5 hover:bg-[#fafafa] transition-colors"
            >
              <p className="text-xs text-[#514b81] mb-2">{label}</p>
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
              {isAlert && value > 0 && (
                <span className="text-[10px] text-red-500 mt-1 font-medium flex items-center gap-0.5">
                  <AlertTriangle className="size-2.5" />즉시 확인
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* ── 소방업무 위젯 (manager/admin) ─────────────── */}
      {isManagerOrAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 점검보고서 제출대기 */}
          <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
              <div className="flex items-center gap-2">
                <FileCheck2 className="size-4 text-blue-500" />
                <h2 className="text-sm font-semibold text-[#090c1d]">점검보고서 제출대기</h2>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                  {pendingReports.length}건
                </span>
              </div>
              <Link href="/inspection-reports/status" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
                전체보기 <ArrowRight className="size-3" />
              </Link>
            </div>
            {pendingReports.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-[#b0acd6]">제출 대기 건이 없습니다</p>
              </div>
            ) : (
              <div className="divide-y divide-[#f8f9fa]">
                {pendingReports.map(r => {
                  const item = r.inspection_plan_items
                  const isOverdue = r.notification_due_date && r.notification_due_date < todayStr
                  return (
                    <div key={r.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{item?.customers?.customer_name ?? '—'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">점검일: {item?.inspection_date ?? '—'}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs font-medium ${isOverdue ? 'text-red-500' : 'text-gray-500'}`}>
                          {r.notification_due_date ? `신고예정: ${r.notification_due_date}` : '—'}
                        </p>
                        {isOverdue && (
                          <span className="text-[10px] text-red-400 flex items-center justify-end gap-0.5 mt-0.5">
                            <AlertTriangle className="size-2.5" /> 기한초과
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 이행보고서 제출대기 */}
          <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-[#090c1d]">이행계획 제출대기</h2>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
                  {pendingActions.length}건
                </span>
              </div>
              <Link href="/action-plans/status" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
                전체보기 <ArrowRight className="size-3" />
              </Link>
            </div>
            {pendingActions.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-[#b0acd6]">제출 대기 건이 없습니다</p>
              </div>
            ) : (
              <div className="divide-y divide-[#f8f9fa]">
                {pendingActions.map(a => {
                  type InspJoin = { inspection_start_date: string | null; customers: { customer_name: string } | null } | null
                  const insp = a.inspections as InspJoin
                  const isOverdue = a.completion_target_date && a.completion_target_date < todayStr
                  return (
                    <div key={a.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{insp?.customers?.customer_name ?? '—'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          점검일: {insp?.inspection_start_date ?? '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs font-medium ${isOverdue ? 'text-red-500' : 'text-gray-500'}`}>
                          {a.completion_target_date ? `완료목표: ${a.completion_target_date}` : '기한 미지정'}
                        </p>
                        {isOverdue && (
                          <span className="text-[10px] text-red-400 flex items-center justify-end gap-0.5 mt-0.5">
                            <AlertTriangle className="size-2.5" /> 기한초과
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 이번 주 마감 임박 + 기한 초과 ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-[#090c1d]">마감 임박</h2>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">D-7 이내</span>
            </div>
            <Link href="/inspections/calendar?filter=week" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
              달력 <ArrowRight className="size-3" />
            </Link>
          </div>

          {dueSoonList.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[#b0acd6]">이번 주 마감 예정 단계가 없습니다</p>
            </div>
          ) : (
            <div className="divide-y divide-[#f8f9fa]">
              {dueSoonList.map(item => {
                const dLabel = item.dDays === 0 ? 'D-Day' : `D-${item.dDays}`
                const urgentCls = item.dDays === 0
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : item.dDays <= 2
                  ? 'bg-orange-50 text-orange-600'
                  : item.dDays <= 6
                  ? 'bg-yellow-50 text-yellow-700'
                  : 'bg-green-50 text-green-700'

                return (
                  <Link
                    key={item.stepId}
                    href={`/inspections/${item.inspectionId}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-[#fafafa] transition-colors"
                  >
                    <div className="size-6 rounded-full bg-[#f5f4ff] flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-[#7b68ee]">{item.stepNum}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#090c1d] truncate">{item.stepName}</p>
                      <p className="text-xs text-[#514b81] truncate">
                        {item.customerName}
                        <span className="text-[#b0acd6] mx-1">·</span>
                        {item.year}년 {item.sequenceNum}차
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${urgentCls}`}>
                        {dLabel}
                      </span>
                      <span className="text-[10px] text-[#b0acd6]">{item.dueDate}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow} flex flex-col`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-500" />
              <h2 className="text-sm font-semibold text-[#090c1d]">기한 초과</h2>
            </div>
            <Link href="/inspections/calendar?filter=overdue" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
              확인하기 <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center py-8 gap-3">
            {overdueStepCount > 0 ? (
              <>
                <div className="relative">
                  <div className="size-20 rounded-full bg-red-50 border-4 border-red-100 flex items-center justify-center">
                    <span className="text-3xl font-bold text-red-600">{overdueStepCount}</span>
                  </div>
                  <span className="absolute -top-1 -right-1 size-5 rounded-full bg-red-500 flex items-center justify-center">
                    <AlertTriangle className="size-3 text-white" />
                  </span>
                </div>
                <p className="text-sm font-medium text-[#090c1d]">{overdueStepCount}개 단계가 기한을 초과했습니다</p>
                <p className="text-xs text-[#514b81] text-center px-4">
                  {isEmployee ? '담당 점검' : '전체 점검'} 중 미완료 단계 기준
                </p>
                <Link
                  href="/inspections/calendar?filter=overdue"
                  className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <ClipboardList className="size-3.5" /> 기한초과 단계 목록 보기
                </Link>
              </>
            ) : (
              <>
                <div className="size-16 rounded-full bg-green-50 flex items-center justify-center">
                  <CheckSquare className="size-8 text-green-500" />
                </div>
                <p className="text-sm font-medium text-green-700">기한 초과 단계 없음</p>
                <p className="text-xs text-[#514b81]">모든 단계가 정상 진행 중입니다</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 관리자 전용 요약 현황 ────────────────────── */}
      {isAdmin && adminStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-[#7b68ee]" />
                <h2 className="text-sm font-semibold text-[#090c1d]">전체 문서 현황</h2>
              </div>
              <Link href="/admin" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
                더 보기 <ArrowRight className="size-3" />
              </Link>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-[#514b81]">전체 기안서</p>
                <p className="text-xl font-bold text-[#090c1d] mt-0.5">{adminStats.totalDocs}<span className="text-sm font-normal ml-1">건</span></p>
              </div>
              <div>
                <p className="text-xs text-[#514b81]">결재 대기</p>
                <p className="text-xl font-bold text-blue-600 mt-0.5">{adminStats.pendingDocs}<span className="text-sm font-normal ml-1">건</span></p>
              </div>
            </div>
          </div>

          <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-[#7b68ee]" />
                <h2 className="text-sm font-semibold text-[#090c1d]">금주 휴가 현황</h2>
              </div>
              <Link href="/admin" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
                더 보기 <ArrowRight className="size-3" />
              </Link>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-[#514b81]">승인 대기 휴가</p>
                <p className="text-xl font-bold text-orange-500 mt-0.5">{adminStats.pendingLeaves}<span className="text-sm font-normal ml-1">건</span></p>
              </div>
              <div>
                <p className="text-xs text-[#514b81]">바로가기</p>
                <Link href="/leaves/manage" className="text-sm font-medium text-[#7b68ee] hover:underline mt-0.5 block">
                  휴가 승인 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 최근 휴가 신청 ───────────────────────────── */}
      {myLeaves.length > 0 && (
        <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-[#7b68ee]" />
              <h2 className="text-sm font-semibold text-[#090c1d]">최근 휴가 신청</h2>
            </div>
            <Link href="/leaves" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
              전체보기 <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="divide-y divide-[#c8c4d0]">
            {myLeaves.map((leave) => (
              <div key={leave.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <span className="text-sm font-medium text-[#090c1d]">
                    {leaveTypeLabel[leave.leave_type] ?? leave.leave_type}
                  </span>
                  <span className="text-xs text-[#514b81] ml-2">
                    {leave.start_date} ~ {leave.end_date}
                  </span>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  leave.status === 'approved' ? 'bg-green-50 text-green-700'
                  : leave.status === 'rejected' ? 'bg-red-50 text-red-600'
                  : 'bg-[#f5f4ff] text-[#7b68ee]'
                }`}>
                  {leaveStatusLabel[leave.status] ?? leave.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 공지사항 위젯 ────────────────────────────── */}
      <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-[#7b68ee]" />
            <h2 className="text-sm font-semibold text-[#090c1d]">공지사항</h2>
            {boardNotices.length > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">
                {boardNotices.length}건
              </span>
            )}
          </div>
          <Link href="/board" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
            전체보기 <ArrowRight className="size-3" />
          </Link>
        </div>
        {boardNotices.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-[#b0acd6]">등록된 공지사항이 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f8f9fa]">
            {boardNotices.map(n => (
              <Link
                key={n.id}
                href={`/board/${n.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-[#fafafa] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Pin className="size-3 text-[#7b68ee] shrink-0" />
                  <p className="text-sm font-medium text-[#090c1d] truncate">{n.title}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-xs text-[#514b81]">{n.author?.name ?? '—'}</span>
                  <span className="text-xs text-[#b0acd6]">{n.created_at.slice(0, 10)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── 결재 대기 배너 ───────────────────────────── */}
      {isManagerOrAdmin && pendingCount > 0 && (
        <div className="bg-[#f5f4ff] border border-[#c8c4d0] rounded-xl px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckSquare className="size-5 text-[#7b68ee]" />
            <span className="text-sm font-medium text-[#090c1d]">
              결재 대기 중인 문서가 <span className="text-[#7b68ee] font-bold">{pendingCount}건</span> 있습니다.
            </span>
          </div>
          <Link href="/approvals" className="text-sm font-medium text-[#7b68ee] hover:underline flex items-center gap-1">
            결재하러 가기 <ArrowRight className="size-3" />
          </Link>
        </div>
      )}
    </div>
  )
}
