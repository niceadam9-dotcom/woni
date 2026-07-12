'use client'

import { useState, useTransition } from 'react'
import { Plus, X, Trash2, Mail, MailOpen, Send, ChevronLeft } from 'lucide-react'
import {
  sendMessageAction,
  markReadAction,
  deleteMessageAction,
} from '@/app/(dashboard)/my/messages/actions'

type Profile = { id: string; name: string; position: string | null }
type Message = {
  id: string
  subject: string
  body: string
  is_read: boolean
  read_at: string | null
  created_at: string
  sender?: Profile | null
  recipient?: Profile | null
}

function fmt(dt: string) {
  const d = new Date(dt)
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  if (sameDay) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
}

function ComposeModal({
  employees,
  replyTo,
  onClose,
  onDone,
}: {
  employees: Profile[]
  replyTo?: Message
  onClose: () => void
  onDone: () => void
}) {
  const [recipientId, setRecipientId] = useState(replyTo?.sender?.id ?? '')
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject}` : '')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    if (!recipientId) { setErr('받는 사람을 선택하세요.'); return }
    if (!subject.trim()) { setErr('제목을 입력하세요.'); return }
    if (!body.trim()) { setErr('내용을 입력하세요.'); return }
    start(async () => {
      const res = await sendMessageAction({ recipientId, subject, body })
      if (res.error) { setErr(res.error); return }
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#090c1d]">새 쪽지</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">받는 사람<span className="text-red-500 ml-0.5">*</span></label>
            <select
              value={recipientId} onChange={e => setRecipientId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">선택하세요</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.position ? ` (${e.position})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">제목<span className="text-red-500 ml-0.5">*</span></label>
            <input
              type="text" value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="쪽지 제목"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">내용<span className="text-red-500 ml-0.5">*</span></label>
            <textarea
              value={body} onChange={e => setBody(e.target.value)} rows={6}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="내용을 입력하세요"
            />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            취소
          </button>
          <button
            onClick={submit} disabled={pending}
            className="flex-1 flex items-center justify-center gap-2 bg-[#7b68ee] text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Send size={14} />
            {pending ? '발송 중…' : '발송'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageDetail({
  message,
  tab,
  onBack,
  onReply,
  onDelete,
}: {
  message: Message
  tab: 'inbox' | 'sent'
  onBack: () => void
  onReply: () => void
  onDelete: () => void
}) {
  const person = tab === 'inbox' ? message.sender : message.recipient
  const label  = tab === 'inbox' ? '보낸 사람' : '받는 사람'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg">
          <ChevronLeft size={18} className="text-gray-500" />
        </button>
        <span className="font-semibold text-sm truncate">{message.subject}</span>
      </div>

      <div className="bg-white rounded-xl border p-5 flex-1 space-y-4">
        <div className="flex items-start justify-between gap-4 pb-3 border-b">
          <div className="space-y-1">
            <p className="text-xs text-gray-400">{label}</p>
            <p className="font-medium text-sm">
              {person?.name ?? '—'}{person?.position ? ` (${person.position})` : ''}
            </p>
          </div>
          <p className="text-xs text-gray-400 shrink-0">{new Date(message.created_at).toLocaleString('ko-KR')}</p>
        </div>

        <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed min-h-[120px]">
          {message.body}
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        {tab === 'inbox' && (
          <button
            onClick={onReply}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#7b68ee] text-white rounded-lg text-sm font-medium hover:bg-[#6a5acd]"
          >
            <Send size={13} /> 답장
          </button>
        )}
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-4 py-2 border rounded-lg text-sm text-red-500 hover:bg-red-50"
        >
          <Trash2 size={13} /> 삭제
        </button>
      </div>
    </div>
  )
}

export function MessagesClient({
  inbox,
  sent,
  employees,
  myId,
  myName,
}: {
  inbox: Record<string, unknown>[]
  sent: Record<string, unknown>[]
  employees: Record<string, unknown>[]
  myId: string
  myName: string
}) {
  const inboxList = inbox as unknown as Message[]
  const sentList  = sent  as unknown as Message[]
  const empList   = employees as unknown as Profile[]

  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox')
  const [selected, setSelected] = useState<Message | null>(null)
  const [showCompose, setShowCompose] = useState(false)
  const [replyTarget, setReplyTarget] = useState<Message | null>(null)
  const [deletePending, startDelete] = useTransition()

  const unreadCount = inboxList.filter(m => !m.is_read).length
  const currentList = tab === 'inbox' ? inboxList : sentList

  function openMessage(msg: Message) {
    setSelected(msg)
    if (tab === 'inbox' && !msg.is_read) {
      markReadAction(msg.id)
    }
  }

  function handleDelete(msg: Message) {
    if (!confirm('삭제하시겠습니까?')) return
    startDelete(async () => {
      await deleteMessageAction(msg.id, tab === 'inbox' ? 'recipient' : 'sender')
      setSelected(null)
    })
  }

  function handleReply(msg: Message) {
    setReplyTarget(msg)
    setShowCompose(true)
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[600px]">
        {/* 왼쪽: 탭 + 목록 */}
        <div className="lg:col-span-1 bg-white rounded-xl border flex flex-col overflow-hidden">
          {/* 탭 헤더 */}
          <div className="flex border-b">
            <button
              onClick={() => { setTab('inbox'); setSelected(null) }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${
                tab === 'inbox' ? 'text-[#7b68ee] border-b-2 border-[#7b68ee]' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Mail size={14} />
              받은 쪽지함
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => { setTab('sent'); setSelected(null) }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${
                tab === 'sent' ? 'text-[#7b68ee] border-b-2 border-[#7b68ee]' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Send size={14} />
              보낸 쪽지함
            </button>
          </div>

          {/* 새 쪽지 버튼 */}
          <div className="p-3 border-b">
            <button
              onClick={() => { setReplyTarget(null); setShowCompose(true) }}
              className="w-full flex items-center justify-center gap-2 bg-[#7b68ee] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#6a5acd]"
            >
              <Plus size={15} /> 새 쪽지 쓰기
            </button>
          </div>

          {/* 목록 */}
          <div className="flex-1 overflow-y-auto divide-y">
            {currentList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Mail size={32} className="mb-2 opacity-30" />
                <p className="text-sm">쪽지가 없습니다.</p>
              </div>
            ) : (
              currentList.map(msg => {
                const person = tab === 'inbox' ? msg.sender : msg.recipient
                const isSelected = selected?.id === msg.id
                const isUnread   = tab === 'inbox' && !msg.is_read

                return (
                  <button
                    key={msg.id}
                    onClick={() => openMessage(msg)}
                    className={`w-full text-left px-4 py-3 hover:bg-[#f8f8ff] transition-colors ${isSelected ? 'bg-[#f0eeff]' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {tab === 'inbox'
                          ? (isUnread
                              ? <Mail size={13} className="text-[#7b68ee] shrink-0" />
                              : <MailOpen size={13} className="text-gray-300 shrink-0" />)
                          : <Send size={13} className="text-gray-300 shrink-0" />
                        }
                        <div className="min-w-0">
                          <p className={`text-xs truncate ${isUnread ? 'font-semibold text-[#090c1d]' : 'text-gray-500'}`}>
                            {person?.name ?? '—'}
                          </p>
                          <p className={`text-sm truncate ${isUnread ? 'font-medium text-[#090c1d]' : 'text-gray-700'}`}>
                            {msg.subject}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{msg.body.slice(0, 30)}</p>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">{fmt(msg.created_at)}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* 오른쪽: 상세 */}
        <div className="lg:col-span-2 bg-gray-50 rounded-xl border p-5">
          {selected ? (
            <MessageDetail
              message={selected}
              tab={tab}
              onBack={() => setSelected(null)}
              onReply={() => handleReply(selected)}
              onDelete={() => handleDelete(selected)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-20 text-gray-300">
              <MailOpen size={48} className="mb-3" />
              <p className="text-sm">쪽지를 선택하면 내용을 볼 수 있습니다.</p>
            </div>
          )}
        </div>
      </div>

      {showCompose && (
        <ComposeModal
          employees={empList}
          replyTo={replyTarget ?? undefined}
          onClose={() => { setShowCompose(false); setReplyTarget(null) }}
          onDone={() => { setShowCompose(false); setReplyTarget(null) }}
        />
      )}
    </>
  )
}
