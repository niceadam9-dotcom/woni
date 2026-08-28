'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Check, X, Loader2 } from 'lucide-react'
import { createCategoryAction, updateCategoryAction } from '@/app/(dashboard)/board/actions'

const inputCls = 'w-full h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'

type Category = { id: string; name: string; description: string | null; is_notice_board: boolean; is_active: boolean }

export function CategoryManagerClient({ categories }: { categories: Category[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const [newForm, setNewForm] = useState({ name: '', description: '', is_notice_board: false })
  const [editForm, setEditForm] = useState<{ name: string; description: string; is_notice_board: boolean; is_active: boolean } | null>(null)

  function startEdit(cat: Category) {
    setEditingId(cat.id)
    setEditForm({ name: cat.name, description: cat.description ?? '', is_notice_board: cat.is_notice_board, is_active: cat.is_active })
  }

  function handleCreate() {
    setError('')
    if (!newForm.name.trim()) { setError('카테고리명을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await createCategoryAction({
        name: newForm.name.trim(),
        description: newForm.description.trim() || undefined,
        is_notice_board: newForm.is_notice_board,
      })
      if (result.error) { setError(result.error); return }
      setShowNew(false)
      setNewForm({ name: '', description: '', is_notice_board: false })
      router.refresh()
    })
  }

  function handleUpdate(id: string) {
    if (!editForm) return
    setError('')
    if (!editForm.name.trim()) { setError('카테고리명을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await updateCategoryAction({
        id, name: editForm.name.trim(),
        description: editForm.description.trim() || undefined,
        is_notice_board: editForm.is_notice_board,
        is_active: editForm.is_active,
      })
      if (result.error) { setError(result.error); return }
      setEditingId(null)
      setEditForm(null)
      router.refresh()
    })
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <span className="text-sm font-semibold text-ink">카테고리 목록</span>
          <button onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-xs font-medium transition-colors">
            <Plus className="size-3" />추가
          </button>
        </div>

        {/* 신규 등록 폼 */}
        {showNew && (
          <div className="px-5 py-4 border-b border-brand-line bg-paper space-y-3">
            <input value={newForm.name} onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))}
              placeholder="카테고리명 *" className={inputCls} />
            <input value={newForm.description} onChange={e => setNewForm(p => ({ ...p, description: e.target.value }))}
              placeholder="설명 (선택)" className={inputCls} />
            <label className="flex items-center gap-2 text-sm text-ink-sub cursor-pointer">
              <input type="checkbox" checked={newForm.is_notice_board} onChange={e => setNewForm(p => ({ ...p, is_notice_board: e.target.checked }))}
                className="size-4 rounded accent-brand" />
              공지사항 게시판
            </label>
            <div className="flex gap-2">
              <button onClick={() => { setShowNew(false); setError('') }}
                className="h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors">취소</button>
              <button onClick={handleCreate} disabled={isPending}
                className="h-8 px-4 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition-colors disabled:opacity-50 flex items-center gap-1">
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}저장
              </button>
            </div>
          </div>
        )}

        {categories.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-sub">등록된 카테고리가 없습니다</div>
        ) : (
          <div className="divide-y divide-line">
            {categories.map(cat => (
              <div key={cat.id} className="px-5 py-4">
                {editingId === cat.id && editForm ? (
                  <div className="space-y-2">
                    <input value={editForm.name} onChange={e => setEditForm(p => p ? { ...p, name: e.target.value } : null)}
                      className={inputCls} />
                    <input value={editForm.description} onChange={e => setEditForm(p => p ? { ...p, description: e.target.value } : null)}
                      placeholder="설명" className={inputCls} />
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-xs text-ink-sub cursor-pointer">
                        <input type="checkbox" checked={editForm.is_notice_board}
                          onChange={e => setEditForm(p => p ? { ...p, is_notice_board: e.target.checked } : null)}
                          className="size-4 rounded accent-brand" />
                        공지사항 게시판
                      </label>
                      <label className="flex items-center gap-2 text-xs text-ink-sub cursor-pointer">
                        <input type="checkbox" checked={editForm.is_active}
                          onChange={e => setEditForm(p => p ? { ...p, is_active: e.target.checked } : null)}
                          className="size-4 rounded accent-brand" />
                        활성
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingId(null); setEditForm(null) }}
                        className="h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors">
                        <X className="size-3" />
                      </button>
                      <button onClick={() => handleUpdate(cat.id)} disabled={isPending}
                        className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition-colors disabled:opacity-50">
                        {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink">{cat.name}</span>
                        {cat.is_notice_board && <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-500">공지</span>}
                        {!cat.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">비활성</span>}
                      </div>
                      {cat.description && <p className="text-xs text-ink-faint mt-0.5">{cat.description}</p>}
                    </div>
                    <button onClick={() => startEdit(cat)}
                      className="h-7 px-2 rounded border border-line text-xs text-ink-sub hover:bg-paper transition-colors">
                      <Pencil className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>}
    </div>
  )
}
