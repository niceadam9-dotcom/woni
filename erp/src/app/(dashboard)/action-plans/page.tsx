import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ActionPlansListClient } from '@/components/action-plans/action-plans-list-client'
import type { UserRole } from '@/types'

export default async function ActionPlansPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if ((profile.role as UserRole) === 'employee') redirect('/dashboard')

  const admin = createAdminClient()

  const { data: plans } = await admin
    .from('action_plans')
    .select(`
      id, completion_target_date, submitted_at, sent_at, plan_file_url,
      created_at, updated_at,
      inspections:inspection_id (
        id, inspection_type, sequence_num, year,
        customers:customer_id ( customer_name, customer_code ),
        profiles:assigned_employee_id ( name )
      ),
      action_plan_status ( sent_at, fire_station_submitted_at, defect_certificate_count ),
      action_complete_reports ( id, completed_at, submitted_at )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <ActionPlansListClient
      plans={(plans ?? []) as Record<string, unknown>[]}
    />
  )
}
