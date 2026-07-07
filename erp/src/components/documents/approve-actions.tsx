'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { approveDocumentAction, rejectDocumentAction } from '@/app/(dashboard)/documents/actions'

export function ApproveActions({ documentId }: { documentId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showReject, setShowReject] = useState(false)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  function handleApprove() {
    setError('')
    startTransition(async () => {
      const result = await approveDocumentAction(documentId)
      if (result.error) setError(result.error)
      else router.push('/approvals')
    })
  }

  function handleReject() {
    if (!comment.trim()) { setError('반려 사유를 입력해주세요.'); return }
    setError('')
    startTransition(async () => {
      const result = await rejectDocumentAction(documentId, comment)
      if (result.error) setError(result.error)
      else router.push('/approvals')
    })
  }

  return (
    <>
      <div className="flex gap-3">
        <button
          onClick={handleApprove}
          disabled={isPending}
          className="flex-1 h-11 flex items-center justify-center gap-2 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          승인
        </button>
        <button
          onClick={() => { setShowReject(true); setError('') }}
          disabled={isPending}
          className="flex-1 h-11 flex items-center justify-center gap-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <XCircle className="size-4" />
          반려
        </button>
      </div>

      {error && !showReject && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {showReject && (
        <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-[#090c1d] mb-1">반려 사유 입력</h3>
            <p className="text-xs text-[#514b81] mb-4">반려 사유는 기안자에게 전달됩니다</p>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={4}
              placeholder="반려 사유를 입력해주세요"
              className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] placeholder:text-[#b0acd6] outline-none focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20 transition resize-none"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setShowReject(false); setComment(''); setError('') }}
                className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleReject}
                disabled={isPending}
                className="flex-1 h-10 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : '반려하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
