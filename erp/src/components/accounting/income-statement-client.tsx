'use client'

import { useState } from 'react'

type LineRow = {
  debit_amount: number
  credit_amount: number
  account_codes: { code: string; name: string; account_type: string } | null
  vouchers: { voucher_date: string; status: string } | null
}
type BillRow = {
  total_amount: number
  paid_amount: number
  paid_at: string | null
  bill_date: string
}

function fmt(n: number) { return n.toLocaleString('ko-KR') }

export function IncomeStatementClient({
  lines,
  bills,
  year,
}: {
  lines: Record<string, unknown>[]
  bills: Record<string, unknown>[]
  year: number
}) {
  const lineList = lines as unknown as LineRow[]
  const billList = bills as unknown as BillRow[]

  const [viewYear, setViewYear] = useState(year)

  // 승인된 전표 명세만 필터
  const approvedLines = lineList.filter(l => l.vouchers?.status === '승인')

  // 계정별 집계
  type AccountTotal = { code: string; name: string; total: number }
  const revenueMap = new Map<string, AccountTotal>()
  const expenseMap = new Map<string, AccountTotal>()

  for (const l of approvedLines) {
    const ac = l.account_codes
    if (!ac) continue
    if (ac.account_type === '수익') {
      const existing = revenueMap.get(ac.code)
      // 수익: 대변 증가
      const amt = l.credit_amount - l.debit_amount
      revenueMap.set(ac.code, {
        code: ac.code, name: ac.name,
        total: (existing?.total ?? 0) + amt,
      })
    } else if (ac.account_type === '비용') {
      const existing = expenseMap.get(ac.code)
      // 비용: 차변 증가
      const amt = l.debit_amount - l.credit_amount
      expenseMap.set(ac.code, {
        code: ac.code, name: ac.name,
        total: (existing?.total ?? 0) + amt,
      })
    }
  }

  // bills 기반 매출 집계 (청구 기준)
  const billRevenue = billList.reduce((s, b) => s + b.total_amount, 0)
  const billPaid    = billList.reduce((s, b) => s + b.paid_amount, 0)
  const billUnpaid  = billRevenue - billPaid

  const revenues = [...revenueMap.values()].sort((a, b) => a.code.localeCompare(b.code))
  const expenses = [...expenseMap.values()].sort((a, b) => a.code.localeCompare(b.code))

  const totalRevenue = revenues.reduce((s, r) => s + r.total, 0)
  const totalExpense = expenses.reduce((s, e) => s + e.total, 0)
  const operatingIncome = totalRevenue - totalExpense

  const hasVoucherData = revenues.length > 0 || expenses.length > 0

  return (
    <div className="space-y-4">
      {/* 연도 선택 */}
      <div className="flex items-center gap-3 bg-white rounded-xl border p-4">
        <span className="text-sm font-medium text-gray-600">기준 연도</span>
        <div className="flex gap-1">
          {[year - 1, year].map(y => (
            <button key={y} onClick={() => setViewYear(y)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewYear === y ? 'bg-[#7b68ee] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>{y}년</button>
          ))}
        </div>
        <span className="text-xs text-gray-400 ml-2">{viewYear}년 1월 1일 ~ 12월 31일</span>
      </div>

      {/* bills 기반 매출 현황 */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-sm mb-4 text-[#090c1d]">청구 기반 매출 현황</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: '총 청구금액',  value: billRevenue, color: 'text-[#7b68ee]' },
            { label: '입금 완료',    value: billPaid,    color: 'text-emerald-600' },
            { label: '미수금 (미납)', value: billUnpaid,  color: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className={`text-xl font-bold mt-1 ${s.color}`}>{fmt(s.value)}<span className="text-sm font-normal ml-1">원</span></p>
            </div>
          ))}
        </div>
      </div>

      {/* 전표 기반 손익계산서 */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b bg-gray-50">
          <h2 className="font-semibold text-sm text-[#090c1d]">손익계산서 (승인 전표 기준)</h2>
          {!hasVoucherData && (
            <p className="text-xs text-gray-400 mt-1">승인된 전표 데이터가 없습니다. 전표를 등록·승인하면 자동으로 집계됩니다.</p>
          )}
        </div>

        <div className="p-5 space-y-6">
          {/* 수익 */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">수익</h3>
            {revenues.length === 0 ? (
              <p className="text-xs text-gray-300 pl-2">—</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {revenues.map(r => (
                    <tr key={r.code} className="border-b last:border-0">
                      <td className="py-2 pl-2 text-gray-600">[{r.code}] {r.name}</td>
                      <td className="py-2 pr-2 text-right font-medium">{fmt(r.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-blue-50">
                    <td className="py-2 pl-2 font-semibold text-blue-700">수익 합계</td>
                    <td className="py-2 pr-2 text-right font-bold text-blue-700">{fmt(totalRevenue)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* 비용 */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">비용</h3>
            {expenses.length === 0 ? (
              <p className="text-xs text-gray-300 pl-2">—</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {expenses.map(e => (
                    <tr key={e.code} className="border-b last:border-0">
                      <td className="py-2 pl-2 text-gray-600">[{e.code}] {e.name}</td>
                      <td className="py-2 pr-2 text-right font-medium">{fmt(e.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-red-50">
                    <td className="py-2 pl-2 font-semibold text-red-600">비용 합계</td>
                    <td className="py-2 pr-2 text-right font-bold text-red-600">{fmt(totalExpense)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* 영업이익 */}
          <div className={`rounded-xl p-4 ${operatingIncome >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <div className="flex justify-between items-center">
              <span className={`font-bold ${operatingIncome >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                당기 순이익
              </span>
              <span className={`text-2xl font-bold ${operatingIncome >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {operatingIncome >= 0 ? '+' : ''}{fmt(operatingIncome)}원
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
