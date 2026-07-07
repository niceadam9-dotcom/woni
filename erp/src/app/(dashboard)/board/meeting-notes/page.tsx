import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BookMarked, Plus, Search } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function MeetingNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const q = params.q ?? ''

  const admin = createAdminClient()
  const { data: notes } = await admin
    .from('meeting_notes')
    .select(`*, author:author_id (name)`)
    .eq('is_deleted', false)
    .order('meeting_date', { ascending: false })

  type NoteRow = {
    id: string; title: string; meeting_date: string; participants: string | null
    location: string | null; created_at: string
    author: { name: string } | null
  }

  let rows = (notes ?? []) as NoteRow[]
  if (q) {
    const lq = q.toLowerCase()
    rows = rows.filter(r =>
      r.title.toLowerCase().includes(lq) ||
      (r.participants ?? '').toLowerCase().includes(lq)
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookMarked className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">회의록</h1>
            <p className="text-sm text-[#514b81] mt-0.5">회의 결과·결정사항을 기록합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/board" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
            게시판
          </Link>
          <Link href="/board/meeting-notes/new"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
            <Plus className="size-4" />회의록 작성
          </Link>
        </div>
      </div>

      <form method="GET" action="/board/meeting-notes" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          <input name="q" defaultValue={q} placeholder="제목·참석자 검색"
            className="h-9 pl-8 pr-3 rounded-lg border border-[#d0ccf5] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-48" />
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">검색</button>
        {q && <a href="/board/meeting-notes" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">초기화</a>}
        <span className="text-xs text-[#514b81] ml-auto">총 {rows.length}건</span>
      </form>

      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">등록된 회의록이 없습니다</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                {['제목', '회의일', '장소', '참석자', '작성자', '작성일', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#c8c4d0]">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-[#f8f9fa] transition-colors">
                  <td className="px-4 py-3 font-medium text-[#090c1d] max-w-[200px] truncate">{r.title}</td>
                  <td className="px-4 py-3 text-xs text-[#292d34]">{r.meeting_date}</td>
                  <td className="px-4 py-3 text-xs text-[#514b81]">{r.location ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-[#514b81] max-w-[150px] truncate">{r.participants ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-[#514b81]">{r.author?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-[#292d34]">{r.created_at.slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/board/meeting-notes/${r.id}`} className="text-xs text-[#7b68ee] hover:underline font-medium">상세보기</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
