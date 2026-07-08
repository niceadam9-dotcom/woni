import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ClipboardList } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ActionPlanDetailClient } from '@/components/action-plans/action-plan-detail-client'
import type { UserRole } from '@/types'

export default async function ActionPlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('action_plans')
    .select(`
      id, inspection_id, completion_target_date, submitted_at, sent_at, plan_file_url,
      created_at, updated_at,
      inspections:inspection_id (
        id, inspection_type, sequence_num, year, inspection_start_date,
        customers:customer_id ( customer_name, customer_code, address ),
        profiles:assigned_employee_id ( name, position )
      ),
      action_plan_status ( sent_at, fire_station_submitted_at, defect_certificate_count ),
      action_complete_reports ( id, completed_at, submitted_at, report_file_url )
    `)
    .eq('id', id)
    .single()

  if (!plan) notFound()

  // 불량내역 조회
  const inspectionId = (plan as Record<string, unknown>).inspection_id as string
  const { data: defects } = await admin
    .from('inspection_defects')
    .select('id, defect_code, defect_name, defect_detail, photo_url, severity, created_at')
    .eq('inspection_id', inspectionId)
    .order('created_at')

  const canManage = can(profile.role as UserRole, 'action_plan_manage')

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/action-plans" className="text-[#514b81] hover:text-[#7b68ee]">
          <ChevronLeft className="size-5" />
        </Link>
        <ClipboardList className="size-4 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">이행계획서</h1>
      </div>

      <ActionPlanDetailClient
        plan={plan as Record<string, unknown>}
        defects={(defects ?? []) as Record<string, unknown>[]}
        canManage={canManage}
      />
    </div>
  )
}
