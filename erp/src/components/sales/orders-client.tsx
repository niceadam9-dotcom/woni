'use client'

import { useState, useTransition } from 'react'
import { Plus, X, Trash2, ChevronDown } from 'lucide-react'
import {
  createOrderAction,
  updateOrderStatusAction,
  deleteOrderAction,
  type OrderItem,
} from '@/app/(dashboard)/orders/actions'

type Customer = { id: string; customer_name: string; customer_code: string }
type QuoteRef  = { id: string; quote_number: string; total_amount: number; customer_id: string }
type Order = {
  id: string
  order_number: string
  order_date: string
  delivery_date: string | null
  total_amount: number
  status: string
  notes: string | null
  items: OrderItem[]
  customers: Customer | null
  quotes: { quote_number: string } | null
  profiles: { name: string } | null
}

const STATUS_STYLE: Record<string, string> = {
  수주:   'bg-blue-100 text-blue-700',
  진행중: 'bg-amber-100 text-amber-700',
  완료:   'bg-emerald-100 text-emerald-700',
  취소:   'bg-red-100 text-red-600',
}
const STATUSES = ['수주', '진행중', '완료', '취소']

function fmt(n: number) { return n.toLocaleString('ko-KR') }

function ItemsEditor({ items, onChange }: { items: OrderItem[]; onChange: (i: OrderItem[]) => void }) {
  function update(idx: number, field: keyof OrderItem, val: string | number) {
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
          <input className="col-span-5 border rounded px-2 py-1.5 text-xs" placeholder="품목명"
            value={item.description} onChange={e => update(idx, 'description', e.target.value)} />
          <input type="number" min={1} className="col-span-2 border rounded px-2 py-1.5 text-xs text-right"
            value={item.quantity} onChange={e => update(idx, 'quantity', Number(e.target.value))} />
          <input type="number" min={0} className="col-span-3 border rounded px-2 py-1.5 text-xs text-right"
            value={item.unit_price} onChange={e => update(idx, 'unit_price', Number(e.target.value))} />
          <div className="col-span-1 text-xs text-right text-gray-600 pr-1">{fmt(item.amount)}</div>
          <button onClick={() => onChange(items.filter((_, i) => i !== idx))}
            className="col-span-1 text-gray-300 hover:text-red-400"><X size={13} /></button>
        </div>
      ))}
      <button onClick={() => onChange([...items, { description: '', quantity: 1, unit_price: 0, amount: 0 }])}
        className="flex items-center gap-1 text-xs text-[#7b68ee] hover:underline mt-1">
        <Plus size={12} /> 항목 추가
      </button>
    </div>
  )
}

function OrderModal({
  customers,
  quotes,
  onClose,
  onDone,
}: {
  customers: Customer[]
  quotes: QuoteRef[]
  onClose: () => void
  onDone: () => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [quoteId,    setQuoteId]    = useState('')
  const [orderDate,  setOrderDate]  = useState(new Date().toISOString().split('T')[0])
  const [deliveryDate, setDeliveryDate] = useState('')
  const [items, setItems] = useState<OrderItem[]>([
    { description: '', quantity: 1, unit_price: 0, amount: 0 },
  ])
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  // 연결 견적 선택 시 항목 자동 채우기
  function handleQuoteSelect(qid: string) {
    setQuoteId(qid)
    if (qid) {
      const q = quotes.find(q => q.id === qid)
      if (q) setCustomerId(q.customer_id)
    }
  }

  const totalAmount = items.reduce((s, i) => s + i.amount, 0)

  function submit() {
    if (!customerId) { setErr('고객을 선택하세요.'); return }
    if (!orderDate)  { setErr('수주일을 입력하세요.'); return }
    if (items.every(i => !i.description)) { setErr('최소 1개의 품목을 입력하세요.'); return }
    start(async () => {
      const res = await createOrderAction({
        customerId,
        quoteId: quoteId || null,
        orderDate,
        deliveryDate: deliveryDate || null,
        items: items.filter(i => i.description),
        notes: notes || null,
      })
      if (res.error) { setErr(res.error); return }
      onDone()
    })
  }

  const filteredQuotes = customerId ? quotes.filter(q => q.customer_id === customerId) : quotes

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#090c1d]">수주 등록</span>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">고객 *</label>
            <select value={customerId} onChange={e => setCustomerId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">선택하세요</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.customer_name} ({c.customer_code})</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">연결 견적서 (선택)</label>
            <select value={quoteId} onChange={e => handleQuoteSelect(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">없음</option>
              {filteredQuotes.map(q => (
                <option key={q.id} value={q.id}>{q.quote_number} — {fmt(q.total_amount)}원</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">수주일 *</label>
            <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">납기일</label>
            <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-2">수주 항목</label>
          <ItemsEditor items={items} onChange={setItems} />
        </div>

        <div className="bg-gray-50 rounded-lg p-3 flex justify-between items-center text-sm font-bold">
          <span>합계금액</span>
          <span>{fmt(totalAmount)}원</span>
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

export function OrdersClient({
  orders,
  customers,
  quotes,
}: {
  orders: Record<string, unknown>[]
  customers: Record<string, unknown>[]
  quotes: Record<string, unknown>[]
}) {
  const rows      = orders    as unknown as Order[]
  const custList  = customers as unknown as Customer[]
  const quoteList = quotes    as unknown as QuoteRef[]

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
          !r.order_number.toLowerCase().includes(q)) return false
    }
    return true
  })

  const summary = {
    total:   rows.length,
    진행중:  rows.filter(r => r.status === '진행중').length,
    완료:    rows.filter(r => r.status === '완료').length,
    totalAmt: rows.reduce((s, r) => s + r.total_amount, 0),
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '전체 수주', value: summary.total, color: 'text-gray-700' },
          { label: '진행중', value: summary.진행중, color: 'text-amber-600' },
          { label: '완료', value: summary.완료, color: 'text-emerald-600' },
          { label: '수주 총액', value: `${fmt(summary.totalAmt)}원`, color: 'text-[#7b68ee]' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {(['전체', ...STATUSES]).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === f ? 'bg-[#7b68ee] text-white' : 'bg-white border text-gray-500 hover:bg-gray-50'
              }`}>{f}</button>
          ))}
        </div>
        <input type="text" placeholder="고객명 / 수주번호 검색"
          value={search} onChange={e => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-48" />
        <div className="ml-auto">
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#7b68ee] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#6a5acd]">
            <Plus size={15} /> 수주 등록
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                {['No', '수주번호', '고객명', '연결 견적', '수주일', '납기일', '수주금액', '상태', '처리'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400 text-sm">수주 내역이 없습니다.</td></tr>
              ) : (
                filtered.map((row, idx) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-400">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{row.order_number}</td>
                    <td className="px-3 py-2.5 font-medium">{row.customers?.customer_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-400">{row.quotes?.quote_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500">{row.order_date}</td>
                    <td className="px-3 py-2.5 text-gray-500">{row.delivery_date ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmt(row.total_amount)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[row.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <div className="relative group">
                          <button disabled={statusPending}
                            className="flex items-center gap-1 border rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                            상태 <ChevronDown size={10} />
                          </button>
                          <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-10 hidden group-hover:block min-w-[80px]">
                            {STATUSES.filter(s => s !== row.status).map(s => (
                              <button key={s}
                                onClick={() => startStatus(async () => { await updateOrderStatusAction(row.id, s) })}
                                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50">
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                        {row.status === '취소' && (
                          <button
                            onClick={() => { if (confirm('삭제하시겠습니까?')) startDelete(async () => { await deleteOrderAction(row.id) }) }}
                            disabled={deletePending}
                            className="p-1 text-gray-300 hover:text-red-400 disabled:opacity-50">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <OrderModal
          customers={custList}
          quotes={quoteList}
          onClose={() => setShowModal(false)}
          onDone={() => setShowModal(false)}
        />
      )}
    </>
  )
}
