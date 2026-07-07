'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { approveLeaveAction, rejectLeaveAction } from '@/app/(dashboard)/leaves/actions'

export function ManageActions({ leaveId }: { leaveId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showReject, setShowReject] = useState(false)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  function handleApprove() {
    setError('')
    startTransition(async () => {
      const result = await approveLeaveAction(leaveId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  function handleReject() {
    if (!comment.trim()) { setError('諛섎젮 ?ъ쑀瑜??낅젰?댁＜?몄슂.'); return }
    setError('')
    startTransition(async () => {
      const result = await rejectLeaveAction(leaveId, comment)
      if (result.error) setError(result.error)
      else { setShowReject(false); router.refresh() }
    })
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
          ?뱀씤
        </button>
        <button
          onClick={() => { setShowReject(true); setError('') }}
          disabled={isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <XCircle className="size-3" />
          諛섎젮
        </button>
      </div>
      {error && !showReject && <p className="text-xs text-red-500 mt-1">{error}</p>}

      {showReject && (
        <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-[#090c1d] mb-1">諛섎젮 ?ъ쑀 ?낅젰</h3>
            <p className="text-xs text-[#514b81] mb-4">諛섎젮 ?ъ쑀???좎껌?먯뿉寃??꾨떖?⑸땲??</p>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="諛섎젮 ?ъ쑀瑜??낅젰?댁＜?몄슂"
              className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] placeholder:text-[#b0acd6] outline-none focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20 transition resize-none"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setShowReject(false); setComment(''); setError('') }}
                className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                痍⑥냼
              </button>
              <button
                onClick={handleReject}
                disabled={isPending}
                className="flex-1 h-10 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : '諛섎젮?섍린'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
