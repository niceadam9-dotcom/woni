'use client'

import { useState, useMemo, useTransition } from 'react'
import { Search, X, Plus, Check, CalendarClock, Loader2 } from 'lucide-react'
import { CustomerCombobox } from '@/components/ui/customer-combobox'
import { DateInput } from '@/components/ui/date-input'
import { TableScroll } from '@/components/ui/table-scroll'
import {
  createBillAction,
  updateBillPaymentAction,
  issueTaxInvoiceAction,
  generateMonthlyFixedBillsAction,
} from '@/app/(dashboard)/billing/status/actions'
import { useRouter } from 'next/navigation'

// ── helpers ────────────────────────────────────────────────────────────────
function fmt(d: string | null | undefined) { return d ? d.slice(0, 10) : '' }
function fmtNum(n: number) { return n.toLocaleString('ko-KR') }
function isOverdue(billDate: string | null | undefined, paidAt: string | null | undefined) {
  if (paidAt) return false
  if (!billDate) return false
  const due = new Date(billDate)
  due.setDate(due.getDate() + 30)
  return due < new Date()
}

// ── types ──────────────────────────────────────────────────────────────────
type TaxInvoice = { issued: boolean; issue_date: string | null; invoice_status: string }
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
  payment_method: string | null
  notes: string | null
  customers: { customer_name: string; customer_code: string } | null
  tax_invoices: TaxInvoice | TaxInvoice[] | null
}

function getTaxInvoice(row: BillRow): TaxInvoice | null {
  if (!row.tax_invoices) return null
  if (Array.isArray(row.tax_invoices)) return row.tax_invoices[0] ?? null
  return row.tax_invoices
}

// ── 청구등록 모달 ─────────────────────────────────────────────────────────
function CreateBillModal({
  customers,
  defaultMonth,
  onClose,
}: {
  customers: Array<{ id: string; customer_name: string; customer_code: string }>
  defaultMonth: string
  onClose: () => void
}) {
  const [customerId,  setCustomerId]  = useState('')
  const [billType,    setBillType]    = useState('일괄점검')
  const [billingMonth, setBillingMonth] = useState(defaultMonth)
  const [billDate,    setBillDate]    = useState('')
  const [supplyValue, setSupplyValue] = useState('')
  const [notes,       setNotes]       = useState('')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  const sv      = Number(supplyValue.replace(/,/g, '')) || 0
  const taxV    = Math.round(sv * 0.1)
  const totalV  = sv + taxV

  function save() {
    if (!customerId || !billDate || !sv) { setErr('건물명, 청구일, 공급가액을 입력해 주세요.'); return }
    startTransition(async () => {
      const res = await createBillAction({
        customerId,
        billingMonth,
        billType,
        billDate,
        supplyValue: sv,
        taxValue:    taxV,
        totalAmount: totalV,
        notes:       notes || null,
      })
      if (res.error) { setErr(res.error); return }
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[440px] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-semibold">청구서 등록</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-3">
            <label className="w-24 text-xs text-gray-600 shrink-0">건물명<span className="text-red-500 ml-0.5">*</span></label>
            <CustomerCombobox
              customers={customers}
              value={customerId}
              onChange={setCustomerId}
              placeholder="고객사 검색"
              className="flex-1"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-24 text-xs text-gray-600 shrink-0">청구월<span className="text-red-500 ml-0.5">*</span></label>
            <input
              value={billingMonth}
              onChange={e => setBillingMonth(e.target.value)}
              placeholder="YYYY.MM"
              className="flex-1 border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-24 text-xs text-gray-600 shrink-0">구분<span className="text-red-500 ml-0.5">*</span></label>
            <select
              value={billType}
              onChange={e => setBillType(e.target.value)}
              className="flex-1 border rounded px-2 py-1.5 text-sm"
            >
              {['일괄점검','자동기능점검','종합정밀점검','일괄청구','기타'].map(t => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="w-24 text-xs text-gray-600 shrink-0">청구일<span className="text-red-500 ml-0.5">*</span></label>
            <DateInput
              value={billDate}
              onChange={e => setBillDate(e.target.value)}
              className="flex-1 border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-24 text-xs text-gray-600 shrink-0">공급가액<span className="text-red-500 ml-0.5">*</span></label>
            <input
              value={supplyValue}
              onChange={e => setSupplyValue(e.target.value)}
              placeholder="100,000"
              className="flex-1 border rounded px-2 py-1.5 text-sm text-right"
            />
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="w-24 text-xs shrink-0">부가세액</span>
            <span className="flex-1 text-right pr-2">{fmtNum(taxV)}</span>
            <span className="text-[10px] text-gray-400">(자동)</span>
          </div>
          <div className="flex items-center gap-3 text-sm font-medium">
            <span className="w-24 text-xs shrink-0">청구금액</span>
            <span className="flex-1 text-right pr-2">{fmtNum(totalV)}</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="w-24 text-xs text-gray-600 shrink-0">메모</label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="flex-1 border rounded px-2 py-1.5 text-sm"
            />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded">취소</button>
          <button
            onClick={save}
            disabled={pending}
            className="px-4 py-1.5 text-sm bg-[#7b68ee] text-white rounded disabled:opacity-50"
          >
            {pending ? '등록 중…' : '등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 입금 처리 슬라이드 패널 ───────────────────────────────────────────────
function PaymentSlidePanel({
  bill,
  onClose,
}: {
  bill: BillRow
  onClose: () => void
}) {
  const [paidAt,         setPaidAt]         = useState(fmt(bill.paid_at))
  const [paidAmount,     setPaidAmount]     = useState(String(bill.paid_amount || bill.total_amount))
  const [paymentMethod,  setPaymentMethod]  = useState(bill.payment_method ?? '계좌이체')
  const [notes,          setNotes]          = useState(bill.notes ?? '')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  // 세금계산서 발행
  const [showInvoice,   setShowInvoice]   = useState(false)
  const [issueDate,     setIssueDate]     = useState(fmt(new Date().toISOString()))
  const [approvalNum,   setApprovalNum]   = useState('')
  const [invoicePending, startInvoiceTransition] = useTransition()

  const ti = getTaxInvoice(bill)

  function save() {
    startTransition(async () => {
      const res = await updateBillPaymentAction({
        id:            bill.id,
        paidAt:        paidAt || null,
        paidAmount:    Number(paidAmount) || 0,
        paymentMethod: paymentMethod || null,
        notes:         notes || null,
      })
      if (res.error) { setErr(res.error); return }
      onClose()
    })
  }

  function issueInvoice() {
    startInvoiceTransition(async () => {
      const res = await issueTaxInvoiceAction({ billId: bill.id, issueDate, approvalNum: approvalNum || null })
      if (res.error) { setErr(res.error); return }
      setShowInvoice(false)
      onClose()
    })
  }

  const unpaid = bill.total_amount - (Number(paidAmount) || 0)

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-80 bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <div className="font-semibold text-sm">{bill.customers?.customer_name}</div>
            <div className="text-xs text-gray-400">{bill.billing_month} 청구</div>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          <div className="flex justify-between text-sm border-b pb-2">
            <span className="text-gray-500">청구금액</span>
            <span className="font-bold">{fmtNum(bill.total_amount)}원</span>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">입금일<span className="text-red-500 ml-0.5">*</span></label>
            <DateInput
              value={paidAt}
              onChange={e => setPaidAt(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">입금액<span className="text-red-500 ml-0.5">*</span></label>
            <input
              value={paidAmount}
              onChange={e => setPaidAmount(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm text-right"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">입금방법</label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm"
            >
              {['계좌이체','현금','카드','기타'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">메모</label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          {unpaid < 0 || unpaid > 0 ? (
            <div className={`text-xs p-2 rounded ${unpaid > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
              미납금액: {fmtNum(Math.max(0, unpaid))}원
            </div>
          ) : null}
          {err && <p className="text-xs text-red-500">{err}</p>}

          {/* 세금계산서 발행 */}
          {paidAt && (
            <div className="border-t pt-3">
              {ti?.issued ? (
                <div className="text-xs text-green-600 flex items-center gap-1">
                  <Check size={12} /> 세금계산서 발행완료 ({fmt(ti.issue_date)})
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowInvoice(v => !v)}
                    className="text-xs text-[#7b68ee] underline"
                  >
                    세금계산서 발행
                  </button>
                  {showInvoice && (
                    <div className="mt-2 space-y-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">발행일자</label>
                        <DateInput value={issueDate} onChange={e => setIssueDate(e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">승인번호</label>
                        <input value={approvalNum} onChange={e => setApprovalNum(e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm" />
                      </div>
                      <button
                        onClick={issueInvoice}
                        disabled={invoicePending}
                        className="w-full border border-[#7b68ee] text-[#7b68ee] rounded py-1.5 text-sm"
                      >
                        {invoicePending ? '발행 중…' : '발행'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t">
          <button
            onClick={save}
            disabled={pending}
            className="w-full bg-[#7b68ee] text-white rounded py-2 text-sm font-medium disabled:opacity-50"
          >
            {pending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export function BillingStatusClient({
  initialBills,
  customers,
  defaultMonth,
}: {
  initialBills: Record<string, unknown>[]
  customers: Array<{ id: string; customer_name: string; customer_code: string }>
  defaultMonth: string
}) {
  const bills = initialBills as unknown as BillRow[]

  const [monthFilter,   setMonthFilter]   = useState(defaultMonth)
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [nameFilter,    setNameFilter]    = useState('')
  const [showCreate,    setShowCreate]    = useState(false)
  const [slideItem,     setSlideItem]     = useState<BillRow | null>(null)
  const [genPending, startGen] = useTransition()
  const [genMsg, setGenMsg] = useState('')
  const router = useRouter()

  function generateFixed() {
    const month = monthFilter?.trim()
    if (!month || !/^\d{4}\.\d{2}$/.test(month)) { setGenMsg('월 필터를 YYYY.MM 형식으로 지정하세요.'); return }
    setGenMsg('')
    const today = new Date()
    const billDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    startGen(async () => {
      const res = await generateMonthlyFixedBillsAction({ billingMonth: month, billDate })
      if (res.error) { setGenMsg(res.error); return }
      setGenMsg(`${month} 월정액 청구 ${res.created ?? 0}건 생성 (건너뜀 ${res.skipped ?? 0}건)`)
      router.refresh()
    })
  }

  const filtered = useMemo(() => {
    return bills.filter(b => {
      if (monthFilter && b.billing_month !== monthFilter) return false
      if (nameFilter) {
        const nm = (b.customers?.customer_name ?? '').toLowerCase()
        if (!nm.includes(nameFilter.toLowerCase())) return false
      }
      if (statusFilter === 'paid'    && !b.paid_at) return false
      if (statusFilter === 'unpaid'  && (b.paid_at || !isOverdue(b.bill_date, b.paid_at))) return false
      if (statusFilter === 'pending' && b.paid_at) return false
      return true
    })
  }, [bills, monthFilter, statusFilter, nameFilter])

  // 합계
  const totals = useMemo(() => ({
    supply:  filtered.reduce((s, r) => s + r.supply_value, 0),
    tax:     filtered.reduce((s, r) => s + r.tax_value, 0),
    total:   filtered.reduce((s, r) => s + r.total_amount, 0),
    unpaid:  filtered.reduce((s, r) => s + Math.max(0, r.total_amount - r.paid_amount), 0),
  }), [filtered])

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h1 className="text-xl font-bold">정산현황 모니터링</h1>
          <p className="text-xs text-gray-400 mt-0.5">청구서 생성·입금·미납금 현황</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generateFixed}
            disabled={genPending}
            title="월 필터의 종합·작동 고객 월정액을 일괄 청구"
            className="flex items-center gap-2 border border-[#7b68ee] text-[#7b68ee] px-3 py-2 rounded-lg text-sm hover:bg-[#f5f4ff] disabled:opacity-50"
          >
            {genPending ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />} 월정액 일괄청구
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-[#7b68ee] text-white px-4 py-2 rounded-lg text-sm"
          >
            <Plus size={14} /> 청구등록
          </button>
        </div>
      </div>
      {genMsg && <div className="px-6 py-1.5 text-xs text-[#514b81] bg-[#f5f4ff] border-b">{genMsg}</div>}

      {/* 필터 */}
      <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b flex-wrap">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="all">전체</option>
          <option value="pending">입금대기</option>
          <option value="paid">입금완료</option>
          <option value="unpaid">미납</option>
        </select>
        <input
          value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}
          placeholder="YYYY.MM"
          className="border rounded px-2 py-1.5 text-sm w-24"
        />
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            placeholder="거래처·건물명"
            className="border rounded pl-7 pr-3 py-1.5 text-sm w-40"
          />
        </div>
        <span className="ml-auto text-xs text-gray-400">{filtered.length}건</span>
      </div>

      {/* 테이블 — 헤더 고정 + 레코드 스크롤 */}
      <TableScroll offset={280}>
        <table className="w-full text-xs border-collapse min-w-[1000px]">
          <thead className="bg-gray-100 sticky top-0 z-10 shadow-[0_1px_0_0_#c8c4d0]">
            <tr>
              <th className="border px-2 py-2 w-8">No</th>
              <th className="border px-2 py-2">청구월</th>
              <th className="border px-2 py-2">구분</th>
              <th className="border px-2 py-2 min-w-[120px]">건물명</th>
              <th className="border px-2 py-2">청구일</th>
              <th className="border px-2 py-2">입금일</th>
              <th className="border px-2 py-2 text-right">공급가액</th>
              <th className="border px-2 py-2 text-right">부가세액</th>
              <th className="border px-2 py-2 text-right">청구금액</th>
              <th className="border px-2 py-2 text-right">미납금액</th>
              <th className="border px-2 py-2 text-center">계산서발행</th>
              <th className="border px-2 py-2 text-center">선택</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="text-center py-10 text-gray-400">데이터가 없습니다.</td>
              </tr>
            )}
            {filtered.map((row, idx) => {
              const unpaid = Math.max(0, row.total_amount - row.paid_amount)
              const overdueFlag = isOverdue(row.bill_date, row.paid_at)
              const ti = getTaxInvoice(row)

              return (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="border px-2 py-1.5 text-center text-gray-500">{idx + 1}</td>
                  <td className="border px-2 py-1.5 text-center">{row.billing_month}</td>
                  <td className="border px-2 py-1.5 text-center text-gray-600">{row.bill_type}</td>
                  <td className="border px-2 py-1.5 font-medium">{row.customers?.customer_name}</td>
                  <td className="border px-2 py-1.5 text-center">{fmt(row.bill_date)}</td>
                  <td className={`border px-2 py-1.5 text-center ${row.paid_at ? 'text-green-600' : 'text-gray-300'}`}>
                    {fmt(row.paid_at) || '-'}
                  </td>
                  <td className="border px-2 py-1.5 text-right">{fmtNum(row.supply_value)}</td>
                  <td className="border px-2 py-1.5 text-right">{fmtNum(row.tax_value)}</td>
                  <td className="border px-2 py-1.5 text-right font-medium">{fmtNum(row.total_amount)}</td>
                  <td className={`border px-2 py-1.5 text-right ${overdueFlag && unpaid > 0 ? 'bg-red-100 text-red-700 font-medium' : ''}`}>
                    {unpaid > 0 ? fmtNum(unpaid) : row.paid_at ? '0' : '-'}
                  </td>
                  <td className="border px-2 py-1.5 text-center">
                    {ti?.issued
                      ? <span className="text-green-600"><Check size={12} className="inline" /></span>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="border px-2 py-1.5 text-center">
                    <button
                      onClick={() => setSlideItem(row)}
                      className="w-3.5 h-3.5 rounded-full border-2 border-[#7b68ee] inline-block"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
          {/* 합계 행 */}
          {filtered.length > 0 && (
            <tfoot>
              <tr className="bg-gray-100 font-semibold">
                <td colSpan={6} className="border px-2 py-2 text-right">합계</td>
                <td className="border px-2 py-2 text-right">{fmtNum(totals.supply)}</td>
                <td className="border px-2 py-2 text-right">{fmtNum(totals.tax)}</td>
                <td className="border px-2 py-2 text-right">{fmtNum(totals.total)}</td>
                <td className={`border px-2 py-2 text-right ${totals.unpaid > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmtNum(totals.unpaid)}
                </td>
                <td colSpan={2} className="border" />
              </tr>
            </tfoot>
          )}
        </table>
      </TableScroll>

      {/* 청구등록 모달 */}
      {showCreate && (
        <CreateBillModal
          customers={customers}
          defaultMonth={defaultMonth}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* 입금처리 슬라이드 패널 */}
      {slideItem && (
        <PaymentSlidePanel
          bill={slideItem}
          onClose={() => setSlideItem(null)}
        />
      )}
    </div>
  )
}
