import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { isSelfInspection, visibleStepNums } from '@/lib/inspection-step-status'

/** 고객 상세 [이력] 탭의 회차별 진행바(완료/유효 단계) — 단계·불량·✕ 세 조회를 **한 고객의 전 회차**에 대해 돈다.
 *
 *  속도 개선 3단계(2026-10-01): 종전엔 고객 페이지가 이걸 **탭과 무관하게** 매 방문 서버에서 돌렸다
 *  (물결 B의 fetchAllRows 3회 — 이력 탭을 열지 않는 방문이 대부분인데도). 이제 이력 탭을 처음 열 때
 *  `getCustomerStepProgressAction`이 부른다. 판정식은 그대로 옮겼다(아래 주석 보존).
 *
 *  소방계획서_45: **유효 단계만** 분모에 넣는다. 점검표 모두 합격이면 ⑤⑥은 '해당없음'이라 세지 않는다
 *  (행은 DB에 그대로 두고 조회 시 필터). R4-8이 목록에만 적용돼 있어 같은 점검이 목록 4/4 · 여기 4/6으로
 *  갈라져 있었다.
 *  ⚠ 조용한 폴백 금지 — ✕·불량 조회가 실패하면 needsRepair가 **말없이 종전 축으로 되돌아가** 미조치
 *  불량이 남은 회차까지 '모두 합격 4/4'로 보인다. 크론(inspection-deadline-notify)과 같이 실패는
 *  **보수적으로 전 단계 활성**으로 기운다 — 조치가 필요한 회차를 '완료'로 보이게 하는 쪽이 더 위험하다.
 *  ⚠ 2026-09-08 2차 독립 판정: 단계 조회만 fetchAllRows가 빠져 있었다 — 하필 분모·분자의 원천이라,
 *  한 고객의 누적 점검이 167건을 넘으면 뒤쪽 회차의 진행바가 통째로 결측됐다. 세 조회 모두 끝까지 받는다. */

export type StepProgress = Record<string, { total: number; completed: number }>

export async function loadStepProgress(
  admin: SupabaseClient,
  inspections: ReadonlyArray<{ id: string; plan_type: string | null }>,
): Promise<StepProgress> {
  if (inspections.length === 0) return {}
  const ids = inspections.map(i => i.id)
  const [stepsRes, defectsRes, sheetXRes] = await Promise.all([
    fetchAllRows<{ inspection_id: string; step_num: number; status: string }>((from, to) =>
      admin.from('inspection_steps').select('inspection_id, step_num, status')
        .in('inspection_id', ids).order('id').range(from, to)),
    // ⑤⑥ 활성 축 = 등록 불량 ∪ 점검표 ✕ (목록·작업대·현황판과 같은 원천)
    fetchAllRows<{ inspection_id: string }>((from, to) => admin.from('inspection_defects')
      .select('inspection_id').in('inspection_id', ids).order('id').range(from, to)),
    fetchAllRows<{ inspection_id: string }>((from, to) => admin.from('inspection_sheet_responses')
      .select('inspection_id').in('inspection_id', ids).eq('result', 'X').order('id').range(from, to)),
  ])
  const repairAxisIncomplete = !!(defectsRes.error || defectsRes.truncated || sheetXRes.error || sheetXRes.truncated)
  if (repairAxisIncomplete) {
    console.error('[customers/[id]] 불량·✕ 조회 불완전 — ⑤⑥을 전 단계 활성으로 보수 판정합니다:',
      { defects: defectsRes.error, defectsTruncated: defectsRes.truncated, sheetX: sheetXRes.error, sheetXTruncated: sheetXRes.truncated })
  }
  if (stepsRes.error) console.error('[customers/[id]] 단계 조회 실패 — 진행바가 부정확할 수 있습니다:', stepsRes.error)
  else if (stepsRes.truncated) console.error('[customers/[id]] 단계 조회가 상한에서 잘렸습니다 — 진행바가 부정확합니다')
  const needsRepairByInsp = new Set([...defectsRes.rows, ...sheetXRes.rows].map(r => r.inspection_id))
  // 소방계획서_48 — 진행바는 **표시 축**(불량 0이면 ④도 즉시 감춤). 완료 판정은 의무 축 그대로.
  const activeNumsByInsp = new Map(inspections.map(i => [
    i.id,
    new Set<number>(visibleStepNums(isSelfInspection(i.plan_type), repairAxisIncomplete || needsRepairByInsp.has(i.id))),
  ]))
  const progress: StepProgress = {}
  for (const r of stepsRes.rows) {
    if (!activeNumsByInsp.get(r.inspection_id)?.has(r.step_num)) continue
    if (!progress[r.inspection_id]) progress[r.inspection_id] = { total: 0, completed: 0 }
    progress[r.inspection_id].total++
    if (r.status === 'completed') progress[r.inspection_id].completed++
  }
  return progress
}
