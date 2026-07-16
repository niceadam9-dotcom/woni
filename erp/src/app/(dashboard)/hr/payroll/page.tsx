import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PayrollClient } from '@/components/hr/payroll-client'

export default async function PayrollPage() {
  await requireRole(['manager', 'admin'])
  const supabase = createAdminClient()

  const year = new Date().getFullYear()

  // HR-5 실측 버그 수정: profiles에 full_name·department 컬럼이 없음(실제는 name·department_id)
  // — DB 컬럼을 클라이언트가 기대하는 표시 형태(full_name, 부서명 문자열)로 매핑한다.
  const [{ data: payrollsRaw }, { data: employeesRaw }, { data: depts }] = await Promise.all([
    supabase
      .from('payrolls')
      .select(`
        *,
        profiles:employee_id (id, name, department_id)
      `)
      .eq('pay_year', year)
      .order('pay_month', { ascending: false })
      .order('created_at', { ascending: false }),

    supabase
      .from('profiles')
      .select('id, name, department_id')
      .eq('is_active', true)
      .eq('is_system', false)
      .order('name'),

    supabase.from('departments').select('id, name'),
  ])

  const deptName = new Map((depts ?? []).map(d => [(d as { id: string }).id, (d as { name: string }).name]))
  const toDisplay = (p: { id: string; name: string; department_id: string | null } | null) =>
    p ? { id: p.id, full_name: p.name, department: p.department_id ? deptName.get(p.department_id) ?? null : null } : null

  const payrolls = (payrollsRaw ?? []).map(row => ({
    ...(row as Record<string, unknown>),
    profiles: toDisplay((row as { profiles: { id: string; name: string; department_id: string | null } | null }).profiles),
  }))
  const employees = (employeesRaw ?? [])
    .map(e => toDisplay(e as { id: string; name: string; department_id: string | null })!)

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">급여 등록</h1>
        <p className="text-sm text-gray-500 mt-0.5">직원 급여 계산 및 지급 관리</p>
      </div>
      <PayrollClient
        payrolls={payrolls as Record<string, unknown>[]}
        employees={employees}
        year={year}
      />
    </div>
  )
}
