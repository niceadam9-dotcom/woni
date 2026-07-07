import { redirect } from 'next/navigation'
import Link from 'next/link'
import { NotebookPen, Plus } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkJournalClient } from '@/components/tasks/work-journal-client'

export default async function WorkJournalPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data: journals } = await admin
    .from('work_journals')
    .select(`*, author:author_id (name)`)
    .order('work_date', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <NotebookPen className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">업무일지</h1>
            <p className="text-sm text-[#514b81] mt-0.5">일별 업무 수행 내용을 기록합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tasks" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
            업무지시
          </Link>
        </div>
      </div>

      <WorkJournalClient
        journals={(journals ?? []) as Record<string, unknown>[]}
        currentUserId={profile.id}
      />
    </div>
  )
}
