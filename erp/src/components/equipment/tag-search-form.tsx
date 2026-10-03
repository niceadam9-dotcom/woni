/** 설비 코드 수기 조회 칸 — GET /t?q= (서버 컴포넌트에서도 쓰는 평범한 폼, JS 불필요) */
export function TagSearchForm({ initial = '' }: { initial?: string }) {
  return (
    <form method="GET" action="/t" className="flex gap-1.5">
      <input name="q" defaultValue={initial} autoCapitalize="characters" autoComplete="off" placeholder="예: 7K2M9Q"
        className="h-10 flex-1 rounded-lg border border-brand-line px-3 font-mono uppercase tracking-wider" data-testid="tag-search-input" />
      <button className="h-10 rounded-lg bg-brand px-4 text-white" data-testid="tag-search-submit">찾기</button>
    </form>
  )
}
