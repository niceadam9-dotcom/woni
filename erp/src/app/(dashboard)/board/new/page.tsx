import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LayoutList, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PostFormClient } from '@/components/board/post-form-client'

export default async function BoardNewPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data: categories } = await admin
    .from('board_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/board" className="hover:text-[#7b68ee] flex items-center gap-1">
          <LayoutList className="size-3.5" />게시판
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">글쓰기</span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">게시물 등록</h1>
      </div>
      <PostFormClient
        categories={(categories ?? []) as { id: string; name: string }[]}
        isAdmin={profile.role === 'admin'}
      />
    </div>
  )
}
