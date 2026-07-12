'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, X, Check, Phone, User } from 'lucide-react'
import {
  updateInquiryAction,
  updateInquiryStatusAction,
  type InquiryType,
  type InquiryStatus,
} from '@/app/(dashboard)/inquiries/actions'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'
const labelCls = 'text-xs font-medium text-[#514b81]'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}

const TYPE_OPTIONS: { value: InquiryType; label: string }[] = [
  { value: 'as_request', label: 'AS 요청' },
  { value: 'schedule', label: '일정 조율' },
  { value: 'quote', label: '견적 문의' },
  { value: 'other', label: '기타' },
]

const STATUS_TRANSITIONS: Record<string, { value: InquiryStatus; label: string; color: string }[]> = {
  pending: [
    { value: 'in_progress', label: '처리 시작', color: 'bg-blue-500 text-white hover:bg-blue-600' },
    { value: 'cancelled', label: '취소', color: 'border border-gray-300 text-gray-600 hover:bg-gray-50' },
  ],
  in_progress: [
    { value: 'resolved', label: '처리 완료', color: 'bg-green-500 text-white hover:bg-green-600' },
    { value: 'cancelled', label: '취소', color: 'border border-gray-300 text-gray-600 hover:bg-gray-50' },
  ],
  resolved: [],
  cancelled: [
    { value: 'pending', label: '재접수', color: 'bg-yellow-500 text-white hover:bg-yellow-600' },
  ],
}

const STATUS_LABELS: Record<string, string> = {
  pending: '접수대기',
  in_progress: '처리중',
  resolved: '처리완료',
  cancelled: '취소',
}
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700',
  in_progress: 'bg-blue-50 text-blue-700',
  resolved: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}
const TYPE_LABELS: Record<string, string> = {
  as_request: 'AS 요청',
  schedule: '일정 조율',
  quote: '견적 문의',
  other: '기타',
}

type Inquiry = {
  id: string
  customer_id: string
  inquiry_type: string
  title: string
  content: string
  status: string
  contact_name: string | null
  contact_phone: string | null
  resolution_notes: string | null
  created_at: string
  resolved_at: string | null
}

export function InquiryDetailClient({ inquiry }: { inquiry: Inquiry }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState('')
  const [resolutionNotes, setResolutionNotes] = useState(inquiry.resolution_notes ?? '')
  const [showResolution, setShowResolution] = useState(false)

  const [form, setForm] = useState({
    title: inquiry.title,
    content: inquiry.content,
    inquiry_type: inquiry.inquiry_type as InquiryType,
    contact_name: inquiry.contact_name ?? '',
    contact_phone: inquiry.contact_phone ?? '',
  })

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    setError('')
    if (!form.title.trim()) { setError('제목을 입력해주세요.'); return }
    if (!form.content.trim()) { setError('내용을 입력해주세요.'); return }

    startTransition(async () => {
      const result = await updateInquiryAction({
        id: inquiry.id,
        title: form.title.trim(),
        content: form.content.trim(),
        inquiry_type: form.inquiry_type,
        contact_name: form.contact_name.trim() || undefined,
        contact_phone: form.contact_phone.trim() || undefined,
      })
      if (result.error) { setError(result.error); return }
      setIsEditing(false)
      router.refresh()
    })
  }

  function handleStatusChange(status: InquiryStatus) {
    if (status === 'resolved') {
      setShowResolution(true)
      return
    }
    startTransition(async () => {
      const result = await updateInquiryStatusAction({ id: inquiry.id, status })
      if (result.error) { setError(result.error); return }
      router.refresh()
    })
  }

  function handleResolve() {
    startTransition(async () => {
      const result = await updateInquiryStatusAction({
        id: inquiry.id,
        status: 'resolved',
        resolution_notes: resolutionNotes,
      })
      if (result.error) { setError(result.error); return }
      setShowResolution(false)
      router.refresh()
    })
  }

  const transitions = STATUS_TRANSITIONS[inquiry.status] ?? []

  return (
    <div className="max-w-2xl space-y-6">
      {/* 상태 배지 및 전환 */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${STATUS_COLORS[inquiry.status] ?? 'bg-gray-100 text-gray-600'}`}>
          {STATUS_LABELS[inquiry.status] ?? inquiry.status}
        </span>
        {transitions.map(t => (
          <button
            key={t.value}
            onClick={() => handleStatusChange(t.value)}
            disabled={isPending}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${t.color}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 처리완료 메모 입력 */}
      {showResolution && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-green-800">처리 완료 메모</p>
          <textarea
            value={resolutionNotes}
            onChange={e => setResolutionNotes(e.target.value)}
            placeholder="처리 결과를 입력해주세요 (선택)"
            rows={3}
            className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-green-500 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowResolution(false)}
              className="h-8 px-3 rounded-lg border border-green-300 text-xs text-green-700 hover:bg-green-100 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleResolve}
              disabled={isPending}
              className="h-8 px-4 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              처리 완료
            </button>
          </div>
        </div>
      )}

      {/* 문의 내용 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#090c1d]">문의 내용</h2>
          {inquiry.status === 'pending' && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
            >
              <Pencil className="size-3" />
              수정
            </button>
          )}
          {isEditing && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setIsEditing(false); setError('') }}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                <X className="size-3" />
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={isPending}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                저장
              </button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-4">
            <Field label="유형">
              <select
                value={form.inquiry_type}
                onChange={e => setField('inquiry_type', e.target.value as InquiryType)}
                className={inputCls}
              >
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="제목" required>
              <input
                value={form.title}
                onChange={e => setField('title', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="내용" required>
              <textarea
                value={form.content}
                onChange={e => setField('content', e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="담당자명">
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
                  <input
                    value={form.contact_name}
                    onChange={e => setField('contact_name', e.target.value)}
                    className={`${inputCls} pl-8`}
                  />
                </div>
              </Field>
              <Field label="연락처">
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
                  <input
                    value={form.contact_phone}
                    onChange={e => setField('contact_phone', e.target.value)}
                    className={`${inputCls} pl-8`}
                  />
                </div>
              </Field>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">
                {TYPE_LABELS[inquiry.inquiry_type] ?? inquiry.inquiry_type}
              </span>
            </div>
            <div>
              <p className="text-xs text-[#514b81] mb-1">제목</p>
              <p className="text-sm font-medium text-[#090c1d]">{inquiry.title}</p>
            </div>
            <div>
              <p className="text-xs text-[#514b81] mb-1">내용</p>
              <p className="text-sm text-[#090c1d] whitespace-pre-wrap">{inquiry.content}</p>
            </div>
            {(inquiry.contact_name || inquiry.contact_phone) && (
              <div className="pt-3 border-t border-[#c8c4d0]">
                <p className="text-xs text-[#514b81] mb-2">담당 연락처</p>
                <div className="flex items-center gap-4 text-sm">
                  {inquiry.contact_name && (
                    <span className="flex items-center gap-1 text-[#090c1d]">
                      <User className="size-3.5 text-[#b0acd6]" />
                      {inquiry.contact_name}
                    </span>
                  )}
                  {inquiry.contact_phone && (
                    <span className="flex items-center gap-1 text-[#090c1d]">
                      <Phone className="size-3.5 text-[#b0acd6]" />
                      {inquiry.contact_phone}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 처리 결과 */}
      {inquiry.resolution_notes && (
        <section className="bg-green-50 border border-green-200 rounded-xl p-6 space-y-2">
          <p className="text-xs font-semibold text-green-800">처리 완료 메모</p>
          <p className="text-sm text-green-800 whitespace-pre-wrap">{inquiry.resolution_notes}</p>
          {inquiry.resolved_at && (
            <p className="text-xs text-green-600">완료일: {inquiry.resolved_at.slice(0, 10)}</p>
          )}
        </section>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}
    </div>
  )
}
