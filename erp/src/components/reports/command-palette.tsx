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
    // 소방계획서_8 Phase B: 문서 현황 = 고객 소방계획서 트리(별지 서식)가 단일 허브
    router.push(`/customers/${customerId}?tab=plan&form=annex`)
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
              <p className="mt-2 px-1 text-[10px] text-ink-faint">
                Esc 닫기 · 결과에서 바로 PDF 보기·HWP 받기·업로드·생성, 고객명 선택 시 소방계획서 트리(별지 서식)로 이동
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
