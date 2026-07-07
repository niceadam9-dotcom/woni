'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import { createWorkJournalAction } from '@/app/(dashboard)/tasks/actions'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

type Journal = {
  id: string; work_date: string; title: string; content: string
  work_hours: number | null; author: { name: string } | null; created_at: string
}

export function WorkJournalClient({
  journals, currentUserId,
}: {
  journals: Record<string, unknown>[]; currentUserId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [newForm, setNewForm] = useState({
    work_date: new Date().toISOString().slice(0, 10),
    title: '', content: '', work_hours: '',
  })

  const rows = journals as Journal[]

  function handleCreate() {
    setError('')
    if (!newForm.title.trim()) { setError('제목을 입력해주세요.'); return }
    if (!newForm.content.trim()) { setError('내용을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await createWorkJournalAction({
        work_date: newForm.work_date,
        title: newForm.title.trim(),
        content: newForm.content.trim(),
        work_hours: newForm.work_hours ? parseFloat(newForm.work_hours) : undefined,
      })
      if (result.error) { setError(result.error); return }
      setShowNew(false)
      setNewForm({ work_date: new Date().toISOString().slice(0, 10), title: '', content: '', work_hours: '' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* 신규 작성 */}
      {showNew ? (
        <div className="bg-[#fafafe] border border-[#d0ccf5] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input type="date" value={newForm.work_date} onChange={e => setNewForm(p => ({ ...p, work_date: e.target.value }))} className={inputCls} />
            <div className="col-span-2">
              <input value={newForm.title} onChange={e => setNewForm(p => ({ ...p, title: e.target.value }))}
                placeholder="제목 *" className={inputCls} />
            </div>
          </div>
          <textarea value={newForm.content} onChange={e => setNewForm(p => ({ ...p, content: e.target.value }))}
            placeholder="업무 내용 *" rows={5}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition resize-none" />
          <div className="flex items-center gap-3">
            <input type="number" value={newForm.work_hours} onChange={e => setNewForm(p => ({ ...p, work_hours: e.target.value }))}
              placeholder="업무 시간 (h)" step={0.5} min={0} max={24}
              className="h-10 w-36 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition" />
            <span className="text-xs text-[#514b81]">시간</span>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setError('') }}
              className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center gap-1">
              <X className="size-3" />취소
            </button>
            <button onClick={handleCreate} disabled={isPending}
              className="h-8 px-4 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50 flex items-center gap-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}저장
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowNew(true)}
          className="w-full h-10 rounded-xl border-2 border-dashed border-[#d0ccf5] text-sm text-[#b0acd6] hover:border-[#7b68ee] hover:text-[#7b68ee] transition-colors flex items-center justify-center gap-1.5">
          <Plus className="size-4" />업무일지 작성
        </button>
      )}

      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#514b81] bg-white rounded-xl border border-[#c8c4d0]">작성된 업무일지가 없습니다</div>
        ) : rows.map(j => (
          <div key={j.id} className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
            <button onClick={() => setExpanded(prev => prev === j.id ? null : j.id)}
              className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-[#f8f9fa] transition-colors text-left">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[#7b68ee] w-24 shrink-0">{j.work_date}</span>
                <span className="font-medium text-[#090c1d]">{j.title}</span>
                {j.work_hours && (
                  <span className="text-xs text-[#b0acd6]">{j.work_hours}h</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-[#514b81]">{j.author?.name ?? '-'}</span>
                {expanded === j.id ? <ChevronUp className="size-4 text-[#b0acd6]" /> : <ChevronDown className="size-4 text-[#b0acd6]" />}
              </div>
            </button>
            {expanded === j.id && (
              <div className="px-5 pb-4 border-t border-[#c8c4d0]">
                <p className="text-sm text-[#090c1d] whitespace-pre-wrap mt-3 leading-relaxed">{j.content}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
