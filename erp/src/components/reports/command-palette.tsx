'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { DocActionSearch } from '@/components/reports/doc-action-search'

/** Ctrl+K 전역 팔레트 (소방계획서_5 R0-4·4-0-13-(1)) —
 *  어느 화면에서든 Ctrl+K(모바일: 헤더 🔍)로 같은 행동 자동완성 검색.
 *  "보고서 센터로 이동"조차 생략 — 문서 확인·생성·업로드를 그 자리에서. 고객 선택 시 문서 현황으로 이동. */

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen(v => !v)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function openDocs(customerId: string) {
    setOpen(false)
    // 소방계획서_8 Phase B: 문서 현황 = 별지서식 탭이 단일 허브 (소방계획서_34로 최상위 탭 승격)
    const href = `/customers/${customerId}?tab=annex`
    // ⚠ 팔레트는 전역 헤더라 지금 보고 있는 그 고객을 다시 고를 수 있다 = **같은 경로**.
    //   같은 pathname으로 ?tab=만 바꾸는 router.push는 URL만 바꾸고 서버를 재렌더하지 않아
    //   활성 탭이 그대로 남는다(customers/[id]/page.tsx의 헤더 <a> 주석에 실측 근거).
    //   여기는 CustomerTabs 컨텍스트 밖이라 goTab을 못 쓰므로 전체 이동으로 확정한다.
    if (typeof window !== 'undefined' && window.location.pathname === `/customers/${customerId}`) {
      window.location.assign(href)
      return
    }
    router.push(href)
  }

  return (
    <>
      {/* 트리거 — 데스크톱은 힌트 포함, 모바일은 🔍만 */}
      <button
        onClick={() => setOpen(true)}
        aria-label="문서 검색 (Ctrl+K)"
        className="inline-flex items-center gap-2 h-9 rounded-lg border border-brand-line text-ink-sub hover:border-brand hover:text-brand transition-colors px-2 sm:pl-2.5 sm:pr-2"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline text-xs">문서 검색</span>
        <kbd className="hidden sm:inline text-[10px] font-sans text-ink-faint border border-brand-line-soft rounded px-1 py-0.5 leading-none">Ctrl K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/30 dark:bg-black/60" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-lg" onMouseDown={e => e.stopPropagation()}>
            <div className="rounded-2xl bg-surface shadow-2xl border border-brand-line p-3">
              <DocActionSearch onOpenDocs={openDocs} autoFocus
                placeholder="고객명을 검색하세요 — 문서 확인·생성·업로드 (초성 ㅅㄹㅅ 가능)" />
              {/* S7-1 — 이 패널을 어떻게 쓰는지 알려주는 유일한 문장이다. 읽히지 않으면 기능이 없는 것과 같다 */}
              <p className="mt-2 px-1 text-[10px] text-ink-meta">
                Esc 닫기 · 결과에서 바로 PDF 보기·HWP 받기·업로드·생성, 고객명 선택 시 소방계획서 트리(별지 서식)로 이동
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
