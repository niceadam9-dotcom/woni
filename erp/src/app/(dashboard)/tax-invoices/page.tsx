import { redirect } from 'next/navigation'
import { Receipt } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { TaxInvoiceListClient } from '@/components/billing/tax-invoice-list-client'

export default async function TaxInvoicesPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role, 'tax_invoice_manage')) redirect('/dashboard')

  const admin = createAdminClient()

  const { data: bills } = await admin
    .from('bills')
    .select(`
      id, billing_month, bill_type, bill_date,
      supply_value, tax_value, total_amount, paid_amount, paid_at,
      customers:customer_id ( customer_name, customer_code ),
      tax_invoices ( id, issue_date, approval_num, invoice_status, issued )
    `)
    .order('bill_date', { ascending: false })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Receipt className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">세금계산서 발행</h1>
      </div>

      <TaxInvoiceListClient
        bills={(bills ?? []) as Record<string, unknown>[]}
        canManage
      />
    </div>
  )
}
