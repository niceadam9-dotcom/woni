'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth'

export async function createPayrollAction(formData: {
  employee_id: string
  pay_year: number
  pay_month: number
  base_salary: number
  overtime_pay: number
  bonus: number
  allowances: number
  income_tax: number
  local_income_tax: number
  national_pension: number
  health_insurance: number
  employment_insurance: number
  other_deductions: number
  pay_date: string
  notes: string
}) {
  const user = await requireRole(['manager', 'admin'])
  const supabase = createAdminClient()

  const { error } = await supabase.from('payrolls').insert({
    ...formData,
    status: '작성중',
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/hr/payroll')
  return { success: true }
}

export async function updatePayrollAction(
  id: string,
  formData: {
    base_salary: number
    overtime_pay: number
    bonus: number
    allowances: number
    income_tax: number
    local_income_tax: number
    national_pension: number
    health_insurance: number
    employment_insurance: number
    other_deductions: number
    pay_date: string
    notes: string
  }
) {
  await requireRole(['manager', 'admin'])
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('payrolls')
    .update(formData)
    .eq('id', id)
    .eq('status', '작성중')

  if (error) return { error: error.message }
  revalidatePath('/hr/payroll')
  return { success: true }
}

export async function updatePayrollStatusAction(
  id: string,
  status: '작성중' | '확정' | '지급완료'
) {
  await requireRole(['manager', 'admin'])
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('payrolls')
    .update({ status })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/hr/payroll')
  return { success: true }
}

export async function deletePayrollAction(id: string) {
  await requireRole(['manager', 'admin'])
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('payrolls')
    .delete()
    .eq('id', id)
    .eq('status', '작성중')

  if (error) return { error: error.message }
  revalidatePath('/hr/payroll')
  return { success: true }
}
