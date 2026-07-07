import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ClipboardCheck, Plus } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkTasksClient } from '@/components/tasks/work-tasks-client'

export default async function WorkTasksPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  const [{ data: taskList }, { data: employees }] = await Promise.all([
    admin
      .from('work_tasks')
      .select(`*, assignee:assignee_id (name), creator:created_by (name)`)
      .order('created_at', { ascending: false }),
    admin.from('profiles').select('id, name').eq('is_active', true).order('name'),
  ])

  const canCreate = profile.role === 'manager' || profile.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">업무지시</h1>
            <p className="text-sm text-[#514b81] mt-0.5">업무 지시 및 진행 상황을 관리합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tasks/journal" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
            업무일지
          </Link>
          {canCreate && (
            <Link href="/tasks/new" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
              <Plus className="size-4" />업무 등록
            </Link>
          )}
        </div>
      </div>

      <WorkTasksClient
        tasks={(taskList ?? []) as Record<string, unknown>[]}
        employees={(employees ?? []) as { id: string; name: string }[]}
        currentUserId={profile.id}
        canCreate={canCreate}
      />
    </div>
  )
}
