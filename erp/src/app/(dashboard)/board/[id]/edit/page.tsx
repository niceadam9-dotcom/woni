import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { LayoutList, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PostFormClient } from '@/components/board/post-form-client'

export default async function BoardEditPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  const [{ data: post }, { data: categories }] = await Promise.all([
    admin.from('board_posts').select('*').eq('id', id).eq('is_deleted', false).single(),
    admin.from('board_categories').select('id, name').eq('is_active', true).order('name'),
  ])

  if (!post) notFound()

  type PostRow = { id: string; title: string; content: string; category_id: string; is_notice: boolean; author_id: string }
  const p = post as PostRow

  if (p.author_id !== profile.id && profile.role === 'employee') redirect(`/board/${id}`)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/board" className="hover:text-[#7b68ee] flex items-center gap-1"><LayoutList className="size-3.5" />게시판</Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <Link href={`/board/${id}`} className="hover:text-[#7b68ee]">게시물</Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">수정</span>
      </div>
      <h1 className="text-xl font-bold text-[#090c1d]">게시물 수정</h1>
      <PostFormClient
        categories={(categories ?? []) as { id: string; name: string }[]}
        existing={p}
        isAdmin={profile.role === 'admin'}
      />
    </div>
  )
}
