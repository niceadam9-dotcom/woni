import { redirect } from 'next/navigation'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillingStatusClient } from '@/components/billing/billing-status-client'
import type { UserRole } from '@/types'

export default async function BillingStatusPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  // 정산 권한(매니저 이상) — 역할 목록은 permissions.ts 한 곳에서 관리
  if (!can(profile.role as UserRole, 'billing_manage')) redirect('/dashboard')

  const admin = createAdminClient()
  const now   = new Date()
  const defaultMonth = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`

  // 청구서 목록 (이번 달 기준)
  const { data: bills } = await admin
    .from('bills')
    .select(`
      id, billing_month, bill_type, bill_date,
      supply_value, tax_value, total_amount,
      paid_amount, paid_at, payment_method, notes,
      customers:customer_id ( customer_name, customer_code ),
      tax_invoices ( issued, issue_date, invoice_status )
    `)
    .eq('billing_month', defaultMonth)
    .order('bill_date', { ascending: true })

  // 고객 목록 (청구 등록 폼용)
  const { data: customers } = await admin
    .from('customers')
    .select('id, customer_name, customer_code')
    .eq('is_active', true)
    .order('customer_name')

  return (
    <BillingStatusClient
      initialBills={(bills ?? []) as Record<string, unknown>[]}
      customers={(customers ?? []) as Array<{ id: string; customer_name: string; customer_code: string }>}
      defaultMonth={defaultMonth}
    />
  )
}
