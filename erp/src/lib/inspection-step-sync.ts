import 'server-only'

import { dismissInspectionDeadlineNotifications } from '@/lib/inspection-notify-dismiss'

/** 점검 단계 **단일 기록자** — `inspection_steps.status`를 쓰는 곳은 이 파일 하나다 (소방계획서_21 R4-4·R4-5 / B-3)
 *
 *  F-5의 두 갈래(증거로 계산하는 타임라인 ✓ vs 버튼으로만 바뀌는 status)를 하나로 합친다.
 *  증거가 생기면 그 단계가 스스로 완료되고, 증거가 사라지면 되돌아간다 — **되돌림에 예외 없음**
 *  (제출일을 지웠으면 미완료로 돌아가는 것이 맞다).
 *
 *  **순서 강제 미적용**: 배치확인서는 협회에서 늦게 오고 점검표는 먼저 채워진다. 순서를 강제하면
 *  첫 단계에서 막혀 아무것도 완료되지 않는다(종전 completeStepCore의 전제와 다른 점).
 *
 *  ⚠ recalc와의 순서(설계 C1-b) — 마이그레이션 128로 해소: 종전 `recalc_inspection_steps`는
 *  **미완료 단계만** 갱신해서, 증거로 자동 완료된 단계가 재계산에서 빠지고 종료일을 나중에 고치면
 *  그 단계의 마감일만 낡은 채 남았다. 이제 두 호출부(여기, updateInspectionMultidayAction)가
 *  `p_include_completed=TRUE`를 넘겨 완료 여부와 무관하게 기준일을 따르므로 순서 의존이 없다. */

import type { createAdminClient } from '@/lib/supabase/admin'
import { isCertFileName, findArchivedCertInspections } from '@/lib/doc-status'
import { countInstalledRequiredBlanks } from '@/lib/sheet-overview'
import {
  evidenceDone, activeStepNums, isSelfInspection, resolveForcedSteps,
  OWNER_REPORT_OFFLINE_ACTION, STEP_FORCE_COMPLETE_ACTION, STEP_FORCE_UNDO_ACTION,
  type StepEvidence, type StepNum,
} from '@/lib/inspection-step-status'

type Admin = ReturnType<typeof createAdminClient>

type InspRow = {
  id: string; customer_id: string; status: string
  inspection_start_date: string | null; inspection_end_date: string | null
  inspection_type: string; plan_type: string | null
  report9_submitted_at: string | null; report11_submitted_at: string | null
}


/** 증거 수집 — 단계 판정에 필요한 값만 모은다. 화면(page.tsx)이 이미 같은 값을 조회하지만
 *  서버 액션에서도 불려야 하므로 여기서 독립적으로 모은다(같은 판정 함수를 쓰므로 결과는 일치). */
export async function gatherStepEvidence(
  admin: Admin, insp: InspRow,
): Promise<StepEvidence> {
  const prefix = `${insp.customer_id}/inspections/${insp.id}`
  const [respRes, filesRes, deliveryRes, defectsRes, logsRes, archivedSet] = await Promise.all([
    admin.from('inspection_sheet_responses').select('id', { count: 'exact', head: true }).eq('inspection_id', insp.id),
    admin.storage.from('fire-plans').list(prefix, { limit: 100 }),
    admin.from('report_deliveries').select('id').eq('inspection_id', insp.id).eq('doc_kind', 'report9_owner').limit(1),
    admin.from('inspection_defects').select('action_completed_at').eq('inspection_id', insp.id),
    // ③ 오프라인 보고·강제 완료·철회 마커 — 마이그레이션 없이 activity_logs를 근거로 쓴다(D34-2).
    // created_at을 함께 읽는다: append-only라 철회는 '나중 마커'로만 표현된다(D1)
    admin.from('activity_logs').select('action, metadata, created_at')
      .eq('entity_type', 'inspection').eq('entity_id', insp.id)
      .in('action', [OWNER_REPORT_OFFLINE_ACTION, STEP_FORCE_COMPLETE_ACTION, STEP_FORCE_UNDO_ACTION])
      .order('created_at')
      .limit(500),
    findArchivedCertInspections(admin, [insp.id]),
  ])

  const defects = (defectsRes.data ?? []) as Array<{ action_completed_at: string | null }>
  const logs = (logsRes.data ?? []) as Array<{ action: string; metadata: Record<string, unknown> | null; created_at: string }>
  const { steps: forced } = resolveForcedSteps(
    logs.map(l => ({ action: l.action, stepNum: Number(l.metadata?.['step_num']), at: l.created_at })),
  )

  return {
    responded: respRes.count ?? 0,
    certFile: (filesRes.data ?? []).some(o => isCertFileName(o.name)),
    certArchived: archivedSet.has(insp.id),
    delivery: (deliveryRes.data ?? []).length > 0,
    offlineReport: logs.some(l => l.action === OWNER_REPORT_OFFLINE_ACTION),
    submit9At: insp.report9_submitted_at,
    defectsTotal: defects.length,
    defectsDone: defects.filter(d => d.action_completed_at).length,
    submit11At: insp.report11_submitted_at,
    forced,
  }
}

/** 단계 완료의 파급 — 점검 status 전이 + 계획 동기화 (R4-5).
 *  종전 completeStepCore(:259-330) 뒷부분을 그대로 옮겨 **공유**한다(복제 금지).
 *  allActiveDone은 호출자가 '유효 단계' 기준으로 판정해 넘긴다 — 트리거가 만든 6행을 그대로 세면
 *  월간 건이 영원히 미완이 된다(F-6). */
export async function applyStepSideEffects(
  admin: Admin,
  opts: {
    inspectionId: string; actorId: string; prevStatus: string
    allActiveDone: boolean
    /** 이번에 새로 완료된 단계 번호 — 계획 동기화(inspection_status_log) 대상 */
    newlyCompleted: number[]
    completedAtIso: string
    /** 39 S3-1 완료 보류 — 설치 시트의 범위 내 무응답 항목이 남았으면 completed 전환을 미룬다
     *  (작동·종합 공통, §0). 판정은 호출자가 임박 시에만 계산해 넘긴다(allActiveDone과 같은 계약).
     *  null/미공급 = 보류 없음(구 호출부 호환). */
    holdCompletion?: { required: number; comp: number } | null
  },
): Promise<{ justCompleted: boolean; completionHeld?: { required: number; comp: number } }> {
  const { inspectionId, actorId, prevStatus, allActiveDone, newlyCompleted, completedAtIso, holdCompletion } = opts

  const hold = !!holdCompletion && holdCompletion.required > 0
  const justCompleted = allActiveDone && !hold && prevStatus !== 'completed'
  if (allActiveDone) {
    if (hold) {
      // 39 S3-1 — 보류: completed로 올리지 않는다. **이미 completed면 소급하지 않는다**(내리지 않음).
      // scheduled였다면 단계가 다 찼어도 '진행중'으로만 — 화면이 보류 사유(배너·alert)를 말한다.
      if (prevStatus === 'scheduled') {
        await admin.from('inspections').update({ status: 'in_progress' } as Record<string, unknown>).eq('id', inspectionId)
      }
    } else if (prevStatus !== 'completed') {
      await admin.from('inspections').update({ status: 'completed' } as Record<string, unknown>).eq('id', inspectionId)
    }
  } else if (prevStatus === 'completed' || prevStatus === 'scheduled') {
    // 되돌림에 예외 없음 — 증거가 사라져 미완이 되면 완료 상태도 물러난다
    await admin.from('inspections').update({ status: 'in_progress' } as Record<string, unknown>).eq('id', inspectionId)
  }

  // 1단계 완료 → 계획 항목 확정 승격.
  //
  // ⚠ 종전에는 여기서 inspection_status_log도 함께 upsert했다(6단계 날짜 6개). 그 테이블은
  //   inspection_steps와 1:1 중복인데 동기화가 **작업대 → 모니터링 단방향뿐**이라,
  //   모니터링에서 날짜를 입력해도 다른 화면은 모르는 채 같은 점검의 진행률이 화면마다 달랐다
  //   (소방계획서_24 P-14·P-15). Q-8로 그 축을 은퇴시키면서 이 쓰기를 걷어냈다.
  //
  // ⚠⚠ **아래 승격은 status_log와 무관한 별개 로직이라 반드시 남긴다.** 함께 지우면
  //   1단계 완료가 계획 항목에 반영되지 않아 점검확정 화면이 계속 '계획중'으로 보인다.
  if (newlyCompleted.includes(1)) {
    const { data: planItem } = await admin.from('inspection_plan_items')
      .select('id, status').eq('inspection_id', inspectionId).maybeSingle()
    const pi = planItem as { id: string; status: string } | null
    if (pi && pi.status === 'planned') {
      await admin.from('inspection_plan_items')
        .update({ status: 'confirmed' } as Record<string, unknown>).eq('id', pi.id)
    }
  }
  return { justCompleted, ...(hold ? { completionHeld: holdCompletion! } : {}) }
}

/** 화면이 서버와 **같은 증거**로 판정하도록 증거 묶음을 그대로 내준다 (독립 검증 D3).
 *  상세 페이지가 이 값을 TimelineData.evidence로 실어 보내면 ✓·진행률이 DB와 갈라질 수 없다. */
export async function loadStepEvidence(
  admin: Admin, inspectionId: string,
): Promise<StepEvidence | null> {
  const { data } = await admin.from('inspections')
    .select('id, customer_id, status, inspection_start_date, inspection_end_date, inspection_type, plan_type, report9_submitted_at, report11_submitted_at')
    .eq('id', inspectionId).maybeSingle()
  const insp = data as InspRow | null
  if (!insp) return null
  return gatherStepEvidence(admin, insp)
}

/** 단계 마감일 재계산 — 완료된 단계까지 포함(마이그레이션 128).
 *  128 미적용 DB에서는 3인자 시그니처가 없어 PGRST202로 실패하므로 종전 2인자로 물러난다.
 *  (마감일이 낡는 문제는 남지만 저장 자체가 실패하는 것보다 낫다 — 128 적용 후 자동으로 해소된다.) */
export async function recalcStepDueDates(
  admin: Admin, inspectionId: string, baseDate: string,
): Promise<void> {
  const { error } = await admin.rpc('recalc_inspection_steps', {
    p_inspection_id: inspectionId, p_base_date: baseDate, p_include_completed: true,
  })
  if (!error) return
  await admin.rpc('recalc_inspection_steps', { p_inspection_id: inspectionId, p_base_date: baseDate })
}

/** 증거 → inspection_steps.status 동기화. **status를 쓰는 유일한 함수**.
 *  상태가 실제로 바뀐 행만 갱신한다(무의미한 쓰기·revalidate 폭풍 방지). */
export async function syncInspectionSteps(
  admin: Admin, inspectionId: string, actorId: string | null,
): Promise<{
  changed: number; justCompleted?: boolean; error?: string
  /** 39 S3 — 완료 보류 사유(필수 미입력 항목 수·그중 ●). 있으면 status가 completed로 안 올라갔다 */
  completionHeld?: { required: number; comp: number }
}> {
  // 점검 행과 단계 행은 서로 독립 — 병렬 조회로 왕복 1회 절약(저장 경로 최적화, 2026-08-15)
  const [{ data: inspRaw }, { data: stepRaw }] = await Promise.all([
    admin.from('inspections')
      .select('id, customer_id, status, inspection_start_date, inspection_end_date, inspection_type, plan_type, report9_submitted_at, report11_submitted_at')
      .eq('id', inspectionId).maybeSingle(),
    admin.from('inspection_steps')
      .select('id, step_num, status').eq('inspection_id', inspectionId),
  ])
  const insp = inspRaw as InspRow | null
  if (!insp) return { changed: 0, error: '점검을 찾을 수 없습니다.' }

  const evidence = await gatherStepEvidence(admin, insp)
  const done = evidenceDone(evidence)
  const isSpecial = isSelfInspection(insp.plan_type)
  const active = activeStepNums(isSpecial, evidence.defectsTotal > 0)

  const steps = (stepRaw ?? []) as Array<{ id: string; step_num: number; status: string }>
  if (steps.length === 0) return { changed: 0 }

  const now = new Date().toISOString()
  const newlyCompleted: number[] = []
  const toComplete: string[] = []
  const toRevert: string[] = []

  for (const s of steps) {
    const n = s.step_num as StepNum
    const want = !!done[n]
    const isDone = s.status === 'completed'
    if (want === isDone) continue
    if (want) { toComplete.push(s.id); newlyCompleted.push(n) } else { toRevert.push(s.id) }
  }

  if (toComplete.length > 0) {
    await admin.from('inspection_steps')
      .update({ status: 'completed', completed_at: now, completed_by: actorId } as Record<string, unknown>)
      .in('id', toComplete)
  }
  if (toRevert.length > 0) {
    await admin.from('inspection_steps')
      .update({ status: 'pending', completed_at: null, completed_by: null } as Record<string, unknown>)
      .in('id', toRevert)
  }
  const changed = toComplete.length + toRevert.length

  // R7-10(소방계획서_21): 단계가 새로 완료되면 그 점검의 미읽음 **기한 알림**을 읽음 처리한다.
  // 삭제가 아니라 읽음 처리다 — 알림은 "언제 알렸는지"의 이력이다. 실패는 삼킨다(동기화를 되돌리지 않는다).
  if (newlyCompleted.length > 0) {
    await dismissInspectionDeadlineNotifications(admin, inspectionId)
  }

  // ①이 새로 완료되면 확정일 기준으로 마감일 재계산 (migration 048 — 법정 기한은 실제 점검일 기산).
  // p_include_completed=TRUE(128): 위에서 방금 2~4단계까지 함께 완료시켰을 수 있는데, 종전 recalc는
  // 완료 행을 건너뛰므로 그 단계만 마감일이 비거나 낡은 채 남았다. 마감일은 완료 여부와 무관하다.
  if (newlyCompleted.includes(1)) {
    const kstToday = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]
    await recalcStepDueDates(
      admin, inspectionId,
      insp.inspection_end_date || insp.inspection_start_date || kstToday,
    )
  }

  const allActiveDone = active.every(n => done[n])
  // 39 S3-1 — 완료 전환이 **임박했을 때만** 필수 미입력을 센다(비용 게이트: 매 저장마다 돌지 않는다).
  // 자체점검(작동·종합)만 — 외관 등은 점검표 필수 축이 없다. 판정식은 UI 카운터와 같은
  // countInstalledRequiredBlanks(sheet-overview) — 축이 갈라지면 카운터 N>0인데 완료되는 모순이 생긴다.
  const holdCompletion = (allActiveDone && insp.status !== 'completed' && isSpecial)
    ? await countInstalledRequiredBlanks(admin, inspectionId)
    : null
  const { justCompleted, completionHeld } = await applyStepSideEffects(admin, {
    inspectionId, actorId: actorId ?? '', prevStatus: insp.status,
    allActiveDone, newlyCompleted, completedAtIso: now, holdCompletion,
  })

  return { changed, justCompleted, completionHeld }
}
