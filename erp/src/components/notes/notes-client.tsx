'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, Check, X } from 'lucide-react'
import { createNoteAction, updateNoteAction, deleteNoteAction } from '@/app/(dashboard)/my/notes/actions'

const NOTE_COLORS = [
  { value: 'white', bg: 'bg-surface', border: 'border-line' },
  { value: 'yellow', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  { value: 'blue', bg: 'bg-blue-50', border: 'border-blue-200' },
  { value: 'green', bg: 'bg-green-50', border: 'border-green-200' },
  { value: 'purple', bg: 'bg-purple-50', border: 'border-purple-200' },
  { value: 'pink', bg: 'bg-pink-50', border: 'border-pink-200' },
]

const BG: Record<string, string> = { white: 'bg-surface', yellow: 'bg-yellow-50', blue: 'bg-blue-50', green: 'bg-green-50', purple: 'bg-purple-50', pink: 'bg-pink-50' }
const BORDER: Record<string, string> = { white: 'border-line', yellow: 'border-yellow-200', blue: 'border-blue-200', green: 'border-green-200', purple: 'border-purple-200', pink: 'border-pink-200' }

type Note = { id: string; title: string; content: string; color: string; created_at: string; updated_at: string }

export function NotesClient({ notes }: { notes: Record<string, unknown>[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [newForm, setNewForm] = useState({ title: '', content: '', color: 'white' })
  const [editForm, setEditForm] = useState({ title: '', content: '', color: 'white' })

  const rows = notes as Note[]

  function startEdit(n: Note) {
    setEditId(n.id)
    setEditForm({ title: n.title, content: n.content, color: n.color })
  }

  function handleCreate() {
    setError('')
    if (!newForm.title.trim()) { setError('제목을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await createNoteAction({ title: newForm.title.trim(), content: newForm.content, color: newForm.color })
      if (result.error) { setError(result.error); return }
      setShowNew(false); setNewForm({ title: '', content: '', color: 'white' })
      router.refresh()
    })
  }

  function handleUpdate(id: string) {
    startTransition(async () => {
      await updateNoteAction(id, { title: editForm.title.trim(), content: editForm.content, color: editForm.color })
      setEditId(null)
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    if (!confirm('노트를 삭제하시겠습니까?')) return
    startTransition(async () => {
      await deleteNoteAction(id)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {!showNew && (
        <button onClick={() => setShowNew(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-brand-line text-sm text-ink-faint hover:border-brand hover:text-brand transition-colors flex items-center justify-center gap-1.5">
          <Plus className="size-4" />새 노트 작성
        </button>
      )}

      {showNew && (
        <div className="bg-paper border border-brand-line rounded-xl p-4 space-y-3">
          <input value={newForm.title} onChange={e => setNewForm(p => ({ ...p, title: e.target.value }))}
            placeholder="제목 *" className="w-full h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand transition" />
          <textarea value={newForm.content} onChange={e => setNewForm(p => ({ ...p, content: e.target.value }))}
            placeholder="내용을 입력하세요..." rows={5}
            className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand transition resize-none" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-sub">색상:</span>
            {NOTE_COLORS.map(c => (
              <button key={c.value} onClick={() => setNewForm(p => ({ ...p, color: c.value }))}
                className={`size-5 rounded-full ${c.bg} border-2 ${newForm.color === c.value ? 'border-brand' : 'border-line'} transition-colors`} />
            ))}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setError('') }}
              className="h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors flex items-center gap-1"><X className="size-3" />취소</button>
            <button onClick={handleCreate} disabled={isPending}
              className="h-8 px-4 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition-colors disabled:opacity-50 flex items-center gap-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}저장</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.length === 0 ? (
          <div className="col-span-full py-12 text-center text-sm text-ink-sub bg-surface rounded-xl border border-line">작성된 노트가 없습니다</div>
        ) : rows.map(n => (
          editId === n.id ? (
            <div key={n.id} className={`rounded-xl border-2 border-brand p-4 space-y-3 ${BG[n.color] ?? 'bg-surface'}`}>
              <input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                className="w-full h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm outline-none focus:border-brand transition" />
              <textarea value={editForm.content} onChange={e => setEditForm(p => ({ ...p, content: e.target.value }))} rows={4}
                className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand transition resize-none" />
              <div className="flex items-center gap-2">
                {NOTE_COLORS.map(c => (
                  <button key={c.value} onClick={() => setEditForm(p => ({ ...p, color: c.value }))}
                    className={`size-5 rounded-full ${c.bg} border-2 ${editForm.color === c.value ? 'border-brand' : 'border-line'} transition-colors`} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditId(null)} className="h-7 px-2 rounded text-xs text-ink-sub border border-line hover:bg-surface transition-colors"><X className="size-3" /></button>
                <button onClick={() => handleUpdate(n.id)} disabled={isPending} className="h-7 px-3 rounded bg-brand text-white text-xs hover:bg-brand-strong transition-colors disabled:opacity-50">저장</button>
              </div>
            </div>
          ) : (
            <div key={n.id} onClick={() => startEdit(n)}
              className={`${BG[n.color] ?? 'bg-surface'} rounded-xl border ${BORDER[n.color] ?? 'border-line'} p-4 cursor-pointer hover:shadow-md transition-shadow group relative`}>
              <button onClick={e => { e.stopPropagation(); handleDelete(n.id) }} disabled={isPending}
                className="absolute top-3 right-3 size-6 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-100 flex items-center justify-center text-red-400 transition-all">
                <Trash2 className="size-3" />
              </button>
              <h3 className="font-semibold text-ink text-sm pr-6">{n.title}</h3>
              {n.content && <p className="text-xs text-ink-sub mt-1.5 whitespace-pre-wrap line-clamp-6">{n.content}</p>}
              <p className="text-xs text-ink-faint mt-3">{n.updated_at.slice(0, 10)}</p>
            </div>
          )
        ))}
      </div>
    </div>
  )
}
