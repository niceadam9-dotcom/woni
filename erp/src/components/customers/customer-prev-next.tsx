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

  // 2026-09-21 사용자 요청 — 헤더의 화살표를 **한 크기로** 맞춘다(공통·보고서·소방계획서 공통 헤더).
  // 바로 왼쪽 [목록으로] ‹ 를 40px·굵기3으로 키웠더니 16px·굵기2인 이 둘만 남아 짝이 어긋났다.
  // 같은 줄에 붙어 있어 차이가 더 도드라진다. 아이콘 40px + 상자 48px = 사방 4px 여백.
  const btnCls = (enabled: boolean) =>
    `inline-flex items-center justify-center size-12 rounded-lg border-2 transition-colors ${
      enabled ? 'border-brand-line text-brand hover:bg-brand-tint' : 'border-brand-line-soft text-[#d0ccf5] cursor-default'
    }`

  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={() => prevId && go(prevId)} disabled={!prevId} className={btnCls(!!prevId)} title="이전 고객" aria-label="이전 고객">
        <ChevronLeft className="size-10" strokeWidth={3} />
      </button>
      {/* 순번도 같이 키운다 — 혼자 작으면 커진 화살표 둘 사이에서 파묻힌다 */}
      <span className="text-form-sm font-semibold text-ink-sub w-14 text-center">{position}</span>
      <button onClick={() => nextId && go(nextId)} disabled={!nextId} className={btnCls(!!nextId)} title="다음 고객" aria-label="다음 고객">
        <ChevronRight className="size-10" strokeWidth={3} />
      </button>
    </span>
  )
}
