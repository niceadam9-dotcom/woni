'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'
import { generateYearlyPlanItems, loadHolidaySet } from '@/lib/inspection-plan-generator'
import { notifyIfEnabled } from '@/lib/notify'
import type { InspectionType } from '@/types'

// ── 점검 보조 참여자 관리 (P31-2) — 보고서 개요의 보조 인력 ──
export async function addAuxParticipantAction(
  inspectionId: string, employeeId: string
): Promise<{ error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { error } = await admin.from('inspection_participants').insert({
    inspection_id: inspectionId, employee_id: employeeId, role: '보조',
  } as Record<string, unknown>)
  if (error) return { error: error.message.includes('duplicate') ? '이미 추가된 인력입니다.' : '추가에 실패했습니다.' }
  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}

export async function removeParticipantAction(
  participantId: string, inspectionId: string
): Promise<{ error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { error } = await admin.from('inspection_participants').delete().eq('id', participantId)
  if (error) return { error: '삭제에 실패했습니다.' }
  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}

export type CreateInspectionInput = {
  customer_id: string
  contact_id?: string
  assigned_employee_id: string
  inspection_type: InspectionType
  inspection_start_date: string
  sequence_num: 1 | 2
  notes?: string
}

export async function createInspectionAction(
  input: CreateInspectionInput
): Promise<{ error?: string; inspectionId?: string }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  // 같은 고객·연도·차수 중복 방지
  const year = new Date(input.inspection_start_date).getFullYear()
  const { data: dup } = await admin
    .from('inspections')
    .select('id')
    .eq('customer_id', input.customer_id)
    .eq('year', year)
    .eq('sequence_num', input.sequence_num)
    .single()
  if (dup) return { error: `${year}년 ${input.sequence_num}차 점검이 이미 존재합니다.` }

  const { data: raw, error } = await admin
    .from('inspections')
    .insert({
      customer_id: input.customer_id,
      contact_id: input.contact_id || null,
      assigned_employee_id: input.assigned_employee_id,
      inspection_type: input.inspection_type,
      inspection_start_date: input.inspection_start_date,
      sequence_num: input.sequence_num,
      notes: input.notes || null,
      status: 'scheduled',
      created_by: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error || !raw) return { error: '점검 생성에 실패했습니다.' }
  const inspectionId = (raw as { id: string }).id

  // 담당직원에게 알림 (수신 설정 존중)
  await notifyIfEnabled(admin, input.assigned_employee_id, 'assignment', {
    title: '점검 업무 배정',
    message: `새 점검 업무가 배정되었습니다. (${year}년 ${input.sequence_num}차)`,
    type: 'inspection_assigned',
    reference_id: inspectionId,
    reference_type: 'inspection',
  })

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'create_inspection',
    entity_type: 'inspection',
    entity_id: inspectionId,
    metadata: { year, sequence_num: input.sequence_num, customer_id: input.customer_id },
  } as Record<string, unknown>)

  // 사용승인일 없는 소방안전관리 고객: 방금 등록한 점검시작일을 기준일로
  // 연간 계획(정기 포함) 자동 생성 — 멱등이라 중복 실행 안전
  const { data: custRaw } = await admin
    .from('customers')
    .select('inspection_type, use_approval_date, assigned_employee_id, is_active')
    .eq('id', input.customer_id)
    .single()
  const cust = custRaw as {
    inspection_type: InspectionType; use_approval_date: string | null
    assigned_employee_id: string | null; is_active: boolean
  } | null
  if (cust && cust.is_active && cust.inspection_type !== '일반관리' && !cust.use_approval_date) {
    const targetYear = Math.max(year, new Date().getFullYear())
    const hdSet = await loadHolidaySet(admin, targetYear)
    await generateYearlyPlanItems(
      admin,
      { id: input.customer_id, inspection_type: cust.inspection_type, use_approval_date: null, assigned_employee_id: cust.assigned_employee_id },
      targetYear, profile.id, hdSet,
    )
    revalidatePath('/inspection-plans')
  }

  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspection-plans/monitor')
  revalidatePath(`/customers/${input.customer_id}`)
  return { inspectionId }
}

export async function completeStepAction(
  stepId: string,
  inspectionId: string
): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  // 본인 담당 점검 또는 manager/admin만 처리 가능
  const { data: insp } = await admin
    .from('inspections')
    .select('assigned_employee_id, status, customer_id')
    .eq('id', inspectionId)
    .single()

  if (!insp) return { error: '점검을 찾을 수 없습니다.' }

  const { data: prof } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = (prof as { role: string } | null)?.role ?? 'employee'
  const isAssigned = (insp as { assigned_employee_id: string }).assigned_employee_id === user.id
  if (!isAssigned && role === 'employee') {
    return { error: '담당 직원만 단계를 완료할 수 있습니다.' }
  }

  // 완료 순서 강제: 이전 단계가 모두 완료되어야 현재 단계 완료 가능
  const { data: targetStep } = await admin
    .from('inspection_steps')
    .select('step_num')
    .eq('id', stepId)
    .single()
  const targetNum = (targetStep as { step_num: number } | null)?.step_num
  if (targetNum && targetNum > 1) {
    const { data: prevSteps } = await admin
      .from('inspection_steps')
      .select('step_num, status')
      .eq('inspection_id', inspectionId)
      .lt('step_num', targetNum)
    const incomplete = (prevSteps ?? []).filter(s => (s as { status: string }).status !== 'completed')
    if (incomplete.length > 0) {
      const nums = incomplete.map(s => (s as { step_num: number }).step_num).sort().join(', ')
      return { error: `이전 단계(${nums}단계)를 먼저 완료해주세요.` }
    }
  }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('inspection_steps')
    .update({
      status: 'completed',
      completed_at: now,
      completed_by: user.id,
    } as Record<string, unknown>)
    .eq('id', stepId)

  if (error) return { error: '단계 완료 처리에 실패했습니다.' }

  // 1단계(점검일) 완료 시 확정일 기준으로 미완료 2~6단계 마감일 재계산 (migration 048)
  // — 법정 기한(소방서 보고서 15일 이내 등)은 실제 점검일 기준으로 기산되기 때문
  if (targetNum === 1) {
    const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
    await admin.rpc('recalc_inspection_steps', {
      p_inspection_id: inspectionId,
      p_base_date: kstToday,
    })
  }

  // 모든 단계 완료 시 inspection status → completed
  const { data: steps } = await admin
    .from('inspection_steps')
    .select('status')
    .eq('inspection_id', inspectionId)

  const allDone = (steps ?? []).every(s => (s as { status: string }).status === 'completed')
  if (allDone) {
    await admin
      .from('inspections')
      .update({ status: 'completed' } as Record<string, unknown>)
      .eq('id', inspectionId)
  } else if ((insp as { status: string }).status === 'scheduled') {
    await admin
      .from('inspections')
      .update({ status: 'in_progress' } as Record<string, unknown>)
      .eq('id', inspectionId)
  }

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'complete_step',
    entity_type: 'inspection_step',
    entity_id: stepId,
    metadata: { inspection_id: inspectionId },
  } as Record<string, unknown>)

  // P-19: 단계 완료 → inspection_status_log + inspection_plan_items 자동 동기화
  const { data: stepInfo } = await admin
    .from('inspection_steps')
    .select('step_num')
    .eq('id', stepId)
    .single()

  if (stepInfo) {
    const stepNum = (stepInfo as { step_num: number }).step_num
    const { data: planItem } = await admin
      .from('inspection_plan_items')
      .select('id, status')
      .eq('inspection_id', inspectionId)
      .maybeSingle()

    if (planItem) {
      const pid = (planItem as { id: string; status: string }).id
      const STEP_FIELDS: Record<number, string> = {
        1: 'inspection_date',
        2: 'report_submitted_at',
        3: 'sent_at',
        4: 'filed_at',
        5: 'step5_completed_at',
        6: 'step6_completed_at',
      }
      const field = STEP_FIELDS[stepNum]
      if (field) {
        await admin
          .from('inspection_status_log')
          .upsert({
            plan_item_id: pid,
            [field]: now.split('T')[0],
            updated_by: user.id,
          } as Record<string, unknown>, { onConflict: 'plan_item_id' })
      }
      // 1단계 완료 → plan_item status 'confirmed'으로 업데이트
      if (stepNum === 1 && (planItem as { status: string }).status === 'planned') {
        await admin
          .from('inspection_plan_items')
          .update({ status: 'confirmed' } as Record<string, unknown>)
          .eq('id', pid)
      }
    }
  }

  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspection-plans/monitor')
  revalidatePath('/inspection-plans')
  return {}
}

export async function deleteInspectionAction(
  inspectionId: string
): Promise<{ error?: string }> {
  await requirePermission('inspection_delete')
  const admin = createAdminClient()

  // GAP-2: 연결된 계획 항목을 먼저 되돌린다 — FK SET NULL만 되면
  // "완료인데 점검 없음" 모순 상태(INV-3 위반)로 남기 때문.
  // 확정일이 있으면 확정 상태로(재시작 가능), 없으면 계획으로 복귀
  const { data: linkedRaw } = await admin
    .from('inspection_plan_items')
    .select('id, scheduled_date')
    .eq('inspection_id', inspectionId)
  for (const item of (linkedRaw ?? []) as { id: string; scheduled_date: string | null }[]) {
    await admin.from('inspection_plan_items')
      .update({
        inspection_id: null,
        status: item.scheduled_date ? 'confirmed' : 'planned',
      } as Record<string, unknown>)
      .eq('id', item.id)
  }

  const { error } = await admin
    .from('inspections')
    .delete()
    .eq('id', inspectionId)

  if (error) return { error: '점검 삭제에 실패했습니다.' }

  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspection-plans')
  revalidatePath('/inspection-plans/monitor')
  return {}
}

export async function getInspectionWithSteps(inspectionId: string) {
  const admin = createAdminClient()

  const [inspRes, stepsRes] = await Promise.all([
    admin.from('inspections').select('*').eq('id', inspectionId).single(),
    admin.from('inspection_steps').select('*').eq('inspection_id', inspectionId).order('step_num'),
  ])

  return {
    inspection: inspRes.data,
    steps: stepsRes.data ?? [],
  }
}

// 점검 생성 시 6단계 예상 마감일 미리보기
export async function previewStepDates(
  startDate: string
): Promise<{ error?: string; steps?: Array<{ step_num: number; name_ko: string; due_date: string | null }> }> {
  const STEP_DEFS = [
    { step_num: 1, name_ko: '점검일',                                  days: 0  },
    { step_num: 2, name_ko: '배치확인서 보고서 작성',                  days: 7  },
    { step_num: 3, name_ko: '관계인 보고서 제출',                      days: 14 },
    { step_num: 4, name_ko: '소방서 보고서 제출 및 이행계획서 등록',   days: 21 },
    { step_num: 5, name_ko: '소방보수 완료',                          days: 28 },
    { step_num: 6, name_ko: '이행완료보고서 제출',                    days: 35 },
  ]

  const start = new Date(startDate + 'T12:00:00')
  const steps = STEP_DEFS.map(def => {
    const d = new Date(start)
    d.setDate(d.getDate() + def.days)
    return { step_num: def.step_num, name_ko: def.name_ko, due_date: d.toISOString().split('T')[0] }
  })

  return { steps }
}
