'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Search, Loader2, Paperclip } from 'lucide-react'
import { saveDraftAction, submitDocumentAction } from '@/app/(dashboard)/documents/actions'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'

const TEMPLATES: Record<string, string> = {
  general: '일반 기안서',
  business_trip: '출장 신청서',
  purchase_request: '구매 요청서',
  expense_report: '비용 정산서',
}

const schema = z.object({
  title: z.string().min(1, '제목을 입력해주세요').max(200),
  template_type: z.string(),
  content: z.string().min(1, '내용을 입력해주세요'),
})

type FormValues = z.infer<typeof schema>
type ApproverProfile = Pick<Profile, 'id' | 'name' | 'email' | 'position'>

interface DocumentFormProps {
  templateType: string
  profile: Profile
  documentId?: string
  initialValues?: { title?: string; content?: string }
  initialApprovers?: ApproverProfile[]
}

export function DocumentForm({
  templateType,
  profile,
  documentId,
  initialValues,
  initialApprovers = [],
}: DocumentFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const submitModeRef = useRef<'draft' | 'submit'>('draft')
  const [approvers, setApprovers] = useState<ApproverProfile[]>(initialApprovers)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ApproverProfile[]>([])
  const [searching, setSearching] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [savedDocId, setSavedDocId] = useState(documentId)
  const [submitted, setSubmitted] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      template_type: templateType,
      title: initialValues?.title ?? '',
      content: initialValues?.content ?? '',
    },
  })

  async function searchApprovers(q: string) {
    setSearchQuery(q)
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email, position')
      .eq('is_active', true)
      .eq('is_system', false)
      .neq('id', profile.id)
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(6)
    setSearchResults((data ?? []) as ApproverProfile[])
    setSearching(false)
  }

  async function uploadFiles(docId: string) {
    if (!files.length) return
    const supabase = createClient()
    for (const file of files) {
      const path = `${docId}/${Date.now()}-${file.name}`
      const { error: err } = await supabase.storage.from('documents').upload(path, file)
      if (!err) {
        await supabase.from('document_attachments').insert({
          document_id: docId,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type,
        } as Record<string, unknown>)
      }
    }
  }

  const onSubmit = handleSubmit((values) => {
    const mode = submitModeRef.current
    setError('')

    if (mode === 'submit' && approvers.length === 0) {
      setError('결재자를 1명 이상 지정해야 합니다')
      return
    }

    startTransition(async () => {
      const draft = await saveDraftAction({
        ...values,
        approver_ids: approvers.map(a => a.id),
        document_id: savedDocId,
      })
      if (draft.error) {
        if (draft.error === '수정 권한이 없습니다.') {
          setSavedDocId(undefined)
          setError('이미 상신된 문서입니다. 새 문서를 작성하려면 페이지를 새로고침하세요.')
        } else if (draft.error.includes('세션이 만료')) {
          setError('로그인 세션이 만료되었습니다. 새 탭에서 로그인 후 이 페이지를 새로고침하세요.')
        } else {
          setError(draft.error)
        }
        return
      }

      const docId = draft.documentId!
      setSavedDocId(docId)
      await uploadFiles(docId)

      if (mode === 'draft') {
        setSubmitted(true)
        router.replace(`/documents/${docId}`)
        return
      }

      const result = await submitDocumentAction(docId)
      if (result.error) { setError(result.error); return }
      setSubmitted(true)
      router.replace(`/documents/${docId}`)
    })
  })

  return (
    <form onSubmit={onSubmit} className="space-y-6" aria-disabled={submitted}>
      {/* Template badge */}
      <div className="inline-flex items-center px-3 py-1 rounded-full bg-[#f5f4ff] border border-[#c8c4d0] text-xs font-medium text-[#7b68ee]">
        {TEMPLATES[templateType] ?? '일반 기안서'}
      </div>

      <input type="hidden" {...register('template_type')} />

      {/* Title */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[#292d34]">제목<span className="text-red-500 ml-0.5">*</span></label>
        <input
          {...register('title')}
          placeholder="기안서 제목을 입력하세요"
          className="w-full h-11 rounded-lg border border-[#d0ccf5] bg-white px-4 text-sm text-[#090c1d] placeholder:text-[#b0acd6] outline-none focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20 transition"
        />
        {errors.title && <p className="text-xs text-red-500">{errors.title.message}</p>}
      </div>

      {/* Content */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[#292d34]">내용<span className="text-red-500 ml-0.5">*</span></label>
        <textarea
          {...register('content')}
          rows={12}
          placeholder="내용을 입력하세요"
          className="w-full rounded-lg border border-[#d0ccf5] bg-white px-4 py-3 text-sm text-[#090c1d] placeholder:text-[#b0acd6] outline-none focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20 transition resize-y"
        />
        {errors.content && <p className="text-xs text-red-500">{errors.content.message}</p>}
      </div>

      {/* Approvers */}
      <div className="space-y-2">
        <div>
          <label className="text-sm font-medium text-[#292d34]">결재자<span className="text-red-500 ml-0.5">*</span></label>
          <p className="text-xs text-[#514b81] mt-0.5">순서대로 추가하세요 (최대 5명)</p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#b0acd6]" />
          <input
            value={searchQuery}
            onChange={e => searchApprovers(e.target.value)}
            disabled={approvers.length >= 5}
            placeholder={approvers.length >= 5 ? '결재자 최대 5명' : '이름 또는 이메일로 검색'}
            className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white pl-9 pr-4 text-sm text-[#090c1d] placeholder:text-[#b0acd6] outline-none focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-[#7b68ee] animate-spin" />
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="rounded-xl border border-[#c8c4d0] bg-white shadow-[0_4px_16px_rgba(123,104,238,0.1)] overflow-hidden">
            {searchResults.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (!approvers.find(a => a.id === p.id) && approvers.length < 5) {
                    setApprovers(prev => [...prev, p])
                  }
                  setSearchQuery('')
                  setSearchResults([])
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f9fa] text-left transition-colors"
              >
                <div className="size-8 rounded-full bg-[#7b68ee]/10 flex items-center justify-center text-xs font-semibold text-[#7b68ee] shrink-0">
                  {p.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#090c1d]">{p.name}</p>
                  <p className="text-xs text-[#514b81] truncate">{p.position ?? p.email}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {approvers.length > 0 && (
          <div className="space-y-2">
            {approvers.map((a, i) => (
              <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#f8f9fa] border border-[#c8c4d0]">
                <span className="size-6 rounded-full bg-[#7b68ee] flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#090c1d]">{a.name}</p>
                  <p className="text-xs text-[#514b81] truncate">{a.position ?? a.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setApprovers(prev => prev.filter(x => x.id !== a.id))}
                  className="text-[#b0acd6] hover:text-red-400 transition-colors shrink-0"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* File upload */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[#292d34]">첨부 파일</label>
        <label className="flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed border-[#c4bff5] bg-[#f8f9fa] cursor-pointer hover:bg-[#f8f9fa] transition-colors">
          <Paperclip className="size-4 text-[#7b68ee] shrink-0" />
          <span className="text-sm text-[#514b81]">파일 선택 (클릭 또는 드래그)</span>
          <input
            type="file"
            multiple
            className="hidden"
            onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files ?? [])])}
          />
        </label>
        {files.length > 0 && (
          <div className="space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#f5f4ff] text-xs text-[#514b81]">
                <Paperclip className="size-3.5 text-[#7b68ee] shrink-0" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-[#b0acd6] shrink-0">{(f.size / 1024).toFixed(0)}KB</span>
                <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                  <X className="size-3.5 hover:text-red-400 transition-colors" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-[#c8c4d0]">
        <button
          type="submit"
          disabled={isPending || submitted}
          onClick={() => { submitModeRef.current = 'draft' }}
          className="h-11 px-5 rounded-lg border border-[#c8c4d0] bg-white text-sm font-medium text-[#7b68ee] hover:bg-[#f8f9fa] transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          임시저장
        </button>
        <button
          type="submit"
          disabled={isPending || submitted}
          onClick={() => { submitModeRef.current = 'submit' }}
          className="flex-1 h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          상신하기
        </button>
      </div>
    </form>
  )
}
