import { redirect } from 'next/navigation'
import { StickyNote } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { NotesClient } from '@/components/notes/notes-client'

export default async function NotesPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data: notes } = await admin
    .from('my_notes')
    .select('*')
    .eq('owner_id', profile.id)
    .order('updated_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <StickyNote className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">노트</h1>
          <p className="text-sm text-[#514b81] mt-0.5">점검결과·보수내역 등 업무 기록을 남깁니다</p>
        </div>
      </div>
      <NotesClient notes={(notes ?? []) as Record<string, unknown>[]} />
    </div>
  )
}
