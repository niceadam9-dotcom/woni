import { redirect } from 'next/navigation'
import { ShoppingCart } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { OrdersClient } from '@/components/sales/orders-client'
import type { UserRole } from '@/types'

export default async function OrdersPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if ((profile.role as UserRole) === 'employee') redirect('/dashboard')

  const admin = createAdminClient()

  const [ordersRes, customersRes, quotesRes] = await Promise.all([
    admin
      .from('orders')
      .select(`
        id, order_number, order_date, delivery_date,
        total_amount, status, notes, items, created_at,
        customers:customer_id ( customer_name, customer_code ),
        quotes:quote_id ( quote_number ),
        profiles:created_by ( name )
      `)
      .order('created_at', { ascending: false }),
    // 신규 수주 선택지 — 삭제(비활성) 고객 제외(소방계획서_30 S2-2). 기존 행 표시는 위 임베드라 무영향
    admin
      .from('customers')
      .select('id, customer_name, customer_code')
      .eq('is_active', true)
      .order('customer_name'),
    admin
      .from('quotes')
      .select('id, quote_number, total_amount, customer_id')
      .eq('status', '발송')
      .order('quote_date', { ascending: false }),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ShoppingCart className="size-5 text-brand" />
        <h1 className="text-xl font-bold">수주 관리</h1>
      </div>

      <OrdersClient
        orders={(ordersRes.data ?? []) as Record<string, unknown>[]}
        customers={(customersRes.data ?? []) as Record<string, unknown>[]}
        quotes={(quotesRes.data ?? []) as Record<string, unknown>[]}
      />
    </div>
  )
}
