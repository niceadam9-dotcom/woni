import { redirect } from 'next/navigation'
import { FileText } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { QuotesClient } from '@/components/sales/quotes-client'
import type { UserRole } from '@/types'

export default async function QuotesPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  const [quotesRes, customersRes] = await Promise.all([
    admin
      .from('quotes')
      .select(`
        id, quote_number, quote_date, valid_until,
        subtotal, tax_amount, total_amount, status, notes,
        items, created_at,
        customers:customer_id ( customer_name, customer_code ),
        profiles:created_by ( name )
      `)
      .order('created_at', { ascending: false }),
    admin
      .from('customers')
      .select('id, customer_name, customer_code')
      .order('customer_name'),
  ])

  const canManage = (profile.role as UserRole) !== 'employee'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FileText className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">견적 관리</h1>
      </div>

      <QuotesClient
        quotes={(quotesRes.data ?? []) as Record<string, unknown>[]}
        customers={(customersRes.data ?? []) as Record<string, unknown>[]}
        canManage={canManage}
      />
    </div>
  )
}
