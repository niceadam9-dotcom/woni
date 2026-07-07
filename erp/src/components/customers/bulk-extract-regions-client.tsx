'use client'

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { bulkExtractRegionsAction } from '@/app/(dashboard)/customers/actions'

export function BulkExtractRegionsClient({ missingCount }: { missingCount: number }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    if (missingCount <= 0) return
    startTransition(async () => {
      await bulkExtractRegionsAction()
      router.refresh()
    })
  // missingCount가 변할 때만 실행 (페이지 마운트 시 1회)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingCount])

  if (!isPending || missingCount === 0) return null

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#514b81]">
      <Loader2 className="size-3.5 animate-spin text-[#7b68ee]" />
      지역 정보 자동 추출 중 ({missingCount}건)...
    </span>
  )
}
