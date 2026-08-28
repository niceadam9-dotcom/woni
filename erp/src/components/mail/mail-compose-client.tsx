'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Paperclip, Send, X } from 'lucide-react'
import { sendMailAction } from '@/app/(dashboard)/mail/actions'
import { MessageTemplateModal } from '@/components/settings/message-template-modal'

/** 메일 작성 폼 (2026-07-23) — 공용 계정 발신 + 작성자 자동 서명. 수신자 자동완성 = 관계인·직원 이메일 */
export function MailComposeClient({ candidates, initial }: {
  candidates: Array<{ email: string; label: string }>
  initial: { to?: string; subject?: string; body?: string; replyToId?: string }
}) {
  const router = useRouter()
  const [to, setTo] = useState(initial.to ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(initial.subject ?? '')
  const [body, setBody] = useState(initial.body ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const totalSize = files.reduce((s, f) => s + f.size, 0)

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    setFiles(prev => [...prev, ...picked])
    e.target.value = ''
  }

  function send() {
    setMsg('')
    const fd = new FormData()
    fd.set('to', to)
    fd.set('cc', cc)
    fd.set('subject', subject)
    fd.set('body', body)
    if (initial.replyToId) fd.set('replyToId', initial.replyToId)
    for (const f of files) fd.append('files', f)
    startTransition(async () => {
      const res = await sendMailAction(fd)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ 발송 완료 — 보낸편지함으로 이동합니다')
      setTimeout(() => router.push('/mail?box=sent'), 800)
    })
  }

  const inputCls = 'h-9 w-full rounded-lg border border-brand-line bg-surface px-3 text-sm outline-none focus:border-brand'

  return (
    <div className="bg-surface rounded-xl border border-line p-6 space-y-3 max-w-3xl">
      <div>
        <label className="text-xs font-medium text-ink-sub block mb-1">받는 사람 <span className="text-red-500">*</span> <span className="text-ink-faint font-normal">(쉼표로 여러 명)</span></label>
        <input value={to} onChange={e => setTo(e.target.value)} list="mail-candidates" placeholder="example@domain.com" className={inputCls} />
      </div>
      <div>
        <label className="text-xs font-medium text-ink-sub block mb-1">참조 (CC)</label>
        <input value={cc} onChange={e => setCc(e.target.value)} list="mail-candidates" className={inputCls} />
      </div>
      <datalist id="mail-candidates">
        {candidates.map(c => <option key={c.email} value={c.email}>{c.label}</option>)}
      </datalist>
      <div>
        <label className="text-xs font-medium text-ink-sub block mb-1">제목 <span className="text-red-500">*</span></label>
        <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="text-xs font-medium text-ink-sub block mb-1">본문 <span className="text-red-500">*</span> <span className="text-ink-faint font-normal">(하단에 작성자 서명 자동 부착)</span></label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={12}
          className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand resize-y" />
      </div>

      {/* 첨부 */}
      <div className="space-y-1.5">
        {files.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-ink-sub">
            <Paperclip className="size-3 text-ink-faint" />
            <span className="truncate">{f.name}</span>
            <span className="text-ink-faint">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
            <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-ink-faint hover:text-red-500"><X className="size-3" /></button>
          </div>
        ))}
        <input ref={fileRef} type="file" multiple className="hidden" onChange={addFiles} />
        <button onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint">
          <Paperclip className="size-3" /> 파일 첨부 <span className="text-ink-faint">(합계 20MB, 현재 {(totalSize / 1024 / 1024).toFixed(1)}MB)</span>
        </button>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={send} disabled={isPending || !to.trim() || !subject.trim() || !body.trim()}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-brand hover:bg-brand-strong text-white text-sm font-medium disabled:opacity-50">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} 발송
        </button>
        <button onClick={() => router.push('/mail')} className="h-9 px-4 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper">취소</button>
        {/* R7-3: 서명은 발송 시 자동 부착된다 — 고치는 자리를 여기 둔다(전용 페이지 없음) */}
        <MessageTemplateModal templateKey="mail_signature" label="메일 서명"
          buttonClass="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-brand-line text-sm text-brand hover:bg-brand-tint" />
        {msg && <span className="text-sm text-ink-sub">{msg}</span>}
      </div>
      <p className="text-[11px] text-ink-faint">발신 주소는 회사 공용 계정(sjfirekorea@gmail.com)이며, 발송 이력에 작성 직원이 기록됩니다. 서명은 발송 시 자동으로 붙습니다.</p>
    </div>
  )
}
