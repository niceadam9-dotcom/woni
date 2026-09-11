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
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  evidenceDone, activeStepNums, hasSheetDefect, isSelfInspection, resolveForcedSteps,
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
  const [respRes, xRes, filesRes, deliveryRes, defectsRes, logsRes, archivedSet] = await Promise.all([
    admin.from('inspection_sheet_responses').select('id', { count: 'exact', head: true }).eq('inspection_id', insp.id),
    // ✕ 응답의 **항목 코드** (소방계획서_45 R-5) — 개수만으로는 '미등록 ✕'를 셀 수 없어 코드를 받는다.
    // 종전에는 `count:'exact', head:true`로 수만 셌고 미등록 여부는 `defectsTotal===0`으로 근사했다.
    // 회차당 ✕는 많아야 수백이지만 상한에 기대지 않는다(fetchAllRows).
    fetchAllRows<{ item_code: string }>((from, to) => admin.from('inspection_sheet_responses')
      .select('item_code').eq('inspection_id', insp.id).eq('result', 'X').order('id').range(from, to)),
    admin.storage.from('fire-plans').list(prefix, { limit: 100 }),
    admin.from('report_deliveries').select('id').eq('inspection_id', insp.id).eq('doc_kind', 'report9_owner').limit(1),
    // ⚠ 3차 독립 판정(R-2): 집합 차의 **반대편**인 이 조회만 맨몸이었다 — 상한 미대비·error 미확인.
    // 실패하면 registered가 비어 ✕ 전건이 미등록으로 부풀고, applyStepSideEffects가 completed였던
    // 점검을 in_progress로 **되돌리는 쓰기**까지 한다. 두 집합은 같은 규약으로 받아야 한다.
    fetchAllRows<{ action_completed_at: string | null; defect_code: string | null }>((from, to) =>
      admin.from('inspection_defects').select('action_completed_at, defect_code')
        .eq('inspection_id', insp.id).order('id').range(from, to)),
    // ③ 오프라인 보고·강제 완료·철회 마커 — 마이그레이션 없이 activity_logs를 근거로 쓴다(D34-2).
    // created_at을 함께 읽는다: append-only라 철회는 '나중 마커'로만 표현된다(D1)
    admin.from('activity_logs').select('action, metadata, created_at')
      .eq('entity_type', 'inspection').eq('entity_id', insp.id)
      .in('action', [OWNER_REPORT_OFFLINE_ACTION, STEP_FORCE_COMPLETE_ACTION, STEP_FORCE_UNDO_ACTION])
      .order('created_at')
      .limit(500),
    findArchivedCertInspections(admin, [insp.id]),
  ])

  const defects = defectsRes.rows
  const logs = (logsRes.data ?? []) as Array<{ action: string; metadata: Record<string, unknown> | null; created_at: string }>
  // 미등록 ✕ = ✕ 항목 코드 − 이미 등록된 불량 코드. 등록 경로(createDefectsFromXAction)가
  // `defect_code = item_code`로 넣으므로 두 집합의 키가 같다(sheet-actions.ts:731).
  // ⚠ 조회가 불완전하면 **0으로 접지 않는다** — 0은 곧 '미등록 없음'이라 ⑤ 사유 완료를 열어준다.
  // 못 받았을 땐 ✕ 전건을 미등록으로 보수 판정한다(닫는 쪽이 안전하다).
  const xCodes = xRes.rows.map(r => r.item_code)
  const registered = new Set(defects.map(d => d.defect_code).filter(Boolean))
  const xAxisIncomplete = !!(xRes.error || xRes.truncated)
  const defectAxisIncomplete = !!(defectsRes.error || defectsRes.truncated)
  if (xAxisIncomplete || defectAxisIncomplete) {
    console.error(`[step-sync] 불량·✕ 조회 불완전 — ⑤⑥ 축을 보수 판정합니다 (inspection ${insp.id}):`, xRes.error, defectsRes.error)
  }
  /** ⚠ Q-9(2026-09-09 사용자 확정) — **코드 없는 불량 1건은 ✕ 1건을 덮은 것으로 본다.**
   *  `defect_code`는 NULL 허용이고 실제로 두 경로가 비워서 넣는다: 수기 폼(`defect-actions.ts`,
   *  코드 칸이 「선택」)과 모바일 Edge Function(`functions/add-defect`, 호출부가 아예 안 보낸다).
   *  스테이징 실측 9행 중 **2행(22%)**이 그 형태였고, 그 회차는 등록을 했는데도 `unregisteredX=1`로
   *  ⑤가 영구 미완이었다 — 출구가 배너 CTA뿐인데 누르면 같은 불량에 행이 하나 더 생겨 별지
   *  9·10·11호에 **중복 인쇄**된다. 집합 차만으로는 키가 없는 행을 영원히 못 본다.
   *  ⚠ 상쇄는 「무관한 수기 불량이 ✕ 하나를 가릴 수 있다」는 값을 치른다. 그래도 ⑤⑥ **활성** 축은
   *  sheetX가 그대로 잡으므로 단계가 사라지지는 않고, 조치 전건 확인(defectsDone)도 그대로다. */
  const uncodedDefects = defects.filter(d => !d.defect_code).length
  const unmatchedX = xCodes.filter(c => !registered.has(c)).length
  const unregisteredX = (xAxisIncomplete || defectAxisIncomplete)
    ? xCodes.length
    : Math.max(0, unmatchedX - uncodedDefects)
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
    sheetX: xCodes.length,
    unregisteredX,
    // 🎯 3차 독립 판정 R-1(중대): 종전에는 보수 판정을 `unregisteredX` **한 필드에만** 걸고
    // 형제인 `sheetX`는 실패 시 그대로 0으로 접었다. 그러면 `hasSheetDefect`가 false가 되어
    // ⑤⑥이 분모에서 통째로 빠지고(activeStepNums → [1,2,3,4]) ①~④가 이미 찼으면
    // `applyStepSideEffects`가 **`inspections.status='completed'`를 DB에 쓴다** — 목록·현황판에서
    // 막아 놓은 '거짓 초록 4/4'가 여기서는 **영속화**된다(점검 상세를 여는 것만으로 발화).
    // 개수를 부풀려 흉내내지 않고 **축 자체를 실어** 순수 함수 세 곳이 함께 보수 판정하게 한다.
    axisIncomplete: xAxisIncomplete || defectAxisIncomplete,
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
  /** 방금 모은 증거를 **그대로 돌려준다** — 화면(page.tsx)이 `loadStepEvidence`로 똑같은
   *  7~9회 왕복(점검표 응답 2·스토리지 list·송달·불량·활동로그·보관정리)을 **한 번 더** 하고
   *  있었다. 증거는 `inspection_steps`를 읽지 않으므로 동기화 전후로 값이 같다 —
   *  즉 재조회에 신선도 이득이 없고 왕복만 두 배였다(2026-09-11 조회 지연 수리).
   *  🚨 점검 행을 못 찾으면 없다 — 그때만 호출부가 `loadStepEvidence`로 물러난다. */
  evidence?: StepEvidence
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
  const active = activeStepNums(isSpecial, hasSheetDefect(evidence))

  const steps = (stepRaw ?? []) as Array<{ id: string; step_num: number; status: string }>
  // 단계 행이 없어도 증거는 이미 모았다 — 화면이 쓸 수 있게 함께 내준다(재조회 방지)
  if (steps.length === 0) return { changed: 0, evidence }

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

  return { changed, justCompleted, completionHeld, evidence }
}
