'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** 상세 헤더 [◀ 이전 | 다음 ▶] (설계 §6-C-3) — 목록 필터 컨텍스트(lq)·현재 탭 유지 이동.
 *  현재 URL의 tab·lq를 그대로 들고 다음 고객으로 — 계획서 탭에서 ▶ = 다음 고객의 계획서 탭. */
export function CustomerPrevNext({ prevId, nextId, position }: {
  prevId: string | null
  nextId: string | null
  position: string   // "3 / 16" 같은 순번 표시
}) {
  const router = useRouter()

  function go(id: string) {
    const sp = new URLSearchParams(window.location.search)
    sp.delete('b'); sp.delete('new')   // 상세 전용 파라미터는 넘기지 않음
    const qs = sp.toString()
    router.push(`/customers/${id}${qs ? `?${qs}` : ''}`)
  }

  const btnCls = (enabled: boolean) =>
    `inline-flex items-center justify-center size-7 rounded-lg border text-xs transition-colors ${
      enabled ? 'border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff]' : 'border-[#e8e6f5] text-[#d0ccf5] cursor-default'
    }`

  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={() => prevId && go(prevId)} disabled={!prevId} className={btnCls(!!prevId)} title="이전 고객">
        <ChevronLeft className="size-4" />
      </button>
      <span className="text-[10px] text-[#b0acd6] w-12 text-center">{position}</span>
      <button onClick={() => nextId && go(nextId)} disabled={!nextId} className={btnCls(!!nextId)} title="다음 고객">
        <ChevronRight className="size-4" />
      </button>
    </span>
  )
}
