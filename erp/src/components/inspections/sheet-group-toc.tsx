'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 드로어 안 머더(중분류) 목차 — 점프 + 스크롤 스파이 (소방계획서_23 S7-7).
 *
 *  점프: `scrollIntoView` 금지 — 조상 스크롤러가 전부 움직여 "페이지 스크롤 0" 규약(프로브 3)이 깨진다.
 *  스크롤 박스의 scrollTop을 수동 계산한다. 항목이 async 로드라 열 때의 첫 점프는 pendingJump로
 *  받아 useLayoutEffect(엔트리 렌더 후)에서 소비한다.
 *
 *  스파이: IntersectionObserver 1개(root=스크롤 박스). 점프 직후 400ms 억제 — 통과하는 그룹들이
 *  차례로 하이라이트되며 깜빡이는 것을 막는다. */

export type TocEntry = {
  code: string
  /** 폴백에서는 code와 같을 수 있다 — 그땐 이름 병기 생략 */
  name: string
  total: number
  responded: number
  x: number
}

export function SheetGroupToc({ entries, scrollBoxRef, pendingJump, onJumpConsumed, onActiveGroup }: {
  entries: TocEntry[]
  /** 항목 스크롤 박스(sheet-item-editor outline의 scrollBoxRef와 같은 ref) */
  scrollBoxRef: React.RefObject<HTMLDivElement | null>
  /** 열 때 이동할 머더 — 소비 후 onJumpConsumed 호출(재점프 방지) */
  pendingJump?: string | null
  onJumpConsumed?: () => void
  onActiveGroup?: (code: string) => void
}) {
  const [active, setActive] = useState<string | null>(null)
  const suppressUntil = useRef(0)

  function jumpTo(code: string): boolean {
    const box = scrollBoxRef.current
    if (!box) return false
    const el = box.querySelector<HTMLElement>(`[data-outline-group="${CSS.escape(code)}"]`)
    if (!el) return false
    box.scrollTop = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top
    suppressUntil.current = Date.now() + 400
    setActive(code)
    onActiveGroup?.(code)
    return true
  }

  // 열 때 첫 점프 — 엔트리(=항목)가 렌더된 뒤에만 DOM이 있으므로 layout effect에서 소비.
  // ⚠ 커밋 레이아웃 단계는 트리 순서라, 이 컴포넌트(드로어 toc 슬롯 — 편집기보다 앞)의 effect 시점엔
  //   편집기 스크롤 박스 ref가 아직 안 붙어 있다(실측: box null로 무음 실패했었다) —
  //   실패하면 소비하지 않고 다음 프레임(paint 전)에 재시도한다.
  useLayoutEffect(() => {
    if (!pendingJump || entries.length === 0) return
    if (jumpTo(pendingJump)) { onJumpConsumed?.(); return }
    const raf = requestAnimationFrame(() => { if (jumpTo(pendingJump)) onJumpConsumed?.() })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, entries.length])

  // 스크롤 스파이 — 그룹 헤더가 박스 상단 30% 밴드에 들어오면 활성
  useEffect(() => {
    const box = scrollBoxRef.current
    if (!box || entries.length === 0) return
    const io = new IntersectionObserver(ents => {
      if (Date.now() < suppressUntil.current) return
      const hit = ents.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (!hit) return
      const code = (hit.target as HTMLElement).dataset.outlineGroup
      if (code) { setActive(code); onActiveGroup?.(code) }
    }, { root: box, rootMargin: '0px 0px -70% 0px' })
    for (const el of box.querySelectorAll('[data-outline-group]')) io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length])

  return (
    <nav data-testid="sheet-toc" aria-label="머더 목차"
      className="flex gap-1 overflow-x-auto lg:overflow-x-visible lg:flex-col lg:w-40 lg:shrink-0 lg:overflow-y-auto pr-1">
      {entries.map(e => {
        const on = e.code === active
        const full = e.total > 0 && e.responded >= e.total
        return (
          <button key={e.code} onClick={() => jumpTo(e.code)}
            data-toc-group={e.code} data-toc-active={on ? '1' : undefined}
            title={e.name !== e.code ? `${e.code}. ${e.name}` : e.code}
            className={`shrink-0 lg:shrink lg:w-full text-left rounded-lg border px-2 py-1 transition-colors ${
              on ? 'border-[#7b68ee] bg-[#f5f4ff]' : 'border-[#e0ddf5] hover:bg-[#fafaff]'}`}>
            <span className="flex items-center gap-1">
              <span className={`text-[10px] font-bold ${on ? 'text-[#7b68ee]' : 'text-[#514b81]'}`}>{e.code}</span>
              <span className={`ml-auto text-[9px] shrink-0 ${full ? 'text-green-600' : e.responded > 0 ? 'text-amber-600' : 'text-[#b0acd6]'}`}>
                {e.responded}/{e.total}{e.x > 0 ? ` ✕${e.x}` : ''}
              </span>
            </span>
            {e.name !== e.code && (
              <span className="hidden lg:block text-[9px] text-[#b0acd6] truncate">{e.name}</span>
            )}
            <span className="hidden lg:block h-1 mt-0.5 rounded bg-[#f0eefb] overflow-hidden">
              <span className={`block h-full ${full ? 'bg-green-400' : 'bg-[#c3bdf5]'}`}
                style={{ width: `${e.total > 0 ? Math.round(e.responded / e.total * 100) : 0}%` }} />
            </span>
          </button>
        )
      })}
    </nav>
  )
}
