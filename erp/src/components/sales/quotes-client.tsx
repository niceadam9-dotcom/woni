'use client'

import { useState, useTransition } from 'react'
import { Plus, X, Trash2, ChevronDown } from 'lucide-react'
import {
  createQuoteAction,
  updateQuoteStatusAction,
  deleteQuoteAction,
  type QuoteItem,
} from '@/app/(dashboard)/quotes/actions'
import { DateInput } from '@/components/ui/date-input'

type Customer = { id: string; customer_name: string; customer_code: string }
type Quote = {
  id: string
  quote_number: string
  quote_date: string
  valid_until: string | null
  subtotal: number
  tax_amount: number
  total_amount: number
  status: string
  notes: string | null
  items: QuoteItem[]
  customers: Customer | null
  profiles: { name: string } | null
}

const STATUS_STYLE: Record<string, string> = {
  작성중: 'bg-gray-100 text-gray-600',
  발송:   'bg-blue-100 text-blue-700',
  수주:   'bg-emerald-100 text-emerald-700',
  취소:   'bg-red-100 text-red-600',
  만료:   'bg-yellow-100 text-yellow-600',
}
const STATUSES = ['작성중', '발송', '수주', '취소', '만료']

function fmt(n: number) { return n.toLocaleString('ko-KR') }

function ItemsEditor({
  items,
  onChange,
}: {
  items: QuoteItem[]
  onChange: (items: QuoteItem[]) => void
}) {
  function update(idx: number, field: keyof QuoteItem, val: string | number) {
    const next = items.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: val }
      if (field === 'quantity' || field === 'unit_price') {
        updated.amount = Number(updated.quantity) * Number(updated.unit_price)
      }
      return updated
    })
    onChange(next)
  }
  function addRow() {
    onChange([...items, { description: '', quantity: 1, unit_price: 0, amount: 0 }])
  }
  function removeRow(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-1 text-xs text-gray-400 px-1">
        <div className="col-span-5">품목/내용</div>
        <div className="col-span-2 text-right">수량</div>
        <div className="col-span-3 text-right">단가</div>
        <div className="col-span-1 text-right">금액</div>
        <div className="col-span-1" />
      </div>
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-1 items-center">
          <input
            className="col-span-5 border rounded px-2 py-1.5 text-xs"
            placeholder="품목명"
            value={item.description}
            onChange={e => update(idx, 'description', e.target.value)}
          />
          <input
            type="number" min={1}
            className="col-span-2 border rounded px-2 py-1.5 text-xs text-right"
            value={item.quantity}
            onChange={e => update(idx, 'quantity', Number(e.target.value))}
          />
          <input
            type="number" min={0}
            className="col-span-3 border rounded px-2 py-1.5 text-xs text-right"
            value={item.unit_price}
            onChange={e => update(idx, 'unit_price', Number(e.target.value))}
          />
          <div className="col-span-1 text-xs text-right text-gray-600 pr-1">
            {fmt(item.amount)}
          </div>
          <button onClick={() => removeRow(idx)} className="col-span-1 text-gray-300 hover:text-red-400">
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        className="flex items-center gap-1 text-xs text-[#7b68ee] hover:underline mt-1"
      >
        <Plus size={12} /> 항목 추가
      </button>
    </div>
  )
}

function QuoteModal({
  customers,
  onClose,
  onDone,
}: {
  customers: Customer[]
  onClose: () => void
  onDone: () => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [quoteDate, setQuoteDate]   = useState(new Date().toISOString().split('T')[0])
  const [validUntil, setValidUntil] = useState('')
  const [items, setItems] = useState<QuoteItem[]>([
    { description: '', quantity: 1, unit_price: 0, amount: 0 },
  ])
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  const subtotal    = items.reduce((s, i) => s + i.amount, 0)
  const taxAmount   = Math.round(subtotal * 0.1)
  const totalAmount = subtotal + taxAmount

  function submit() {
    if (!customerId) { setErr('고객을 선택하세요.'); return }
    if (!quoteDate)  { setErr('견적일을 입력하세요.'); return }
    if (items.every(i => !i.description)) { setErr('최소 1개의 품목을 입력하세요.'); return }
    start(async () => {
      const res = await createQuoteAction({
        customerId,
        quoteDate,
        validUntil: validUntil || null,
        items: items.filter(i => i.description),
        notes: notes || null,
      })
      if (res.error) { setErr(res.error); return }
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#090c1d]">견적서 등록</span>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">고객<span className="text-red-500 ml-0.5">*</span></label>
            <select value={customerId} onChange={e => setCustomerId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">선택하세요</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.customer_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">견적일<span className="text-red-500 ml-0.5">*</span></label>
            <DateInput value={quoteDate} onChange={e => setQuoteDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">유효기간</label>
            <DateInput value={validUntil} onChange={e => setValidUntil(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-2">견적 항목<span className="text-red-500 ml-0.5">*</span></label>
          <ItemsEditor items={items} onChange={setItems} />
        </div>

        {/* 합계 */}
        <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-500">
            <span>공급가액</span><span>{fmt(subtotal)}원</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>부가세 (10%)</span><span>{fmt(taxAmount)}원</span>
          </div>
          <div className="flex justify-between font-bold text-[#090c1d] pt-1 border-t">
            <span>합계금액</span><span>{fmt(totalAmount)}원</span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">메모</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button onClick={submit} disabled={pending}
            className="flex-1 bg-[#7b68ee] text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {pending ? '등록 중…' : '등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function QuotesClient({
  quotes,
  customers,
  canManage,
}: {
  quotes: Record<string, unknown>[]
  customers: Record<string, unknown>[]
  canManage: boolean
}) {
  const rows = quotes as unknown as Quote[]
  const custList = customers as unknown as Customer[]

  const [statusFilter, setStatusFilter] = useState('전체')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [statusPending, startStatus] = useTransition()
  const [deletePending, startDelete] = useTransition()

  const filtered = rows.filter(r => {
    if (statusFilter !== '전체' && r.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!r.customers?.customer_name.toLowerCase().includes(q) &&
          !r.quote_number.toLowerCase().includes(q)) return false
    }
    return true
  })

  const summary = {
    total:  rows.length,
    발송:   rows.filter(r => r.status === '발송').length,
    수주:   rows.filter(r => r.status === '수주').length,
    totalAmt: rows.filter(r => r.status === '수주').reduce((s, r) => s + r.total_amount, 0),
  }

  function handleStatusChange(id: string, status: string) {
    startStatus(async () => { await updateQuoteStatusAction(id, status) })
  }
  function handleDelete(id: string) {
    if (!confirm('견적서를 삭제하시겠습니까?')) return
    startDelete(async () => { await deleteQuoteAction(id) })
  }

  return (
    <>
      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '전체 견적', value: summary.total, color: 'text-gray-700' },
          { label: '발송', value: summary.발송, color: 'text-blue-600' },
          { label: '수주', value: summary.수주, color: 'text-emerald-600' },
          { label: '수주 금액', value: `${fmt(summary.totalAmt)}원`, color: 'text-[#7b68ee]' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 필터 + 등록 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {(['전체', ...STATUSES]).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === f ? 'bg-[#7b68ee] text-white' : 'bg-white border text-gray-500 hover:bg-gray-50'
              }`}>{f}</button>
          ))}
        </div>
        <input
          type="text" placeholder="고객명 / 견적번호 검색"
          value={search} onChange={e => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-48"
        />
        <div className="ml-auto">
          {canManage && (
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-[#7b68ee] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#6a5acd]">
              <Plus size={15} /> 견적서 등록
            </button>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                {['No', '견적번호', '고객명', '견적일', '유효기간', '공급가액', '부가세', '합계', '상태', canManage ? '처리' : ''].filter(Boolean).map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400 text-sm">견적서가 없습니다.</td></tr>
              ) : (
                filtered.map((row, idx) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-400">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{row.quote_number}</td>
                    <td className="px-3 py-2.5 font-medium">{row.customers?.customer_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500">{row.quote_date}</td>
                    <td className="px-3 py-2.5 text-gray-500">{row.valid_until ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(row.subtotal)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(row.tax_amount)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmt(row.total_amount)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[row.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {row.status}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <div className="relative group">
                            <button
                              disabled={statusPending}
                              className="flex items-center gap-1 border rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                            >
                              상태 <ChevronDown size={10} />
                            </button>
                            <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-10 hidden group-hover:block min-w-[80px]">
                              {STATUSES.filter(s => s !== row.status).map(s => (
                                <button key={s} onClick={() => handleStatusChange(row.id, s)}
                                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50">
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                          {['작성중', '취소'].includes(row.status) && (
                            <button onClick={() => handleDelete(row.id)} disabled={deletePending}
                              className="p-1 text-gray-300 hover:text-red-400 disabled:opacity-50">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <QuoteModal
          customers={custList}
          onClose={() => setShowModal(false)}
          onDone={() => setShowModal(false)}
        />
      )}
    </>
  )
}
