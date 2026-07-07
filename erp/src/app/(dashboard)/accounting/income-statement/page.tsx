import { redirect } from 'next/navigation'
import { TrendingUp } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { IncomeStatementClient } from '@/components/accounting/income-statement-client'

export default async function IncomeStatementPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role, 'accounting_view')) redirect('/dashboard')

  const admin = createAdminClient()
  const today = new Date()
  const yearStart = `${today.getFullYear()}-01-01`
  const yearEnd   = `${today.getFullYear()}-12-31`

  // 승인된 전표의 수익/비용 계정 명세
  const { data: lines } = await admin
    .from('voucher_lines')
    .select(`
      debit_amount, credit_amount,
      account_codes:account_code_id ( code, name, account_type ),
      vouchers:voucher_id ( voucher_date, status )
    `)
    .gte('vouchers.voucher_date', yearStart)
    .lte('vouchers.voucher_date', yearEnd)

  // 청구 기반 매출 (bills)
  const { data: bills } = await admin
    .from('bills')
    .select('total_amount, paid_amount, paid_at, bill_date')
    .gte('bill_date', yearStart)
    .lte('bill_date', yearEnd)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <TrendingUp className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">손익계산서</h1>
      </div>

      <IncomeStatementClient
        lines={(lines ?? []) as Record<string, unknown>[]}
        bills={(bills ?? []) as Record<string, unknown>[]}
        year={today.getFullYear()}
      />
    </div>
  )
}
