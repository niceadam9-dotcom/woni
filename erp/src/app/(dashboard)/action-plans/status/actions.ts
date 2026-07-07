'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'

// 이행계획 상태 로그 upsert
export async function upsertActionPlanStatusAction(input: {
  actionPlanId: string
  sentAt?: string | null
  fireStationSubmittedAt?: string | null
  defectCertificateCount?: number
}): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  await requirePermission('action_plan_manage')
  const admin = createAdminClient()

  const payload: Record<string, unknown> = {
    action_plan_id: input.actionPlanId,
    updated_by:     user.id,
  }
  if (input.sentAt                    !== undefined) payload.sent_at                      = input.sentAt
  if (input.fireStationSubmittedAt    !== undefined) payload.fire_station_submitted_at    = input.fireStationSubmittedAt
  if (input.defectCertificateCount    !== undefined) payload.defect_certificate_count     = input.defectCertificateCount

  const { error } = await admin
    .from('action_plan_status')
    .upsert(payload, { onConflict: 'action_plan_id' })

  if (error) return { error: '저장에 실패했습니다.' }
  revalidatePath('/action-plans/status')
  return {}
}

// 이행계획서 날짜 업데이트
export async function updateActionPlanAction(input: {
  id: string
  completionTargetDate?: string | null
  submittedAt?: string | null
  sentAt?: string | null
}): Promise<{ error?: string }> {
  await requirePermission('action_plan_manage')
  const admin = createAdminClient()

  const payload: Record<string, unknown> = {}
  if (input.completionTargetDate !== undefined) payload.completion_target_date = input.completionTargetDate
  if (input.submittedAt          !== undefined) payload.submitted_at           = input.submittedAt
  if (input.sentAt               !== undefined) payload.sent_at                = input.sentAt

  const { error } = await admin
    .from('action_plans')
    .update(payload)
    .eq('id', input.id)

  if (error) return { error: '저장에 실패했습니다.' }
  revalidatePath('/action-plans/status')
  return {}
}

// 이행완료보고서 날짜 업데이트
export async function updateCompleteReportAction(input: {
  id: string
  completedAt?: string | null
  submittedAt?: string | null
}): Promise<{ error?: string }> {
  await requirePermission('action_plan_manage')
  const admin = createAdminClient()

  const payload: Record<string, unknown> = {}
  if (input.completedAt  !== undefined) payload.completed_at  = input.completedAt
  if (input.submittedAt  !== undefined) payload.submitted_at  = input.submittedAt

  const { error } = await admin
    .from('action_complete_reports')
    .update(payload)
    .eq('id', input.id)

  if (error) return { error: '저장에 실패했습니다.' }
  revalidatePath('/action-plans/status')
  return {}
}
