import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PayrollClient } from '@/components/hr/payroll-client'

export default async function PayrollPage() {
  await requireRole(['manager', 'admin'])
  const supabase = createAdminClient()

  const year = new Date().getFullYear()

  const [{ data: payrolls }, { data: employees }] = await Promise.all([
    supabase
      .from('payrolls')
      .select(`
        *,
        profiles:employee_id (id, full_name, department)
      `)
      .eq('pay_year', year)
      .order('pay_month', { ascending: false })
      .order('created_at', { ascending: false }),

    supabase
      .from('profiles')
      .select('id, full_name, department')
      .order('full_name'),
  ])

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">급여 등록</h1>
        <p className="text-sm text-gray-500 mt-0.5">직원 급여 계산 및 지급 관리</p>
      </div>
      <PayrollClient
        payrolls={(payrolls ?? []) as Record<string, unknown>[]}
        employees={(employees ?? []) as { id: string; full_name: string; department: string | null }[]}
        year={year}
      />
    </div>
  )
}
