import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
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
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const sp = await searchParams
  const now = new Date()
  const year  = sp.year  ? parseInt(sp.year,  10) : now.getFullYear()
  const month = sp.month ? parseInt(sp.month, 10) : now.getMonth() + 1

  const admin = createAdminClient()

  // 최근 24개월 계획 목록
  const { data: plans } = await admin
    .from('inspection_plans')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(24)

  // 선택 달 계획 항목
  const { data: currentPlan } = await admin
    .from('inspection_plans')
    .select('id')
    .eq('year', year)
    .eq('month', month)
    .single()

  let items: Record<string, unknown>[] = []
  if (currentPlan) {
    const { data } = await admin
      .from('inspection_plan_items')
      .select(`
        *,
        customers:customer_id ( customer_name, customer_code ),
        profiles:assigned_employee_id ( name )
      `)
      .eq('plan_id', (currentPlan as { id: string }).id)
      .order('scheduled_date', { ascending: true, nullsFirst: false })
    items = (data ?? []) as Record<string, unknown>[]
  }

  // 직원·고객·올해 계획 목록 병렬 조회
  const [employeesRes, customersRes, yearPlansRes] = await Promise.all([
    admin.from('profiles').select('id, name, position').eq('is_active', true).order('name'),
    admin.from('customers')
      .select('id, customer_name, inspection_type, assigned_employee_id, address, use_approval_date')
      .eq('is_active', true)
      .order('customer_name'),
    admin.from('inspection_plans').select('id, month').eq('year', year),
  ])

  // ── 초과 점검 대상 계산 ──────────────────────────────────────
  // 올해 계획에 등록된 항목 (취소 제외) → "customer_id-sequence_num-plan_month" 키 집합
  const planMonthMap: Record<string, number> = {}
  for (const p of (yearPlansRes.data ?? [])) {
    planMonthMap[(p as { id: string; month: number }).id] = (p as { id: string; month: number }).month
  }
  const yearPlanIds = Object.keys(planMonthMap)

  let yearPlanItems: { customer_id: string; sequence_num: number; plan_id: string }[] = []
  if (yearPlanIds.length > 0) {
    const { data } = await admin
      .from('inspection_plan_items')
      .select('customer_id, sequence_num, plan_id')
      .in('plan_id', yearPlanIds)
      .neq('status', 'cancelled')
    yearPlanItems = (data ?? []) as typeof yearPlanItems
  }

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
    const wraps         = secondMonth < approvalMonth   // 2차가 내년으로 넘어가는 경우
    const empName       = cust.assigned_employee_id ? (employeeNameMap[cust.assigned_employee_id] ?? null) : null

    // 1차: 사용승인월이 현재 보기 월 이전이고 계획에 없음
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

    // 2차: 같은 해 안에서 secondMonth가 현재 월 이전이고 계획에 없음 (내년 넘김은 제외)
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

  // 공휴일: 해당 연도 + 다음 연도(연말 경계 처리)
  const { data: holidayData } = await admin
    .from('holidays')
    .select('date')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year + 1}-12-31`)
  const holidays: string[] = (holidayData ?? []).map((h: { date: string }) => h.date)

  const canManage = (profile.role as UserRole) !== 'employee'

  return (
    <InspectionPlansClient
      key={`${year}-${month}`}
      initialPlans={(plans ?? []) as InspectionPlan[]}
      initialItems={items}
      initialYear={year}
      initialMonth={month}
      employees={(employeesRes.data ?? []) as Array<{ id: string; name: string; position: string | null }>}
      customers={(customersRes.data ?? []) as Array<{ id: string; customer_name: string; inspection_type: import('@/types').InspectionType; assigned_employee_id: string | null; address: string | null; use_approval_date: string | null }>}
      overdueItems={overdueItems}
      holidays={holidays}
      canManage={canManage}
    />
  )
}
