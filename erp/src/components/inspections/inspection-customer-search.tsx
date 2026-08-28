'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, Building2, X } from 'lucide-react'
import { searchInspectionCustomersAction } from '@/app/(dashboard)/inspections/actions'

type Suggestion = { name: string; count: number }

/** 점검 업무 목록의 고객명 검색 + 자동완성.
 *
 *  고객 목록의 CustomerSearchBox와 달리 **고르면 상세로 가지 않고 목록을 거른다** — 여기서
 *  원하는 건 '이 고객의 점검 건만 보기'이지 고객 상세로의 이탈이 아니다.
 *  제안을 고르면 그 값으로 폼을 제출하고, 자유 입력(부분 문자열)도 그대로 검색어가 된다. */
export function InspectionCustomerSearch({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue)
  const [sug, setSug] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 늦게 도착한 이전 요청이 최신 제안을 덮어쓰지 않도록 (빠르게 타이핑하면 순서가 뒤집힌다)
  const seqRef = useRef(0)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // 밖에서 검색어가 바뀌면 따라간다 — [최근 본 고객] 칩·초기화처럼 클라이언트 내비게이션으로
  // 오는 경로는 이 컴포넌트를 다시 마운트하지 않아, useState 초기값만으로는 입력창이 빈 채로
  // 남는다. 그러면 필터가 걸린 줄 모르고 다른 조건을 바꿔 제출해 q가 조용히 풀린다.
  useEffect(() => {
    setValue(defaultValue)
    setSug([])
    setOpen(false)
    setActive(-1)
  }, [defaultValue])

  function handleChange(v: string) {
    setValue(v)
    setActive(-1)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!v.trim()) { setSug([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current
      const res = await searchInspectionCustomersAction(v)
      if (seq !== seqRef.current) return
      setSug(res.customers)
      setOpen(res.customers.length > 0)
    }, 250)
  }

  function apply(name: string) {
    setValue(name)
    setOpen(false)
    // state 반영 후 제출 — 같은 tick에 제출하면 직전 값이 실린다
    requestAnimationFrame(() => inputRef.current?.form?.requestSubmit())
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || sug.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % sug.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? sug.length : i) - 1) }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1) }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); apply(sug[active].name) }
    // Enter인데 고른 항목이 없으면 기본 동작(입력값 그대로 검색)에 맡긴다
  }

  return (
    <div className="relative" ref={boxRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint pointer-events-none" />
      <input
        ref={inputRef}
        name="q"
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => sug.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="고객명 검색"
        autoComplete="off"
        aria-label="고객명 검색"
        className="h-9 pl-8 pr-8 rounded-lg border border-brand-line bg-surface text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition w-56"
      />
      {value && (
        <button
          type="button"
          onClick={() => { setValue(''); setSug([]); setOpen(false); apply('') }}
          aria-label="고객명 검색어 지우기"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-ink-sub transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}

      {open && sug.length > 0 && (
        <div className="absolute top-10 left-0 z-40 w-72 bg-surface rounded-xl border border-brand-line shadow-xl py-2 max-h-80 overflow-y-auto">
          <p className="px-3 py-1 text-[10px] font-semibold text-ink-faint uppercase flex items-center gap-1">
            <Building2 className="size-3" /> 고객 (선택 시 목록 필터)
          </p>
          {sug.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => apply(c.name)}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 transition-colors ${i === active ? 'bg-brand-tint' : 'hover:bg-brand-tint'}`}
            >
              <span className="text-sm text-ink truncate">{c.name}</span>
              <span className="text-[10px] text-ink-faint shrink-0">{c.count}건</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
