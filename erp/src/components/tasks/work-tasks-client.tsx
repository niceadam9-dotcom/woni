'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Check } from 'lucide-react'
import { createWorkTaskAction, updateWorkTaskStatusAction, type WorkTaskPriority } from '@/app/(dashboard)/tasks/actions'
import { DateInput } from '@/components/ui/date-input'

const inputCls = 'w-full h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'

const STATUS_LABELS: Record<string, string> = { pending: '대기', in_progress: '진행중', completed: '완료', cancelled: '취소' }
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700', in_progress: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700', cancelled: 'bg-gray-100 text-gray-500',
}
const PRIORITY_LABELS: Record<string, string> = { high: '높음', medium: '보통', low: '낮음' }
const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-50 text-red-600', medium: 'bg-brand-tint text-brand', low: 'bg-gray-100 text-gray-600',
}

type Task = {
  id: string; title: string; description: string | null; status: string; priority: string
  due_date: string | null; assignee: { name: string } | null; creator: { name: string } | null; created_at: string
}
type Employee = { id: string; name: string }

export function WorkTasksClient({
  tasks, employees, currentUserId, canCreate,
}: {
  tasks: Record<string, unknown>[]; employees: Employee[]; currentUserId: string; canCreate: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [newForm, setNewForm] = useState({
    title: '', description: '', assignee_id: '', due_date: '', priority: 'medium' as WorkTaskPriority,
  })

  const rows = (tasks as Task[]).filter(t => !statusFilter || t.status === statusFilter)

  function handleCreate() {
    setError('')
    if (!newForm.title.trim()) { setError('제목을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await createWorkTaskAction({
        title: newForm.title.trim(), description: newForm.description.trim() || undefined,
        assignee_id: newForm.assignee_id || undefined, due_date: newForm.due_date || undefined,
        priority: newForm.priority,
      })
      if (result.error) { setError(result.error); return }
      setShowNew(false)
      setNewForm({ title: '', description: '', assignee_id: '', due_date: '', priority: 'medium' })
      router.refresh()
    })
  }

  function handleStatusChange(id: string, status: string) {
    startTransition(async () => {
      await updateWorkTaskStatusAction(id, status as 'pending' | 'in_progress' | 'completed' | 'cancelled')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {['', 'pending', 'in_progress', 'completed'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? 'bg-brand text-white' : 'border border-line text-ink-sub hover:bg-paper'}`}>
            {s === '' ? '전체' : STATUS_LABELS[s]}
          </button>
        ))}
        <span className="text-xs text-ink-sub ml-auto">총 {rows.length}건</span>
      </div>

      {/* 신규 등록 */}
      {showNew && (
        <div className="bg-paper border border-brand-line rounded-xl p-4 space-y-3">
          <input value={newForm.title} onChange={e => setNewForm(p => ({ ...p, title: e.target.value }))}
            placeholder="업무 제목 *" className={inputCls} />
          <textarea value={newForm.description} onChange={e => setNewForm(p => ({ ...p, description: e.target.value }))}
            placeholder="업무 내용" rows={2}
            className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand transition resize-none" />
          <div className="grid grid-cols-3 gap-3">
            <select value={newForm.priority} onChange={e => setNewForm(p => ({ ...p, priority: e.target.value as WorkTaskPriority }))} className={inputCls}>
              <option value="high">높음</option>
              <option value="medium">보통</option>
              <option value="low">낮음</option>
            </select>
            <select value={newForm.assignee_id} onChange={e => setNewForm(p => ({ ...p, assignee_id: e.target.value }))} className={inputCls}>
              <option value="">담당자 선택</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <DateInput value={newForm.due_date} onChange={e => setNewForm(p => ({ ...p, due_date: e.target.value }))} className={inputCls} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setError('') }}
              className="h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors">취소</button>
            <button onClick={handleCreate} disabled={isPending}
              className="h-8 px-4 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition-colors disabled:opacity-50 flex items-center gap-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}등록
            </button>
          </div>
        </div>
      )}

      {!showNew && canCreate && (
        <button onClick={() => setShowNew(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-brand-line text-sm text-ink-faint hover:border-brand hover:text-brand transition-colors flex items-center justify-center gap-1.5">
          <Plus className="size-4" />업무 추가
        </button>
      )}

      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-sub bg-surface rounded-xl border border-line">업무가 없습니다</div>
        ) : rows.map(t => (
          <div key={t.id} className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${PRIORITY_COLORS[t.priority]}`}>{PRIORITY_LABELS[t.priority]}</span>
                  <span className="font-medium text-ink">{t.title}</span>
                </div>
                {t.description && <p className="text-xs text-ink-sub mt-1">{t.description}</p>}
                <div className="flex items-center gap-3 mt-2 text-xs text-ink-faint">
                  {t.assignee && <span>담당: {t.assignee.name}</span>}
                  {t.due_date && <span>마감: {t.due_date}</span>}
                  <span>등록: {t.created_at.slice(0, 10)}</span>
                </div>
              </div>
              <select value={t.status} onChange={e => handleStatusChange(t.id, e.target.value)} disabled={isPending}
                className={`h-8 rounded-lg border px-2 text-xs font-medium transition-colors outline-none ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'} border-transparent`}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
