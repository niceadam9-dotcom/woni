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
    // 신규 견적 선택지 — 삭제(비활성) 고객 제외(소방계획서_30 S2-2). 기존 행 표시는 위 임베드라 무영향
    admin
      .from('customers')
      .select('id, customer_name, customer_code')
      .eq('is_active', true)
      .order('customer_name'),
  ])

  const canManage = (profile.role as UserRole) !== 'employee'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FileText className="size-5 text-brand" />
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
