import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** [지난 회차 결과 불러오기]의 **출처 판정 단일 원천**.
 *
 *  왜 뽑아냈나(2026-09-07): 제안 배너(A안)가 이 판정을 따로 구현하면 두 벌이 된다 —
 *  배너는 "2025년 2차가 있습니다"라고 권하는데 복사는 다른 회차를 집거나
 *  '불러올 회차가 없습니다'로 실패하는 어긋남이 생긴다. 권하는 쪽과 실행하는 쪽이
 *  같은 함수를 봐야 그 어긋남이 구조적으로 불가능해진다.
 *
 *  판정 규칙(종전 copyPreviousRoundResponsesAction 인라인 로직 그대로):
 *   · 같은 고객 · status='completed' · 이 건보다 앞선 회차(연도 desc, 같은 해면 차수 desc) 중 첫 건
 *   · `responseCount`는 그 회차에 실제 저장된 응답 수 — 0이면 복사해도 채울 게 없다.
 *     배너는 이 값이 0이면 뜨지 않아야 한다(권해놓고 실패하는 버튼을 만들지 않는다).
 */
export type PrevRoundSource = {
  id: string
  year: number
  sequenceNum: number
  /** '2025년 2차' — 화면 문구·activity_logs 라벨 공용 */
  label: string
  responseCount: number
}

export async function findPrevRoundSource(
  admin: Admin,
  inspectionId: string,
): Promise<PrevRoundSource | null> {
  const { data: cur } = await admin.from('inspections')
    .select('year, sequence_num, customer_id').eq('id', inspectionId).maybeSingle()
  if (!cur) return null
  const c = cur as { year: number; sequence_num: number; customer_id: string }

  // 회차 정렬은 (연도, 차수) 2축이라 DB order만으로는 '이 건보다 앞선'을 표현할 수 없다
  // (year<c.year OR (year=c.year AND seq<c.seq)) — 넉넉히 받아 앱에서 첫 건을 고른다
  const { data: rows } = await admin.from('inspections')
    .select('id, year, sequence_num')
    .eq('customer_id', c.customer_id).eq('status', 'completed').neq('id', inspectionId)
    .order('year', { ascending: false }).order('sequence_num', { ascending: false })
    .limit(24)
  const prev = ((rows ?? []) as Array<{ id: string; year: number; sequence_num: number }>)
    .find(p => p.year < c.year || (p.year === c.year && p.sequence_num < c.sequence_num))
  if (!prev) return null

  const { count } = await admin.from('inspection_sheet_responses')
    .select('id', { count: 'exact', head: true }).eq('inspection_id', prev.id)

  return {
    id: prev.id,
    year: prev.year,
    sequenceNum: prev.sequence_num,
    label: `${prev.year}년 ${prev.sequence_num}차`,
    responseCount: count ?? 0,
  }
}
