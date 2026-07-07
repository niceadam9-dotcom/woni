'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Check, X } from 'lucide-react'
import { createStockMovementAction, type StockMovementType } from '@/app/(dashboard)/stock/actions'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

type Item = { id: string; item_code: string; item_name: string; unit: string | null; current_stock: number; standard_price: number | null }
type Movement = {
  id: string; movement_type: string; quantity: number; unit_price: number | null
  before_stock: number; after_stock: number; notes: string | null; created_at: string
  item: { item_code: string; item_name: string; unit: string | null } | null
  creator: { name: string } | null
}

const TYPE_LABELS: Record<string, string> = { in: '입고', out: '출고', adjust: '조정' }
const TYPE_COLORS: Record<string, string> = { in: 'bg-green-50 text-green-600', out: 'bg-red-50 text-red-500', adjust: 'bg-yellow-50 text-yellow-700' }

export function StockMovementClient({
  movements, items, movementType,
}: {
  movements: Record<string, unknown>[]
  items: Item[]
  movementType: StockMovementType
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ item_id: '', quantity: '', unit_price: '', notes: '' })

  const rows = movements as Movement[]
  const selectedItem = items.find(i => i.id === form.item_id)

  function handleSubmit() {
    setError('')
    if (!form.item_id) { setError('품목을 선택해주세요.'); return }
    if (!form.quantity || parseFloat(form.quantity) <= 0) { setError('수량을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await createStockMovementAction({
        item_id: form.item_id,
        movement_type: movementType,
        quantity: parseFloat(form.quantity),
        unit_price: form.unit_price ? parseFloat(form.unit_price) : undefined,
        notes: form.notes || undefined,
      })
      if (result.error) { setError(result.error); return }
      setShowNew(false)
      setForm({ item_id: '', quantity: '', unit_price: '', notes: '' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {showNew ? (
        <div className="bg-[#fafafe] border border-[#d0ccf5] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1 col-span-2">
              <label className="text-xs text-[#514b81]">품목 *</label>
              <select value={form.item_id} onChange={e => {
                const item = items.find(i => i.id === e.target.value)
                setForm(p => ({ ...p, item_id: e.target.value, unit_price: item?.standard_price?.toString() ?? '' }))
              }} className={inputCls}>
                <option value="">품목 선택</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.item_code} {i.item_name} (재고: {i.current_stock})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[#514b81]">수량 * {selectedItem?.unit ? `(${selectedItem.unit})` : ''}</label>
              <input type="number" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[#514b81]">단가 (원)</label>
              <input type="number" value={form.unit_price} onChange={e => setForm(p => ({ ...p, unit_price: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="메모" className={inputCls} />
          {movementType === 'adjust' && selectedItem && (
            <p className="text-xs text-[#514b81]">현재 재고: <strong>{selectedItem.current_stock}</strong> → 조정 후: <strong>{parseFloat(form.quantity) || 0}</strong></p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setError('') }} className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center gap-1"><X className="size-3" />취소</button>
            <button onClick={handleSubmit} disabled={isPending} className="h-8 px-4 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50 flex items-center gap-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}{TYPE_LABELS[movementType]} 등록
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowNew(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-[#d0ccf5] text-sm text-[#b0acd6] hover:border-[#7b68ee] hover:text-[#7b68ee] transition-colors flex items-center justify-center gap-1.5">
          <Plus className="size-4" />{TYPE_LABELS[movementType]} 등록
        </button>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#c8c4d0]">
              {['일시', '품목코드', '품목명', '구분', '수량', '단가', '이전재고', '이후재고', '담당자', '메모'].map(h => (
                <th key={h} className="py-2.5 px-3 text-left font-medium text-[#514b81]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="py-12 text-center text-[#514b81]">{TYPE_LABELS[movementType]} 내역이 없습니다</td></tr>
            ) : rows.map(m => (
              <tr key={m.id} className="border-b border-[#c8c4d0] hover:bg-[#f8f9fa]">
                <td className="py-3 px-3 text-[#514b81]">{m.created_at.slice(0, 16)}</td>
                <td className="py-3 px-3 font-mono text-[#7b68ee]">{m.item?.item_code}</td>
                <td className="py-3 px-3 font-medium text-[#090c1d]">{m.item?.item_name}</td>
                <td className="py-3 px-3"><span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_COLORS[m.movement_type] ?? ''}`}>{TYPE_LABELS[m.movement_type]}</span></td>
                <td className="py-3 px-3 text-right text-[#090c1d]">{m.quantity} {m.item?.unit ?? ''}</td>
                <td className="py-3 px-3 text-right text-[#514b81]">{m.unit_price != null ? m.unit_price.toLocaleString() : '-'}</td>
                <td className="py-3 px-3 text-right text-[#514b81]">{m.before_stock}</td>
                <td className="py-3 px-3 text-right font-medium text-[#090c1d]">{m.after_stock}</td>
                <td className="py-3 px-3 text-[#514b81]">{m.creator?.name ?? '-'}</td>
                <td className="py-3 px-3 text-[#b0acd6]">{m.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
