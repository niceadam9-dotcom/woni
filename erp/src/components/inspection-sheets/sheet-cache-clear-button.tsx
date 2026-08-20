'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { clearSheetCatalogCacheAction } from '@/app/(dashboard)/inspection-sheets/actions'

/** 카탈로그 캐시 비우기 (2026-08-20) — 점검표 항목·시트는 마스터 데이터라 캐시에 담긴다
 *  (`lib/sheet-catalog.ts`). 화면에서 고치면 자동으로 비워지지만, **시드 스크립트나 마이그레이션이
 *  DB를 직접 쓴 경우**는 앱이 알 수 없어 최대 1시간(TTL) 낡은 값이 보인다. 그때 쓰는 수동 경로다. */
export function SheetCacheClearButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function handleClear() {
    setDone(false)
    startTransition(async () => {
      const res = await clearSheetCatalogCacheAction()
      if (res.error) { window.alert(res.error); return }
      setDone(true)
      router.refresh()
      window.setTimeout(() => setDone(false), 3000)
    })
  }

  return (
    <button
      onClick={handleClear}
      disabled={isPending}
      title="점검표 항목 캐시를 즉시 비웁니다 — 시드·마이그레이션으로 DB를 직접 고친 뒤 사용하세요"
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors disabled:opacity-50"
    >
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {done ? '비웠습니다' : '캐시 비우기'}
    </button>
  )
}
