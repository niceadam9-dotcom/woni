import { redirect } from 'next/navigation'
import { Tag } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CategoryManagerClient } from '@/components/items/category-manager-client'

export default async function ItemCategoriesPage() {
  await requireRole(['manager', 'admin'])

  const admin = createAdminClient()
  const { data: categories } = await admin
    .from('item_categories')
    .select('*')
    .order('name')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Tag className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">품목 분류</h1>
          <p className="text-sm text-[#514b81] mt-0.5">소방설비 부품·소모품 분류를 관리합니다</p>
        </div>
      </div>
      <CategoryManagerClient categories={(categories ?? []) as Record<string, unknown>[]} />
    </div>
  )
}
