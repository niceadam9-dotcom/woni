'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'

// 불량내역 기반 이행계획 자동 생성
export async function createActionPlanAction(input: {
  inspectionId: string
  completionTargetDate?: string | null
}): Promise<{ error?: string; id?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  await requirePermission('action_plan_manage')
  const admin = createAdminClient()

  // 중복 방지: inspection_id UNIQUE
  const { data: existing } = await admin
    .from('action_plans')
    .select('id')
    .eq('inspection_id', input.inspectionId)
    .single()

  if (existing) return { error: '이미 이행계획서가 생성되어 있습니다.' }

  const { data, error } = await admin
    .from('action_plans')
    .insert({
      inspection_id:          input.inspectionId,
      completion_target_date: input.completionTargetDate ?? null,
      created_by:             user.id,
    })
    .select('id')
    .single()

  if (error) return { error: '이행계획서 생성에 실패했습니다.' }
  revalidatePath('/action-plans')
  revalidatePath(`/inspections/${input.inspectionId}`)
  return { id: (data as { id: string }).id }
}

// 이행계획서 수정 (완료목표일·제출일·송부일)
export async function updateActionPlanDetailAction(input: {
  id: string
  completionTargetDate?: string | null
  submittedAt?: string | null
  sentAt?: string | null
  planFileUrl?: string | null
}): Promise<{ error?: string }> {
  await requirePermission('action_plan_manage')
  const admin = createAdminClient()

  const payload: Record<string, unknown> = {}
  if (input.completionTargetDate !== undefined) payload.completion_target_date = input.completionTargetDate
  if (input.submittedAt          !== undefined) payload.submitted_at           = input.submittedAt
  if (input.sentAt               !== undefined) payload.sent_at                = input.sentAt
  if (input.planFileUrl          !== undefined) payload.plan_file_url          = input.planFileUrl

  const { error } = await admin.from('action_plans').update(payload).eq('id', input.id)
  if (error) return { error: '저장에 실패했습니다.' }
  revalidatePath('/action-plans')
  revalidatePath('/action-plans/status')
  return {}
}

// 이행계획 상태 로그 upsert (소방서 제출일·증명서 수)
export async function upsertPlanStatusAction(input: {
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
  if (input.sentAt                 !== undefined) payload.sent_at                    = input.sentAt
  if (input.fireStationSubmittedAt !== undefined) payload.fire_station_submitted_at  = input.fireStationSubmittedAt
  if (input.defectCertificateCount !== undefined) payload.defect_certificate_count   = input.defectCertificateCount

  const { error } = await admin
    .from('action_plan_status')
    .upsert(payload, { onConflict: 'action_plan_id' })

  if (error) return { error: '저장에 실패했습니다.' }
  revalidatePath('/action-plans')
  return {}
}

// 이행완료보고서 upsert
export async function upsertCompleteReportAction(input: {
  actionPlanId: string
  completedAt?: string | null
  submittedAt?: string | null
  reportFileUrl?: string | null
}): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  await requirePermission('action_plan_manage')
  const admin = createAdminClient()

  // 기존 레코드 조회
  const { data: existing } = await admin
    .from('action_complete_reports')
    .select('id')
    .eq('action_plan_id', input.actionPlanId)
    .single()

  if (existing) {
    const payload: Record<string, unknown> = {}
    if (input.completedAt   !== undefined) payload.completed_at   = input.completedAt
    if (input.submittedAt   !== undefined) payload.submitted_at   = input.submittedAt
    if (input.reportFileUrl !== undefined) payload.report_file_url = input.reportFileUrl
    await admin.from('action_complete_reports').update(payload).eq('id', (existing as { id: string }).id)
  } else {
    await admin.from('action_complete_reports').insert({
      action_plan_id:  input.actionPlanId,
      completed_at:    input.completedAt   ?? null,
      submitted_at:    input.submittedAt   ?? null,
      report_file_url: input.reportFileUrl ?? null,
      created_by:      user.id,
    })
  }

  revalidatePath('/action-plans')
  return {}
}
