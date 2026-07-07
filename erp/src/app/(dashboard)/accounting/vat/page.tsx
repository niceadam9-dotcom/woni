import { redirect } from 'next/navigation'
import { Receipt } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { VatClient } from '@/components/accounting/vat-client'

export default async function VatPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role, 'accounting_view')) redirect('/dashboard')

  const admin = createAdminClient()
  const today = new Date()
  const yearStart = `${today.getFullYear()}-01-01`
  const yearEnd   = `${today.getFullYear()}-12-31`

  const [billsRes, invoicesRes] = await Promise.all([
    admin
      .from('bills')
      .select('billing_month, supply_value, tax_value, total_amount, paid_at, bill_date')
      .gte('bill_date', yearStart)
      .lte('bill_date', yearEnd)
      .order('bill_date'),
    admin
      .from('tax_invoices')
      .select('issue_date, invoice_status, issued, bills:bill_id ( tax_value )')
      .gte('issue_date', yearStart)
      .lte('issue_date', yearEnd),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Receipt className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">부가가치세 현황</h1>
      </div>

      <VatClient
        bills={(billsRes.data ?? []) as Record<string, unknown>[]}
        invoices={(invoicesRes.data ?? []) as Record<string, unknown>[]}
        year={today.getFullYear()}
      />
    </div>
  )
}
