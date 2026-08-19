/** Supabase(PostgREST)는 **요청당 1000행이 하드 상한**이다 — `.limit(3000)`도 `.range(0,4999)`도
 *  1000건만 돌려준다(2026-08-19 실측). 상한을 넘긴 나머지는 오류 없이 그냥 빠지므로,
 *  화면은 "그만큼밖에 없다"고 믿는다. 실제로 점검달력이 계획 항목 1425건 중 1000건만 싣고 있었고,
 *  잘려나간 425건은 달력·데이 패널에 아예 나타나지 않았다.
 *
 *  그래서 "많을 수 있는 목록"은 이 헬퍼로 **끝까지 받아온다**.
 *  주의: 페이지를 나눠 받으므로 정렬이 흔들리면 건너뛰거나 중복된다 —
 *  호출 쪽에서 반드시 **동점이 없는 정렬**(마지막 키를 id로)을 걸어야 한다. */
export async function fetchAllRows<T>(
  /** from~to(양끝 포함) 구간을 받아오는 질의를 만들어 준다 — `.range(from, to)`를 붙여 반환할 것 */
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  const pageSize = opts.pageSize ?? 1000
  // 폭주 방지 상한 — 여기 걸리면 truncated로 알린다(조용히 자르지 않는다)
  const maxRows = opts.maxRows ?? 20_000
  const rows: T[] = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) return { rows, error: error.message, truncated: false }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) return { rows, error: null, truncated: false }
  }
  return { rows, error: null, truncated: true }
}
