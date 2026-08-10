/** PostgREST 행 상한(db-max-rows, 기본 1000) 우회 — .range()로 끝까지 읽는다.
 *
 *  필요한 이유: inspection_sheet_items 를 `.in('sheet_id', 21개 시트)` 로 읽으면 v2025 STD 기준
 *  총 항목이 1000행을 넘어 **조용히 잘린다**(에러 없음). 점검표 진행률의 분모가 이 쿼리라
 *  잘리면 20/24 같은 값이 틀리게 나온다. 대량 카탈로그 조회는 이 헬퍼를 거칠 것. */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) return { rows, error: error.message }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) return { rows }
  }
}
