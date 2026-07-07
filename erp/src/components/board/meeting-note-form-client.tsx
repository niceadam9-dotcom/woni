'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, Users } from 'lucide-react'
import { createMeetingNoteAction, updateMeetingNoteAction } from '@/app/(dashboard)/board/actions'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

type Note = { id: string; title: string; content: string; meeting_date: string; participants: string | null; location: string | null }

export function MeetingNoteFormClient({ existing }: { existing?: Note }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    title: existing?.title ?? '',
    content: existing?.content ?? '',
    meeting_date: existing?.meeting_date ?? new Date().toISOString().slice(0, 10),
    participants: existing?.participants ?? '',
    location: existing?.location ?? '',
  })

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    setError('')
    if (!form.title.trim()) { setError('제목을 입력해주세요.'); return }
    if (!form.content.trim()) { setError('내용을 입력해주세요.'); return }
    if (!form.meeting_date) { setError('회의일을 선택해주세요.'); return }

    startTransition(async () => {
      if (existing) {
        const result = await updateMeetingNoteAction({
          id: existing.id, title: form.title.trim(), content: form.content.trim(),
          meeting_date: form.meeting_date, participants: form.participants.trim() || undefined,
          location: form.location.trim() || undefined,
        })
        if (result.error) { setError(result.error); return }
        router.push(`/board/meeting-notes/${existing.id}`)
        router.refresh()
      } else {
        const result = await createMeetingNoteAction({
          title: form.title.trim(), content: form.content.trim(),
          meeting_date: form.meeting_date, participants: form.participants.trim() || undefined,
          location: form.location.trim() || undefined,
        })
        if (result.error) { setError(result.error); return }
        router.push(`/board/meeting-notes/${result.noteId}`)
        router.refresh()
      }
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-[#514b81]">제목 <span className="text-red-500">*</span></label>
            <input value={form.title} onChange={e => setField('title', e.target.value)} placeholder="회의 제목" className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#514b81]">회의일 <span className="text-red-500">*</span></label>
            <input type="date" value={form.meeting_date} onChange={e => setField('meeting_date', e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#514b81]">장소</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.location} onChange={e => setField('location', e.target.value)}
                placeholder="회의 장소" className={`${inputCls} pl-8`} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#514b81]">참석자</label>
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.participants} onChange={e => setField('participants', e.target.value)}
                placeholder="홍길동, 김철수, ..." className={`${inputCls} pl-8`} />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#514b81]">내용 <span className="text-red-500">*</span></label>
          <textarea value={form.content} onChange={e => setField('content', e.target.value)}
            placeholder="회의 내용·결정사항을 기록하세요" rows={12}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none" />
        </div>
      </section>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

      <div className="flex gap-3 pb-8">
        <button type="button" onClick={() => router.back()}
          className="flex-1 h-11 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors">취소</button>
        <button type="button" onClick={handleSubmit} disabled={isPending}
          className="flex-1 h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : (existing ? '수정' : '등록')}
        </button>
      </div>
    </div>
  )
}
