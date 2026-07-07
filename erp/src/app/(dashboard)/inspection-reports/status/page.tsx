import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ReportStatusClient } from '@/components/inspection-reports/report-status-client'
import type { UserRole } from '@/types'

export default async function InspectionReportStatusPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1

  // plan_items + report_status join
  const { data: items } = await admin
    .from('inspection_plan_items')
    .select(`
      id, plan_id, customer_id, inspection_type, sequence_num,
      scheduled_date, assigned_employee_id, status,
      customers:customer_id ( customer_name, customer_code, address ),
      profiles:assigned_employee_id ( name ),
      inspection_plans:plan_id ( year, month ),
      inspection_report_status (
        inspection_completed_at, notification_date,
        notification_due_date, submission_deadline,
        sent_at, received_at, returned_at,
        fire_station_submitted, fee_billed
      )
    `)
    .neq('status', 'cancelled')
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .limit(300)

  const { data: employees } = await admin
    .from('profiles')
    .select('id, name, position')
    .eq('is_active', true)
    .order('name')

  const canManage = (profile.role as UserRole) !== 'employee'

  return (
    <ReportStatusClient
      initialItems={(items ?? []) as Record<string, unknown>[]}
      employees={(employees ?? []) as Array<{ id: string; name: string; position: string | null }>}
      canManage={canManage}
      defaultYear={year}
      defaultMonth={month}
    />
  )
}
