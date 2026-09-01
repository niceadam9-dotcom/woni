import { revalidatePath } from 'next/cache'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { InspectionType } from '@/types'
import { planTypeSub, isInitialByLaw } from '@/lib/inspection-round'

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

/** 방문일 동기화: inspections.inspection_start_date ← 확정된 점검일 (소방계획서_24 S12-1 / P-19)
 *
 *  이 갱신이 confirmPlanItemStageOneAction 밖(updatePlanItemAction)에만 있던 탓에,
 *  점검확정 화면의 인라인 달력으로 날짜를 바꾸면 계획·체크리스트는 새 날짜인데
 *  inspections만 옛 날짜로 남았다. 별지 9호 점검기간·작업대 기간 카드가 이 값을 읽으므로
 *  "문자·계획 화면은 새 날짜, 서류·작업대는 옛 날짜"로 갈라진다.
 *  → 확정 함수 안으로 옮겨 어느 호출처로 들어와도 같이 움직이게 한다.
 *
 *  다일 점검(inspection_days 2~5)에서 종료일이 새 시작일보다 앞서면 종료일도 함께 민다. */
export async function syncInspectionVisitDate(
  admin: Admin,
  inspectionId: string,
  startDate: string,
) {
  const { data: raw } = await admin
    .from('inspections')
    .select('inspection_end_date')
    .eq('id', inspectionId)
    .single()
  const endDate = (raw as { inspection_end_date: string | null } | null)?.inspection_end_date
  const patch: Record<string, unknown> = { inspection_start_date: startDate }
  if (endDate && endDate < startDate) patch.inspection_end_date = startDate
  await admin.from('inspections').update(patch).eq('id', inspectionId)
}

/** 1단계(점검일)가 이미 완료된 점검인가 — 완료 후에는 계획 쪽에서 날짜를 못 바꾼다(사실 기록).
 *  소방계획서_24 S12-3: 종전에는 updatePlanItemAction에만 있어서 인라인 달력이 우회했다. */
export async function isStepOneCompleted(admin: Admin, inspectionId: string): Promise<boolean> {
  const { data } = await admin
    .from('inspection_steps')
    .select('status')
    .eq('inspection_id', inspectionId)
    .eq('step_num', 1)
    .single()
  return (data as { status: string } | null)?.status === 'completed'
}

/** 점검 시작 코어 — plan_item → inspections 생성 (권한 검사 없음 — 호출자가 보장).
 *  호출처: [시작] 버튼·확정 자동 시작(자체점검 special_* — 일반관리 포함)·당일 자동 시작 크론(정기). */
export async function startInspectionCore(
  admin: Admin,
  actorId: string,
  itemId: string,
  opts?: { skipRevalidate?: boolean },
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

  // 최초점검 자동판정 — 법령 축(사용승인일 + 60일). **이 경로가 값을 아예 안 넣고 있었다**(F-2):
  // is_initial이 DB DEFAULT false로 새어, 수동 등록(inspections/actions.ts)과 [시작] 버튼이
  // **같은 고객에 대해 서로 다른 서식**을 만들었다. 두 경로가 같은 순수 함수를 부르게 한다.
  // 고객 행은 임베드가 아니라 별도 조회로 얻는다 — 임베드는 FK가 하나 더 생기는 순간 PGRST201로
  // 조용히 죽는 축이라(145 사고) 이 경로에 그 위험을 들이지 않는다.
  const { data: custRaw } = await admin
    .from('customers').select('use_approval_date').eq('id', item.customer_id).single()
  const rowSub = planTypeSub(item.plan_type)
  const isInitial = rowSub
    ? isInitialByLaw((custRaw as { use_approval_date: string | null } | null)?.use_approval_date,
        item.scheduled_date, rowSub)
    : false

  // inspections 레코드 생성 — DB 트리거가 체크리스트 자동 생성
  // (자체점검 special_*·null = 6단계 / 정기·레거시 event = 1단계 — plan_type으로 분기, migration 111)
  const { data: inspRaw, error: inspErr } = await admin
    .from('inspections')
    .insert({
      customer_id:          item.customer_id,
      assigned_employee_id: assigneeId,
      contact_id:           item.contact_id,
      inspection_type:      item.inspection_type,
      sequence_num:         item.sequence_num,
      inspection_start_date: item.scheduled_date,
      is_initial:           isInitial,
      status:               'in_progress',
      created_by:           actorId,
      plan_type:            item.plan_type ?? null,
      // is_initial_source는 **넣지 않는다** — 마이그레이션 155 적용 전에는 없는 컬럼이라
      // INSERT가 통째로 실패한다. 적용 후에는 DB DEFAULT 'auto'가 같은 값을 준다.
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

  // 일괄 처리에서는 건별 revalidate 반복이 지연 요인 — 호출자가 마지막 1회로 대체
  if (!opts?.skipRevalidate) {
    revalidatePath('/inspection-plans')
    revalidatePath('/inspections')
    revalidatePath('/inspections/calendar')
    revalidatePath('/inspections/sms')
  }
  return { inspectionId }
}
