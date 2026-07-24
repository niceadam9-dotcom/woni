import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileOutput, FileText, ClipboardCheck, FileStack, Search, AlertTriangle, TableProperties, CalendarPlus } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { FirePlanGenerateRequestClient } from '@/components/fire-plans/generate-request-client'
import { getFirePlanGenStatusAction } from '@/app/(dashboard)/fire-plans/generate/actions'
import { ReportCenterHome } from '@/components/reports/report-center-home'
import { ReportGenList, type GenRow } from '@/components/reports/report-gen-list'
import { SubmissionBoard } from '@/components/reports/submission-board'
import { AnnualIssueWizard } from '@/components/reports/annual-issue-wizard'
import { getCustomerDocsAction, getRecentDocsAction, getDocTodoAction, getSubmissionBoardAction, type CustomerDocs, type RecentDoc, type SubmissionRow, type SubmissionSummary } from './docs-actions'
import type { DueReport9Row, MissingCertRow } from '@/lib/doc-status'
import type { UserRole } from '@/types'
import { ackLawRevisionAction } from './actions'

export const dynamic = 'force-dynamic'

/** 보고서 센터 (소방계획서_4.md §10, R-1·R-2·R-3) — 전 고객 대상 서식 선택·일괄 생성 + 처리 현황 + 서식 관리.
 *  역할 분담: 고객 탭 = 데이터 입력 + 개별 생성 / 이 페이지 = 서식 카탈로그·일괄 생성·현황.
 *  별지 9호는 준비 화면(점검 상세 §9-6⑦)이 단일 생성 지점 — 여기서는 점검 건 선택 → 준비 화면으로 이동.
 *  서식 버전은 law_form_baselines(106·108) 연동 — 개정 감지(announce>seed) 시 '새 개정판' 뱃지 + 재심기 배너 */

const FORMS = [
  { key: 'fire_plan', label: '소방계획서', desc: 'HWP+PDF · 고객 다중 선택', icon: FileOutput, active: true, blKeys: [] as string[], fallbackVersion: '소방청 표준양식 (25년 이후)' },
  { key: 'report9', label: '자체점검 실시결과 (별지 9호)', desc: '점검 건 선택 → 바로 생성', icon: ClipboardCheck, active: true, blKeys: ['report9'], fallbackVersion: '2026-07-01 공포 (법제처)' },
  { key: 'placement', label: '점검인력 배치확인서', desc: '협회 발급 — 점검 상세에 업로드', icon: FileText, active: false, blKeys: [] as string[], fallbackVersion: '' },
  { key: 'report10', label: '이행계획·완료 (별지 10·11호)', desc: '불량 보유 건 — 바로 생성', icon: FileStack, active: true, blKeys: ['report10', 'report11'], fallbackVersion: '2026-07-01 공포 (법제처)' },
  { key: 'submissions', label: '제출 현황', desc: '9호·배치확인서·10·11호 한눈에', icon: TableProperties, active: true, blKeys: [] as string[], fallbackVersion: '타임라인 단일 소스 · 수기 입력 없음' },
  { key: 'annual', label: '연차 일괄 발행', desc: '전 고객 소방계획서 연초 갱신', icon: CalendarPlus, active: true, blKeys: [] as string[], fallbackVersion: '연초 수백 클릭 → 1클릭' },
]

type Baseline = { key: string; form_name: string; announce_date: string; seed_date: string | null }
const fmtYmd = (d: string) => (d?.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d)

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ form?: string; q?: string; cust?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  const { form: formRaw, q, cust } = await searchParams
  // 랜딩(docs) + 서식별 흐름(fire_plan·report9·report10). 기본은 ⓪ 첫 화면(검색·오늘 할 일)
  const VALID_FORMS = ['docs', 'fire_plan', 'report9', 'report10', 'submissions', 'annual']
  const form = VALID_FORMS.includes(formRaw ?? '') ? formRaw! : 'docs'

  // 보고서 센터 첫 화면 데이터 (소방계획서_5 S2) — 권한 있는 직원만 SSR 페치 (없으면 빈 값, 상호작용 시 액션이 재차 가드)
  const canReports = can(profile.role as UserRole, 'inspection_register')
  let todo: { dueSoon: DueReport9Row[]; missingCerts: MissingCertRow[] } = { dueSoon: [], missingCerts: [] }
  let recentDocs: RecentDoc[] = []
  let initialDocs: CustomerDocs | null = null
  if (canReports) {
    const [t, r, d] = await Promise.all([
      getDocTodoAction(),
      getRecentDocsAction(),
      cust ? getCustomerDocsAction(cust) : Promise.resolve({ docs: null as CustomerDocs | null }),
    ])
    todo = t
    recentDocs = r.docs
    initialDocs = d.docs ?? null
  }

  // §10-R3: 서식 버전(law_form_baselines) — 개정 감지 크론(§9-5c)이 announce_date를 갱신
  const adminBl = createAdminClient()
  const { data: blRaw } = await adminBl.from('law_form_baselines').select('key, form_name, announce_date, seed_date')
  const baselines = new Map(((blRaw ?? []) as Baseline[]).map(b => [b.key, b]))
  const isRevised = (b?: Baseline) => !!b && !!b.seed_date && b.announce_date > b.seed_date
  const revisedList = [...baselines.values()].filter(b => isRevised(b))
  const canAck = ['admin', 'manager'].includes(profile.role)

  // ②③ 바로 생성 목록 (소방계획서_5 R3·R4) — 자체점검만(정기·일반 제외), 최근 완료 우선.
  // report9 = 전 자체점검 / report10 = 불량 보유 건. 생성 이력·불량 수·9호 기한 D-day 동봉.
  let genRows: GenRow[] = []
  if (form === 'report9' || form === 'report10') {
    const admin = createAdminClient()
    let query = admin.from('inspections')
      .select('id, customer_id, year, sequence_num, inspection_type, status, assigned_employee_id, inspection_start_date, inspection_end_date, report9_submitted_at, customer:customers(customer_name)')
      .neq('inspection_type', '일반관리')
      .or('plan_type.is.null,plan_type.like.special_*')
      .order('status', { ascending: true })  // completed 우선 근사 — 클라이언트 필터/정렬 병행
      .order('inspection_start_date', { ascending: false, nullsFirst: false })
      .limit(40)
    if (q?.trim()) {
      const { data: custIds } = await admin.from('customers').select('id').ilike('customer_name', `%${q.trim()}%`).limit(50)
      query = query.in('customer_id', ((custIds ?? []) as Array<{ id: string }>).map(c => c.id))
    }
    const { data: inspRaw } = await query
    const rows = (inspRaw ?? []) as unknown as Array<{
      id: string; customer_id: string; year: number; sequence_num: number; inspection_type: string; status: string
      assigned_employee_id: string | null
      inspection_start_date: string | null; inspection_end_date: string | null; report9_submitted_at: string | null
      customer: { customer_name: string } | null
    }>
    const ids = rows.map(r => r.id)
    const gen: Record<string, { report9: number; report10: number; report11: number }> = {}
    const def: Record<string, { total: number; done: number }> = {}
    if (ids.length > 0) {
      const [jobsRes, defRes] = await Promise.all([
        admin.from('fire_plan_gen_jobs').select('inspection_id, report_type').eq('status', 'done').in('inspection_id', ids),
        admin.from('inspection_defects').select('inspection_id, action_completed_at').in('inspection_id', ids),
      ])
      for (const j of (jobsRes.data ?? []) as Array<{ inspection_id: string; report_type: string | null }>) {
        const g = gen[j.inspection_id] ??= { report9: 0, report10: 0, report11: 0 }
        if (j.report_type === 'report9') g.report9 += 1
        else if (j.report_type === 'report10') g.report10 += 1
        else if (j.report_type === 'report11') g.report11 += 1
      }
      for (const d of (defRes.data ?? []) as Array<{ inspection_id: string; action_completed_at: string | null }>) {
        const c = def[d.inspection_id] ??= { total: 0, done: 0 }
        c.total += 1; if (d.action_completed_at) c.done += 1
      }
    }
    // R3-a: 별지 9호 준비 n/4 (report9 모드만) — ① 공통정보 ② 인력 ③ 점검표 ④ 송달 동의
    const prepMap: Record<string, GenRow['prep']> = {}
    if (form === 'report9' && ids.length > 0) {
      const custIds = [...new Set(rows.map(r => r.customer_id))]
      const [custRes, bldRes, respRes] = await Promise.all([
        admin.from('customers').select('id, address, manager_selected_at, email_delivery_consent').in('id', custIds),
        admin.from('buildings').select('customer_id, purpose').eq('is_active', true).in('customer_id', custIds),
        admin.from('inspection_sheet_responses').select('inspection_id').in('inspection_id', ids),
      ])
      const cMap = new Map(((custRes.data ?? []) as Array<{ id: string; address: string | null; manager_selected_at: string | null; email_delivery_consent: boolean | null }>).map(c => [c.id, c]))
      const purposeSet = new Set(((bldRes.data ?? []) as Array<{ customer_id: string; purpose: string | null }>).filter(b => b.purpose).map(b => b.customer_id))
      const respSet = new Set(((respRes.data ?? []) as Array<{ inspection_id: string }>).map(x => x.inspection_id))
      for (const r of rows) {
        const c = cMap.get(r.customer_id)
        const checks = [
          { label: '① 대상물 공통정보', ok: !!c?.address && purposeSet.has(r.customer_id) && !!c?.manager_selected_at, href: `/customers/${r.customer_id}?tab=plan`, hrefLabel: '고객 탭 →' },
          { label: '② 점검 인력', ok: !!r.assigned_employee_id, href: `/inspections/${r.id}`, hrefLabel: '점검 상세 →' },
          { label: '③ 점검표 응답', ok: respSet.has(r.id), href: `/inspections/${r.id}`, hrefLabel: '점검표 →' },
          { label: '④ 송달 동의', ok: c?.email_delivery_consent !== null && c?.email_delivery_consent !== undefined, href: `/customers/${r.customer_id}?tab=plan`, hrefLabel: '고객 탭 →' },
        ]
        prepMap[r.id] = {
          ready: checks.filter(x => x.ok).length, total: checks.length,
          missing: checks.filter(x => !x.ok).map(({ label, href, hrefLabel }) => ({ label, href, hrefLabel })),
        }
      }
    }

    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]
    const dueDday = (end: string | null, submitted: string | null): number | null => {
      if (!end || submitted) return null
      const due = new Date(end); due.setDate(due.getDate() + 15)
      return Math.round((due.getTime() - new Date(todayKst).getTime()) / 86400000)
    }
    genRows = rows.map(r => {
      const g = gen[r.id] ?? { report9: 0, report10: 0, report11: 0 }
      const d = def[r.id] ?? { total: 0, done: 0 }
      return {
        id: r.id, customerId: r.customer_id, customerName: r.customer?.customer_name ?? '—',
        year: r.year, sequenceNum: r.sequence_num, inspectionType: r.inspection_type, status: r.status,
        startDate: r.inspection_start_date,
        gen9: g.report9, gen10: g.report10, gen11: g.report11,
        defectsTotal: d.total, defectsDone: d.done,
        due9Dday: dueDday(r.inspection_end_date, r.report9_submitted_at),
        prep: prepMap[r.id],
      } satisfies GenRow
    })
    // 최근 완료 우선 (R3-d): 완료 → 그 외, 내부는 최신 시작일
    genRows.sort((a, b) =>
      (a.status === 'completed' ? 0 : 1) - (b.status === 'completed' ? 0 : 1)
      || (b.startDate ?? '').localeCompare(a.startDate ?? ''))
    if (form === 'report10') genRows = genRows.filter(r => r.defectsTotal > 0)
  }

  // §7-A 제출 현황판 (R14) — 타임라인 필드 단일 소스
  let board: { rows: SubmissionRow[]; summary: SubmissionSummary } | null = null
  if (form === 'submissions' && canReports) board = await getSubmissionBoardAction()

  const status = form === 'fire_plan' ? await getFirePlanGenStatusAction() : null

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-xl font-bold text-[#090c1d]">보고서 센터</h1>

      {/* §10-R3: 서식 개정 감지 배너 — 재심기 후 [반영 완료]로 뱃지 해제 */}
      {revisedList.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" /> 법제처 서식 개정이 감지됐습니다 — 새 서식 수신 후 재심기(개발 PC)가 필요합니다
          </p>
          {revisedList.map(b => (
            <div key={b.key} className="flex items-center gap-2 text-[11px] text-amber-700">
              <span>{b.form_name}: 심어진 서식 {fmtYmd(b.seed_date!)} → 최신 공포 {fmtYmd(b.announce_date)}</span>
              {canAck && (
                <form action={ackLawRevisionAction}>
                  <input type="hidden" name="key" value={b.key} />
                  <button type="submit" title="재심기(placeholder 재실행)를 마친 뒤에만 눌러주세요"
                    className="h-5 px-2 rounded border border-amber-300 text-[10px] text-amber-800 hover:bg-amber-100">재심기 반영 완료</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ⓪ 보고서 센터 첫 화면 (R1) — 검색·오늘 할 일 우선. 서식 카드·서식별 흐름을 children으로 감싼다 */}
      <ReportCenterHome
        initialTodo={todo}
        initialRecent={recentDocs}
        initialDocs={initialDocs}
        initialCustId={cust ?? null}
      >

      {/* 서식 카탈로그 (§10-2) — 해당 없는 서식은 흐림, 버전은 law_form_baselines 연동(R-3) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {FORMS.map(f => {
          const Icon = f.icon
          const selected = form === f.key
          const bls = f.blKeys.map(k => baselines.get(k)).filter(Boolean) as Baseline[]
          const latest = bls.length > 0 ? bls.reduce((a, b) => (a.announce_date >= b.announce_date ? a : b)) : null
          const version = latest ? `${fmtYmd(latest.announce_date)} 공포 (법제처)` : f.fallbackVersion
          const revised = bls.some(b => isRevised(b))
          const card = (
            <div className={`rounded-xl border p-3 h-full transition-colors ${
              !f.active ? 'border-[#eceafd] opacity-50'
                : selected ? 'border-[#7b68ee] bg-[#f5f4ff]' : 'border-[#c8c4d0] bg-white hover:border-[#7b68ee]'}`}>
              <div className="flex items-center gap-1.5">
                <Icon className={`size-4 ${selected ? 'text-[#7b68ee]' : 'text-[#514b81]'}`} />
                <span className={`text-xs font-semibold ${selected ? 'text-[#7b68ee]' : 'text-[#090c1d]'}`}>{f.label}</span>
                {revised && (
                  <span title="법제처 개정 감지 — 재심기 필요"
                    className="ml-auto shrink-0 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium">새 개정판</span>
                )}
              </div>
              <p className="text-[11px] text-[#514b81] mt-1">{f.desc}</p>
              {version && <p className="text-[10px] text-[#b0acd6] mt-0.5">{version}</p>}
              {!f.active && <p className="text-[10px] text-[#b0acd6] mt-0.5">예정</p>}
            </div>
          )
          return f.active
            ? <Link key={f.key} href={`/reports?form=${f.key}`}>{card}</Link>
            : <div key={f.key} title="후속 단계에서 제공됩니다">{card}</div>
        })}
      </div>

      {/* 소방계획서 — 기존 생성 화면 흡수 (고객 다중 선택·프리셋·큐 현황·프리셋 관리 포함) */}
      {form === 'fire_plan' && status && <FirePlanGenerateRequestClient initialStatus={status} />}

      {/* ②③ 바로 생성 — 별지 9호 / 이행계획·완료 10·11호 (R3·R4) */}
      {(form === 'report9' || form === 'report10') && (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
          <p className="text-xs text-[#514b81] mb-1">
            {form === 'report9'
              ? '점검 건에서 바로 별지 9호를 생성합니다 — HWP/PDF 받기는 고객 문서 현황에서, 발송·제출 기록은 타임라인에서.'
              : '불량 보유 자체점검 건입니다 — 이행계획서(10호)·이행완료 보고서(11호)를 바로 생성합니다.'}
          </p>
          {/* R9-b: 필터 결과가 왜 이런지 화면이 설명 (4-0-5) */}
          <p className="text-[11px] text-[#b0acd6] mb-3">
            자체점검(작동·종합) 건만 표시됩니다 — 정기·일반관리는 대상이 아닙니다
          </p>
          <form action="/reports" className="flex items-center gap-2 mb-3">
            <input type="hidden" name="form" value={form} />
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input name="q" defaultValue={q ?? ''} placeholder="고객명 검색"
                className="h-8 w-full rounded-lg border border-[#d0ccf5] bg-white pl-7 pr-2 text-xs outline-none focus:border-[#7b68ee]" />
            </div>
            <button type="submit" className="h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium">검색</button>
          </form>
          <ReportGenList mode={form === 'report9' ? 'report9' : 'report1011'} rows={genRows} />
        </div>
      )}

      {/* §7-A 제출 현황판 (R14) */}
      {form === 'submissions' && board && <SubmissionBoard rows={board.rows} summary={board.summary} />}

      {/* P-1 연차 일괄 발행 마법사 (S5) */}
      {form === 'annual' && <AnnualIssueWizard defaultYear={new Date().getFullYear() + 1} />}
      </ReportCenterHome>
    </div>
  )
}
