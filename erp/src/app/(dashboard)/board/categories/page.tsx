import { redirect } from 'next/navigation'
import { LayoutList } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CategoryManagerClient } from '@/components/board/category-manager-client'

export default async function BoardCategoriesPage() {
  await requireRole(['admin'])

  const admin = createAdminClient()
  const { data: categories } = await admin
    .from('board_categories')
    .select('*')
    .order('name')

  type CategoryRow = {
    id: string; name: string; description: string | null; is_notice_board: boolean; is_active: boolean; created_at: string
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LayoutList className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">게시판 카테고리 관리</h1>
          <p className="text-sm text-[#514b81] mt-0.5">게시판 분류를 등록·관리합니다</p>
        </div>
      </div>
      <CategoryManagerClient categories={(categories ?? []) as CategoryRow[]} />
    </div>
  )
}
