import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LayoutList, Plus, Search, Pin } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const q = params.q ?? ''
  const categoryFilter = params.category ?? ''

  const admin = createAdminClient()

  const [{ data: posts }, { data: categories }] = await Promise.all([
    admin
      .from('board_posts')
      .select(`
        *,
        author:author_id (name),
        category:category_id (name)
      `)
      .eq('is_deleted', false)
      .order('is_notice', { ascending: false })
      .order('created_at', { ascending: false }),
    admin
      .from('board_categories')
      .select('id, name')
      .eq('is_active', true)
      .order('name'),
  ])

  type PostRow = {
    id: string; title: string; is_notice: boolean; view_count: number; created_at: string
    author: { name: string } | null
    category: { name: string } | null
  }

  let rows = (posts ?? []) as PostRow[]
  if (q) {
    const lq = q.toLowerCase()
    rows = rows.filter(r => r.title.toLowerCase().includes(lq) || (r.author?.name ?? '').toLowerCase().includes(lq))
  }
  if (categoryFilter) rows = rows.filter(r => r.category?.name === categoryFilter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutList className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">게시판</h1>
            <p className="text-sm text-[#514b81] mt-0.5">사내 공지·게시물을 관리합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/board/meeting-notes" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
            회의록
          </Link>
          <Link href="/board/new" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
            <Plus className="size-4" />글쓰기
          </Link>
        </div>
      </div>

      <form method="GET" action="/board" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          <input name="q" defaultValue={q} placeholder="제목·작성자 검색"
            className="h-9 pl-8 pr-3 rounded-lg border border-[#d0ccf5] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-48" />
        </div>
        <select name="category" defaultValue={categoryFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition">
          <option value="">전체 카테고리</option>
          {(categories ?? []).map((c: { id: string; name: string }) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button type="submit" className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">검색</button>
        {(q || categoryFilter) && (
          <a href="/board" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">초기화</a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {rows.length}건</span>
      </form>

      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">게시물이 없습니다</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                {['구분', '제목', '카테고리', '작성자', '작성일', '조회'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#c8c4d0]">
              {rows.map(r => (
                <tr key={r.id} className={`hover:bg-[#f8f9fa] transition-colors ${r.is_notice ? 'bg-[#fafafe]' : ''}`}>
                  <td className="px-4 py-3 w-8">
                    {r.is_notice && <Pin className="size-3.5 text-[#7b68ee]" />}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/board/${r.id}`} className={`hover:text-[#7b68ee] hover:underline ${r.is_notice ? 'font-semibold text-[#090c1d]' : 'font-medium text-[#090c1d]'}`}>
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {r.category ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">{r.category.name}</span>
                    ) : <span className="text-xs text-[#b0acd6]">-</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#514b81]">{r.author?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-[#292d34]">{r.created_at.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs text-[#b0acd6]">{r.view_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
