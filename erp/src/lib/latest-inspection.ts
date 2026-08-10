import type { createAdminClient } from '@/lib/supabase/admin'

/** 최신 자체점검 건 판정 — 소방계획서_14_점검업무 D-6 (Q-3, 2026-08-10 사용자 확정)
 *
 *  T안의 "회차는 최종만 유지" 원칙상 '현재 점검표'를 서버가 단일 결정해야 한다.
 *  판정 규칙:
 *    where    plan_type is null OR plan_type like 'special_%'   -- 레거시 null 포함(마이그레이션 111 축)
 *    order by year desc, sequence_num desc
 *    limit 1                                                    -- 취소 조건 없음
 *
 *  **취소 조건을 두지 않는 이유**: `InspectionStatus`에 'cancelled'가 없다
 *  ('scheduled | in_progress | completed | overdue' — types/index.ts). 취소 개념은
 *  inspection_plan_items·PlanStatus에만 존재하므로 inspections 단독으로는 표현할 수 없고,
 *  기존 선례(getInspectedFacilityCodesAction·getCustomerRoundsAction)도 필터하지 않는다.
 *
 *  정렬 축도 기존 선례와 통일했다 — 축이 갈리면 교차 검증 칩과 점검표 화면이
 *  서로 다른 회차를 가리킨다. 그래서 이 헬퍼 하나로 흡수했다(T-2b-1b). */

type Admin = ReturnType<typeof createAdminClient>

export type LatestInspection = {
  id: string
  year: number
  sequenceNum: number
  /** 화면 표기용 — "2026년 1차" */
  label: string
}

const labelOf = (year: number, seq: number) => `${year}년 ${seq}차`

/** 최신 자체점검 건. requireResponses=true면 **응답이 있는** 최신 건을 고른다
 *  (교차 검증 칩의 종전 동작 — "점검은 했는데 제원 미입력" 판정 근거라 빈 회차를 잡으면 안 된다).
 *  scanLimit는 응답 유무를 거슬러 확인할 최대 회차 수(종전 6건과 동일). */
export async function getLatestSpecialInspection(
  admin: Admin,
  customerId: string,
  opts: { requireResponses?: boolean; scanLimit?: number } = {},
): Promise<LatestInspection | null> {
  const { requireResponses = false, scanLimit = 6 } = opts
  const { data } = await admin.from('inspections')
    .select('id, year, sequence_num')
    .eq('customer_id', customerId)
    .or('plan_type.is.null,plan_type.like.special_*')
    .order('year', { ascending: false })
    .order('sequence_num', { ascending: false })
    .limit(requireResponses ? scanLimit : 1)
  const rows = (data ?? []) as Array<{ id: string; year: number; sequence_num: string | number }>
  if (rows.length === 0) return null

  const pick = (r: (typeof rows)[number]): LatestInspection => ({
    id: r.id, year: r.year, sequenceNum: Number(r.sequence_num),
    label: labelOf(r.year, Number(r.sequence_num)),
  })
  if (!requireResponses) return pick(rows[0])

  for (const r of rows) {
    const { count } = await admin.from('inspection_sheet_responses')
      .select('id', { count: 'exact', head: true }).eq('inspection_id', r.id)
    if ((count ?? 0) > 0) return pick(r)
  }
  return null
}
