import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { BookMarked, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { MeetingNoteFormClient } from '@/components/board/meeting-note-form-client'

export default async function MeetingNoteEditPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  const { data: note } = await admin
    .from('meeting_notes')
    .select('*')
    .eq('id', id)
    .eq('is_deleted', false)
    .single()

  if (!note) notFound()

  type NoteRow = { id: string; title: string; content: string; meeting_date: string; participants: string | null; location: string | null; author_id: string }
  const n = note as NoteRow

  if (n.author_id !== profile.id && profile.role === 'employee') redirect(`/board/meeting-notes/${id}`)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/board/meeting-notes" className="hover:text-[#7b68ee] flex items-center gap-1"><BookMarked className="size-3.5" />회의록</Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <Link href={`/board/meeting-notes/${id}`} className="hover:text-[#7b68ee]">상세</Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">수정</span>
      </div>
      <h1 className="text-xl font-bold text-[#090c1d]">회의록 수정</h1>
      <MeetingNoteFormClient existing={{ ...n, participants: n.participants, location: n.location }} />
    </div>
  )
}
