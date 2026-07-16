'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { deleteSheetAction } from '@/app/(dashboard)/inspection-sheets/actions'

/** 점검표 삭제 버튼 — 응답이 참조 중이면 서버가 차단(비활성화 안내). manager/admin 전용 렌더. */
export function SheetDeleteButton({ sheetId, sheetName }: { sheetId: string; sheetName: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleDelete() {
    if (!window.confirm(`'${sheetName}' 점검표를 삭제할까요?\n점검 항목도 함께 삭제되며 되돌릴 수 없습니다.`)) return
    setError('')
    startTransition(async () => {
      const res = await deleteSheetAction(sheetId)
      if (res.error) { setError(res.error); window.alert(res.error); return }
      router.refresh()
    })
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      title={error || '점검표 삭제'}
      className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 hover:underline font-medium disabled:opacity-50"
    >
      {isPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
      삭제
    </button>
  )
}
