/** Supabase(PostgREST)는 **요청당 1000행이 하드 상한**이다 — `.limit(3000)`도 `.range(0,4999)`도
 *  1000건만 돌려준다(2026-08-19 실측). 상한을 넘긴 나머지는 오류 없이 그냥 빠지므로,
 *  화면은 "그만큼밖에 없다"고 믿는다. 실제로 점검달력이 계획 항목 1425건 중 1000건만 싣고 있었고,
 *  잘려나간 425건은 달력·데이 패널에 아예 나타나지 않았다.
 *
 *  그래서 "많을 수 있는 목록"은 이 헬퍼로 **끝까지 받아온다**.
 *  주의: 페이지를 나눠 받으므로 정렬이 흔들리면 건너뛰거나 중복된다 —
 *  호출 쪽에서 반드시 **동점이 없는 정렬**(마지막 키를 id로)을 걸어야 한다. */
/** `.in('col', ids)`에 한 번에 실을 수 있는 id 개수의 안전선.
 *
 *  ⚠ 실측(2026-09-09, `scripts/_probe-45-in-url-limit.mts` — 스테이징): id 목록은 **URL에 실린다**.
 *  UUID 36자 + 구분자라 200건(~7.5KB)까지는 통과하고 **400건부터 실패**하며, 5000건에서는
 *  nginx가 `414 Request-URI Too Large`를 그대로 돌려준다. 1000행 상한을 fetchAllRows로 풀어도
 *  **요청 자체가 나가지 못하면 소용이 없다** — 상한보다 이 벽이 앞에 있다.
 *  200에서 400 사이 어딘가가 경계이므로 여유를 두고 150으로 잡는다.
 *
 *  ⚠ 이 실패는 조용하지 않다(오류로 온다). 그래서 error를 확인하는 호출부는 보수 판정으로 물러나고,
 *  확인하지 않는 호출부는 **0건을 진실로 믿는다** — 후자가 이 저장소에서 반복된 결함 형태다. */
export const IN_CHUNK_SIZE = 150

/** 배열을 size 단위로 쪼갠다 (빈 배열이면 빈 결과) */
export function chunk<T>(arr: readonly T[], size = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** id 목록을 URL 한계 아래로 쪼개어 `fetchAllRows`를 돌리고 결과를 합친다.
 *
 *  각 조각의 error·truncated는 **합쳐서** 돌려준다 — 한 조각만 실패해도 전체가 불완전한 것이므로,
 *  부분 성공을 완전한 결과처럼 쓰지 않게 한다(그 혼동이 「3/3 100% 초록」을 만든 형태다). */
export async function fetchAllRowsByIds<T, I>(
  ids: readonly I[],
  buildQuery: (idChunk: I[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { pageSize?: number; maxRows?: number; chunkSize?: number } = {},
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  if (ids.length === 0) return { rows: [], error: null, truncated: false }
  const parts = await Promise.all(
    chunk(ids, opts.chunkSize ?? IN_CHUNK_SIZE).map(c =>
      fetchAllRows<T>((from, to) => buildQuery(c, from, to), opts)),
  )
  return {
    rows: parts.flatMap(p => p.rows),
    error: parts.map(p => p.error).find(Boolean) ?? null,
    truncated: parts.some(p => p.truncated),
  }
}

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
