'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2, Loader2 } from 'lucide-react'
import { recallDocumentAction } from '@/app/(dashboard)/documents/actions'

export function RecallButton({ documentId }: { documentId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')

  function handleClick() {
    if (!confirm) { setConfirm(true); return }
    startTransition(async () => {
      const result = await recallDocumentAction(documentId)
      if (result.error) { setError(result.error); setConfirm(false) }
      else router.push('/documents')
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={isPending}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
          confirm
            ? 'bg-orange-500 text-white hover:bg-orange-600'
            : 'border border-orange-200 text-orange-600 hover:bg-orange-50'
        }`}
      >
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
        {confirm ? '확인 (회수)' : '문서 회수'}
      </button>
      {confirm && !isPending && (
        <button onClick={() => setConfirm(false)} className="text-xs text-[#514b81] hover:underline">
          취소
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
