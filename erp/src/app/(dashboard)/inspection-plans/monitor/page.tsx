import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { MonitorClient } from '@/components/inspection-plans/monitor-client'
import type { UserRole } from '@/types'

export default async function InspectionMonitorPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1

  // 이번 달의 plan_id 목록 먼저 조회
  const { data: plans } = await admin
    .from('inspection_plans')
    .select('id')
    .eq('year', year)
    .eq('month', month)

  const planIds = (plans ?? []).map((p: { id: string }) => p.id)

  // 해당 월의 plan_items + status_log join
  let items: Record<string, unknown>[] = []
  if (planIds.length > 0) {
    const { data } = await admin
      .from('inspection_plan_items')
      .select(`
        id, plan_id, customer_id, inspection_type, sequence_num,
        scheduled_date, assigned_employee_id, status,
        customers:customer_id ( customer_name, customer_code, address, customer_contacts ( role, name, phone ) ),
        contacts:customer_contacts!contact_id ( role, name, phone ),
        profiles:assigned_employee_id ( name ),
        inspection_plans:plan_id ( year, month ),
        inspection_status_log ( inspection_date, report_submitted_at, sent_at, filed_at, step5_completed_at, step6_completed_at, sms_confirmed, sms_sent_at, sms_content )
      `)
      .in('plan_id', planIds)
      .neq('status', 'cancelled')
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .limit(500)
    items = (data ?? []) as Record<string, unknown>[]
  }

  // 직원 목록
  const { data: employees } = await admin
    .from('profiles')
    .select('id, name, position')
    .eq('is_active', true)
    .order('name')

  const canManage = (profile.role as UserRole) !== 'employee'

  return (
    <MonitorClient
      initialItems={(items ?? []) as Record<string, unknown>[]}
      employees={(employees ?? []) as Array<{ id: string; name: string; position: string | null }>}
      canManage={canManage}
      defaultYear={year}
      defaultMonth={month}
      currentUserId={profile.id}
      currentUserRole={profile.role as UserRole}
    />
  )
}
