import { redirect } from 'next/navigation'
import { Package } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ItemsClient } from '@/components/items/items-client'

export default async function ItemsPage() {
  await requireRole(['manager', 'admin'])

  const admin = createAdminClient()
  const [{ data: items }, { data: categories }] = await Promise.all([
    admin
      .from('inventory_items')
      .select(`*, category:category_id (name)`)
      .order('item_code'),
    admin.from('item_categories').select('id, name').order('name'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Package className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">품목 관리</h1>
          <p className="text-sm text-[#514b81] mt-0.5">소방설비 부품·소모품 품목을 등록하고 관리합니다</p>
        </div>
      </div>
      <ItemsClient
        items={(items ?? []) as Record<string, unknown>[]}
        categories={(categories ?? []) as { id: string; name: string }[]}
      />
    </div>
  )
}
