'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'
import { generateRollingPlanItems } from '@/lib/inspection-plan-generator'
import { rowInspectionType, rowSubType, isInitialByLaw, planTypeSub } from '@/lib/inspection-round'
import { startInspectionCore } from '@/lib/inspection-start'
import { notifyIfEnabled } from '@/lib/notify'
import { syncInspectionSteps, recalcStepDueDates } from '@/lib/inspection-step-sync'
import { STEP_FORCE_COMPLETE_ACTION, isSelfInspection } from '@/lib/inspection-step-status'
import { dateRangeError } from '@/lib/date-range'
import type { InspectionType } from '@/types'

// ── 점검 보조 참여자 관리 (P31-2) — 보고서 개요의 보조 인력 ──
export async function addAuxParticipantAction(
  inspectionId: string, employeeId: string
): Promise<{ error?: string }> {
  await requirePermission('inspection_register')
  // 유령 행 차단(2026-09-02): employee_id 없는 참여 행은 사람 없이 문서에 참여일만 찍는다
  // (서림사 실사고 — null 보조 2행). 조립(report9-assemble)도 배제하지만 입구에서 먼저 막는다.
  if (!employeeId) return { error: '직원을 선택해주세요.' }
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

  // 차수 정규화 (소방계획서_33 S2-5) — 2차는 법적으로 작동점검이다. 화면(inspection-new-client)이
  // 차수와 무관하게 고객 유형을 실어 보내는데, 고객이 종합이면 새 트리거도 막지 않으므로
  // 여기서 내리지 않으면 수동 등록만 조용히 옛 축(종합) 행을 만든다.
  // 아래 연간 계획 자동 생성(:135 부근)도 같은 고객 행을 읽고 있었다 — 한 번만 읽어 함께 쓴다.
  const { data: custRaw } = await admin
    .from('customers')
    .select('inspection_type, inspection_category, inspection_sub_type, plan_anchor_date, use_approval_date, assigned_employee_id, is_active')
    .eq('id', input.customer_id)
    .single()
  const cust = custRaw as {
    inspection_type: InspectionType; inspection_category: string | null; inspection_sub_type: string | null
    plan_anchor_date: string | null; use_approval_date: string | null
    assigned_employee_id: string | null; is_active: boolean
  } | null
  const custSubType: '종합' | '작동' =
    cust?.inspection_sub_type === '종합' ? '종합'
    : cust?.inspection_sub_type === '작동' ? '작동'
    : cust?.inspection_type === '종합' ? '종합' : '작동'
  const rowType = rowInspectionType(input.inspection_type, custSubType, input.sequence_num)

  // 최초점검 자동판정 — **법령 축**(시행규칙 [별표 3]): 사용승인일부터 60일 이내의 종합점검.
  //
  // ⚠ 종전엔 "이 고객의 종합점검 이력이 DB에 0건이면 최초"였다. 그건 *우리 DB에 언제 등록했는가*를
  //   잰 것이라, 2009년 사용승인 건물을 새로 등록하면 별지 9호에 `[√]최초점검`이 찍혔다 —
  //   법정 서식 허위 기재다. 판정을 사용승인일 축으로 옮긴다(F-1).
  //
  // ⚠ 판정 축이 `rowType`이 아니라 `rowSubType`이다. rowType은 일반관리 고객에서 관리유형을
  //   나르므로('일반관리') 그걸 보면 **일반관리 + 종합 대상 고객은 최초점검이 될 수 없었다**.
  //   점검 종류 축은 rowSubType이 정본이다.
  const rowSub = rowSubType(custSubType, input.sequence_num)
  const isInitial = isInitialByLaw(cust?.use_approval_date, input.inspection_start_date, rowSub)

  const { data: raw, error } = await admin
    .from('inspections')
    .insert({
      customer_id: input.customer_id,
      contact_id: input.contact_id || null,
      assigned_employee_id: input.assigned_employee_id,
      inspection_type: rowType,
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
  if (cust && cust.is_active && !cust.plan_anchor_date) {
    const targetYear = Math.max(year, new Date().getFullYear())
    // 롤링: 최초 점검 기준으로도 올해+내년을 함께 생성 (등록 경로와 동일 규약)
    await generateRollingPlanItems(
      admin,
      {
        id: input.customer_id, inspection_type: cust.inspection_type,
        inspection_category: cust.inspection_category, inspection_sub_type: cust.inspection_sub_type,
        plan_anchor_date: null, assigned_employee_id: cust.assigned_employee_id,
      },
      targetYear, profile.id,
    )
    revalidatePath('/inspection-plans')
  }

  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspections/sms')
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
  // 종전엔 여기서만 직접 비교했다 — 문구·규칙을 공용 lib/date-range로 모은다(2026-08-19).
  // 같은 날(1일 점검)은 허용, 미완성 형식은 통과라는 규약이 다른 기간 칸과 같아진다.
  const multidayErr = dateRangeError(start, input.endDate, '점검 종료일')
  if (multidayErr) return { error: multidayErr }
  const days = Number.isFinite(input.days) && input.days >= 1 && input.days <= 5 ? input.days : 1

  const { error } = await admin.from('inspections')
    .update({ inspection_end_date: input.endDate || null, inspection_days: days } as Record<string, unknown>)
    .eq('id', inspectionId)
  if (error) return { error: `저장 실패: ${error.message}` }

  // 종료일 지정 시 단계 마감일을 종료일 기준으로 재기산.
  // p_include_completed=TRUE(마이그레이션 128, 설계 C1-b): R4 이후엔 점검표만 채워도 2~4단계가
  // 증거로 자동 완료되므로, 완료 행을 건너뛰면 한 점검 안에서 2단계는 옛 종료일·5단계는 새 종료일
  // 기준이 되는 모순이 남는다. 마감일은 "언제까지였는가"라 완료 여부와 무관하게 기준일을 따른다.
  if (input.endDate) {
    await recalcStepDueDates(admin, inspectionId, input.endDate)
  }
  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}

/** 최초점검 수동 재지정 — 별지 9호 3분기의 `[√]최초점검` 칸을 사람이 고친다.
 *
 *  자동판정은 법령 축(사용승인일 + 60일)이지만 사용승인일이 불분명하거나 증축·용도변경처럼
 *  예외가 있을 수 있다. 사람이 고친 값을 자동이 덮으면 안 되므로 출처를 `manual`로 새긴다.
 *
 *  ⚠ **관용 쓰기**: `is_initial_source`는 마이그레이션 155가 적용돼야 존재한다. 없는 컬럼을
 *  update에 넣으면 통째로 실패하므로, 먼저 출처와 함께 시도하고 실패하면 값만 저장한다.
 *  즉 155 적용 전에도 재지정 자체는 동작하고(출처만 못 남긴다), 적용 후엔 저절로 완전해진다
 *  — 151·154가 세운 배포 순서 자유 규약과 같은 방식이다.
 *
 *  ⚠ 작동점검에는 최초점검이 성립하지 않는다(종합점검의 하위 구분이다). 화면이 막지만
 *  서버에서도 거절한다 — 화면만 믿으면 액션이 곧 공개 엔드포인트가 된다. */
export async function updateInspectionInitialAction(
  inspectionId: string,
  isInitial: boolean,
): Promise<{ error?: string; sourceRecorded?: boolean }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('inspection_type, plan_type').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }

  const row = insp as { inspection_type: string | null; plan_type: string | null }
  const sub = planTypeSub(row.plan_type) ?? (row.inspection_type === '종합' ? '종합' : null)
  if (isInitial && sub !== '종합') {
    return { error: '작동점검은 최초점검이 될 수 없습니다 — 최초점검은 종합점검의 하위 구분입니다.' }
  }

  const withSource = await admin.from('inspections')
    .update({ is_initial: isInitial, is_initial_source: 'manual' } as Record<string, unknown>)
    .eq('id', inspectionId)
  let sourceRecorded = true
  if (withSource.error) {
    sourceRecorded = false                       // 컬럼 미적용(155 전) — 값만이라도 저장한다
    const { error } = await admin.from('inspections')
      .update({ is_initial: isInitial } as Record<string, unknown>)
      .eq('id', inspectionId)
    if (error) return { error: `저장 실패: ${error.message}` }
  }

  revalidatePath(`/inspections/${inspectionId}`)
  return { sourceRecorded }
}

/** 단계 수동 완료 — **사유 필수** (소방계획서_21 R4-3·R4-9 / D34-2)
 *
 *  종전엔 사유 없이 status만 바꿨다. 이제 status는 syncInspectionSteps가 증거로부터 계산하므로,
 *  근거 없는 수동 완료는 다음 상세 진입 때 보정에 되돌아간다 — 사용자에겐 "완료했는데 풀렸다"로 보인다.
 *  그래서 수동 경로는 **사유를 받아 step_force_complete 마커로 남기고**, 그 마커가 증거가 되어 유지된다. */
export async function completeStepAction(
  stepId: string,
  inspectionId: string,
  reason: string,
): Promise<{
  error?: string; justCompleted?: boolean; report9Eligible?: boolean
  /** 39 S3-2 — 단계는 완료됐지만 필수 미입력으로 점검 완료 전환이 보류됐다(화면이 alert로 알린다) */
  completionHeld?: { required: number; comp: number }
}> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()
  const { data: prof0 } = await admin.from('profiles').select('role').eq('id', user.id).single()
  const role = (prof0 as { role: string } | null)?.role ?? 'employee'
  const res = await completeStepCore(admin, user.id, role, stepId, inspectionId, reason)
  if (!res.error) {
    revalidatePath(`/inspections/${inspectionId}`)
    revalidatePath('/inspections')
    revalidatePath('/inspections/calendar')
    revalidatePath('/inspections/sms')
    revalidatePath('/inspection-plans')
  }
  return res
}

/** 단계 완료 코어 — 역할은 호출자가 1회 조회해 전달, revalidate는 호출자 책임 (일괄 완료 성능, 2026-08-04).
 *
 *  R4-9(소방계획서_21) 재작성: 종전엔 여기서 `inspection_steps.status`를 **직접** 썼다.
 *  이제 status를 쓰는 함수는 syncInspectionSteps 하나뿐이므로(R4-4 단일 기록자), 이 코어는
 *  ① 권한을 확인하고 ② **사유를 step_force_complete 마커로 남긴 뒤** ③ 동기화를 부른다.
 *  마커가 곧 증거라 보정에 되돌아가지 않는다.
 *
 *  **순서 강제는 폐지**했다(R4-4) — 배치확인서는 협회에서 늦게 오고 점검표는 먼저 채워진다.
 *  순서를 강제하면 첫 단계에서 막혀 뒤 단계를 영영 완료할 수 없다. */
async function completeStepCore(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  role: string,
  stepId: string,
  inspectionId: string,
  reason: string,
): Promise<{
  error?: string; justCompleted?: boolean; report9Eligible?: boolean
  completionHeld?: { required: number; comp: number }
}> {
  const trimmedReason = (reason ?? '').trim()
  if (trimmedReason.length < 5) {
    return { error: '완료 사유를 5자 이상 입력해주세요 — 증거가 없는 완료는 사유가 곧 증빙입니다.' }
  }
  if (trimmedReason.length > 300) return { error: '사유는 300자 이내로 입력해주세요.' }
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

  // 순서 강제 폐지(R4-4) — 대상 단계 번호만 확인해 마커에 담는다
  const { data: targetStep } = await admin
    .from('inspection_steps')
    .select('step_num')
    .eq('id', stepId)
    .single()
  const targetNum = (targetStep as { step_num: number } | null)?.step_num
  if (!targetNum) return { error: '단계를 찾을 수 없습니다.' }

  // 사유를 증거로 남긴다 — 이 마커가 있어야 동기화가 완료 상태를 유지한다(R4-3)
  await admin.from('activity_logs').insert({
    actor_id: userId,
    action: STEP_FORCE_COMPLETE_ACTION,
    entity_type: 'inspection',
    entity_id: inspectionId,
    metadata: { step_num: targetNum, reason: trimmedReason, step_id: stepId },
  } as Record<string, unknown>)

  // 마커를 남겼으니 나머지는 단일 기록자에게 맡긴다 — status 쓰기·recalc·점검 상태 전이·계획 동기화가
  // 전부 syncInspectionSteps 안에서 일어난다(R4-4·R4-5, 복제 금지).
  const { justCompleted, completionHeld, error: syncErr } = await syncInspectionSteps(admin, inspectionId, userId)
  if (syncErr) return { error: syncErr }

  // 별지 9호 제출 대상 = 자체점검(special_*·null) — 정기(monthly)·레거시 event는 외관점검표만이라 제외.
  // 관리유형 무관(소방계획서_6 W-4) — requestReport9Action·getReport9StatusAction isSpecial과 동일 기준
  const _insp = insp as { inspection_type: string; plan_type: string | null }
  const report9Eligible = isSelfInspection(_insp.plan_type)

  // 39 S3-2 — 완료 보류 사유를 화면까지 실어 나른다: 사용자가 [완료]를 누른 직후가 "왜 완료가
  // 안 되지?"의 유일한 순간이다(justCompleted를 쓰는 클라이언트가 종전 0곳이라 채널을 새로 만들었다)
  return { justCompleted, report9Eligible, completionHeld }
}

/** 점검달력 데이 패널 — 같은 날 미완료 단계 일괄 완료 (2026-08-04, 성능 개선판).
 *  느렸던 원인: 건별 직렬 실행 + 건마다 역할 조회·revalidate 5회 반복.
 *  개선: 역할 1회 조회 → 같은 점검은 직렬·점검 간 병렬(동시 6) → revalidate는 마지막 1회.
 *  로직은 completeStepCore 재사용 — 권한·마커·동기화 동일. 최대 100건.
 *
 *  R4-9: **사유 1회 입력으로 묶음 전체에 적용**한다. 달력의 '완료'는 증거가 아니라 사람의 확인이므로
 *  근거를 남겨야 동기화가 되돌리지 않는다(D34-2). 건마다 묻지 않는 대신 한 번은 반드시 받는다. */
export async function bulkCompleteStepsAction(
  items: Array<{ stepId: string; inspectionId: string; label: string }>,
  reason: string,
): Promise<{ done: number; failed: Array<{ label: string; error: string }>; error?: string }> {
  const user = await getSessionUser()
  if (!user) return { done: 0, failed: [], error: '인증이 필요합니다.' }
  if (items.length === 0) return { done: 0, failed: [] }
  if (items.length > 100) return { done: 0, failed: [], error: '한 번에 100건까지만 처리할 수 있습니다.' }
  if ((reason ?? '').trim().length < 5) {
    return { done: 0, failed: [], error: '완료 사유를 5자 이상 입력해주세요 — 사유가 곧 증빙입니다.' }
  }

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
          const res = await completeStepCore(admin, user.id, role, it.stepId, it.inspectionId, reason)
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
  revalidatePath('/inspections/sms')
  revalidatePath('/inspection-plans')
  return { done, failed }
}

/** 점검달력 데이 패널 — 미시작 정기·일반(1단계형) 계획 항목 일괄 완료 (2026-08-05).
 *  건별로 점검 시작(startInspectionCore, 1단계 생성) → 1단계 완료(completeStepCore)까지 처리 —
 *  개별 [점검 시작]→점검 상세→완료와 동일 경로라 상태 로그·계획 동기화도 동일하게 남는다.
 *  자체점검(special_*)은 6단계 법정 절차라 대상 제외 — 시작된 점검의 단계는 bulkCompleteStepsAction 담당. */
export async function bulkStartCompletePlanItemsAction(
  items: Array<{ itemId: string; label: string }>,
  reason: string,
): Promise<{ done: number; failed: Array<{ label: string; error: string }>; error?: string }> {
  const profile = await requirePermission('inspection_plan_manage')
  if (items.length === 0) return { done: 0, failed: [] }
  if (items.length > 100) return { done: 0, failed: [], error: '한 번에 100건까지만 처리할 수 있습니다.' }
  // R4-9: ①을 사람이 확정하는 경로라 근거가 필요하다 — 점검표 응답이 들어오면 그때는 증거로 자동 완료된다
  if ((reason ?? '').trim().length < 5) {
    return { done: 0, failed: [], error: '완료 사유를 5자 이상 입력해주세요 — 사유가 곧 증빙입니다.' }
  }

  const admin = createAdminClient()
  const role = (profile as { role: string }).role

  let done = 0
  const failed: Array<{ label: string; error: string }> = []
  const CONC = 6
  for (let i = 0; i < items.length; i += CONC) {
    await Promise.all(items.slice(i, i + CONC).map(async it => {
      try {
        const { data: itemRaw } = await admin
          .from('inspection_plan_items')
          .select('plan_type, inspection_id, status')
          .eq('id', it.itemId)
          .single()
        const item = itemRaw as { plan_type: string | null; inspection_id: string | null; status: string } | null
        if (!item) { failed.push({ label: it.label, error: '계획 항목을 찾을 수 없습니다.' }); return }
        if (item.plan_type !== 'monthly' && item.plan_type !== 'event') {
          failed.push({ label: it.label, error: '정기·일반(1단계형) 항목만 일괄 완료할 수 있습니다.' }); return
        }
        if (item.inspection_id) {
          failed.push({ label: it.label, error: '이미 점검이 시작된 항목입니다 — 단계 완료로 처리해주세요.' }); return
        }

        const started = await startInspectionCore(admin, profile.id, it.itemId, { skipRevalidate: true })
        if (started.error || !started.inspectionId) {
          failed.push({ label: it.label, error: started.error ?? '점검 생성에 실패했습니다.' }); return
        }
        // 정기·일반은 1단계뿐 (migration 111) — 트리거가 만든 1단계를 바로 완료
        const { data: stepRaw } = await admin
          .from('inspection_steps')
          .select('id')
          .eq('inspection_id', started.inspectionId)
          .eq('step_num', 1)
          .single()
        const stepId = (stepRaw as { id: string } | null)?.id
        if (!stepId) { failed.push({ label: it.label, error: '점검은 시작됐지만 1단계를 찾지 못했습니다.' }); return }
        const res = await completeStepCore(admin, profile.id, role, stepId, started.inspectionId, reason)
        if (res.error) { failed.push({ label: it.label, error: `점검은 시작됨 — 완료 실패: ${res.error}` }); return }
        done += 1
      } catch {
        failed.push({ label: it.label, error: '처리 실패' })
      }
    }))
  }

  revalidatePath('/inspections')
  revalidatePath('/inspections/calendar')
  revalidatePath('/inspections/sms')
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
  revalidatePath('/inspections/sms')
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

// 단계 마감일 미리보기는 lib/step-dates.previewInspectionSteps로 단일화 (DB 트리거 111+121과 같은 산식).
// 종전 previewStepDates는 호출처 없이 달력일 산식을 따로 들고 있어 제거했다.

/** 점검 업무 목록의 고객명 자동완성.
 *
 *  고객 마스터 전체가 아니라 **점검 건이 있는 고객만** 제안한다 — 목록을 거를 검색어이므로
 *  고르는 순간 0건이 되는 이름이 뜨면 안 된다. 그래서 **비활성 고객도 제외한다**(D-8, 2026-08-29):
 *  목록 쿼리가 is_active=true를 무조건 걸므로(page.tsx:90), 비활성 고객을 제안하면 고르는 순간
 *  0건이 되어 위 규약을 정면으로 깬다. 종전 주석의 '취소 필터로 조회 가능'은 그 필터가 폐지돼
 *  더는 성립하지 않는다.
 *
 *  제안은 **고객이 아니라 이름 단위**다 — 고르면 그 이름으로 목록을 거르므로, 동명이 둘이면
 *  둘 다 걸린다. 고객별로 나눠 보여주면 특정 고객만 골라지는 것처럼 오해된다. 건수도 합산. */
export async function searchInspectionCustomersAction(q: string): Promise<{
  customers: { name: string; count: number }[]
}> {
  await getSessionUser()
  const query = q.trim()
  if (!query) return { customers: [] }
  const admin = createAdminClient()

  const { data: matched } = await admin.from('customers')
    .select('id, customer_name, customer_code, is_active')
    .ilike('customer_name', `%${query}%`)
    .eq('is_active', true)                 // D-8 — 비활성 고객은 제안하지 않는다
    .order('customer_name')
    .limit(50)
  const rows = (matched ?? []) as Array<{ id: string; customer_name: string; customer_code: string; is_active: boolean }>
  if (rows.length === 0) return { customers: [] }

  // 점검 건수는 한 번의 조회로 — 고객마다 count 쿼리를 돌리면 제안 하나에 왕복 50번이 된다
  const { data: insps } = await admin.from('inspections')
    .select('customer_id').in('customer_id', rows.map(r => r.id))
  const counts = new Map<string, number>()
  for (const i of (insps ?? []) as Array<{ customer_id: string }>) {
    counts.set(i.customer_id, (counts.get(i.customer_id) ?? 0) + 1)
  }

  const byName = new Map<string, number>()
  for (const r of rows) {
    const n = counts.get(r.id) ?? 0
    if (n === 0) continue
    byName.set(r.customer_name, (byName.get(r.customer_name) ?? 0) + n)
  }

  return {
    customers: [...byName.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
      .slice(0, 8)
      .map(([name, count]) => ({ name, count })),
  }
}
