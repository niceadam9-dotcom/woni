import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { LayoutList, ChevronRight, Pin, Pencil, Trash2 } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { DeletePostButton } from '@/components/board/delete-post-button'

export default async function BoardPostPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  // 조회수 증가 (RPC 미구현 시 무시)
  try { await admin.rpc('increment_post_view', { post_id: id } as Record<string, unknown>) } catch {}

  const { data: post } = await admin
    .from('board_posts')
    .select(`*, author:author_id (id, name), category:category_id (name)`)
    .eq('id', id)
    .eq('is_deleted', false)
    .single()

  if (!post) notFound()

  type PostRow = {
    id: string; title: string; content: string; is_notice: boolean; view_count: number; created_at: string
    author: { id: string; name: string } | null
    category: { name: string } | null
  }
  const p = post as PostRow
  const canEdit = profile.id === p.author?.id || profile.role === 'manager' || profile.role === 'admin'
  const canDelete = profile.role === 'manager' || profile.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/board" className="hover:text-[#7b68ee] flex items-center gap-1">
          <LayoutList className="size-3.5" />게시판
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium truncate max-w-[200px]">{p.title}</span>
      </div>

      <div className="max-w-3xl bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-5 border-b border-[#c8c4d0]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {p.category && <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">{p.category.name}</span>}
                {p.is_notice && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 flex items-center gap-1">
                    <Pin className="size-3" />공지
                  </span>
                )}
              </div>
              <h1 className="text-lg font-bold text-[#090c1d]">{p.title}</h1>
              <div className="flex items-center gap-3 mt-2 text-xs text-[#514b81]">
                <span>{p.author?.name ?? '-'}</span>
                <span>{p.created_at.slice(0, 10)}</span>
                <span>조회 {p.view_count ?? 0}</span>
              </div>
            </div>
            {(canEdit || canDelete) && (
              <div className="flex items-center gap-2 shrink-0">
                {canEdit && (
                  <Link href={`/board/${p.id}/edit`}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors">
                    <Pencil className="size-3" />수정
                  </Link>
                )}
                {canDelete && <DeletePostButton postId={p.id} />}
              </div>
            )}
          </div>
        </div>

        {/* 본문 */}
        <div className="px-6 py-6">
          <div className="text-sm text-[#090c1d] whitespace-pre-wrap leading-relaxed">{p.content}</div>
        </div>
      </div>

      <div className="max-w-3xl">
        <Link href="/board" className="text-sm text-[#7b68ee] hover:underline">← 목록으로</Link>
      </div>
    </div>
  )
}
