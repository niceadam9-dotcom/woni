import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  FileText, CalendarDays, CheckSquare, ArrowRight,
  Flame, AlertTriangle, ClipboardList, Clock,
  TrendingUp, Banknote, CircleDollarSign, BarChart2,
  FileCheck2, ClipboardCheck, Megaphone, Pin,
} from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDocTodo } from '@/lib/doc-status'
import { DocTodoWidget } from '@/components/reports/doc-todo-widget'
import { SubmissionWidget } from '@/components/reports/submission-widget'
import { countUnsentNotices } from '@/lib/sms'
import { SmsNoticeWidget } from '@/components/sms/sms-notice-widget'
import { fetchInputTodo } from '@/lib/customer-list'
import { fetchAllRows, fetchAllRowsByIds } from '@/lib/supabase/paginate'
import { activeStepsByInspection, isStepVisible } from '@/lib/active-steps'
/* 이행기간 종료일 판정 — 작업대·별지 10·11호·갑지 엑셀이 쓰는 그 함수(사본 금지) */
import { repairEndISO } from '@/lib/annex-due'
import type { UserRole } from '@/types'

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

  // 문서 할 일 위젯 (소방계획서_5 R0-9) — 권한 있는 직원만, 판정은 lib/doc-status 1곳 공유
  const canDoc = can(profile.role as UserRole, 'inspection_register')
  // 사전 안내 위젯 (소방계획서_24 S9-5) — 사이드바 뱃지·문자 발송 화면 배너와 **같은 함수**로 센다.
  // 실측 ~500ms라 문서 할 일 조회와 **병렬로** 묶는다(직렬로 붙이면 대시보드가 그만큼 느려진다).
  // 실패해도 대시보드가 죽지 않게 한다 — 다만 **null로 물러나면 위젯이 통째로 사라져
  // '오늘 보낼 안내가 없다'와 구별되지 않는다**(위젯 파일 주석이 금지한 바로 그 상태를
  // 호출부가 만들고 있었다). 실패는 실패로 표시하도록 error 객체를 넘긴다.
  const canSms = can(profile.role as UserRole, 'inspection_sms_send')
  const [docTodo, inputTodo, smsNotice] = await Promise.all([
    canDoc ? getDocTodo(admin) : Promise.resolve(null),
    canDoc ? fetchInputTodo(admin) : Promise.resolve([]),   // §4-D H-26 입력 미완료 큐
    canSms
      ? countUnsentNotices(admin).catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
      }))
      : Promise.resolve(null),
  ])

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
  // 삭제(비활성) 고객 제외(소방계획서_30 S2-2) — 이 목록이 점검현황·마감임박·기한초과의 뿌리라
  // 여기서 걸러야 사이드바 뱃지(layout.tsx)와 수가 어긋나지 않는다. FK 힌트는 PGRST201 방지
  // 🎯 4차 독립 판정 R-6: 이 **상류**가 미포장이었다 — 세 줄 아래 주석이 스스로 「myInspIds는
  // manager/admin이면 전 점검이라 수천이다」라고 적어 놓고 1000행 상한에 안 대비했다.
  // 하류를 아무리 `fetchAllRowsByIds`로 풀어도 상류에서 없어진 행은 못 살린다 — 이 차수가 크론에서
  // 「상류를 풀었으면 하류도」라고 쓴 것의 정확한 역상이다. inspStats(예정/진행/완료 카드)·기한초과·
  // 오늘·마감임박이 **전부** 이 목록에서 나온다.
  const inspCols = 'id, status, customers:customer_id!inner(is_active)'
  const myInspRes = await fetchAllRows<{ id: string; status: string }>((from, to) => (
    isEmployee
      ? admin.from('inspections').select(inspCols).eq('customers.is_active', true).eq('assigned_employee_id', profile.id).order('id').range(from, to)
      : admin.from('inspections').select(inspCols).eq('customers.is_active', true).order('id').range(from, to)
  ))
  if (myInspRes.error || myInspRes.truncated) {
    console.error('[dashboard] 점검 목록 조회 불완전 — 현황·마감임박·기한초과가 과소 집계됩니다', myInspRes.error)
  }

  type InspRow = { id: string; status: string }
  const myInspList = myInspRes.rows as InspRow[]
  const myInspIds = myInspList.map(i => i.id)

  const inspStats = { scheduled: 0, in_progress: 0, completed: 0, overdue: 0 }
  for (const i of myInspList) {
    const s = i.status as keyof typeof inspStats
    if (s in inspStats) inspStats[s]++
  }

  /** 마감임박 위젯은 7건을 보여준다. 해당없음(⑤⑥)이 섞여 있을 수 있으므로 **거르기 전에** 여유분을
   *  받아 온다 — 7건만 받아 뒤에서 거르면 목록이 7보다 줄어 "임박한 일이 적다"로 보인다. */
  const DUE_SOON_SHOW = 7

  let dueSoonList: DueSoonItem[] = []
  let overdueStepCount = 0
  let todayStepCount = 0

  if (myInspIds.length > 0) {
    // inspection_steps → inspections → customers 를 JOIN 1회로 처리 (기존 직렬 3-hop 제거)
    type DueSoonRaw = {
      id: string; inspection_id: string; step_num: number; name_ko: string; due_date: string
      inspection: { id: string; year: number; sequence_num: number; customer: { customer_name: string } | null } | null
    }

    // 🎯 소방계획서_45 §S11(Q-6 유예분) — 세 수치 모두 `activeStepNums` 필터가 **없었다**.
    // 점검표 모두 합격이라 화면에서 '해당없음'인 ⑤⑥이 「마감 임박」·「기한 초과」로 계속 뜨고,
    // 그 회차가 '나의 점검현황 기한초과'까지 부풀렸다 — 크론이 고친 것과 같은 거짓말이다.
    //
    // ⚠ `.limit(7)`을 **먼저** 걸면 안 된다: 7건을 받아 뒤에서 거르면 해당없음이 섞인 만큼
    // 목록이 7보다 줄어 "임박한 일이 적다"로 보인다. 여유분(40)을 받아 거른 뒤 7건으로 자른다.
    // ⚠ 기한초과 조회는 미포장이었다 — 개수의 원천이라 잘리면 그대로 과소 집계된다.
    const [dueSoonRes, overdueRes, todayRes] = await Promise.all([
      // ⚠ `.limit(N)`은 쪼갠 조각마다 걸리므로 여기서는 쓰지 않는다 — 창(窓)이 7일로 좁아
      // 행수가 유계이고, 자르는 일은 아래에서 **거른 뒤에** 한다(그래야 7건이 7건으로 남는다).
      fetchAllRowsByIds<Record<string, unknown>, string>(
        myInspIds, (c, from, to) => admin.from('inspection_steps')
          .select('id, inspection_id, step_num, name_ko, due_date, inspection:inspections(id, year, sequence_num, customer:customers(customer_name))')
          .in('inspection_id', c)
          .gte('due_date', todayStr)
          .lte('due_date', in7DaysStr)
          .neq('status', 'completed')
          .order('id').range(from, to)),
      // ⚠ myInspIds는 manager/admin이면 **전 점검**이라 수천이다 — `.in()`은 400건부터 URL 한계로
      // 요청이 실패하므로(§S12 실측) 쪼개 보낸다. 종전에도 같은 형태였으니 이 수치들은 규모가
      // 커진 시점부터 조용히 0이 되고 있었을 수 있다(대시보드는 error를 안 봤다).
      fetchAllRowsByIds<{ id: string; inspection_id: string; step_num: number }, string>(
        myInspIds, (c, from, to) => admin.from('inspection_steps')
          .select('id, inspection_id, step_num')
          .in('inspection_id', c)
          .lt('due_date', todayStr)
          .neq('status', 'completed')
          .order('id').range(from, to)),
      fetchAllRowsByIds<{ id: string; inspection_id: string; step_num: number }, string>(
        myInspIds, (c, from, to) => admin.from('inspection_steps')
          .select('id, inspection_id, step_num')
          .in('inspection_id', c)
          .eq('due_date', todayStr)
          .neq('status', 'completed')
          .order('id').range(from, to)),
    ])

    // ⚠ R-7(4차 판정): 이 파일이 **이 커밋에서 error/truncated를 한 번도 안 보는 유일한 표면**이었다.
    // 한 조각만 실패해도 `rows`는 부분인데 화면은 「기한초과 0건」이라는 **거짓 평온**을 그린다.
    // 나머지 다섯 표면(달력·고객목록·크론·목록·고객상세)이 세운 기울기와 반대였다.
    if (dueSoonRes.error || dueSoonRes.truncated || overdueRes.error || overdueRes.truncated
      || todayRes.error || todayRes.truncated) {
      console.error('[dashboard] 단계 조회 불완전 — 마감임박·기한초과·오늘 수치가 과소 집계됩니다',
        dueSoonRes.error, overdueRes.error, todayRes.error)
    }

    // 조각마다 id 정렬로 받았으므로(페이징 규약) 마감일 순서는 여기서 세운다 — 조각을 이어 붙인
    // 배열은 날짜 순이 아니다. 정렬 전에 자르면 "가장 임박한 7건"이 아니게 된다.
    const dueSoonRaw = (dueSoonRes.rows as unknown as DueSoonRaw[])
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
    // 세 창(窓)의 점검을 한 번에 판정한다 — 화면 안에서 축이 갈라지지 않게 한 벌만 쓴다
    const active = await activeStepsByInspection(admin, [...new Set([
      ...dueSoonRaw.map(s => s.inspection_id),
      ...overdueRes.rows.map(s => s.inspection_id),
      ...todayRes.rows.map(s => s.inspection_id),
    ])], 'dashboard')

    // 소방계획서_48 — 대시보드 세 창은 **표시 축**(불량 0이면 ④도 즉시 감춤). 15일 보고 알림은 크론(의무 축)이 맡는다.
    const overdueSteps = overdueRes.rows.filter(s => isStepVisible(active, s.inspection_id, s.step_num))
    overdueStepCount = overdueSteps.length
    // 기한 초과 단계가 있는 점검 건수 → 나의 점검현황 기한초과와 일치시킴
    inspStats.overdue = new Set(overdueSteps.map(s => s.inspection_id)).size
    todayStepCount = todayRes.rows.filter(s => isStepVisible(active, s.inspection_id, s.step_num)).length

    dueSoonList = dueSoonRaw
      .filter(s => isStepVisible(active, s.inspection_id, s.step_num))
      .slice(0, DUE_SOON_SHOW)
      .map(s => {
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
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('is_system', false),
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
      // ⚠ 종전 이름은 inspection_date였는데 그런 컬럼은 없다 — 아래 쿼리가 42703으로 통째로
      //   실패해 이 위젯이 **줄곧 비어 있었다**(2026-08-29 실측). 실제 컬럼은 scheduled_date.
      scheduled_date: string | null
      customers: { customer_name: string } | null
    } | null
  }
  /** 이행 진행 중(불량 있고 ⑥ 미제출) — `completionTargetDate`는 **저장값이 아니라 파생값**이다
   *  (이행기간 종료일). 종전 `action_plans.completion_target_date`를 대체한다. */
  type PendingActionRow = {
    id: string
    customerName: string | null
    inspectionDate: string | null
    targetDate: string | null
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
        // D-8: 비활성 고객 제외. 자동취소는 planned/confirmed만 만지므로 **완료·미제출** 행은
        // 그대로 남는다 — 이 위젯이 고르는 상태가 정확히 그것이라 필터 없이는 되살아난다.
        // 중첩 임베드는 층마다 !inner여야 필터가 걸린다(FK 힌트 유지로 PGRST201 방지).
        .select(`
          id, notification_due_date,
          inspection_plan_items:plan_item_id!inner (
            scheduled_date,
            customers:customer_id!inner ( customer_name, is_active )
          )
        `)
        .eq('inspection_plan_items.customers.is_active', true)
        .eq('fire_station_submitted', false)
        .not('inspection_completed_at', 'is', null)
        .order('notification_due_date', { ascending: true })
        .limit(5),
      /* 🚨 2026-09-11 축 교체 — 종전엔 `action_plans`(옛 체계)를 읽었다. 그 테이블은 「이행계획
       *   자동생성」 버튼이 만든 **빈 행**만 들고 있었고(운영 실측 2건, 완료목표일 전부 null),
       *   문서 조립기는 그것을 한 번도 읽지 않는다. 그래서 이 카드가 늘 「기한 미지정」이었다.
       *
       *   이제 현행 축을 읽는다: **불량이 있고 ⑥(별지 11호) 미제출인 회차**.
       *   완료목표일은 저장하지 않고 `repairEndISO`로 **파생**한다 — 별지 10·11호 PDF와 갑지
       *   엑셀이 쓰는 바로 그 함수라, ④에서 총 이행기간을 고치면 이 카드가 즉시 따라온다.
       *   (두 곳에 쓰고 맞추는 「동기화」를 하지 않는 이유: 어긋날 수 있는 두 값을 만들지 않는다.)
       *
       *   ⚠ 정렬이 파생값이라 DB에서 못 한다 — 넉넉히 받아 아래에서 자른다. */
      admin
        .from('inspections')
        // D-8: 위와 같은 축 — 비활성 고객 것이 남는다
        .select(`
          id, inspection_start_date,
          customers:customer_id!inner ( customer_name, is_active ),
          inspection_defects!inner ( action_end )
        `)
        .eq('customers.is_active', true)
        .is('report11_submitted_at', null)
        .order('inspection_start_date', { ascending: false })
        .limit(60),
    ])

    kpiBills = (billsRes.data ?? []) as BillKpi[]
    pendingReports = (reportsRes.data ?? []) as unknown as PendingReportRow[]
    /* 완료목표일 = 이행기간 종료일. 수기 총 이행기간(④)이 정본이고, 없으면 불량별 action_end의
     * 최댓값 — 판정은 `repairEndISO` 한 곳이 하고 PDF·엑셀이 같은 함수를 탄다(사본 금지). */
    type InspRow = {
      id: string; inspection_start_date: string | null
      customers: { customer_name: string } | null
      inspection_defects: { action_end: string | null }[] | null
    }
    const rows = (actionsRes.data ?? []) as unknown as InspRow[]
    const annexRes = rows.length
      ? await admin.from('annex_inputs').select('inspection_id, fields')
        .eq('annex_no', 'report10').in('inspection_id', rows.map(r => r.id))
      : { data: [] }
    const periodOf = new Map(((annexRes.data ?? []) as { inspection_id: string; fields: Record<string, unknown> | null }[])
      .map(a => [a.inspection_id, typeof a.fields?.totalPeriod === 'string' ? a.fields.totalPeriod : '']))
    pendingActions = rows
      .map(r => ({
        id: r.id,
        customerName: r.customers?.customer_name ?? null,
        inspectionDate: r.inspection_start_date,
        // '' → null: 기한을 못 구한 것과 「없음」을 섞지 않는다(화면이 '기한 미지정'으로 구분해 말한다)
        targetDate: repairEndISO({
          totalPeriod: periodOf.get(r.id) ?? '',
          actionEnds: (r.inspection_defects ?? []).map(d => d.action_end),
        }) || null,
      }))
      // 기한이 이른 것부터. 기한 미정은 맨 뒤로 — 위쪽은 '지금 급한 것'을 위한 자리다
      .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))
      .slice(0, 5)
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
        <h1 className="text-xl font-bold text-ink">안녕하세요, {profile.name}님</h1>
        <p className="text-sm text-ink-sub mt-1">오늘의 업무 현황입니다.</p>
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
              sub: '소방서 제출 전', icon: BarChart2, color: 'text-brand',
            },
          ].map(k => (
            <div key={k.label} className={`bg-surface rounded-xl border border-line p-5 ${cardShadow}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-ink-sub uppercase tracking-wide">{k.label}</p>
                <k.icon className={`size-4 ${k.color}`} />
              </div>
              <p className={`text-3xl font-bold ${k.color} mt-1`}>{k.value}</p>
              <p className="text-xs text-ink-faint mt-1">{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── 소방 단계 KPI (오늘 마감 / 지연) ──────────── */}
      {isManagerOrAdmin && (
        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/inspections/calendar?filter=today"
            className={`bg-surface rounded-xl border border-line p-5 ${cardShadow} hover:border-orange-200 transition-colors`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-ink-sub uppercase tracking-wide">오늘 마감</p>
              <Clock className={`size-4 ${todayStepCount > 0 ? 'text-orange-500' : 'text-ink-faint'}`} />
            </div>
            <p className={`text-3xl font-bold mt-1 ${todayStepCount > 0 ? 'text-orange-500' : 'text-ink-faint'}`}>
              {todayStepCount}<span className="text-base font-medium ml-1">건</span>
            </p>
            <p className="text-xs text-ink-faint mt-1">오늘 마감 미완료 단계</p>
          </Link>
          <Link
            href="/inspections/calendar?filter=overdue"
            className={`bg-surface rounded-xl border border-line p-5 ${cardShadow} hover:border-red-200 transition-colors`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-ink-sub uppercase tracking-wide">지연</p>
              <AlertTriangle className={`size-4 ${overdueStepCount > 0 ? 'text-red-500' : 'text-ink-faint'}`} />
            </div>
            <p className={`text-3xl font-bold mt-1 ${overdueStepCount > 0 ? 'text-red-500' : 'text-ink-faint'}`}>
              {overdueStepCount}<span className="text-base font-medium ml-1">건</span>
            </p>
            <p className="text-xs text-ink-faint mt-1">기한 초과 미완료 단계</p>
          </Link>
        </div>
      )}

      {/* ── 사전 안내 위젯 (소방계획서_24 S9-5) — 문자 발송 화면 배너의 축약판.
             방문 안내는 시점을 놓치면 의미가 없어져(지난 날에 "방문합니다"는 성립하지 않는다)
             하루의 시작 화면에서 먼저 보이게 둔다 ── */}
      {smsNotice && ('error' in smsNotice
        ? <SmsNoticeWidget count={0} messages={0} nearest={null} error={smsNotice.error} />
        : <SmsNoticeWidget count={smsNotice.count} messages={smsNotice.messages}
            nearest={smsNotice.nearest} blockedCount={smsNotice.blockedCount} />
      )}

      {/* ── 문서 할 일 위젯 (소방계획서_5 R0-9) — 하루의 시작점 ── */}
      {docTodo && <DocTodoWidget dueSoon={docTodo.dueSoon} missingCerts={docTodo.missingCerts} inputTodo={inputTodo} myId={profile.id} defaultMine={isEmployee} />}

      {/* ── 제출 현황 위젯 (소방계획서_8 H-6b·D-16) — 구 보고서 센터 제출 현황판 이전지 ── */}
      {canDoc && <SubmissionWidget myId={profile.id} defaultMine={isEmployee} />}

      {/* ── 상단 ERP 카드 ─────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`bg-surface rounded-xl border border-line p-5 ${cardShadow}`}>
          <p className="text-xs font-medium text-ink-sub uppercase tracking-wide">내 문서</p>
          <p className="text-3xl font-bold text-brand mt-2">{myDocCount}</p>
          <p className="text-xs text-ink-faint mt-1">기안서 전체</p>
        </div>

        {isManagerOrAdmin && (
          <div className={`bg-surface rounded-xl border border-line p-5 ${cardShadow}`}>
            <p className="text-xs font-medium text-ink-sub uppercase tracking-wide">미결재</p>
            <p className="text-3xl font-bold text-brand mt-2">{pendingCount}</p>
            <p className="text-xs text-ink-faint mt-1">결재 대기 건</p>
          </div>
        )}

        <div className={`bg-surface rounded-xl border border-line p-5 ${cardShadow}`}>
          <p className="text-xs font-medium text-ink-sub uppercase tracking-wide">내 휴가</p>
          <p className="text-3xl font-bold text-brand mt-2">{myLeaves.length}</p>
          <p className="text-xs text-ink-faint mt-1">최근 신청</p>
        </div>

        {isAdmin && adminStats && (
          <div className={`bg-surface rounded-xl border border-line p-5 ${cardShadow}`}>
            <p className="text-xs font-medium text-ink-sub uppercase tracking-wide">전체 직원</p>
            <p className="text-3xl font-bold text-brand mt-2">{adminStats.totalEmployees}</p>
            <p className="text-xs text-ink-faint mt-1">활성 계정</p>
          </div>
        )}
      </div>

      {/* ── 나의 점검 현황 ────────────────────────────── */}
      <div className={`bg-surface rounded-xl border border-line ${cardShadow} overflow-hidden`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Flame className="size-4 text-brand" />
            <h2 className="text-sm font-semibold text-ink">{inspLabel} 현황</h2>
            <span className="text-xs text-ink-faint">전체 {totalInsp}건</span>
          </div>
          <Link href="/inspections" className="text-xs text-brand hover:underline flex items-center gap-1">
            전체보기 <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="grid grid-cols-4 divide-x divide-brand-line-soft">
          {[
            { label: '예정', value: inspStats.scheduled, color: 'text-blue-600' },
            { label: '진행중', value: inspStats.in_progress, color: 'text-brand' },
            { label: '완료', value: inspStats.completed, color: 'text-green-700' },
            { label: '기한초과', value: inspStats.overdue, color: 'text-red-600', isAlert: true },
          ].map(({ label, value, color, isAlert }) => (
            <Link
              key={label}
              href={label === '기한초과' ? '/inspections/calendar?filter=overdue' : `/inspections?status=${label === '예정' ? 'scheduled' : label === '진행중' ? 'in_progress' : 'completed'}`}
              className="flex flex-col items-center py-5 hover:bg-paper transition-colors"
            >
              <p className="text-xs text-ink-sub mb-2">{label}</p>
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
              {isAlert && value > 0 && (
                <span className="text-form-2xs text-red-500 mt-1 font-medium flex items-center gap-0.5">
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
          <div className={`bg-surface rounded-xl border border-line ${cardShadow}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div className="flex items-center gap-2">
                <FileCheck2 className="size-4 text-blue-500" />
                <h2 className="text-sm font-semibold text-ink">점검보고서 제출대기</h2>
                <span className="text-form-2xs font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                  {pendingReports.length}건
                </span>
              </div>
              <Link href="#submissions" className="text-xs text-brand hover:underline flex items-center gap-1">
                전체보기 <ArrowRight className="size-3" />
              </Link>
            </div>
            {pendingReports.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-ink-faint">제출 대기 건이 없습니다</p>
              </div>
            ) : (
              <div className="divide-y divide-paper">
                {pendingReports.map(r => {
                  const item = r.inspection_plan_items
                  const isOverdue = r.notification_due_date && r.notification_due_date < todayStr
                  return (
                    <div key={r.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{item?.customers?.customer_name ?? '—'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">점검일: {item?.scheduled_date ?? '—'}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs font-medium ${isOverdue ? 'text-red-500' : 'text-gray-500'}`}>
                          {r.notification_due_date ? `신고예정: ${r.notification_due_date}` : '—'}
                        </p>
                        {isOverdue && (
                          <span className="text-form-2xs text-red-400 flex items-center justify-end gap-0.5 mt-0.5">
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
          <div className={`bg-surface rounded-xl border border-line ${cardShadow}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-ink">이행계획 제출대기</h2>
                <span className="text-form-2xs font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
                  {pendingActions.length}건
                </span>
              </div>
              <Link href="#submissions" className="text-xs text-brand hover:underline flex items-center gap-1">
                전체보기 <ArrowRight className="size-3" />
              </Link>
            </div>
            {pendingActions.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-ink-faint">제출 대기 건이 없습니다</p>
              </div>
            ) : (
              <div className="divide-y divide-paper">
                {pendingActions.map(a => {
                  const isOverdue = a.targetDate && a.targetDate < todayStr
                  return (
                    <div key={a.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{a.customerName ?? '—'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          점검일: {a.inspectionDate ?? '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs font-medium ${isOverdue ? 'text-red-500' : 'text-gray-500'}`}>
                          {a.targetDate ? `완료목표: ${a.targetDate}` : '기한 미지정'}
                        </p>
                        {isOverdue && (
                          <span className="text-form-2xs text-red-400 flex items-center justify-end gap-0.5 mt-0.5">
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
        <div className={`bg-surface rounded-xl border border-line ${cardShadow}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-ink">마감 임박</h2>
              <span className="text-form-2xs font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">D-7 이내</span>
            </div>
            <Link href="/inspections/calendar?filter=week" className="text-xs text-brand hover:underline flex items-center gap-1">
              달력 <ArrowRight className="size-3" />
            </Link>
          </div>

          {dueSoonList.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-ink-faint">이번 주 마감 예정 단계가 없습니다</p>
            </div>
          ) : (
            <div className="divide-y divide-paper">
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
                    className="flex items-center gap-3 px-5 py-3 hover:bg-paper transition-colors"
                  >
                    <div className="size-6 rounded-full bg-brand-tint flex items-center justify-center shrink-0">
                      <span className="text-form-2xs font-bold text-brand">{item.stepNum}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{item.stepName}</p>
                      <p className="text-xs text-ink-sub truncate">
                        {item.customerName}
                        <span className="text-ink-faint mx-1">·</span>
                        {item.year}년 {item.sequenceNum}차
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-form-2xs font-bold px-2 py-0.5 rounded-full ${urgentCls}`}>
                        {dLabel}
                      </span>
                      <span className="text-form-2xs text-ink-faint">{item.dueDate}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <div className={`bg-surface rounded-xl border border-line ${cardShadow} flex flex-col`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-500" />
              <h2 className="text-sm font-semibold text-ink">기한 초과</h2>
            </div>
            <Link href="/inspections/calendar?filter=overdue" className="text-xs text-brand hover:underline flex items-center gap-1">
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
                <p className="text-sm font-medium text-ink">{overdueStepCount}개 단계가 기한을 초과했습니다</p>
                <p className="text-xs text-ink-sub text-center px-4">
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
                <p className="text-xs text-ink-sub">모든 단계가 정상 진행 중입니다</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 관리자 전용 요약 현황 ────────────────────── */}
      {isAdmin && adminStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={`bg-surface rounded-xl border border-line ${cardShadow}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-brand" />
                <h2 className="text-sm font-semibold text-ink">전체 문서 현황</h2>
              </div>
              <Link href="/admin" className="text-xs text-brand hover:underline flex items-center gap-1">
                더 보기 <ArrowRight className="size-3" />
              </Link>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-ink-sub">전체 기안서</p>
                <p className="text-xl font-bold text-ink mt-0.5">{adminStats.totalDocs}<span className="text-sm font-normal ml-1">건</span></p>
              </div>
              <div>
                <p className="text-xs text-ink-sub">결재 대기</p>
                <p className="text-xl font-bold text-blue-600 mt-0.5">{adminStats.pendingDocs}<span className="text-sm font-normal ml-1">건</span></p>
              </div>
            </div>
          </div>

          <div className={`bg-surface rounded-xl border border-line ${cardShadow}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-brand" />
                <h2 className="text-sm font-semibold text-ink">금주 휴가 현황</h2>
              </div>
              <Link href="/admin" className="text-xs text-brand hover:underline flex items-center gap-1">
                더 보기 <ArrowRight className="size-3" />
              </Link>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-ink-sub">승인 대기 휴가</p>
                <p className="text-xl font-bold text-orange-500 mt-0.5">{adminStats.pendingLeaves}<span className="text-sm font-normal ml-1">건</span></p>
              </div>
              <div>
                <p className="text-xs text-ink-sub">바로가기</p>
                <Link href="/leaves/manage" className="text-sm font-medium text-brand hover:underline mt-0.5 block">
                  휴가 승인 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 최근 휴가 신청 ───────────────────────────── */}
      {myLeaves.length > 0 && (
        <div className={`bg-surface rounded-xl border border-line ${cardShadow}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-brand" />
              <h2 className="text-sm font-semibold text-ink">최근 휴가 신청</h2>
            </div>
            <Link href="/leaves" className="text-xs text-brand hover:underline flex items-center gap-1">
              전체보기 <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="divide-y divide-line">
            {myLeaves.map((leave) => (
              <div key={leave.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <span className="text-sm font-medium text-ink">
                    {leaveTypeLabel[leave.leave_type] ?? leave.leave_type}
                  </span>
                  <span className="text-xs text-ink-sub ml-2">
                    {leave.start_date} ~ {leave.end_date}
                  </span>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  leave.status === 'approved' ? 'bg-green-50 text-green-700'
                  : leave.status === 'rejected' ? 'bg-red-50 text-red-600'
                  : 'bg-brand-tint text-brand'
                }`}>
                  {leaveStatusLabel[leave.status] ?? leave.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 공지사항 위젯 ────────────────────────────── */}
      <div className={`bg-surface rounded-xl border border-line ${cardShadow}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-brand" />
            <h2 className="text-sm font-semibold text-ink">공지사항</h2>
            {boardNotices.length > 0 && (
              <span className="text-form-2xs font-medium px-1.5 py-0.5 rounded-full bg-brand-tint text-brand">
                {boardNotices.length}건
              </span>
            )}
          </div>
          <Link href="/board" className="text-xs text-brand hover:underline flex items-center gap-1">
            전체보기 <ArrowRight className="size-3" />
          </Link>
        </div>
        {boardNotices.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-ink-faint">등록된 공지사항이 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-paper">
            {boardNotices.map(n => (
              <Link
                key={n.id}
                href={`/board/${n.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-paper transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Pin className="size-3 text-brand shrink-0" />
                  <p className="text-sm font-medium text-ink truncate">{n.title}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-xs text-ink-sub">{n.author?.name ?? '—'}</span>
                  <span className="text-xs text-ink-faint">{n.created_at.slice(0, 10)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── 결재 대기 배너 ───────────────────────────── */}
      {isManagerOrAdmin && pendingCount > 0 && (
        <div className="bg-brand-tint border border-line rounded-xl px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckSquare className="size-5 text-brand" />
            <span className="text-sm font-medium text-ink">
              결재 대기 중인 문서가 <span className="text-brand font-bold">{pendingCount}건</span> 있습니다.
            </span>
          </div>
          <Link href="/approvals" className="text-sm font-medium text-brand hover:underline flex items-center gap-1">
            결재하러 가기 <ArrowRight className="size-3" />
          </Link>
        </div>
      )}
    </div>
  )
}
