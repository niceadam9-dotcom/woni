'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { deletePostAction } from '@/app/(dashboard)/board/actions'

export function DeletePostButton({ postId }: { postId: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleDelete() {
    if (!confirm('게시물을 삭제하시겠습니까?')) return
    startTransition(async () => {
      await deletePostAction(postId)
      router.push('/board')
      router.refresh()
    })
  }

  return (
    <button onClick={handleDelete} disabled={isPending}
      className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-red-200 text-xs text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
      {isPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
      삭제
    </button>
  )
}
