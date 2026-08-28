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
          <LayoutList className="size-6 text-brand" />
          <div>
            <h1 className="text-xl font-bold text-ink">게시판</h1>
            <p className="text-sm text-ink-sub mt-0.5">사내 공지·게시물을 관리합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/board/meeting-notes" className="h-9 px-3 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper transition-colors flex items-center">
            회의록
          </Link>
          <Link href="/board/new" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
            <Plus className="size-4" />글쓰기
          </Link>
        </div>
      </div>

      <form method="GET" action="/board" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
          <input name="q" defaultValue={q} placeholder="제목·작성자 검색"
            className="h-9 pl-8 pr-3 rounded-lg border border-brand-line bg-surface text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition w-48" />
        </div>
        <select name="category" defaultValue={categoryFilter}
          className="h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition">
          <option value="">전체 카테고리</option>
          {(categories ?? []).map((c: { id: string; name: string }) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button type="submit" className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">검색</button>
        {(q || categoryFilter) && (
          <a href="/board" className="h-9 px-3 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper transition-colors flex items-center">초기화</a>
        )}
        <span className="text-xs text-ink-sub ml-auto">총 {rows.length}건</span>
      </form>

      <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-sub">게시물이 없습니다</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper">
                {['구분', '제목', '카테고리', '작성자', '작성일', '조회'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-ink-sub whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(r => (
                <tr key={r.id} className={`hover:bg-paper transition-colors ${r.is_notice ? 'bg-paper' : ''}`}>
                  <td className="px-4 py-3 w-8">
                    {r.is_notice && <Pin className="size-3.5 text-brand" />}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/board/${r.id}`} className={`hover:text-brand hover:underline ${r.is_notice ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {r.category ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-brand-tint text-brand">{r.category.name}</span>
                    ) : <span className="text-xs text-ink-faint">-</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-sub">{r.author?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-ink-strong">{r.created_at.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs text-ink-faint">{r.view_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
