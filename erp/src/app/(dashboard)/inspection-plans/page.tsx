import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InspectionPlansClient } from '@/components/inspection-plans/inspection-plans-client'
import type { InspectionPlan, InspectionPlanItem, UserRole } from '@/types'

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

  // 직원 목록 (담당자 필터용)
  const [employeesRes, customersRes] = await Promise.all([
    admin.from('profiles').select('id, name, position').eq('is_active', true).order('name'),
    admin.from('customers')
      .select('id, customer_name, inspection_type, assigned_employee_id')
      .eq('is_active', true)
      .order('customer_name'),
  ])

  const canManage = (profile.role as UserRole) !== 'employee'

  return (
    <InspectionPlansClient
      initialPlans={(plans ?? []) as InspectionPlan[]}
      initialItems={items}
      initialYear={year}
      initialMonth={month}
      employees={(employeesRes.data ?? []) as Array<{ id: string; name: string; position: string | null }>}
      customers={(customersRes.data ?? []) as Array<{ id: string; customer_name: string; inspection_type: import('@/types').InspectionType; assigned_employee_id: string | null }>}
      canManage={canManage}
    />
  )
}
