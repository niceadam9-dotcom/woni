'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { hangulMatch } from '@/lib/hangul'

export type FilterCustomer = { id: string; name: string; sub?: string }

/** 목록·달력을 고객명으로 거르는 검색 입력 + 자동완성.
 *
 *  점검 업무 목록의 InspectionCustomerSearch와 달리 **서버를 부르지 않는다** — 점검확정·점검달력은
 *  화면에 필요한 고객을 이미 통째로 들고 있어서, 디바운스·왕복 없이 그 배열에서 바로 고른다.
 *  고른 값은 폼 제출이 아니라 호출부의 필터 상태로 들어간다(URL 동기화는 호출부 책임).
 *
 *  질의는 부분 일치 + 초성(ㅅㄹㅅ → 서림사, lib/hangul)이라 목록 필터와 제안이 같은 규칙을 쓴다 —
 *  제안에 뜬 고객이 목록에서는 안 걸리는 어긋남이 생기지 않는다. */
export function CustomerFilterSearch({
  customers, value, onChange,
  placeholder = '고객명 검색 (초성 가능)',
  widthClass = 'w-52',
  testId,
  size = 'sm',
}: {
  customers: FilterCustomer[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  widthClass?: string
  testId?: string
  /** 'lg' = 화면의 **주인공 검색창**(점검달력 2026-09-23 「고객검색이 눈에 잘 띄게」) — 높이 44px·글씨 14px·
   *  `/` 단축키 안내. 기본 'sm'은 종전 그대로(다른 화면 무변경). */
  size?: 'sm' | 'lg'
}) {
  const lg = size === 'lg'
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const matches = useMemo(() => {
    const q = value.trim()
    if (!q) return []
    const hit = customers.filter(c => hangulMatch(c.name, q))
    // 정확히 그 이름 하나만 남으면 이미 고른 상태 — 제안을 닫아 목록을 가리지 않는다
    if (hit.length === 1 && hit[0].name === q) return []
    return hit.slice(0, 8)
  }, [customers, value])

  function apply(name: string) {
    onChange(name)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); setActive(-1); return }
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % matches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? matches.length : i) - 1) }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); apply(matches[active].name) }
  }

  return (
    <div className="relative" ref={boxRef}>
      <Search className={`absolute top-1/2 -translate-y-1/2 pointer-events-none ${lg ? 'left-3.5 size-4.5 text-brand' : 'left-2.5 size-3.5 text-ink-faint'}`} />
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setActive(-1); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        aria-label="고객명 검색"
        data-testid={testId}
        className={lg
          ? `h-11 pl-10 pr-16 rounded-xl border-2 border-brand-line bg-surface text-sm text-ink placeholder:text-ink-meta outline-none shadow-sm focus:border-brand focus:ring-4 focus:ring-brand/15 transition ${widthClass}`
          : `h-8 pl-7 pr-7 rounded-lg border border-line bg-surface text-xs text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand transition ${widthClass}`}
      />
      {/* `/` 단축키 안내 — 큰 검색창에서만, 비었을 때만(값이 있으면 지우기 X가 그 자리를 쓴다) */}
      {lg && !value && (
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none rounded border border-line bg-paper px-1.5 text-form-2xs text-ink-meta">/</kbd>
      )}
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); setOpen(false); setActive(-1); inputRef.current?.focus() }}
          aria-label="고객명 검색어 지우기"
          data-testid={testId ? `${testId}-clear` : undefined}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-meta hover:text-ink-sub transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}

      {open && matches.length > 0 && (
        <div
          role="listbox"
          data-testid={testId ? `${testId}-list` : undefined}
          className={`absolute left-0 z-40 bg-surface rounded-xl border border-brand-line shadow-xl py-1.5 max-h-72 overflow-y-auto ${lg ? 'top-12 w-full min-w-64' : 'top-9 w-64'}`}
        >
          {matches.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => apply(c.name)}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 transition-colors ${i === active ? 'bg-brand-tint' : 'hover:bg-brand-tint'}`}
            >
              <span className="text-xs text-ink truncate">{c.name}</span>
              {c.sub && <span className="text-form-2xs text-ink-meta shrink-0">{c.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
