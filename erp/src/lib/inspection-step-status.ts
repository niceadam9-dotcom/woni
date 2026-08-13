/** 점검 단계 완료 판정 — 화면·서버 공용 단일 원천 (소방계획서_21 R4-1 / B-1)
 *
 *  배경(F-5): 완료 판정이 두 갈래였다. 타임라인의 ✓는 **증거**(응답 수·파일·발송 이력…)로 계산하는데
 *  `inspection_steps.status`는 [단계 완료] 버튼을 눌러야만 바뀌었다. 그래서 상단 진행률과 목록의
 *  '진행 단계' 열(둘 다 status를 읽는다)이 타임라인과 어긋났다 — 여섯 다 ✓인데 0/6인 상태가 가능했다.
 *
 *  이 파일은 **판정만** 한다(조회·쓰기 없음). 증거 수집은 inspection-step-sync.ts, 표시는 타임라인이
 *  각각 맡되 판정 함수는 여기 하나를 쓴다. 순수 함수라 프로브가 DB 없이 전 조합을 단언할 수 있다.
 *
 *  D34-2(2026-08-12 확정): **근거 없는 완료를 없앤다.** 클릭만으로 완료되면 실제로 하지 않은 일이
 *  소방서 제출 이력에 완료로 남는다. 근거가 없던 자리(③ 방문·전화 보고, 그 밖의 예외)는
 *  마커를 새로 만들어 근거로 삼는다 — 마이그레이션 없이 activity_logs를 쓴다(소방계획서_18 D-5와 동일). */

/** ③ 관계인에게 방문·전화로 보고한 사실을 남기는 마커 (R4-2). metadata: {일자, 방법, 메모} */
export const OWNER_REPORT_OFFLINE_ACTION = 'owner_report_offline'
/** 그 밖의 예외를 사람이 확정하는 마커 (R4-3) — **사유 필수**. 이것도 증거로 남는다 */
export const STEP_FORCE_COMPLETE_ACTION = 'step_force_complete'
/** 강제 완료의 **철회** 마커 (독립 검증 D1). activity_logs는 append-only(트리거 040)라 마커를 지울 수
 *  없다 — 지우는 대신 반대 마커를 덧붙여 무효화한다. 철회도 기록이므로 이력이 사라지지 않는다. */
export const STEP_FORCE_UNDO_ACTION = 'step_force_undo'

/** 단계 번호 ①~⑥ — inspection_steps.step_num과 1:1 */
export type StepNum = 1 | 2 | 3 | 4 | 5 | 6

/** 자체점검 여부 — **plan_type 축 단독**(sheet-scope·requestReport9Action과 동일 기준).
 *  관리유형(inspection_type)이 '일반관리'여도 자체점검이면 ①~⑥이 전부 유효하다 —
 *  두 축을 혼동하면 분모가 1로 줄어 별지 9호 제출 단계가 통째로 사라진다. */
export function isSelfInspection(planType: string | null): boolean {
  return !planType || planType.startsWith('special')
}

/** 판정에 필요한 증거 일체 — 수집처는 sync가, 표시는 타임라인이 채운다 */
export type StepEvidence = {
  /** ① 점검표 응답 건수(전 시트 합) */
  responded: number
  /** ② 배치확인서 — 파일 보유 또는 종이 보관 마커(소방계획서_18 D-7) */
  certFile: boolean
  certArchived: boolean
  /** ③ 이메일 발송 이력 / 오프라인(방문·전화) 보고 마커 */
  delivery: boolean
  offlineReport: boolean
  /** ④ 별지 9호 제출일 */
  submit9At: string | null
  /** ⑤ 불량 전건 조치 완료 (R10-a — 계약서·사진은 선택 증빙이라 조건에서 제외) */
  defectsTotal: number
  defectsDone: number
  /** ⑥ 별지 11호 제출일 */
  submit11At: string | null
  /** 강제 완료된 단계 번호 — 사유가 남고 **철회되지 않은** 것만 들어온다(R4-3 / resolveForcedSteps) */
  forced?: StepNum[]
}

/** append-only 로그에서 **현재 유효한** 강제 완료 단계를 가려낸다 (독립 검증 D1).
 *  단계별로 가장 최근 마커만 본다 — force면 유효, undo면 해제. 순수 함수라 DB 없이 단언 가능. */
export function resolveForcedSteps(
  markers: Array<{ action: string; stepNum: number; at: string }>,
): { steps: StepNum[] } {
  const latest = new Map<number, { action: string; at: string }>()
  for (const m of markers) {
    if (!Number.isInteger(m.stepNum) || m.stepNum < 1 || m.stepNum > 6) continue
    if (m.action !== STEP_FORCE_COMPLETE_ACTION && m.action !== STEP_FORCE_UNDO_ACTION) continue
    const cur = latest.get(m.stepNum)
    // 시각이 같으면 **철회가 이긴다** — 한 트랜잭션에서 두 마커가 함께 들어오면 created_at이 동일해질
    // 수 있는데(2차 독립 검증 지적), 그때 완료 쪽으로 기우는 것이 더 위험한 오답이다
    const wins = !cur || m.at > cur.at
      || (m.at === cur.at && m.action === STEP_FORCE_UNDO_ACTION)
    if (wins) latest.set(m.stepNum, { action: m.action, at: m.at })
  }
  const steps: StepNum[] = []
  for (const [num, m] of latest) {
    if (m.action !== STEP_FORCE_COMPLETE_ACTION) continue
    steps.push(num as StepNum)
  }
  return { steps: steps.sort((a, b) => a - b) }
}

/** 증거 → 단계별 완료 여부. 순서 강제 없음(R4-4) — 배치확인서는 늦게 오고 점검표는 먼저 채워진다.
 *  강제 완료 마커는 마지막에 덮어쓴다(사유가 남은 근거이므로 증거와 동급).
 *
 *  ⚠ D1 규칙(독립 검증 지적): 강제 완료가 **미래의 일까지 완료로 고정**해서는 안 된다.
 *  ⑤(보수 완료)만은 사유 완료가 **미조치 불량이 하나도 없을 때만** 효력을 갖는다 —
 *  미조치가 남아 있는데 완료로 굳으면 D34-2가 막으려던 '하지 않은 일이 완료로 남는다'가 된다.
 *
 *  시각 비교(마커 이후에 등록된 불량인지)로 풀지 않는다: inspection_defects에는 updated_at이 없어
 *  **조치완료를 해제해도 created_at은 그대로**라, 2차 독립 검증에서 그 구멍이 실제로 재현됐다.
 *  '지금 미조치가 있는가'만 보면 신규 등록·조치 해제·불량 삭제가 한 규칙으로 덮인다.
 *  ①~④·⑥은 증거가 단발(제출일·파일)이라 같은 문제가 없고, 필요하면 철회 마커로 되돌린다. */
export function evidenceDone(e: StepEvidence): Record<StepNum, boolean> {
  const done: Record<StepNum, boolean> = {
    1: e.responded > 0,
    2: e.certFile || e.certArchived,
    3: e.delivery || e.offlineReport,
    4: !!e.submit9At,
    5: e.defectsTotal > 0 && e.defectsDone >= e.defectsTotal,
    6: !!e.submit11At,
  }
  for (const n of e.forced ?? []) {
    if (n === 5 && isForced5Void(e)) continue
    done[n] = true
  }
  return done
}

/** ⑤ 사유 완료가 무효인 상태 — 미조치 불량이 하나라도 남아 있으면 완료로 굳히지 않는다.
 *  (신규 등록·조치 해제·불량 삭제를 한 규칙으로 덮는다 — 시각 비교로는 조치 해제를 못 잡았다) */
export function isForced5Void(e: StepEvidence): boolean {
  return e.defectsDone < e.defectsTotal
}

/** 진행률 분모가 될 **유효 단계** (R4-8 / B-5).
 *
 *  F-6: 트리거(019)는 모든 점검에 6행을 만드는데, 정기·일반(월간 외관점검)은 유효 단계가 ① 하나다.
 *  정기관리 고객 1명당 연 12건이 생기므로 목록에서 가장 많은 행이 **영원히 미완**으로 보였다.
 *  마이그레이션으로 행을 지우지 않고 **조회 시 필터**로 좁힌다 — 과거를 파괴하지 않고,
 *  불량이 생기면 ⑤⑥이 다시 필요해지기 때문이다.
 *
 *  ⚠ isSpecial은 **plan_type 축**으로 판정한다(sheet-scope.ts와 동일). 관리유형(inspection_type)이
 *  '일반관리'여도 자체점검이면 ①~⑥이 전부 유효하다 — 두 축을 혼동하면 분모가 1로 줄어든다. */
export function activeStepNums(isSpecial: boolean, hasDefects: boolean): StepNum[] {
  if (!isSpecial) return [1]
  // D-4: 불량 0건이면 ⑤⑥은 '해당없음'이라 분모에서 뺀다(행은 남기고 화면은 흐림 처리)
  return hasDefects ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4]
}

/** 유효 단계 기준 진행률 — 상세 카드·목록 열이 같은 수치를 쓰게 하는 공용 계산 */
export function stepProgress(
  done: Record<StepNum, boolean>, active: StepNum[],
): { done: number; total: number; pct: number } {
  const total = active.length
  const doneCount = active.filter(n => done[n]).length
  return { done: doneCount, total, pct: total > 0 ? Math.round((doneCount / total) * 100) : 0 }
}
