'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'

// 보고서 제출현황 upsert
export async function upsertReportStatusAction(input: {
  planItemId: string
  inspectionCompletedAt?: string | null
  notificationDate?: string | null
  sentAt?: string | null
  receivedAt?: string | null
  returnedAt?: string | null
  fireStationSubmitted?: boolean
  feeBilled?: boolean
}): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  await requirePermission('report_status_manage')
  const admin = createAdminClient()

  const payload: Record<string, unknown> = {
    plan_item_id: input.planItemId,
    updated_by:   user.id,
  }
  // GENERATED ALWAYS AS columns (notification_due_date, submission_deadline) cannot be inserted
  if (input.inspectionCompletedAt !== undefined) payload.inspection_completed_at = input.inspectionCompletedAt
  if (input.notificationDate      !== undefined) payload.notification_date       = input.notificationDate
  if (input.sentAt                !== undefined) payload.sent_at                 = input.sentAt
  if (input.receivedAt            !== undefined) payload.received_at             = input.receivedAt
  if (input.returnedAt            !== undefined) payload.returned_at             = input.returnedAt
  if (input.fireStationSubmitted  !== undefined) payload.fire_station_submitted  = input.fireStationSubmitted
  if (input.feeBilled             !== undefined) payload.fee_billed              = input.feeBilled

  const { error } = await admin
    .from('inspection_report_status')
    .upsert(payload, { onConflict: 'plan_item_id' })

  if (error) return { error: '저장에 실패했습니다.' }
  revalidatePath('/inspection-reports/status')
  return {}
}
