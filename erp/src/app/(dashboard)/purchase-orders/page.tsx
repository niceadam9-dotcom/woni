import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ShoppingCart } from 'lucide-react'
import { PurchaseOrdersClient } from '@/components/purchase-orders/purchase-orders-client'

const STATUS_LABELS: Record<string, string> = { draft: '임시', ordered: '발주완료', received: '입고완료', cancelled: '취소' }

export default async function PurchaseOrdersPage() {
  await requireRole(['manager', 'admin'])

  const admin = createAdminClient()
  const [{ data: pos }, { data: items }, { data: partners }] = await Promise.all([
    admin
      .from('purchase_orders')
      .select(`*, partner:partner_id (partner_name), creator:created_by (name), purchase_order_lines (id, quantity, unit_price, subtotal, item:item_id (item_name, item_code, unit))`)
      .order('order_date', { ascending: false }),
    admin.from('inventory_items').select('id, item_code, item_name, unit, standard_price').eq('is_active', true).order('item_code'),
    admin.from('partners').select('id, partner_name').order('partner_name'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShoppingCart className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">발주 관리</h1>
          <p className="text-sm text-[#514b81] mt-0.5">소방설비 부품·소모품 발주를 등록하고 관리합니다</p>
        </div>
      </div>
      <PurchaseOrdersClient
        orders={(pos ?? []) as Record<string, unknown>[]}
        items={(items ?? []) as { id: string; item_code: string; item_name: string; unit: string | null; standard_price: number | null }[]}
        partners={(partners ?? []) as { id: string; partner_name: string }[]}
      />
    </div>
  )
}
