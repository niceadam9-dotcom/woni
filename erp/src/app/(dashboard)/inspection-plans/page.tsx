import { redirect } from 'next/navigation'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InspectionPlansClient } from '@/components/inspection-plans/inspection-plans-client'
import type { InspectionPlan, UserRole } from '@/types'

export type OverdueItem = {
  customer_id: string
  customer_name: string
  inspection_type: string
  assigned_employee_id: string | null
  assigned_employee_name: string | null
  use_approval_date: string
  sequence_num: 1 | 2
  due_month: number
}

export default async function InspectionPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; view?: string; type?: string; status?: string; emp?: string }>
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
      .select('id, customer_name, inspection_type, assigned_employee_id, address, use_approval_date')
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
  const [currentItemsRes, yearPlanItemsRes] = await Promise.all([
    currentPlan
      ? admin.from('inspection_plan_items')
          .select(`*, customers:customer_id (customer_name, customer_code, is_active), profiles:assigned_employee_id (name)`)
          .eq('plan_id', currentPlan.id)
          .order('scheduled_date', { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    yearPlanIds.length > 0
      ? admin.from('inspection_plan_items')
          // 취소 항목도 '계획이 이미 존재(처리됨)'로 간주 — 미점검 초과 재판정 방지 (ADD-20)
          .select('customer_id, sequence_num, plan_id')
          .in('plan_id', yearPlanIds)
      : Promise.resolve({ data: [] }),
  ])

  const items = (currentItemsRes.data ?? []) as Record<string, unknown>[]
  const yearPlanItems = (yearPlanItemsRes.data ?? []) as { customer_id: string; sequence_num: number; plan_id: string }[]

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
      assigned_employee_id: string | null; use_approval_date: string | null
    }
    if (!cust.use_approval_date) continue

    const approvalMonth = new Date(cust.use_approval_date).getMonth() + 1
    const secondMonth   = ((approvalMonth - 1 + 6) % 12) + 1
    const wraps         = secondMonth < approvalMonth
    const empName       = cust.assigned_employee_id ? (employeeNameMap[cust.assigned_employee_id] ?? null) : null

    if (approvalMonth < month && !handledKey.has(`${cust.id}-1-${approvalMonth}`)) {
      overdueItems.push({
        customer_id: cust.id, customer_name: cust.customer_name,
        inspection_type: cust.inspection_type,
        assigned_employee_id: cust.assigned_employee_id,
        assigned_employee_name: empName,
        use_approval_date: cust.use_approval_date,
        sequence_num: 1, due_month: approvalMonth,
      })
    }

    if (!wraps && secondMonth < month && !handledKey.has(`${cust.id}-2-${secondMonth}`)) {
      overdueItems.push({
        customer_id: cust.id, customer_name: cust.customer_name,
        inspection_type: cust.inspection_type,
        assigned_employee_id: cust.assigned_employee_id,
        assigned_employee_name: empName,
        use_approval_date: cust.use_approval_date,
        sequence_num: 2, due_month: secondMonth,
      })
    }
  }

  // B안(2026-07-08): 일반직원도 계획 관리 전체 개방 — 전체 항목·고객·경보 표시.
  // isEmployee는 담당직원 변경(배정) UI 제한에만 사용
  const isEmployee = (profile.role as UserRole) === 'employee'
  const canManage = can(profile.role as UserRole, 'inspection_plan_manage')

  return (
    <InspectionPlansClient
      key={`${year}-${month}`}
      initialViewMode={viewMode}
      initialFilterPlanType={filterPlanType}
      initialFilterStatus={filterStatus}
      initialFilterEmployee={filterEmployee}
      initialPlans={(plans ?? []) as InspectionPlan[]}
      initialItems={items}
      initialYear={year}
      initialMonth={month}
      employees={(employeesRes.data ?? []) as Array<{ id: string; name: string; position: string | null }>}
      customers={(customersRes.data ?? []) as Array<{ id: string; customer_name: string; inspection_type: import('@/types').InspectionType; assigned_employee_id: string | null; address: string | null; use_approval_date: string | null }>}
      overdueItems={overdueItems}
      holidays={holidays}
      holidayInfos={holidayInfos}
      canManage={canManage}
      isEmployee={isEmployee}
    />
  )
}
