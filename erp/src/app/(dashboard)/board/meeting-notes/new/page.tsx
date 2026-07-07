import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BookMarked, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { MeetingNoteFormClient } from '@/components/board/meeting-note-form-client'

export default async function MeetingNoteNewPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/board/meeting-notes" className="hover:text-[#7b68ee] flex items-center gap-1">
          <BookMarked className="size-3.5" />회의록
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">회의록 작성</span>
      </div>
      <h1 className="text-xl font-bold text-[#090c1d]">회의록 작성</h1>
      <MeetingNoteFormClient />
    </div>
  )
}
