'use client'

import { useState } from 'react'

type BillRow = {
  billing_month: string
  supply_value: number
  tax_value: number
  total_amount: number
  paid_at: string | null
  bill_date: string
}
type InvoiceRow = {
  issue_date: string | null
  invoice_status: string
  issued: boolean
  bills: { tax_value: number } | null
}

function fmt(n: number) { return n.toLocaleString('ko-KR') }

export function VatClient({
  bills,
  invoices,
  year,
}: {
  bills: Record<string, unknown>[]
  invoices: Record<string, unknown>[]
  year: number
}) {
  const billList    = bills    as unknown as BillRow[]
  const invoiceList = invoices as unknown as InvoiceRow[]

  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4 | 'all'>('all')

  // 분기별 범위
  const quarterRange: Record<number, [string, string]> = {
    1: ['01', '03'],
    2: ['04', '06'],
    3: ['07', '09'],
    4: ['10', '12'],
  }

  const filteredBills = billList.filter(b => {
    if (quarter === 'all') return true
    const [start, end] = quarterRange[quarter]
    const m = b.bill_date.slice(5, 7)
    return m >= start && m <= end
  })

  // 월별 집계
  type MonthData = {
    month: string
    supplyValue: number
    taxValue: number
    totalAmount: number
    count: number
    paidCount: number
  }
  const monthMap = new Map<string, MonthData>()

  for (const b of filteredBills) {
    const m = b.bill_date.slice(0, 7)
    const existing = monthMap.get(m) ?? {
      month: m, supplyValue: 0, taxValue: 0, totalAmount: 0, count: 0, paidCount: 0,
    }
    monthMap.set(m, {
      ...existing,
      supplyValue:  existing.supplyValue  + b.supply_value,
      taxValue:     existing.taxValue     + b.tax_value,
      totalAmount:  existing.totalAmount  + b.total_amount,
      count:        existing.count + 1,
      paidCount:    existing.paidCount + (b.paid_at ? 1 : 0),
    })
  }

  const monthRows = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month))

  // 전체 합계
  const totals = filteredBills.reduce(
    (acc, b) => ({
      supplyValue:  acc.supplyValue  + b.supply_value,
      taxValue:     acc.taxValue     + b.tax_value,
      totalAmount:  acc.totalAmount  + b.total_amount,
    }),
    { supplyValue: 0, taxValue: 0, totalAmount: 0 }
  )

  // 세금계산서 현황
  const issuedTax    = invoiceList.filter(i => i.invoice_status === '발행완료').reduce((s, i) => s + (i.bills?.tax_value ?? 0), 0)
  const pendingTax   = totals.taxValue - issuedTax
  const issuedCount  = invoiceList.filter(i => i.invoice_status === '발행완료').length
  const totalInvCount = invoiceList.length

  return (
    <div className="space-y-4">
      {/* 분기 필터 */}
      <div className="flex items-center gap-3 bg-white rounded-xl border p-4">
        <span className="text-sm font-medium text-gray-600">{year}년</span>
        <div className="flex gap-1">
          {([['all', '전체'], [1, '1분기'], [2, '2분기'], [3, '3분기'], [4, '4분기']] as const).map(([v, label]) => (
            <button key={label} onClick={() => setQuarter(v as typeof quarter)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                quarter === v ? 'bg-[#7b68ee] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>{label}</button>
          ))}
        </div>
      </div>

      {/* 부가세 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '공급가액 합계', value: totals.supplyValue, color: 'text-gray-700' },
          { label: '부가세 합계',   value: totals.taxValue,    color: 'text-[#7b68ee]' },
          { label: '세금계산서 발행', value: `${issuedCount}/${totalInvCount}건`, color: 'text-emerald-600', isText: true },
          { label: '미발행 부가세', value: pendingTax, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            {s.isText
              ? <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              : <p className={`text-2xl font-bold mt-1 ${s.color}`}>{fmt(s.value as number)}<span className="text-sm font-normal ml-0.5">원</span></p>
            }
          </div>
        ))}
      </div>

      {/* 월별 부가세 현황 테이블 */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50">
          <h2 className="font-semibold text-sm text-[#090c1d]">월별 부가가치세 현황</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                {['월', '청구 건수', '공급가액', '부가세', '청구금액 합계', '입금 건수'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthRows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">데이터가 없습니다.</td></tr>
              ) : (
                monthRows.map(row => (
                  <tr key={row.month} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{row.month}</td>
                    <td className="px-4 py-2.5 text-center">{row.count}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(row.supplyValue)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[#7b68ee]">{fmt(row.taxValue)}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(row.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-center">{row.paidCount} / {row.count}</td>
                  </tr>
                ))
              )}
            </tbody>
            {monthRows.length > 0 && (
              <tfoot>
                <tr className="bg-[#f5f4ff] font-bold">
                  <td className="px-4 py-3 text-[#7b68ee]">합계</td>
                  <td className="px-4 py-3 text-center text-[#7b68ee]">{filteredBills.length}</td>
                  <td className="px-4 py-3 text-right text-[#7b68ee]">{fmt(totals.supplyValue)}</td>
                  <td className="px-4 py-3 text-right text-[#7b68ee]">{fmt(totals.taxValue)}</td>
                  <td className="px-4 py-3 text-right text-[#7b68ee]">{fmt(totals.totalAmount)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
