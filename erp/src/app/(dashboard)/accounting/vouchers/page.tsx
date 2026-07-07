import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { VouchersClient } from '@/components/accounting/vouchers-client'

export default async function VouchersPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role, 'accounting_view')) redirect('/dashboard')

  const admin = createAdminClient()

  const [vouchersRes, accountCodesRes] = await Promise.all([
    admin
      .from('vouchers')
      .select(`
        id, voucher_number, voucher_date, voucher_type,
        description, total_amount, status, created_at,
        profiles:created_by ( name ),
        voucher_lines (
          id, debit_amount, credit_amount, description,
          account_codes:account_code_id ( code, name, account_type )
        )
      `)
      .order('voucher_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('account_codes')
      .select('id, code, name, account_type')
      .eq('is_active', true)
      .order('code'),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BookOpen className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">전표 등록</h1>
      </div>

      <VouchersClient
        vouchers={(vouchersRes.data ?? []) as Record<string, unknown>[]}
        accountCodes={(accountCodesRes.data ?? []) as Record<string, unknown>[]}
      />
    </div>
  )
}
