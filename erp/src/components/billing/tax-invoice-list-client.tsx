'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { CheckCircle, Clock, XCircle } from 'lucide-react'
import { cancelTaxInvoiceAction } from '@/app/(dashboard)/tax-invoices/actions'

type TaxInvoice = {
  id: string
  issue_date: string | null
  approval_num: string | null
  invoice_status: string
  issued: boolean
}

type BillRow = {
  id: string
  billing_month: string
  bill_type: string
  bill_date: string
  supply_value: number
  tax_value: number
  total_amount: number
  paid_amount: number
  paid_at: string | null
  customers: { customer_name: string; customer_code: string } | null
  tax_invoices: TaxInvoice | TaxInvoice[] | null
}

function getTaxInvoice(row: BillRow): TaxInvoice | null {
  if (!row.tax_invoices) return null
  if (Array.isArray(row.tax_invoices)) return row.tax_invoices[0] ?? null
  return row.tax_invoices
}

function fmt(n: number) {
  return n.toLocaleString('ko-KR')
}

function StatusBadge({ status, issued }: { status?: string; issued?: boolean }) {
  if (!status || status === '전송대기') {
    return (
      <span className="flex items-center gap-1 text-xs text-gray-400">
        <Clock size={12} /> 미발행
      </span>
    )
  }
  if (status === '발행완료') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
        <CheckCircle size={12} /> 발행완료
      </span>
    )
  }
  if (status === '취소') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500">
        <XCircle size={12} /> 취소
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-amber-600">
      <Clock size={12} /> {status}
    </span>
  )
}


export function TaxInvoiceListClient({
  bills,
  canManage,
}: {
  bills: Record<string, unknown>[]
  canManage: boolean
}) {
  const rows = bills as unknown as BillRow[]

  const [statusFilter, setStatusFilter] = useState<'전체' | '미발행' | '발행완료' | '취소'>('전체')
  const [search, setSearch] = useState('')
  const [cancelPending, startCancel] = useTransition()
  const [cancelErr, setCancelErr] = useState('')

  // '전송대기'는 미발행으로 취급
  function normalizeStatus(inv: TaxInvoice | null): string {
    if (!inv || inv.invoice_status === '전송대기') return '미발행'
    return inv.invoice_status
  }

  const filtered = rows.filter(row => {
    const inv = getTaxInvoice(row)
    const invStatus = normalizeStatus(inv)

    if (statusFilter !== '전체' && invStatus !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !row.customers?.customer_name.toLowerCase().includes(q) &&
        !row.billing_month.includes(q)
      ) return false
    }
    return true
  })

  const summary = {
    total:    rows.length,
    issued:   rows.filter(r => getTaxInvoice(r)?.invoice_status === '발행완료').length,
    pending:  rows.filter(r => !getTaxInvoice(r)).length,
    canceled: rows.filter(r => getTaxInvoice(r)?.invoice_status === '취소').length,
  }

  function handleCancel(row: BillRow) {
    if (!confirm('세금계산서를 취소하시겠습니까?')) return
    setCancelErr('')
    startCancel(async () => {
      const res = await cancelTaxInvoiceAction(row.id)
      if (res?.error) setCancelErr(res.error)
    })
  }

  return (
    <>
      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '전체 청구', value: summary.total, color: 'text-gray-600' },
          { label: '발행완료', value: summary.issued, color: 'text-emerald-600' },
          { label: '미발행', value: summary.pending, color: 'text-amber-600' },
          { label: '취소', value: summary.canceled, color: 'text-red-500' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 취소 오류 */}
      {cancelErr && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">
          {cancelErr}
        </div>
      )}

      {/* 필터 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {(['전체', '미발행', '발행완료', '취소'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === f
                  ? 'bg-[#7b68ee] text-white'
                  : 'bg-white border text-gray-500 hover:bg-gray-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="건물명 / 청구월 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-48"
        />
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                {['No', '건물명', '청구월', '구분', '청구일', '공급가액', '부가세', '청구금액', '발행상태', '발행일', '승인번호', canManage ? '처리' : ''].filter(Boolean).map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-gray-400 text-sm">
                    청구 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => {
                  const inv = getTaxInvoice(row)
                  const isIssued = inv?.invoice_status === '발행완료'
                  const isCanceled = inv?.invoice_status === '취소'

                  return (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2.5 font-medium">{row.customers?.customer_name}</td>
                      <td className="px-3 py-2.5">{row.billing_month}</td>
                      <td className="px-3 py-2.5 text-gray-500">{row.bill_type}</td>
                      <td className="px-3 py-2.5 text-gray-500">{row.bill_date}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(row.supply_value)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(row.tax_value)}</td>
                      <td className="px-3 py-2.5 text-right font-medium">{fmt(row.total_amount)}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={inv?.invoice_status} issued={inv?.issued} />
                      </td>
                      <td className="px-3 py-2.5 text-gray-500">{inv?.issue_date ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{inv?.approval_num ?? '—'}</td>
                      {canManage && (
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {!isIssued && (
                              <Link
                                href={`/tax-invoices/issue?billId=${row.id}`}
                                className="bg-[#7b68ee]/10 text-[#7b68ee] hover:bg-[#7b68ee]/20 px-2 py-1 rounded text-xs font-medium"
                              >
                                {isCanceled ? '재발행' : '발행'}
                              </Link>
                            )}
                            {isIssued && (
                              <>
                                <Link
                                  href={`/tax-invoices/issue?billId=${row.id}`}
                                  className="border text-gray-500 hover:bg-gray-50 px-2 py-1 rounded text-xs"
                                >
                                  수정
                                </Link>
                                <button
                                  onClick={() => handleCancel(row)}
                                  disabled={cancelPending}
                                  className="text-red-400 hover:text-red-600 px-2 py-1 rounded text-xs"
                                >
                                  취소
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </>
  )
}
