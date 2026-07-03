import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ActionPlanStatusClient } from '@/components/action-plans/action-plan-status-client'
import type { UserRole } from '@/types'

// inspection_report_status는 inspection_plan_items에 연결되어 있어
// inspections에서 plan_items를 경유해 조회 후 단일 객체로 평탄화
function flattenReportStatus(obj: Record<string, unknown> | null): void {
  if (!obj) return
  const items = (obj.inspection_plan_items as Record<string, unknown>[] | null) ?? []
  let status: unknown = null
  for (const it of items) {
    const s = it.inspection_report_status
    const first = Array.isArray(s) ? s[0] : s
    if (first) { status = first; break }
  }
  obj.inspection_report_status = status
  delete obj.inspection_plan_items
}

export default async function ActionPlanStatusPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  // 이행계획 목록: inspection → action_plan → action_plan_status + defect count + complete_report
  const { data: rawPlans } = await admin
    .from('action_plans')
    .select(`
      id, inspection_id, plan_file_url, completion_target_date, submitted_at, sent_at,
      created_at, updated_at,
      inspections:inspection_id (
        id, inspection_type, sequence_num,
        customers:customer_id ( customer_name, customer_code ),
        profiles:assigned_employee_id ( name ),
        inspection_plan_items ( inspection_report_status ( inspection_completed_at ) )
      ),
      action_plan_status ( sent_at, fire_station_submitted_at, defect_certificate_count ),
      action_complete_reports ( id, completed_at, submitted_at )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  // 불량내역 있는 inspections 중 action_plan 미생성 건 (작성대기)
  const { data: uninitiated } = await admin
    .from('inspections')
    .select(`
      id, inspection_type, sequence_num,
      customers:customer_id ( customer_name, customer_code ),
      profiles:assigned_employee_id ( name ),
      inspection_plan_items ( inspection_report_status ( inspection_completed_at ) ),
      inspection_defects ( id )
    `)
    .not('inspection_defects', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100)

  // plan_items 경유로 조회한 report_status를 기존 형태로 평탄화
  for (const p of (rawPlans ?? []) as Record<string, unknown>[]) {
    flattenReportStatus(p.inspections as Record<string, unknown> | null)
  }
  for (const i of (uninitiated ?? []) as Record<string, unknown>[]) {
    flattenReportStatus(i)
  }

  // action_plan이 없는 것만 필터링 (uninitiated에서 이미 plan 있는 것 제외)
  const existingInspectionIds = new Set(
    (rawPlans ?? []).map(p => (p as Record<string, unknown>).inspection_id as string)
  )
  const pendingPlans = ((uninitiated ?? []) as Record<string, unknown>[]).filter(i => {
    const defects = (i.inspection_defects as unknown[]) ?? []
    return defects.length > 0 && !existingInspectionIds.has(i.id as string)
  })

  const canManage = (profile.role as UserRole) !== 'employee'

  return (
    <ActionPlanStatusClient
      actionPlans={(rawPlans ?? []) as Record<string, unknown>[]}
      pendingPlans={pendingPlans}
      canManage={canManage}
    />
  )
}
