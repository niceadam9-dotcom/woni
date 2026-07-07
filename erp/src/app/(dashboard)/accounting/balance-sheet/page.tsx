import { redirect } from 'next/navigation'
import { Scale } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { BalanceSheetClient } from '@/components/accounting/balance-sheet-client'

export default async function BalanceSheetPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role, 'accounting_view')) redirect('/dashboard')

  const admin = createAdminClient()
  const today = new Date().toISOString().split('T')[0]

  // 승인된 전표의 자산/부채/자본 계정 명세 (누적)
  const { data: lines } = await admin
    .from('voucher_lines')
    .select(`
      debit_amount, credit_amount,
      account_codes:account_code_id ( code, name, account_type )
    `)
    .eq('vouchers.status', '승인')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Scale className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">재무상태표</h1>
      </div>

      <BalanceSheetClient
        lines={(lines ?? []) as Record<string, unknown>[]}
        asOf={today}
      />
    </div>
  )
}
