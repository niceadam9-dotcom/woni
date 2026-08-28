import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { BookMarked, ChevronRight, MapPin, Users, Pencil } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function MeetingNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  const { data: note } = await admin
    .from('meeting_notes')
    .select(`*, author:author_id (id, name)`)
    .eq('id', id)
    .eq('is_deleted', false)
    .single()

  if (!note) notFound()

  type NoteRow = {
    id: string; title: string; content: string; meeting_date: string
    participants: string | null; location: string | null; created_at: string
    author: { id: string; name: string } | null
  }
  const n = note as NoteRow
  const canEdit = profile.id === n.author?.id || profile.role === 'manager' || profile.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-ink-sub">
        <Link href="/board/meeting-notes" className="hover:text-brand flex items-center gap-1">
          <BookMarked className="size-3.5" />회의록
        </Link>
        <ChevronRight className="size-3.5 text-ink-faint" />
        <span className="text-ink font-medium truncate max-w-[200px]">{n.title}</span>
      </div>

      <div className="max-w-2xl bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
        <div className="px-6 py-5 border-b border-line">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-ink">{n.title}</h1>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-ink-sub">
                <span className="font-medium">{n.meeting_date}</span>
                {n.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3 text-ink-faint" />{n.location}
                  </span>
                )}
                {n.participants && (
                  <span className="flex items-center gap-1">
                    <Users className="size-3 text-ink-faint" />{n.participants}
                  </span>
                )}
                <span>작성자: {n.author?.name ?? '-'}</span>
              </div>
            </div>
            {canEdit && (
              <Link href={`/board/meeting-notes/${n.id}/edit`}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors shrink-0">
                <Pencil className="size-3" />수정
              </Link>
            )}
          </div>
        </div>
        <div className="px-6 py-6">
          <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{n.content}</div>
        </div>
      </div>

      <div className="max-w-2xl">
        <Link href="/board/meeting-notes" className="text-sm text-brand hover:underline">← 목록으로</Link>
      </div>
    </div>
  )
}
