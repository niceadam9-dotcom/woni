import { redirect } from 'next/navigation'
// Link·PackageOpen 제거 — 배치 발행 진입 칩이 유일한 사용처였다(2026-08-19 폐지)
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadAnchorDates } from '@/lib/inspection-plan-generator'
import { InspectionPlansClient } from '@/components/inspection-plans/inspection-plans-client'
import { fetchAllRows } from '@/lib/supabase/paginate'
import type { InspectionPlan, UserRole } from '@/types'

export type OverdueItem = {
  customer_id: string
  customer_name: string
  inspection_type: string
  assigned_employee_id: string | null
  assigned_employee_name: string | null
  /** 기준일: 점검계획일(수동) → 최초 점검시작일 */
  anchor_date: string
  sequence_num: 1 | 2
  due_month: number
}

export default async function InspectionPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; view?: string; type?: string; status?: string; emp?: string; cust?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const sp = await searchParams
  const now = new Date()
  const year  = sp.year  ? parseInt(sp.year,  10) : now.getFullYear()
  const month = sp.month ? parseInt(sp.month, 10) : now.getMonth() + 1
  // 보기 모드·필터 — 월 이동(key 리마운트) 후에도 URL로 유지
  const viewMode = sp.view === 'calendar' ? 'calendar' as const : 'list' as const
  const filterPlanType = ['special_종합', 'special_작동', 'monthly', 'event'].includes(sp.type ?? '') ? sp.type! : 'all'
  const filterStatus   = ['all', 'confirmed', 'completed', 'cancelled'].includes(sp.status ?? '') ? sp.status! : 'planned'
  const filterEmployee = sp.emp || 'all'
  // 고객명 검색어 — 필터링은 클라이언트가 한다(활성 고객을 통째로 넘기므로). 여기선 복원만.
  const filterCustomer = (sp.cust ?? '').slice(0, 100)

  const admin = createAdminClient()

  // ── Wave 1: 모든 독립적인 쿼리 병렬 실행 ─────────────────────
  const [
    plansRes, currentPlanRes,
    employeesRes, customersRes, yearPlansRes, holidayRes,
  ] = await Promise.all([
    admin.from('inspection_plans').select('*')
      .order('year', { ascending: false }).order('month', { ascending: false }).limit(24),
    admin.from('inspection_plans').select('id').eq('year', year).eq('month', month).maybeSingle(),
    admin.from('profiles').select('id, name, position').eq('is_active', true).eq('is_system', false).order('name'),
    admin.from('customers')
      .select('id, customer_name, inspection_type, inspection_sub_type, assigned_employee_id, address, plan_anchor_date')
      .eq('is_active', true).order('customer_name'),
    admin.from('inspection_plans').select('id, month').eq('year', year),
    admin.from('holidays').select('date, name')
      .gte('date', `${year}-01-01`).lte('date', `${year + 1}-12-31`),
  ])

  const plans       = plansRes.data ?? []
  const currentPlan = currentPlanRes.data as { id: string } | null
  const holidayInfos = (holidayRes.data ?? []) as { date: string; name: string }[]
  const holidays     = holidayInfos.map(h => h.date)

  // yearPlanIds는 wave2 의존성
  const planMonthMap: Record<string, number> = {}
  for (const p of (yearPlansRes.data ?? [])) {
    planMonthMap[(p as { id: string; month: number }).id] = (p as { id: string; month: number }).month
  }
  const yearPlanIds = Object.keys(planMonthMap)

  // ── Wave 2: wave1 결과에 의존하는 쿼리 병렬 실행 ─────────────
  const emptyPage = <T,>() => Promise.resolve({ rows: [] as T[], error: null, truncated: false })
  const [itemsPage, yearPlanItemsPage, anchorMap] = await Promise.all([
    currentPlan
      ? fetchAllRows<Record<string, unknown>>((from, to) =>
          admin.from('inspection_plan_items')
            // D-8: 비활성 고객 항목은 **서버에서** 뺀다. 종전엔 클라이언트 visibleItems만 걸렀는데
            // ①임베드가 null이면 `undefined !== false`가 참이라 fail-open으로 새고 ②비활성 고객
            // 이름이 RSC 페이로드에 실려 나갔다. !inner로 fail-closed 전환(FK 힌트 유지 = PGRST201 방지).
            // 클라이언트 필터는 이중 방어로 남긴다.
            .select(`*, customers:customer_id!inner (customer_name, customer_code, is_active), profiles:assigned_employee_id (name)`)
            .eq('customers.is_active', true)
            .eq('plan_id', currentPlan.id)
            .order('scheduled_date', { ascending: true, nullsFirst: false })
            .order('id')
            .range(from, to))
      : emptyPage<Record<string, unknown>>(),
    yearPlanIds.length > 0
      ? fetchAllRows<{ customer_id: string; sequence_num: number; plan_id: string }>((from, to) =>
          admin.from('inspection_plan_items')
            // 취소 항목도 '계획이 이미 존재(처리됨)'로 간주 — 미점검 초과 재판정 방지 (ADD-20)
            .select('customer_id, sequence_num, plan_id')
            .in('plan_id', yearPlanIds)
            .order('id')
            .range(from, to))
      : emptyPage<{ customer_id: string; sequence_num: number; plan_id: string }>(),
    // 기준일: 점검계획일(수동) → 최초 점검시작일 (초과 판정도 생성과 동일 기준)
    loadAnchorDates(admin, (customersRes.data ?? []) as Array<{ id: string; plan_anchor_date: string | null }>),
  ])

  // 조용한 결손 금지 — 여기가 잘리면 이미 처리된 항목이 '미처리'로 되살아나 승인 무한 반복이 된다
  // (2026-07-14 실사고). 종전 로컬 헬퍼는 오류를 통째로 삼켜 부분 결과를 전량인 척 돌려줬다.
  if (itemsPage.error) console.error(`[inspection-plans] 계획 항목 조회 실패: ${itemsPage.error}`)
  if (yearPlanItemsPage.error) console.error(`[inspection-plans] 연간 계획 항목 조회 실패 — 초과 판정이 부정확할 수 있다: ${yearPlanItemsPage.error}`)
  if (itemsPage.truncated || yearPlanItemsPage.truncated) console.error('[inspection-plans] 조회가 상한(20,000행)에서 잘렸다')
  const items = itemsPage.rows
  const yearPlanItems = yearPlanItemsPage.rows

  // ── 초과 점검 대상 계산 ──────────────────────────────────────
  const handledKey = new Set(
    yearPlanItems.map(i => `${i.customer_id}-${i.sequence_num}-${planMonthMap[i.plan_id]}`)
  )

  const employeeNameMap: Record<string, string> = {}
  for (const e of (employeesRes.data ?? [])) {
    employeeNameMap[(e as { id: string; name: string }).id] = (e as { id: string; name: string }).name
  }

  const overdueItems: OverdueItem[] = []
  for (const c of (customersRes.data ?? [])) {
    const cust = c as {
      id: string; customer_name: string; inspection_type: string
      inspection_sub_type: string | null
      assigned_employee_id: string | null
    }
    // 초과 판정: 종합/작동 1·2차 + 일반관리 1차(점검계획일 달) — 일반관리도 event 자동 생성과 일관되게 관리
    const anchorDate = anchorMap.get(cust.id)
    if (!anchorDate) continue

    const approvalMonth = new Date(anchorDate).getMonth() + 1
    const secondMonth   = ((approvalMonth - 1 + 6) % 12) + 1
    const wraps         = secondMonth < approvalMonth
    const empName       = cust.assigned_employee_id ? (employeeNameMap[cust.assigned_employee_id] ?? null) : null

    if (approvalMonth < month && !handledKey.has(`${cust.id}-1-${approvalMonth}`)) {
      overdueItems.push({
        customer_id: cust.id, customer_name: cust.customer_name,
        inspection_type: cust.inspection_type,
        assigned_employee_id: cust.assigned_employee_id,
        assigned_employee_name: empName,
        anchor_date: anchorDate,
        sequence_num: 1, due_month: approvalMonth,
      })
    }

    // 2차(+6개월)는 종합 대상만 — 작동은 연 1회(2차 없음).
    // ※ 판정은 **고객 축**이다(cust는 customers 행이지 계획 항목이 아니다). 소방계획서_33으로
    //   2차 '행'이 작동으로 저장돼도 '2차가 존재해야 하는가'는 여전히 고객이 정한다.
    // 술어는 153 트리거·생성기와 **같은 축**(sub_type 우선, 미보유 레거시만 inspection_type 폴백)이다.
    //   종전엔 inspection_type만 봐서 일반관리 sub=종합 고객의 2차를 놓쳤다 — 생성기는 그 고객에게
    //   2차를 만드는데 초과 감시만 눈을 감고 있었다(소방계획서_33 S4-4).
    //   영향 실측(2026-08-29): 스테이징 대상 고객 +1(양평2)·실제 초과 행 +0, 운영 +0. 빠지는 고객 0.
    const isComprehensiveTarget = cust.inspection_sub_type === '종합'
      || (cust.inspection_sub_type == null && cust.inspection_type === '종합')
    if (isComprehensiveTarget && !wraps && secondMonth < month && !handledKey.has(`${cust.id}-2-${secondMonth}`)) {
      overdueItems.push({
        customer_id: cust.id, customer_name: cust.customer_name,
        inspection_type: cust.inspection_type,
        assigned_employee_id: cust.assigned_employee_id,
        assigned_employee_name: empName,
        anchor_date: anchorDate,
        sequence_num: 2, due_month: secondMonth,
      })
    }
  }

  // B안(2026-07-08): 일반직원도 계획 관리 전체 개방 — 전체 항목·고객·경보 표시.
  // isEmployee는 담당직원 변경(배정) UI 제한에만 사용
  const isEmployee = (profile.role as UserRole) === 'employee'
  const canManage = can(profile.role as UserRole, 'inspection_plan_manage')

  return (
    <div className="space-y-2">
      {/* 배치 발행 진입점 삭제(2026-08-19 사용자 확정) — 페이지 자체를 폐지했다.
          연차 발행은 고객 상세 소방계획서 탭의 [연차], 계획서 생성도 같은 탭이 담당한다. */}
    <InspectionPlansClient
      key={`${year}-${month}`}
      initialViewMode={viewMode}
      initialFilterPlanType={filterPlanType}
      initialFilterStatus={filterStatus}
      initialFilterEmployee={filterEmployee}
      initialFilterCustomer={filterCustomer}
      initialPlans={(plans ?? []) as InspectionPlan[]}
      initialItems={items}
      initialYear={year}
      initialMonth={month}
      employees={(employeesRes.data ?? []) as Array<{ id: string; name: string; position: string | null }>}
      customers={((customersRes.data ?? []) as Array<{ id: string; customer_name: string; inspection_type: import('@/types').InspectionType; assigned_employee_id: string | null; address: string | null; plan_anchor_date: string | null }>)
        // 표시는 점검계획일 원본(미입력이면 입력 유도), 날짜 제안·자동 계산은 기준일(anchor_date)
        .map(c => ({ ...c, anchor_date: anchorMap.get(c.id) ?? null }))}
      overdueItems={overdueItems}
      holidays={holidays}
      holidayInfos={holidayInfos}
      canManage={canManage}
      isEmployee={isEmployee}
    />
    </div>
  )
}
