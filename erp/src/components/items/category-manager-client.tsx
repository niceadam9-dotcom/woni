'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { createCategoryAction, updateCategoryAction, deleteCategoryAction } from '@/app/(dashboard)/item-categories/actions'

const inputCls = 'h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition'

type Category = { id: string; name: string; description: string | null }

export function CategoryManagerClient({ categories }: { categories: Record<string, unknown>[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [editForm, setEditForm] = useState({ name: '', description: '' })
  const [error, setError] = useState('')

  const rows = categories as Category[]

  function handleCreate() {
    if (!form.name.trim()) { setError('분류명을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await createCategoryAction({ name: form.name.trim(), description: form.description || undefined })
      if (result.error) { setError(result.error); return }
      setShowNew(false); setForm({ name: '', description: '' }); setError('')
      router.refresh()
    })
  }

  function handleUpdate(id: string) {
    startTransition(async () => {
      await updateCategoryAction(id, { name: editForm.name.trim(), description: editForm.description || undefined })
      setEditId(null)
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    if (!confirm('분류를 삭제하시겠습니까?')) return
    startTransition(async () => {
      await deleteCategoryAction(id)
      router.refresh()
    })
  }

  return (
    <div className="max-w-xl space-y-3">
      {showNew ? (
        <div className="bg-paper border border-brand-line rounded-xl p-3 flex items-center gap-2">
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="분류명 *" className={`${inputCls} flex-1`} />
          <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="설명" className={`${inputCls} flex-1`} />
          <button onClick={() => { setShowNew(false); setError('') }} className="h-9 px-2 rounded-lg border border-line text-ink-sub hover:bg-paper transition-colors"><X className="size-4" /></button>
          <button onClick={handleCreate} disabled={isPending} className="h-9 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition-colors disabled:opacity-50">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </button>
        </div>
      ) : (
        <button onClick={() => setShowNew(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-brand-line text-sm text-ink-faint hover:border-brand hover:text-brand transition-colors flex items-center justify-center gap-1.5">
          <Plus className="size-4" />분류 추가
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-sub">등록된 분류가 없습니다</p>
        ) : rows.map((c, i) => (
          <div key={c.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}>
            {editId === c.id ? (
              <>
                <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} className={`${inputCls} flex-1`} />
                <input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} className={`${inputCls} flex-1`} placeholder="설명" />
                <button onClick={() => setEditId(null)} className="h-8 px-2 rounded border border-line text-ink-sub hover:bg-paper transition-colors"><X className="size-3.5" /></button>
                <button onClick={() => handleUpdate(c.id)} disabled={isPending} className="h-8 px-2 rounded bg-brand text-white hover:bg-brand-strong transition-colors">
                  <Check className="size-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 font-medium text-sm text-ink">{c.name}</span>
                <span className="flex-1 text-xs text-ink-sub">{c.description ?? ''}</span>
                <button onClick={() => { setEditId(c.id); setEditForm({ name: c.name, description: c.description ?? '' }) }}
                  className="size-7 rounded-lg hover:bg-paper flex items-center justify-center text-ink-faint hover:text-brand transition-colors">
                  <Pencil className="size-3.5" />
                </button>
                <button onClick={() => handleDelete(c.id)} disabled={isPending}
                  className="size-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-ink-faint hover:text-red-500 transition-colors">
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
