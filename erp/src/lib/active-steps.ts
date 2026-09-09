import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRowsByIds } from '@/lib/supabase/paginate'
import { activeStepNums, isSelfInspection } from '@/lib/inspection-step-status'

type Admin = ReturnType<typeof createAdminClient>

/** 점검별 **유효 단계 집합** — 「점검표 모두 합격이면 ⑤⑥은 해당없음」 판정의 조회 계층 단일 원천.
 *  (소방계획서_45 §S11 — Q-6 유예분 착수. 종전에는 이 판정이 크론 라우트 안의 지역 함수였다)
 *
 *  ⭐이 모듈이 생긴 이유: 같은 판정을 여섯 표면이 **각자** 짜고 있었고, 그중 다섯이 아예 짜지 않아
 *  화면마다 다른 말을 했다 — 사이드바 뱃지는 모두 합격 회차 때문에 **영구 빨강**이었고, 착륙 화면인
 *  점검 달력은 4/6, 개인 일정 달력에는 「5단계 · 소방보수 완료」가 빨간 D-Day 칩으로 떴다.
 *  판정 자체(activeStepNums)는 이미 순수 함수로 공유돼 있었는데, **그 함수에 넘길 값을 모으는 일**이
 *  공유되지 않아 호출부마다 빠뜨린 것이다. 순수 함수만 공유하는 것으로는 부족하다.
 *
 *  ⚠ 기울기: 조회가 불완전하면 **전 단계를 활성으로** 본다(닫는 쪽으로 기울지 않는다).
 *  ⑤⑥을 조용히 지우면 화면은 '할 일 없음', 크론은 '마감 임박'이 되고, 최악의 경우
 *  하지 않은 일이 완료로 남는다([[project_allpass_skip56]] R-1). 못 잰 것은 '조치가 필요하다'로 센다. */
export type ActiveSteps = {
  /** inspection_id → 유효 단계 번호 집합. **없는 키는 '모름'이지 '전부 비활성'이 아니다** */
  map: Map<string, Set<number>>
  /** 조회가 불완전했는가 — 참이면 map은 전 단계를 활성으로 담고 있다 */
  incomplete: boolean
}

/** 점검 id 목록에 대해 유효 단계 집합을 모은다.
 *  @param label 로그에 찍을 호출부 이름 — 어느 화면이 눈멀었는지 운영에서 가려내기 위한 것 */
export async function activeStepsByInspection(
  admin: Admin, ids: string[], label: string,
): Promise<ActiveSteps> {
  const map = new Map<string, Set<number>>()
  if (ids.length === 0) return { map, incomplete: false }

  // ⚠ `fetchAllRowsByIds` — id 목록은 URL에 실리므로 **400건부터 요청 자체가 실패**한다(실측).
  // 1000행 상한을 푸는 것만으로는 부족하다: 여기 오는 ids는 목록 「전체」 보기에서 수천이 될 수 있다.
  const [inspRes, defRes, xRes] = await Promise.all([
    fetchAllRowsByIds<{ id: string; plan_type: string | null }, string>(ids, (c, from, to) => admin
      .from('inspections').select('id, plan_type').in('id', c).order('id').range(from, to)),
    fetchAllRowsByIds<{ inspection_id: string }, string>(ids, (c, from, to) => admin
      .from('inspection_defects').select('inspection_id').in('inspection_id', c).order('id').range(from, to)),
    fetchAllRowsByIds<{ inspection_id: string }, string>(ids, (c, from, to) => admin
      .from('inspection_sheet_responses').select('inspection_id').in('inspection_id', c)
      .eq('result', 'X').order('id').range(from, to)),
  ])

  const incomplete = !!(
    inspRes.error || inspRes.truncated || defRes.error || defRes.truncated || xRes.error || xRes.truncated
  )
  if (incomplete) {
    console.error(`[active-steps:${label}] 점검·불량·✕ 조회 불완전 — 전 단계를 활성으로 보수 판정합니다`,
      inspRes.error, defRes.error, xRes.error)
  }

  const needsRepair = new Set([...defRes.rows, ...xRes.rows].map(r => r.inspection_id))
  for (const i of inspRes.rows) {
    map.set(i.id, new Set(activeStepNums(isSelfInspection(i.plan_type), incomplete || needsRepair.has(i.id))))
  }
  return { map, incomplete }
}

/** 이 단계가 화면·알림에 나타나야 하는가.
 *  ⚠ **모르면 참**이다 — 판정 재료를 못 받은 단계를 조용히 지우면 조치가 필요한 회차가 사라진다. */
export function isStepActive(a: ActiveSteps, inspectionId: string, stepNum: number): boolean {
  return a.map.get(inspectionId)?.has(stepNum) ?? true
}

/** 「모두 합격이라 해당없음」인 단계인가 = isStepActive의 부정.
 *  뱃지·카운터가 **빼야 할 건수**를 셀 때 쓴다(0으로 접히지 않도록 부정을 한 곳에 모은다). */
export function isStepNa(a: ActiveSteps, inspectionId: string, stepNum: number): boolean {
  return !isStepActive(a, inspectionId, stepNum)
}

/** ⑤⑥만이 '해당없음'이 될 수 있다(activeStepNums는 ①~④를 두 분기의 공통 접두로 갖는다).
 *  count 질의를 쓰는 표면이 **전 단계를 행으로 받지 않고** 뺄 건수만 재도록 하는 상수다. */
export const NA_CANDIDATE_STEP_NUMS = [5, 6] as const
