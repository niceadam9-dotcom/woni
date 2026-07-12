'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, Check, X, Hash } from 'lucide-react'
import { createItemAction, updateItemAction, generateItemCodeAction } from '@/app/(dashboard)/items/actions'

const inputCls = 'w-full h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition'

type Item = {
  id: string; item_code: string; item_name: string; unit: string | null
  standard_price: number | null; current_stock: number; is_active: boolean
  description: string | null; category: { name: string } | null
}
type Category = { id: string; name: string }

const EMPTY = { item_code: '', item_name: '', category_id: '', unit: '', standard_price: '', description: '' }

export function ItemsClient({ items, categories }: { items: Record<string, unknown>[]; categories: Category[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [editForm, setEditForm] = useState(EMPTY)
  const [error, setError] = useState('')

  const rows = items as Item[]
  const [isGenerating, setIsGenerating] = useState(false)
  const set = (k: keyof typeof EMPTY, target: 'form' | 'edit') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      target === 'form' ? setForm(p => ({ ...p, [k]: e.target.value })) : setEditForm(p => ({ ...p, [k]: e.target.value }))

  async function handleGenerateItemCode() {
    const prefix = form.item_code.replace(/[-_]?\d+$/, '').trim() || 'ITEM'
    setIsGenerating(true)
    const result = await generateItemCodeAction(prefix)
    setIsGenerating(false)
    if (result.code) setForm(p => ({ ...p, item_code: result.code! }))
  }

  function handleCreate() {
    if (!form.item_code.trim() || !form.item_name.trim()) { setError('품목코드와 품목명을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await createItemAction({
        item_code: form.item_code.trim(), item_name: form.item_name.trim(),
        category_id: form.category_id || undefined, unit: form.unit || undefined,
        standard_price: form.standard_price ? parseFloat(form.standard_price) : undefined,
        description: form.description || undefined,
      })
      if (result.error) { setError(result.error); return }
      setShowNew(false); setForm(EMPTY); setError('')
      router.refresh()
    })
  }

  function startEdit(item: Item) {
    setEditId(item.id)
    setEditForm({
      item_code: item.item_code, item_name: item.item_name,
      category_id: '', unit: item.unit ?? '', standard_price: item.standard_price?.toString() ?? '',
      description: item.description ?? '',
    })
  }

  function handleUpdate(id: string) {
    startTransition(async () => {
      await updateItemAction(id, {
        item_name: editForm.item_name.trim(), unit: editForm.unit || undefined,
        standard_price: editForm.standard_price ? parseFloat(editForm.standard_price) : undefined,
        description: editForm.description || undefined,
      })
      setEditId(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {showNew ? (
        <div className="bg-[#fafafe] border border-[#d0ccf5] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-[#514b81]">품목코드<span className="text-red-500 ml-0.5">*</span></label>
              <div className="flex gap-1">
                <input value={form.item_code} onChange={e => setForm(p => ({ ...p, item_code: e.target.value.toUpperCase() }))} className={`${inputCls} flex-1`} placeholder="접두어 후 자동생성" />
                <button type="button" onClick={handleGenerateItemCode} disabled={isGenerating} title="다음 품목코드 자동 생성" className="h-9 px-2 rounded-lg bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] border border-[#d0ccf5] flex items-center gap-1 text-xs font-medium disabled:opacity-50 whitespace-nowrap">
                  {isGenerating ? <Loader2 className="size-3 animate-spin" /> : <Hash className="size-3" />}자동
                </button>
              </div>
            </div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">품목명<span className="text-red-500 ml-0.5">*</span></label><input value={form.item_name} onChange={set('item_name', 'form')} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">분류</label>
              <select value={form.category_id} onChange={set('category_id', 'form')} className={inputCls}>
                <option value="">선택</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">단위</label><input value={form.unit} onChange={set('unit', 'form')} placeholder="개, EA, m 등" className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className="text-xs text-[#514b81]">기준단가 (원)</label><input type="number" value={form.standard_price} onChange={set('standard_price', 'form')} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">설명</label><input value={form.description} onChange={set('description', 'form')} className={inputCls} /></div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setError('') }} className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center gap-1"><X className="size-3" />취소</button>
            <button onClick={handleCreate} disabled={isPending} className="h-8 px-4 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50 flex items-center gap-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}등록
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowNew(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-[#d0ccf5] text-sm text-[#b0acd6] hover:border-[#7b68ee] hover:text-[#7b68ee] transition-colors flex items-center justify-center gap-1.5">
          <Plus className="size-4" />품목 추가
        </button>
      )}

      <div className="bg-white rounded-xl border border-[#c8c4d0] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-[#c8c4d0]">
            <tr>{['품목코드', '품목명', '분류', '단위', '기준단가', '현재고', ''].map(h => (
              <th key={h} className="py-2.5 px-4 text-left font-medium text-[#514b81] text-xs">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-sm text-[#514b81]">등록된 품목이 없습니다</td></tr>
            ) : rows.map((item, i) => (
              editId === item.id ? (
                <tr key={item.id} className="border-t border-[#c8c4d0] bg-[#fafafe]">
                  <td className="px-4 py-2"><span className="text-xs text-[#514b81]">{item.item_code}</span></td>
                  <td className="px-4 py-2"><input value={editForm.item_name} onChange={set('item_name', 'edit')} className={inputCls} /></td>
                  <td className="px-4 py-2"><span className="text-xs text-[#514b81]">{item.category?.name ?? '-'}</span></td>
                  <td className="px-4 py-2"><input value={editForm.unit} onChange={set('unit', 'edit')} placeholder="단위" className={inputCls} /></td>
                  <td className="px-4 py-2"><input type="number" value={editForm.standard_price} onChange={set('standard_price', 'edit')} className={inputCls} /></td>
                  <td className="px-4 py-2 text-xs text-[#514b81]">{item.current_stock}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <button onClick={() => setEditId(null)} className="h-7 px-2 rounded border border-[#c8c4d0] text-[#514b81] hover:bg-[#f8f9fa] transition-colors"><X className="size-3" /></button>
                      <button onClick={() => handleUpdate(item.id)} disabled={isPending} className="h-7 px-2 rounded bg-[#7b68ee] text-white hover:bg-[#6a57dd] transition-colors"><Check className="size-3" /></button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className={`${i > 0 ? 'border-t border-[#c8c4d0]' : ''} hover:bg-[#f8f9fa]`}>
                  <td className="px-4 py-3 font-mono text-xs text-[#7b68ee]">{item.item_code}</td>
                  <td className="px-4 py-3 font-medium text-[#090c1d]">{item.item_name}</td>
                  <td className="px-4 py-3 text-xs text-[#514b81]">{item.category?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-[#514b81]">{item.unit ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-right text-[#090c1d]">{item.standard_price != null ? item.standard_price.toLocaleString() : '-'}</td>
                  <td className="px-4 py-3 text-xs text-right font-medium">{item.current_stock}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => startEdit(item)} className="size-7 rounded-lg hover:bg-[#f5f4ff] flex items-center justify-center text-[#b0acd6] hover:text-[#7b68ee] transition-colors">
                      <Pencil className="size-3.5" />
                    </button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
