'use client'

type LineRow = {
  debit_amount: number
  credit_amount: number
  account_codes: { code: string; name: string; account_type: string } | null
}

function fmt(n: number) { return n.toLocaleString('ko-KR') }

export function BalanceSheetClient({
  lines,
  asOf,
}: {
  lines: Record<string, unknown>[]
  asOf: string
}) {
  const lineList = lines as unknown as LineRow[]

  type AccountTotal = { code: string; name: string; total: number }
  const assetMap     = new Map<string, AccountTotal>()
  const liabilityMap = new Map<string, AccountTotal>()
  const equityMap    = new Map<string, AccountTotal>()

  for (const l of lineList) {
    const ac = l.account_codes
    if (!ac) continue

    const map =
      ac.account_type === '자산' ? assetMap :
      ac.account_type === '부채' ? liabilityMap :
      ac.account_type === '자본' ? equityMap : null
    if (!map) continue

    const existing = map.get(ac.code)
    // 자산: 차변 증가, 부채/자본: 대변 증가
    const amt = ac.account_type === '자산'
      ? l.debit_amount - l.credit_amount
      : l.credit_amount - l.debit_amount
    map.set(ac.code, {
      code: ac.code, name: ac.name,
      total: (existing?.total ?? 0) + amt,
    })
  }

  const assets      = [...assetMap.values()].filter(a => a.total !== 0).sort((a, b) => a.code.localeCompare(b.code))
  const liabilities = [...liabilityMap.values()].filter(a => a.total !== 0).sort((a, b) => a.code.localeCompare(b.code))
  const equities    = [...equityMap.values()].filter(a => a.total !== 0).sort((a, b) => a.code.localeCompare(b.code))

  const totalAssets      = assets.reduce((s, a) => s + a.total, 0)
  const totalLiabilities = liabilities.reduce((s, a) => s + a.total, 0)
  const totalEquities    = equities.reduce((s, a) => s + a.total, 0)
  const totalLiabEquity  = totalLiabilities + totalEquities

  const hasData = assets.length > 0 || liabilities.length > 0 || equities.length > 0

  function Section({
    title, items, total, colorClass,
  }: {
    title: string
    items: AccountTotal[]
    total: number
    colorClass: string
  }) {
    return (
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
        {items.length === 0 ? (
          <p className="text-xs text-gray-300 pl-2">—</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {items.map(item => (
                <tr key={item.code} className="border-b last:border-0">
                  <td className="py-1.5 pl-2 text-gray-600">[{item.code}] {item.name}</td>
                  <td className="py-1.5 pr-2 text-right">{fmt(item.total)}</td>
                </tr>
              ))}
              <tr className={`border-t ${colorClass}`}>
                <td className="py-2 pl-2 font-semibold">{title} 합계</td>
                <td className="py-2 pr-2 text-right font-bold">{fmt(total)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
        <span className="text-sm font-medium text-gray-600">기준일</span>
        <span className="text-sm font-bold text-[#090c1d]">{asOf}</span>
        <span className="text-xs text-gray-400 ml-2">승인된 전표 누적 기준</span>
      </div>

      {!hasData && (
        <div className="bg-white rounded-xl border p-8 text-center">
          <p className="text-gray-400 text-sm">승인된 전표 데이터가 없습니다.</p>
          <p className="text-gray-300 text-xs mt-1">전표를 등록하고 승인하면 재무상태표가 자동으로 집계됩니다.</p>
        </div>
      )}

      {hasData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 자산 */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-semibold text-[#090c1d] border-b pb-2">자산</h2>
            <Section title="자산" items={assets} total={totalAssets} colorClass="bg-blue-50 text-blue-700" />
            <div className="border-t-2 border-blue-300 pt-2">
              <div className="flex justify-between font-bold text-blue-700 text-sm">
                <span>자산 총계</span>
                <span>{fmt(totalAssets)}원</span>
              </div>
            </div>
          </div>

          {/* 부채 + 자본 */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-semibold text-[#090c1d] border-b pb-2">부채 및 자본</h2>
            <Section title="부채" items={liabilities} total={totalLiabilities} colorClass="bg-red-50 text-red-600" />
            <Section title="자본" items={equities} total={totalEquities} colorClass="bg-emerald-50 text-emerald-700" />
            <div className="border-t-2 border-gray-300 pt-2">
              <div className="flex justify-between font-bold text-gray-700 text-sm">
                <span>부채 및 자본 총계</span>
                <span>{fmt(totalLiabEquity)}원</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {hasData && (
        <div className={`rounded-xl border p-4 ${
          Math.round(totalAssets) === Math.round(totalLiabEquity)
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center justify-between text-sm font-semibold">
            <span className={Math.round(totalAssets) === Math.round(totalLiabEquity) ? 'text-emerald-700' : 'text-red-600'}>
              {Math.round(totalAssets) === Math.round(totalLiabEquity)
                ? '✓ 대차 균형 (자산 = 부채 + 자본)'
                : '✗ 대차 불균형 — 전표를 확인하세요'}
            </span>
            <span className="text-gray-500 text-xs">
              차이: {fmt(Math.abs(totalAssets - totalLiabEquity))}원
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
