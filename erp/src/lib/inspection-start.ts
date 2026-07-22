import { revalidatePath } from 'next/cache'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { InspectionType } from '@/types'

type Admin = ReturnType<typeof createAdminClient>

/** 6단계 마감일 동기화: inspection_steps.due_date ← plan_item.step1~6_date */
export async function syncInspectionStepDates(
  admin: Admin,
  inspectionId: string,
  stepDates: (string | null)[],
) {
  for (let i = 0; i < 6; i++) {
    if (!stepDates[i]) continue
    await admin
      .from('inspection_steps')
      .update({ due_date: stepDates[i] } as Record<string, unknown>)
      .eq('inspection_id', inspectionId)
      .eq('step_num', i + 1)
  }
}

/** 점검 시작 코어 — plan_item → inspections 생성 (권한 검사 없음 — 호출자가 보장).
 *  호출처: [시작] 버튼·확정 자동 시작(특별점검)·일반관리 event 생성 즉시 시작·당일 자동 시작 크론(정기). */
export async function startInspectionCore(
  admin: Admin,
  actorId: string,
  itemId: string,
): Promise<{ error?: string; inspectionId?: string }> {
  const { data: itemRaw } = await admin
    .from('inspection_plan_items')
    .select('id, customer_id, inspection_type, sequence_num, scheduled_date, assigned_employee_id, contact_id, inspection_id, status, plan_type, step1_date, step2_date, step3_date, step4_date, step5_date, step6_date')
    .eq('id', itemId)
    .single()

  const item = itemRaw as {
    id: string; customer_id: string; inspection_type: InspectionType
    sequence_num: 1 | 2; scheduled_date: string | null
    assigned_employee_id: string | null; contact_id: string | null
    inspection_id: string | null; status: string; plan_type: string | null
    step1_date: string | null; step2_date: string | null; step3_date: string | null
    step4_date: string | null; step5_date: string | null; step6_date: string | null
  } | null

  if (!item) return { error: '계획 항목을 찾을 수 없습니다.' }
  if (item.inspection_id) return { error: '이미 점검이 시작된 항목입니다.' }
  if (!item.scheduled_date) return { error: '점검 예정일을 입력 후 점검을 시작해주세요.' }

  // 담당 미배정 항목은 점검을 시작한 직원을 담당으로 자동 배정 (모바일 점검시작과 동일 규칙)
  const autoAssigned = !item.assigned_employee_id
  const assigneeId = item.assigned_employee_id ?? actorId

  // inspections 레코드 생성 — DB 트리거가 체크리스트 자동 생성
  // (특별점검 6단계 / 정기·일반관리 1단계 — plan_type으로 분기, migration 088)
  const { data: inspRaw, error: inspErr } = await admin
    .from('inspections')
    .insert({
      customer_id:          item.customer_id,
      assigned_employee_id: assigneeId,
      contact_id:           item.contact_id,
      inspection_type:      item.inspection_type,
      sequence_num:         item.sequence_num,
      inspection_start_date: item.scheduled_date,
      status:               'in_progress',
      created_by:           actorId,
      plan_type:            item.plan_type ?? null,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (inspErr || !inspRaw) return { error: '점검 생성에 실패했습니다.' }
  const inspectionId = (inspRaw as { id: string }).id

  // plan_item에 inspection_id 연결, status → completed (자동 배정 시 담당도 함께 기록)
  await admin
    .from('inspection_plan_items')
    .update({
      inspection_id: inspectionId,
      status: 'completed',
      ...(autoAssigned ? { assigned_employee_id: assigneeId } : {}),
    } as Record<string, unknown>)
    .eq('id', itemId)

  // 6단계 마감일을 확정일 기준(plan_item.step1~6_date)으로 동기화 —
  // DB 트리거는 use_approval_date 기준으로 due_date를 생성하므로 확정일과 어긋남 (Victory9: 기준일 = 1단계 확정일)
  await syncInspectionStepDates(admin, inspectionId, [
    item.step1_date, item.step2_date, item.step3_date,
    item.step4_date, item.step5_date, item.step6_date,
  ])

  await admin.from('activity_logs').insert({
    actor_id:    actorId,
    action:      'inspection_started',
    entity_type: 'inspection',
    entity_id:   inspectionId,
    metadata:    { plan_item_id: itemId, customer_id: item.customer_id, ...(autoAssigned ? { auto_assigned_to: assigneeId } : {}) },
  } as Record<string, unknown>)

  revalidatePath('/inspection-plans')
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspection-plans/monitor')
  return { inspectionId }
}
