'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { deleteInspectionAction } from '@/app/(dashboard)/inspections/actions'

/** 점검 삭제 — §4-E H-28 여정 스텝퍼로 이동하며 InspectionDetailClient에서 분리한 삭제 액션.
 *  자체점검 상세에서 단계 완료/보고서는 타임라인이 흡수하고, 삭제만 여기서 노출(기존 deleteInspectionAction 재사용). */
export function InspectionDeleteClient({ inspectionId }: { inspectionId: string }) {
  const router = useRouter()
  const [showConfirm, setShowConfirm] = useState(false)
  const [isDeleting, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteInspectionAction(inspectionId)
      if (result.error) { setError(result.error); setShowConfirm(false) }
      else router.push('/inspections')
    })
  }

  return (
    <div className="pt-1">
      {error && <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-4 py-3 mb-2">{error}</p>}
      {!showConfirm ? (
        <button onClick={() => setShowConfirm(true)}
          className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors">
          <Trash2 className="size-3.5" /> 이 점검 삭제
        </button>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-red-700">이 점검을 삭제하면 복구할 수 없습니다. 계속하시겠습니까?</p>
          <div className="flex gap-2 shrink-0">
            <button onClick={handleDelete} disabled={isDeleting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors">
              {isDeleting && <Loader2 className="size-3 animate-spin" />} 삭제
            </button>
            <button onClick={() => setShowConfirm(false)}
              className="px-3 py-1.5 border border-line text-xs text-ink-sub rounded-lg hover:bg-surface transition-colors">
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
