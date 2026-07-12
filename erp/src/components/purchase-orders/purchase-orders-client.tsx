'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Check, X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { createPurchaseOrderAction, updatePOStatusAction, type POStatus } from '@/app/(dashboard)/purchase-orders/actions'
import { DateInput } from '@/components/ui/date-input'

const inputCls = 'w-full h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition'

const STATUS_LABELS: Record<string, string> = { draft: '임시', ordered: '발주완료', received: '입고완료', cancelled: '취소' }
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', ordered: 'bg-blue-50 text-blue-600',
  received: 'bg-green-50 text-green-600', cancelled: 'bg-red-50 text-red-500',
}

type Item = { id: string; item_code: string; item_name: string; unit: string | null; standard_price: number | null }
type Partner = { id: string; partner_name: string }
type POLine = { id: string; quantity: number; unit_price: number; subtotal: number; item: { item_name: string; item_code: string; unit: string | null } | null }
type PO = {
  id: string; order_date: string; expected_date: string | null; status: string
  total_amount: number; notes: string | null
  partner: { partner_name: string } | null; creator: { name: string } | null
  purchase_order_lines: POLine[]
}

type LineInput = { item_id: string; quantity: string; unit_price: string }

export function PurchaseOrdersClient({ orders, items, partners }: {
  orders: Record<string, unknown>[]
  items: Item[]; partners: Partner[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [form, setForm] = useState({ partner_id: '', order_date: new Date().toISOString().slice(0, 10), expected_date: '', notes: '' })
  const [lines, setLines] = useState<LineInput[]>([{ item_id: '', quantity: '1', unit_price: '' }])

  const rows = (orders as PO[]).filter(o => !statusFilter || o.status === statusFilter)

  function addLine() { setLines(p => [...p, { item_id: '', quantity: '1', unit_price: '' }]) }
  function removeLine(i: number) { setLines(p => p.filter((_, idx) => idx !== i)) }
  function setLine(i: number, k: keyof LineInput, v: string) {
    setLines(p => {
      const next = [...p]; next[i] = { ...next[i], [k]: v }
      if (k === 'item_id') {
        const item = items.find(it => it.id === v)
        if (item?.standard_price) next[i].unit_price = item.standard_price.toString()
      }
      return next
    })
  }

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0)

  function handleCreate() {
    setError('')
    const validLines = lines.filter(l => l.item_id && parseFloat(l.quantity) > 0)
    if (validLines.length === 0) { setError('품목을 하나 이상 추가하세요.'); return }
    startTransition(async () => {
      const result = await createPurchaseOrderAction({
        partner_id: form.partner_id || undefined,
        order_date: form.order_date,
        expected_date: form.expected_date || undefined,
        notes: form.notes || undefined,
        lines: validLines.map(l => ({ item_id: l.item_id, quantity: parseFloat(l.quantity), unit_price: parseFloat(l.unit_price) || 0 })),
      })
      if (result.error) { setError(result.error); return }
      setShowNew(false)
      setLines([{ item_id: '', quantity: '1', unit_price: '' }])
      setForm({ partner_id: '', order_date: new Date().toISOString().slice(0, 10), expected_date: '', notes: '' })
      router.refresh()
    })
  }

  function handleStatusChange(id: string, status: string) {
    startTransition(async () => {
      await updatePOStatusAction(id, status as POStatus)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {['', 'draft', 'ordered', 'received'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? 'bg-[#7b68ee] text-white' : 'border border-[#c8c4d0] text-[#514b81] hover:bg-[#f8f9fa]'}`}>
            {s === '' ? '전체' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {showNew ? (
        <div className="bg-[#fafafe] border border-[#d0ccf5] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-[#514b81]">거래처</label>
              <select value={form.partner_id} onChange={e => setForm(p => ({ ...p, partner_id: e.target.value }))} className={inputCls}>
                <option value="">선택</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.partner_name}</option>)}
              </select>
            </div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">발주일<span className="text-red-500 ml-0.5">*</span></label><DateInput value={form.order_date} onChange={e => setForm(p => ({ ...p, order_date: e.target.value }))} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">입고예정일</label><DateInput value={form.expected_date} onChange={e => setForm(p => ({ ...p, expected_date: e.target.value }))} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">메모</label><input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} /></div>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-4 gap-2 items-center">
                <select value={l.item_id} onChange={e => setLine(i, 'item_id', e.target.value)} className={inputCls}>
                  <option value="">품목 선택</option>
                  {items.map(it => <option key={it.id} value={it.id}>{it.item_code} {it.item_name}</option>)}
                </select>
                <input type="number" value={l.quantity} onChange={e => setLine(i, 'quantity', e.target.value)} placeholder="수량" className={inputCls} />
                <input type="number" value={l.unit_price} onChange={e => setLine(i, 'unit_price', e.target.value)} placeholder="단가" className={inputCls} />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#514b81]">{((parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0)).toLocaleString()}원</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} className="size-7 rounded hover:bg-red-50 flex items-center justify-center text-[#b0acd6] hover:text-red-500"><Trash2 className="size-3.5" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <button onClick={addLine} className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1"><Plus className="size-3.5" />품목 추가</button>
            <span className="text-xs font-medium text-[#090c1d] ml-auto">합계: {total.toLocaleString()}원</span>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setError('') }} className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center gap-1"><X className="size-3" />취소</button>
            <button onClick={handleCreate} disabled={isPending} className="h-8 px-4 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50 flex items-center gap-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}발주 등록
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowNew(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-[#d0ccf5] text-sm text-[#b0acd6] hover:border-[#7b68ee] hover:text-[#7b68ee] transition-colors flex items-center justify-center gap-1.5">
          <Plus className="size-4" />발주 등록
        </button>
      )}

      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#514b81] bg-white rounded-xl border border-[#c8c4d0]">발주 내역이 없습니다</div>
        ) : rows.map(po => (
          <div key={po.id} className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-4">
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${STATUS_COLORS[po.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[po.status]}</span>
              <span className="text-sm font-medium text-[#090c1d]">{po.order_date}</span>
              <span className="text-xs text-[#514b81]">{po.partner?.partner_name ?? '거래처없음'}</span>
              <span className="text-xs text-[#b0acd6]">{po.purchase_order_lines.length}개 품목</span>
              <span className="text-sm font-semibold text-[#090c1d] ml-auto">{po.total_amount.toLocaleString()}원</span>
              <select value={po.status} onChange={e => handleStatusChange(po.id, e.target.value)} disabled={isPending}
                className="h-7 rounded border border-[#c8c4d0] px-1 text-xs text-[#514b81] outline-none">
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button onClick={() => setExpanded(p => p === po.id ? null : po.id)} className="text-[#b0acd6] hover:text-[#7b68ee] transition-colors">
                {expanded === po.id ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            </div>
            {expanded === po.id && (
              <div className="border-t border-[#c8c4d0] px-5 py-3">
                <table className="w-full text-xs">
                  <thead><tr className="text-[#514b81]">{['품목코드', '품목명', '수량', '단가', '소계'].map(h => <th key={h} className="py-1 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {po.purchase_order_lines.map(l => (
                      <tr key={l.id} className="border-t border-[#c8c4d0]">
                        <td className="py-1.5 text-[#7b68ee] font-mono">{l.item?.item_code}</td>
                        <td className="py-1.5 text-[#090c1d]">{l.item?.item_name}</td>
                        <td className="py-1.5 text-right text-[#514b81]">{l.quantity} {l.item?.unit ?? ''}</td>
                        <td className="py-1.5 text-right text-[#514b81]">{l.unit_price.toLocaleString()}</td>
                        <td className="py-1.5 text-right font-medium text-[#090c1d]">{l.subtotal.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {po.notes && <p className="text-xs text-[#b0acd6] mt-2">{po.notes}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
