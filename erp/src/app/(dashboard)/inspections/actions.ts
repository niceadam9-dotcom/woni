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

  // 같은 고객·연도·차수 중복 방지 — 특별점검만 판정 (정기·일반 이벤트는 차수 개념이 없어 제외, 088)
  const year = new Date(input.inspection_start_date).getFullYear()
  const { data: dupRows } = await admin
    .from('inspections')
    .select('id, plan_type')
    .eq('customer_id', input.customer_id)
    .eq('year', year)
    .eq('sequence_num', input.sequence_num)
  const dup = ((dupRows ?? []) as { id: string; plan_type: string | null }[])
    .find(r => !['monthly', 'event'].includes(r.plan_type ?? ''))
  if (dup) return { error: `${year}년 ${input.sequence_num}차 점검이 이미 존재합니다.` }

  // 최초점검 자동판정 (P32-8): 종합 유형이고 이전 종합점검 이력이 전무하면 최초점검
  let isInitial = false
  if (input.inspection_type === '종합') {
    const { count } = await admin.from('inspections')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', input.customer_id)
      .eq('inspection_type', '종합')
    isInitial = (count ?? 0) === 0
  }

  const { data: raw, error } = await admin
    .from('inspections')
    .insert({
      customer_id: input.customer_id,
      contact_id: input.contact_id || null,
      assigned_employee_id: input.assigned_employee_id,
      inspection_type: input.inspection_type,
      inspection_start_date: input.inspection_start_date,
      sequence_num: input.sequence_num,
      is_initial: isInitial,
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

  // 점검계획일이 없는 고객: 방금 등록한 점검시작일(최초 점검)을 기준일로
  // 연간 계획 자동 생성 — 멱등이라 중복 실행 안전. 일반관리도 동일 경로 (소방계획서_6 D-1 — 정기만 미생성).
  // 점검계획일이 있는 고객은 등록 시 이미 생성됨 — 여기서 점검시작일 기준으로 재생성하면
  // 2차 특별점검이 다른 달에 중복 생성되므로 제외 (기준일 규칙: 점검계획일 최우선)
  const { data: custRaw } = await admin
    .from('customers')
    .select('inspection_type, inspection_category, inspection_sub_type, plan_anchor_date, assigned_employee_id, is_active')
    .eq('id', input.customer_id)
    .single()
  const cust = custRaw as {
    inspection_type: InspectionType; inspection_category: string | null; inspection_sub_type: string | null
    plan_anchor_date: string | null; assigned_employee_id: string | null; is_active: boolean
  } | null
  if (cust && cust.is_active && !cust.plan_anchor_date) {
    const targetYear = Math.max(year, new Date().getFullYear())
    const hdSet = await loadHolidaySet(admin, targetYear)
    await generateYearlyPlanItems(
      admin,
      {
        id: input.customer_id, inspection_type: cust.inspection_type,
        inspection_category: cust.inspection_category, inspection_sub_type: cust.inspection_sub_type,
        plan_anchor_date: null, assigned_employee_id: cust.assigned_employee_id,
      },
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

/** 다일 점검 기간 설정 (P32-9) — 종료일/일수 저장 + 미완료 2~6단계를 종료일 기준 재계산 */
export async function updateInspectionMultidayAction(
  inspectionId: string,
  input: { endDate: string | null; days: number }
): Promise<{ error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('inspection_start_date').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const start = (insp as { inspection_start_date: string }).inspection_start_date
  if (input.endDate && input.endDate < start) return { error: '종료일은 시작일 이후여야 합니다.' }
  const days = Number.isFinite(input.days) && input.days >= 1 && input.days <= 5 ? input.days : 1

  const { error } = await admin.from('inspections')
    .update({ inspection_end_date: input.endDate || null, inspection_days: days } as Record<string, unknown>)
    .eq('id', inspectionId)
  if (error) return { error: `저장 실패: ${error.message}` }

  // 종료일 지정 시 미완료 단계를 종료일 기준으로 재기산 (RPC는 미완료만 갱신)
  if (input.endDate) {
    await admin.rpc('recalc_inspection_steps', { p_inspection_id: inspectionId, p_base_date: input.endDate })
  }
  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}

export async function completeStepAction(
  stepId: string,
  inspectionId: string
): Promise<{ error?: string; justCompleted?: boolean; report9Eligible?: boolean }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()
  const { data: prof0 } = await admin.from('profiles').select('role').eq('id', user.id).single()
  const role = (prof0 as { role: string } | null)?.role ?? 'employee'
  const res = await completeStepCore(admin, user.id, role, stepId, inspectionId)
  if (!res.error) {
    revalidatePath(`/inspections/${inspectionId}`)
    revalidatePath('/inspections')
    revalidatePath('/inspections/calendar')
    revalidatePath('/inspection-plans/monitor')
    revalidatePath('/inspection-plans')
  }
  return res
}

/** 단계 완료 코어 — 역할은 호출자가 1회 조회해 전달, revalidate는 호출자 책임 (일괄 완료 성능, 2026-08-04).
 *  로직은 기존과 동일: 권한·순서 강제·1단계 재계산·점검 완료 전이·계획 동기화. */
async function completeStepCore(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  role: string,
  stepId: string,
  inspectionId: string,
): Promise<{ error?: string; justCompleted?: boolean; report9Eligible?: boolean }> {
  // 본인 담당 점검 또는 manager/admin만 처리 가능
  const { data: insp } = await admin
    .from('inspections')
    .select('assigned_employee_id, status, customer_id, inspection_end_date, inspection_type, plan_type')
    .eq('id', inspectionId)
    .single()

  if (!insp) return { error: '점검을 찾을 수 없습니다.' }

  const isAssigned = (insp as { assigned_employee_id: string }).assigned_employee_id === userId
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
      completed_by: userId,
    } as Record<string, unknown>)
    .eq('id', stepId)

  if (error) return { error: '단계 완료 처리에 실패했습니다.' }

  // 1단계(점검일) 완료 시 확정일 기준으로 미완료 2~6단계 마감일 재계산 (migration 048)
  // — 법정 기한(소방서 보고서 15일 이내 등)은 실제 점검일 기준으로 기산됨.
  // 다일 점검(P32-9): 기산점 = 종료일(inspection_end_date). 없으면 당일.
  if (targetNum === 1) {
    const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
    const endDate = (insp as { inspection_end_date: string | null }).inspection_end_date
    await admin.rpc('recalc_inspection_steps', {
      p_inspection_id: inspectionId,
      p_base_date: endDate || kstToday,
    })
  }

  // 모든 단계 완료 시 inspection status → completed
  const { data: steps } = await admin
    .from('inspection_steps')
    .select('status')
    .eq('inspection_id', inspectionId)

  const allDone = (steps ?? []).every(s => (s as { status: string }).status === 'completed')
  // R0-7: 점검이 방금 완료로 전이됐는지 (이전 상태가 completed가 아니었을 때만)
  const justCompleted = allDone && (insp as { status: string }).status !== 'completed'
  // 별지 9호 제출 대상 = 자체점검(special_*·null) — 정기(monthly)·레거시 event는 외관점검표만이라 제외.
  // 관리유형 무관(소방계획서_6 W-4) — requestReport9Action·getReport9StatusAction isSpecial과 동일 기준
  const _insp = insp as { inspection_type: string; plan_type: string | null }
  const report9Eligible = !_insp.plan_type || _insp.plan_type.startsWith('special')
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
    actor_id: userId,
    action: 'complete_step',
    entity_type: 'inspection_step',
    entity_id: stepId,
    metadata: { inspection_id: inspectionId },
  } as Record<string, unknown>)

  // P-19: 단계 완료 → inspection_status_log + inspection_plan_items 자동 동기화
  // (step_num은 위 targetStep 조회 재사용 — 건별 왕복 1회 절감, 2026-08-04)
  if (targetNum) {
    const stepNum = targetNum
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
            updated_by: userId,
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

  return { justCompleted, report9Eligible }
}

/** 점검달력 데이 패널 — 같은 날 미완료 단계 일괄 완료 (2026-08-04, 성능 개선판).
 *  느렸던 원인: 건별 직렬 실행 + 건마다 역할 조회·revalidate 5회 반복.
 *  개선: 역할 1회 조회 → 같은 점검은 직렬(순서 강제 보존)·점검 간 병렬(동시 6) → revalidate는 마지막 1회.
 *  로직은 completeStepCore 재사용 — 권한·순서·재계산·완료 전이·계획 동기화 동일. 최대 100건. */
export async function bulkCompleteStepsAction(
  items: Array<{ stepId: string; inspectionId: string; label: string }>,
): Promise<{ done: number; failed: Array<{ label: string; error: string }>; error?: string }> {
  const user = await getSessionUser()
  if (!user) return { done: 0, failed: [], error: '인증이 필요합니다.' }
  if (items.length === 0) return { done: 0, failed: [] }
  if (items.length > 100) return { done: 0, failed: [], error: '한 번에 100건까지만 처리할 수 있습니다.' }

  const admin = createAdminClient()
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).single()
  const role = (prof as { role: string } | null)?.role ?? 'employee'

  // 같은 점검의 단계는 직렬(이전 단계 순서 강제 레이스 방지), 점검 간에는 동시 6개 병렬
  const groups = new Map<string, Array<{ stepId: string; inspectionId: string; label: string }>>()
  for (const it of items) {
    const g = groups.get(it.inspectionId) ?? []
    g.push(it)
    groups.set(it.inspectionId, g)
  }

  let done = 0
  const failed: Array<{ label: string; error: string }> = []
  const groupArr = [...groups.values()]
  const CONC = 6
  for (let i = 0; i < groupArr.length; i += CONC) {
    await Promise.all(groupArr.slice(i, i + CONC).map(async group => {
      for (const it of group) {
        try {
          const res = await completeStepCore(admin, user.id, role, it.stepId, it.inspectionId)
          if (res.error) failed.push({ label: it.label, error: res.error })
          else done += 1
        } catch {
          failed.push({ label: it.label, error: '처리 실패' })
        }
      }
    }))
  }

  // 화면 갱신은 마지막 1회 — 건별 반복이 큰 지연 요인이었음
  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspection-plans/monitor')
  revalidatePath('/inspection-plans')
  return { done, failed }
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
