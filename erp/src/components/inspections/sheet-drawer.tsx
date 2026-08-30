'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** 시트 단위 대형 드로어 셸 — createPortal(document.body) 오버레이 (소방계획서_23 S7-6, Q-4·Q-14).
 *
 *  이 컴포넌트는 **dirty를 모른다** — 개폐 판단(미저장 확인창·백드롭 허용 여부)은 오케스트레이터
 *  (inspection-sheet-client)가 소유하고, 여기는 셸(백드롭·패널·포커스 트랩·body 잠금)만 책임진다.
 *
 *  ⚠ 헤더 제목에 '점검표 입력' 문자열 금지 — plan-annex-sheet-tree.tsx:22-23 명시
 *  (test-annex-interaction.mts가 그 문자열로 다른 화면을 판정한다). 시트명만 쓴다.
 *
 *  포털이라 workbench-panes 서브트리 밖이다 — 종전 `lg:has-[[data-sheet-open]]` 규약은 영영 매치되지
 *  않아 폐기됐다(Q-15). grid 재배치가 없으므로 닫을 때 레이아웃이 튀지 않는다(Q-4). */
export function SheetDrawer({ open, title, headerRight, banner, toc, footer, children, onRequestClose, dismissOnBackdrop = true }: {
  open: boolean
  /** 시트명 (예: '옥내소화전설비') — '점검표 입력' 금지 */
  title: ReactNode
  /** 헤더 우측 — 진행 요약·[／ 전체]·● 미저장 등 (오케스트레이터가 채운다) */
  headerRight?: ReactNode
  /** stale 배너·대장 힌트 배너 슬롯 (Q-22 ②) */
  banner?: ReactNode
  /** 좌측(lg)/상단(미만) 머더 목차 슬롯 */
  toc?: ReactNode
  footer?: ReactNode
  children: ReactNode
  /** reason: 'esc' | 'backdrop' | 'button' — 닫을지는 호출부가 결정(dirty 게이트) */
  onRequestClose: (reason: 'esc' | 'backdrop' | 'button') => void
  /** dirty면 false로 — 백드롭 오클릭으로 입력을 잃지 않게 (S7-8) */
  dismissOnBackdrop?: boolean
}) {
  // R-6: Next 16 — createPortal은 'use client' + mounted 가드 (SSR에는 document가 없다)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)
  const requestCloseRef = useRef(onRequestClose)
  requestCloseRef.current = onRequestClose

  // 포커스를 쥔 요소가 언마운트되면(예: stale 배너의 [최신 불러오기] 클릭 → 배너 소멸) 포커스가
  // body로 떨어져 패널 onKeyDown이 ESC를 못 받는다 — 문서 레벨 보강. 포커스가 body 밖 어딘가에
  // 살아 있으면 건드리지 않는다(인라인 X 메모·확인창의 ESC 우선순위 유지).
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const ae = document.activeElement
      if (ae && ae !== document.body && ae !== document.documentElement) return
      requestCloseRef.current('esc')
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open])

  // body 스크롤 잠금 + 스크롤바 폭 보정 — 잠글 때 폭이 줄며 화면이 옆으로 튀는 것을 막는다
  useEffect(() => {
    if (!open) return
    prevFocus.current = document.activeElement as HTMLElement | null
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    const prevOverflow = document.body.style.overflow
    const prevPad = document.body.style.paddingRight
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
    // 초기 포커스 — 목차의 활성 머더 버튼, 없으면 패널
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('[data-toc-active]')
        ?? panelRef.current
      el?.focus()
    }, 0)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prevOverflow
      document.body.style.paddingRight = prevPad
      prevFocus.current?.focus?.()   // 닫을 때 열었던 카드로 포커스 복원
    }
  }, [open])

  if (!mounted || !open) return null

  const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  function onKeyDown(e: React.KeyboardEvent) {
    // ESC — 인라인 X 메모(sheet-item-editor)가 열려 있으면 그쪽이 먼저 소비(stopPropagation)한다
    if (e.key === 'Escape') { e.stopPropagation(); onRequestClose('esc'); return }
    if (e.key !== 'Tab') return
    // 포커스 트랩 — 패널 밖으로 나가지 않게 순환
    const list = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
    if (list.length === 0) return
    const first = list[0], last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* 백드롭 — dirty면 비활성(오클릭 보호). mousedown 기준: 드래그로 끌려나온 mouseup 오탐 방지.
          testid는 테스트용이다: 패널이 전체화면(inset-4)이 되며 백드롭이 16px 테두리만 남아
          좌표 클릭(120,500)이 패널 안으로 들어갔다 — 요소로 집어야 inset 값 변화에 면역이다. */}
      <div data-testid="sheet-drawer-backdrop" className="absolute inset-0 bg-black/25 dark:bg-black/60"
        onMouseDown={() => { if (dismissOnBackdrop) onRequestClose('backdrop') }} />
      <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={onKeyDown}
        data-testid="sheet-drawer"
        className="absolute inset-4 bg-surface shadow-2xl border border-line rounded-2xl flex flex-col outline-none overflow-hidden
          max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:h-[95dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-brand-line-soft shrink-0">
          {/* 제목만 배율에 연동한다 — 닫기 버튼 size-8(32px)이 py-2.5와 함께 헤더 행 높이를
              지배하므로, 제목이 xl에서 19.5px(행간 27.9px)까지 커져도 헤더는 흔들리지 않는다. */}
          <h2 className="text-form-base font-semibold text-ink truncate">{title}</h2>
          {headerRight}
          <button onClick={() => onRequestClose('button')} aria-label="닫기" data-testid="sheet-drawer-close"
            className="ml-1 size-8 shrink-0 rounded-lg flex items-center justify-center text-ink-sub hover:bg-brand-tint">
            <X className="size-4" />
          </button>
        </div>
        {banner}
        {/* ⚠ 우측 컬럼의 min-h-0는 장식이 아니다 — 자식(항목 스크롤 박스)이 flex-1로 남는 공간을
            채우려면 이 칸이 콘텐츠 높이 아래로 줄어들 수 있어야 한다. lg(row)에서는 교차축
            stretch로 높이가 확정되지만 max-lg(column)에서는 min-height:auto라 줄지 않아,
            빼면 박스가 무한히 자라 페이지가 통째로 스크롤된다. */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 p-4">
          {toc}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</div>
        </div>
        {footer && <div className="px-4 py-2.5 border-t border-brand-line-soft shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
