import 'server-only'

/** 점검 단계 **단일 기록자** — `inspection_steps.status`를 쓰는 곳은 이 파일 하나다 (소방계획서_21 R4-4·R4-5 / B-3)
 *
 *  F-5의 두 갈래(증거로 계산하는 타임라인 ✓ vs 버튼으로만 바뀌는 status)를 하나로 합친다.
 *  증거가 생기면 그 단계가 스스로 완료되고, 증거가 사라지면 되돌아간다 — **되돌림에 예외 없음**
 *  (제출일을 지웠으면 미완료로 돌아가는 것이 맞다).
 *
 *  **순서 강제 미적용**: 배치확인서는 협회에서 늦게 오고 점검표는 먼저 채워진다. 순서를 강제하면
 *  첫 단계에서 막혀 아무것도 완료되지 않는다(종전 completeStepCore의 전제와 다른 점).
 *
 *  ⚠ recalc와의 순서(설계 C1-b): `recalc_inspection_steps`는 **미완료 단계만** 갱신한다.
 *  증거 동기화가 단계를 자동 완료시키면 재계산 대상에서 빠지므로, **종료일을 나중에 고치면
 *  이미 완료된 단계의 마감일이 낡은 채 남는다.** 그래서 종료일 변경 경로(saveMultidayAction)는
 *  recalc를 먼저 돌리고 그 다음에 이 함수를 부른다. */

import type { createAdminClient } from '@/lib/supabase/admin'
import { isCertFileName, findArchivedCertInspections } from '@/lib/doc-status'
import {
  evidenceDone, activeStepNums, isSelfInspection,
  OWNER_REPORT_OFFLINE_ACTION, STEP_FORCE_COMPLETE_ACTION,
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
    // ③ 오프라인 보고·강제 완료 마커 — 마이그레이션 없이 activity_logs를 근거로 쓴다(D34-2)
    admin.from('activity_logs').select('action, metadata')
      .eq('entity_type', 'inspection').eq('entity_id', insp.id)
      .in('action', [OWNER_REPORT_OFFLINE_ACTION, STEP_FORCE_COMPLETE_ACTION])
      .limit(500),
    findArchivedCertInspections(admin, [insp.id]),
  ])

  const defects = (defectsRes.data ?? []) as Array<{ action_completed_at: string | null }>
  const logs = (logsRes.data ?? []) as Array<{ action: string; metadata: Record<string, unknown> | null }>
  const forced = [...new Set(
    logs.filter(l => l.action === STEP_FORCE_COMPLETE_ACTION)
      .map(l => Number(l.metadata?.['step_num']))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 6),
  )] as StepNum[]

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
  },
): Promise<{ justCompleted: boolean }> {
  const { inspectionId, actorId, prevStatus, allActiveDone, newlyCompleted, completedAtIso } = opts

  const justCompleted = allActiveDone && prevStatus !== 'completed'
  if (allActiveDone) {
    if (prevStatus !== 'completed') {
      await admin.from('inspections').update({ status: 'completed' } as Record<string, unknown>).eq('id', inspectionId)
    }
  } else if (prevStatus === 'completed' || prevStatus === 'scheduled') {
    // 되돌림에 예외 없음 — 증거가 사라져 미완이 되면 완료 상태도 물러난다
    await admin.from('inspections').update({ status: 'in_progress' } as Record<string, unknown>).eq('id', inspectionId)
  }

  // P-19: 단계 완료 → inspection_status_log + inspection_plan_items 동기화
  if (newlyCompleted.length > 0) {
    const { data: planItem } = await admin.from('inspection_plan_items')
      .select('id, status').eq('inspection_id', inspectionId).maybeSingle()
    if (planItem) {
      const pid = (planItem as { id: string; status: string }).id
      const STEP_FIELDS: Record<number, string> = {
        1: 'inspection_date', 2: 'report_submitted_at', 3: 'sent_at',
        4: 'filed_at', 5: 'step5_completed_at', 6: 'step6_completed_at',
      }
      const patch: Record<string, unknown> = { plan_item_id: pid, updated_by: actorId }
      for (const n of newlyCompleted) {
        const f = STEP_FIELDS[n]
        if (f) patch[f] = completedAtIso.split('T')[0]
      }
      await admin.from('inspection_status_log').upsert(patch, { onConflict: 'plan_item_id' })
      if (newlyCompleted.includes(1) && (planItem as { status: string }).status === 'planned') {
        await admin.from('inspection_plan_items')
          .update({ status: 'confirmed' } as Record<string, unknown>).eq('id', pid)
      }
    }
  }
  return { justCompleted }
}

/** 증거 → inspection_steps.status 동기화. **status를 쓰는 유일한 함수**.
 *  상태가 실제로 바뀐 행만 갱신한다(무의미한 쓰기·revalidate 폭풍 방지). */
export async function syncInspectionSteps(
  admin: Admin, inspectionId: string, actorId: string | null,
): Promise<{ changed: number; justCompleted?: boolean; error?: string }> {
  const { data: inspRaw } = await admin.from('inspections')
    .select('id, customer_id, status, inspection_start_date, inspection_end_date, inspection_type, plan_type, report9_submitted_at, report11_submitted_at')
    .eq('id', inspectionId).maybeSingle()
  const insp = inspRaw as InspRow | null
  if (!insp) return { changed: 0, error: '점검을 찾을 수 없습니다.' }

  const evidence = await gatherStepEvidence(admin, insp)
  const done = evidenceDone(evidence)
  const isSpecial = isSelfInspection(insp.plan_type)
  const active = activeStepNums(isSpecial, evidence.defectsTotal > 0)

  const { data: stepRaw } = await admin.from('inspection_steps')
    .select('id, step_num, status').eq('inspection_id', inspectionId)
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

  // ①이 새로 완료되면 확정일 기준으로 미완료 단계 마감일 재계산 (migration 048 — 법정 기한은 실제 점검일 기산)
  if (newlyCompleted.includes(1)) {
    const kstToday = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]
    await admin.rpc('recalc_inspection_steps', {
      p_inspection_id: inspectionId,
      p_base_date: insp.inspection_end_date || insp.inspection_start_date || kstToday,
    })
  }

  const allActiveDone = active.every(n => done[n])
  const { justCompleted } = await applyStepSideEffects(admin, {
    inspectionId, actorId: actorId ?? '', prevStatus: insp.status,
    allActiveDone, newlyCompleted, completedAtIso: now,
  })

  return { changed, justCompleted }
}
