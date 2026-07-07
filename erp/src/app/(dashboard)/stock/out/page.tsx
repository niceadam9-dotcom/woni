import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PackageMinus } from 'lucide-react'
import { StockMovementClient } from '@/components/stock/stock-movement-client'

export default async function StockOutPage() {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()
  const [{ data: movements }, { data: items }] = await Promise.all([
    admin.from('stock_movements').select(`*, item:item_id (item_code, item_name, unit), creator:created_by (name)`).eq('movement_type', 'out').order('created_at', { ascending: false }),
    admin.from('inventory_items').select('id, item_code, item_name, unit, current_stock, standard_price').eq('is_active', true).order('item_code'),
  ])
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <PackageMinus className="size-6 text-[#7b68ee]" />
        <div><h1 className="text-xl font-bold text-[#090c1d]">출고 등록</h1><p className="text-sm text-[#514b81] mt-0.5">품목 출고 내역을 등록합니다</p></div>
      </div>
      <StockMovementClient
        movements={(movements ?? []) as Record<string, unknown>[]}
        items={(items ?? []) as { id: string; item_code: string; item_name: string; unit: string | null; current_stock: number; standard_price: number | null }[]}
        movementType="out"
      />
    </div>
  )
}
