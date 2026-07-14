import { redirect, notFound } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AutoGenerateWizard } from '@/components/inspection-plans/auto-generate-wizard'
import { loadAnchorDates } from '@/lib/inspection-plan-generator'
import type { UserRole } from '@/types'

export default async function AutoGeneratePage({
  params,
}: {
  params: Promise<{ year: string; month: string }>
}) {
  const { year: yearStr, month: monthStr } = await params
  const year  = parseInt(yearStr,  10)
  const month = parseInt(monthStr, 10)

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) notFound()

  const profile = await getProfile()
  if (!profile) redirect('/login')
  if ((profile.role as UserRole) === 'employee') redirect('/inspection-plans')

  const admin = createAdminClient()

  // 이미 계획이 있으면 목록으로
  const { data: existing } = await admin
    .from('inspection_plans')
    .select('id, status')
    .eq('year', year)
    .eq('month', month)
    .single()

  // 전월 계획
  const prevYear  = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const { data: prevPlan } = await admin
    .from('inspection_plans')
    .select('id, year, month')
    .eq('year', prevYear)
    .eq('month', prevMonth)
    .single()

  // 활성 고객 목록
  const { data: customers } = await admin
    .from('customers')
    .select('id, customer_name, customer_code, inspection_type, assigned_employee_id, plan_anchor_date')
    .eq('is_active', true)
    .order('customer_name')

  // 위저드의 날짜 자동 배분은 기준일(점검계획일→점검시작일) 기준
  const anchorMap = await loadAnchorDates(
    admin,
    (customers ?? []) as Array<{ id: string; plan_anchor_date: string | null }>,
  )

  // 직원 목록
  const { data: employees } = await admin
    .from('profiles')
    .select('id, name, position')
    .eq('is_active', true)
    .order('name')

  // 공휴일 (날짜 배정 참고용)
  const { data: holidays } = await admin
    .from('holidays')
    .select('date')
    .in('year', [year])

  return (
    <AutoGenerateWizard
      year={year}
      month={month}
      existingPlanId={existing ? (existing as { id: string }).id : null}
      existingPlanStatus={existing ? (existing as { id: string; status: string }).status : null}
      prevPlan={prevPlan as { id: string; year: number; month: number } | null}
      customers={((customers ?? []) as Array<{
        id: string; customer_name: string; customer_code: string
        inspection_type: string; assigned_employee_id: string | null
      }>).map(c => ({ ...c, anchor_date: anchorMap.get(c.id) ?? null }))}
      employees={(employees ?? []) as Array<{ id: string; name: string; position: string | null }>}
      holidays={((holidays ?? []) as Array<{ date: string }>).map(h => h.date)}
    />
  )
}
