import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, Plus, AlertTriangle } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { TableScroll, STICKY_THEAD } from '@/components/ui/table-scroll'
import { InspectionCustomerSearch } from '@/components/inspections/inspection-customer-search'
import { RecentCustomersStrip } from '@/components/customers/recent-customers-strip'
import type { InspectionStatus, InspectionType, PlanType, UserRole } from '@/types'
import { inspectionNatureBadge } from '@/lib/inspection-nature'
import { activeStepNums, isSelfInspection } from '@/lib/inspection-step-status'

const STATUS_LABELS: Record<InspectionStatus, string> = {
  scheduled: '예정',
  in_progress: '진행중',
  completed: '완료',
  overdue: '기한초과',
}

const STATUS_COLORS: Record<InspectionStatus, string> = {
  scheduled: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-brand-tint text-brand',
  completed: 'bg-green-50 text-green-700',
  overdue: 'bg-red-50 text-red-600',
}

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; year?: string; status?: string; employee?: string; page?: string; per_page?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const isEmployee = (profile.role as UserRole) === 'employee'
  const q = (params.q ?? '').trim()
  const yearFilter = params.year ?? ''
  const statusFilter = params.status ?? ''
  // B안: 일반직원도 전체 조회 가능 — 첫 진입 기본값만 본인 담당
  const employeeFilter = params.employee ?? (isEmployee ? profile.id : '')
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = Math.max(0, parseInt(params.per_page ?? '25', 10))  // 0 = 전체

  const admin = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  const currentYear = new Date().getFullYear()

  const from = pageSize > 0 ? (page - 1) * pageSize : 0
  const to = pageSize > 0 ? from + pageSize - 1 : 99999

  // 고객명 검색 — 이름으로 고객을 먼저 찾고 그 id로 점검을 거른다.
  // 임베디드 컬럼(customers.customer_name)에 직접 필터를 걸면 count가 조인 전 기준이 되어
  // 페이지 수가 어긋난다. 고객 수는 수백 규모라 id 목록이 쿼리를 넘치게 하지 않는다.
  let custIdFilter: string[] | null = null
  if (q) {
    const { data: matched } = await admin.from('customers')
      .select('id')
      .ilike('customer_name', `%${q}%`)
      .limit(500)
    const ids = ((matched ?? []) as Array<{ id: string }>).map(r => r.id)
    // 일치 고객이 없으면 '전체 표시'가 아니라 0건이어야 한다 — 도달 불가 id로 비운다
    custIdFilter = ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']
  }

  // 검색 쿼리 구성 — 필터는 DB에서, 페이지 단위로만 가져옴
  // 삭제(비활성) 고객 건은 **어떤 필터에서도** 조회되지 않는다 (D-8, 2026-08-29) → 항상 inner join.
  // 종전 '취소' 필터가 유일한 이력 창구였으나 사용자 지시로 폐지했다.
  const custJoin = 'customers:customer_id!inner'
  let query = admin.from('inspections').select(
    `id, year, sequence_num, inspection_type, plan_type, inspection_start_date, status, assigned_employee_id, customer_id,
     ${custJoin} (id, customer_name, customer_code, is_active)`,
    { count: 'exact' }
  )
  if (custIdFilter) query = query.in('customer_id', custIdFilter) as typeof query
  if (employeeFilter) query = query.eq('assigned_employee_id', employeeFilter) as typeof query
  // year도 status와 같은 22P02 축이다 — ?year=abc면 parseInt가 NaN을 주고 `year=eq.NaN`이
  // 정수 컬럼과 대조돼 0건이 아니라 500으로 깨진다. 정수일 때만 건다.
  const yearNum = parseInt(yearFilter, 10)
  if (yearFilter && Number.isInteger(yearNum)) query = query.eq('year', yearNum) as typeof query
  // ADD-15: 비완료/완료 구분 필터
  // ⚠status는 Postgres enum(inspection_status)이라 목록에 없는 값을 그대로 넘기면 0건이 아니라
  //   22P02 오류로 페이지가 깨진다. '취소' 필터 폐지(D-8) 후 남은 북마크·뒤로가기가 ?status=cancelled를
  //   실어 오므로 반드시 화이트리스트로 거른다 — 모르는 값은 '전체 상태'로 떨어뜨린다.
  const INSPECTION_STATUSES = ['scheduled', 'in_progress', 'completed', 'overdue'] as const
  if (statusFilter === 'incomplete') {
    query = query.in('status', ['scheduled', 'in_progress', 'overdue']) as typeof query
  } else if ((INSPECTION_STATUSES as readonly string[]).includes(statusFilter)) {
    query = query.eq('status', statusFilter) as typeof query
  }
  // 고객관리에서 삭제·비활성된 고객의 점검 건은 무조건 제외 — 예외 필터 없음 (D-8)
  query = query.eq('customers.is_active', true) as typeof query

  const [inspRes, profilesRes] = await Promise.all([
    // ADD-14: 최신 등록 건 최상위
    query.order('created_at', { ascending: false }).range(from, to),
    // 이름 해석은 퇴사자 포함 전체 — 필터 목록만 활성 직원으로 제한
    admin.from('profiles').select('id, name, position, is_active').order('name'),
  ])

  type InspRow = {
    id: string; year: number; sequence_num: number; inspection_type: InspectionType
    plan_type: PlanType | null
    inspection_start_date: string; status: InspectionStatus
    assigned_employee_id: string; customer_id: string
    customers: { id: string; customer_name: string; customer_code: string; is_active: boolean } | null
  }

  const inspections = (inspRes.data ?? []) as unknown as InspRow[]
  const totalCount = inspRes.count ?? 0
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalCount / pageSize)
  const allProfiles = (profilesRes.data ?? []) as Array<{ id: string; name: string; position: string | null; is_active: boolean }>
  const employees = allProfiles.filter(e => e.is_active)
  const empMap = new Map(allProfiles.map(e => [e.id, e]))

  // 단계 진행률 및 마감임박 정보 로드
  //
  // R4-8(소방계획서_21 / F-6): **분모를 유효 단계로 좁힌다.** 트리거(019)는 모든 점검에 6행을 만드는데
  // 정기·일반(월간 외관점검)의 유효 단계는 ① 하나이고, 자체점검도 불량이 0건이면 ⑤⑥은 '해당없음'이다.
  // 종전엔 6행을 그대로 세어서 정기관리 고객의 연 12건이 **영원히 미완**으로 보였다(목록에서 가장 많은 행).
  // 마이그레이션으로 행을 지우지 않고 **조회 시 필터**로 좁힌다 — 과거를 파괴하지 않고, 불량이 생기면
  // ⑤⑥이 다시 필요해지기 때문이다. 판정 함수는 상세·동기화와 공용(inspection-step-status.ts).
  const stepSummary: Record<string, { total: number; completed: number; hasDueSoon: boolean; hasOverdue: boolean }> = {}
  if (inspections.length > 0) {
    const ids = inspections.map(i => i.id)
    const [stepsRes, defectsRes] = await Promise.all([
      admin.from('inspection_steps').select('inspection_id, step_num, status, due_date').in('inspection_id', ids),
      admin.from('inspection_defects').select('inspection_id').in('inspection_id', ids),
    ])
    const withDefects = new Set(((defectsRes.data ?? []) as Array<{ inspection_id: string }>).map(d => d.inspection_id))
    const activeByInsp = new Map(inspections.map(i => [
      i.id,
      new Set<number>(activeStepNums(isSelfInspection(i.plan_type), withDefects.has(i.id))),
    ]))

    for (const s of stepsRes.data ?? []) {
      const row = s as { inspection_id: string; step_num: number; status: string; due_date: string | null }
      // 유효 단계가 아니면 분모·마감임박 어디에도 세지 않는다(행은 DB에 그대로 둔다)
      if (!activeByInsp.get(row.inspection_id)?.has(row.step_num)) continue
      if (!stepSummary[row.inspection_id]) {
        stepSummary[row.inspection_id] = { total: 0, completed: 0, hasDueSoon: false, hasOverdue: false }
      }
      const sum = stepSummary[row.inspection_id]
      sum.total++
      if (row.status === 'completed') sum.completed++
      if (row.status !== 'completed' && row.due_date) {
        if (row.due_date < today) sum.hasOverdue = true
        else if (row.due_date <= in7Days) sum.hasDueSoon = true
      }
    }
  }

  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

  function buildPageUrl(p: number) {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (yearFilter) sp.set('year', yearFilter)
    if (statusFilter) sp.set('status', statusFilter)
    if (employeeFilter) sp.set('employee', employeeFilter)
    if (pageSize !== 25) sp.set('per_page', String(pageSize))
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return `/inspections${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="size-6 text-brand" />
          <div>
            <h1 className="text-xl font-bold text-ink">점검 업무</h1>
            <p className="text-sm text-ink-sub mt-0.5">소방 점검 업무 현황을 관리합니다</p>
          </div>
        </div>
      </div>

      {/* 최근 본 고객 — 칩은 **아래 표의 고객명과 같은 곳**(점검업무 상세조회)으로 간다
          (2026-08-18 사용자 확정). 점검이 없는 고객만 고객 상세로 폴백한다.
          이 목록을 고객으로 거르는 일은 바로 아래 고객명 검색창이 그대로 담당한다 */}
      <RecentCustomersStrip userId={profile.id} target="inspection" />

      {/* 필터 */}
      <form method="GET" action="/inspections" className="flex flex-wrap items-center gap-2">
        <InspectionCustomerSearch defaultValue={q} />
        <select
          name="year"
          defaultValue={yearFilter}
          className="h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition"
        >
          <option value="">전체 연도</option>
          {yearOptions.map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={statusFilter}
          className="h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition"
        >
          <option value="">전체 상태</option>
          <option value="incomplete">비완료 (예정·진행중)</option>
          <option value="completed">완료</option>
          <option value="scheduled">예정</option>
          <option value="in_progress">진행중</option>
          <option value="overdue">기한초과</option>
        </select>
        <select
          name="employee"
          defaultValue={employeeFilter}
          className="h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition"
        >
          <option value="">전체 담당자</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <select
          name="per_page"
          defaultValue={String(pageSize)}
          className="h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition"
        >
          <option value="25">25건</option>
          <option value="50">50건</option>
          <option value="0">전체</option>
        </select>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          검색
        </button>
        {(q || yearFilter || statusFilter || employeeFilter) && (
          <a
            href="/inspections"
            className="h-9 px-3 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper transition-colors flex items-center"
          >
            초기화
          </a>
        )}
        <span className="text-xs text-ink-sub ml-auto">총 {totalCount}건</span>
      </form>

      {/* 목록 */}
      <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {inspections.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-sub">
            {q ? `'${q}'에 해당하는 점검 업무가 없습니다` : '검색된 점검 업무가 없습니다'}
          </div>
        ) : (
          <TableScroll offset={300}>
            <table className="w-full text-sm">
              <thead className={STICKY_THEAD}>
                <tr className="border-b border-line bg-paper">
                  {['고객명', '유형/차수', '시작일', '담당자', '진행 단계', '상태'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-ink-sub whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {inspections.map(insp => {
                  const customer = insp.customers
                  const emp = empMap.get(insp.assigned_employee_id)
                  const steps = stepSummary[insp.id] ?? { total: 0, completed: 0, hasDueSoon: false, hasOverdue: false }
                  const pct = steps.total > 0 ? (steps.completed / steps.total) * 100 : 0

                  return (
                    <tr key={insp.id} className="hover:bg-paper transition-colors">
                      <td className="px-4 py-3">
                        {/* 고객명 클릭 = 상세보기와 동일 진입 (2026-08-03 사용자 요청) */}
                        {/* 비활성/삭제 고객은 쿼리에서 이미 빠진다 — 취소선·뱃지 분기 없음 (D-8) */}
                        <Link
                          href={`/inspections/${insp.id}`}
                          className="font-medium hover:underline text-ink hover:text-brand"
                        >
                          {customer?.customer_name ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {(() => {
                            const nb = inspectionNatureBadge(insp.inspection_type, insp.plan_type)
                            return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${nb.className}`}>{nb.label}</span>
                          })()}
                          <span className="text-xs text-ink-sub">{insp.sequence_num}차</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-strong whitespace-nowrap">
                        {insp.inspection_start_date}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink">
                        {emp ? (
                          <span>
                            {emp.name}
                            {emp.position ? <span className="text-ink-faint ml-1">({emp.position})</span> : null}
                            {!emp.is_active && <span className="text-red-500 ml-1">(퇴사)</span>}
                          </span>
                        ) : (
                          <span className="text-red-500">미배정</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {steps.total > 0 ? (
                          <div className="flex items-center gap-2">
                            {(steps.hasOverdue || steps.hasDueSoon) && (
                              <AlertTriangle className={`size-3.5 shrink-0 ${steps.hasOverdue ? 'text-red-500' : 'text-amber-500'}`} />
                            )}
                            <div className="w-20 h-1.5 bg-brand-line-soft rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${steps.completed === steps.total ? 'bg-green-500' : 'bg-brand'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-ink-sub whitespace-nowrap">
                              {steps.completed}/{steps.total}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[insp.status]}`}>
                          {STATUS_LABELS[insp.status]}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {page > 1 && (
            <a href={buildPageUrl(page - 1)}
              className="h-8 px-3 rounded-lg border border-brand-line text-sm text-ink-sub hover:bg-paper transition-colors flex items-center">
              이전
            </a>
          )}
          <span className="text-sm text-ink-sub">{page} / {totalPages}</span>
          {page < totalPages && (
            <a href={buildPageUrl(page + 1)}
              className="h-8 px-3 rounded-lg border border-brand-line text-sm text-ink-sub hover:bg-paper transition-colors flex items-center">
              다음
            </a>
          )}
        </div>
      )}
    </div>
  )
}
