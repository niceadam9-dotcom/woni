import { redirect, notFound } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { TaxInvoiceIssueClient } from '@/components/billing/tax-invoice-issue-client'

interface Props {
  searchParams: Promise<{ billId?: string }>
}

export default async function TaxInvoiceIssuePage({ searchParams }: Props) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role, 'tax_invoice_manage')) redirect('/dashboard')

  const { billId } = await searchParams
  if (!billId) redirect('/tax-invoices')

  const admin = createAdminClient()

  const { data: bill } = await admin
    .from('bills')
    .select(`
      id, billing_month, bill_type, bill_date,
      supply_value, tax_value, total_amount, notes,
      customers:customer_id ( customer_name, customer_code, address ),
      tax_invoices ( id, issue_date, approval_num, invoice_status, issued )
    `)
    .eq('id', billId)
    .single()

  if (!bill) notFound()

  const { data: company } = await admin
    .from('company_profile')
    .select('company_name, business_number, representative, address, phone')
    .limit(1)
    .single()

  return (
    <TaxInvoiceIssueClient
      bill={bill as Record<string, unknown>}
      company={(company ?? {}) as Record<string, unknown>}
    />
  )
}
