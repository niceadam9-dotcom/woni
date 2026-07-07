'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, Building2, MapPin, User } from 'lucide-react'
import { searchSuggestionsAction } from '@/app/(dashboard)/customers/actions'

type Suggestions = {
  buildings: string[]
  addresses: string[]
  employees: { name: string; count: number }[]
}

/** 통합 검색창 + 자동완성 드롭다운 (V10 §6) — 건물명/주소/담당자 섹션 분리 */
export function CustomerSearchBox({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue)
  const [sug, setSug] = useState<Suggestions | null>(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handleChange(v: string) {
    setValue(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!v.trim()) { setSug(null); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      const res = await searchSuggestionsAction(v)
      setSug(res)
      setOpen(res.buildings.length + res.addresses.length + res.employees.length > 0)
    }, 250)
  }

  function applyAndSubmit(v: string) {
    setValue(v)
    setOpen(false)
    // 폼 값 반영 후 제출
    requestAnimationFrame(() => inputRef.current?.form?.requestSubmit())
  }

  const hasAny = sug && (sug.buildings.length + sug.addresses.length + sug.employees.length > 0)

  return (
    <div className="relative" ref={boxRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6] pointer-events-none" />
      <input
        ref={inputRef}
        name="q"
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => hasAny && setOpen(true)}
        placeholder="건물명, 주소, 담당자 검색"
        autoComplete="off"
        className="h-9 pl-8 pr-3 rounded-lg border border-[#d0ccf5] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-60"
      />

      {open && hasAny && (
        <div className="absolute top-10 left-0 z-40 w-80 bg-white rounded-xl border border-[#d0ccf5] shadow-xl py-2 max-h-80 overflow-y-auto">
          {sug!.buildings.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[10px] font-semibold text-[#b0acd6] uppercase flex items-center gap-1">
                <Building2 className="size-3" /> 건물명
              </p>
              {sug!.buildings.map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => applyAndSubmit(b)}
                  className="w-full text-left px-3 py-1.5 text-sm text-[#090c1d] hover:bg-[#f5f4ff] transition-colors truncate"
                >
                  {b}
                </button>
              ))}
            </div>
          )}
          {sug!.addresses.length > 0 && (
            <div>
              <p className="px-3 py-1 mt-1 text-[10px] font-semibold text-[#b0acd6] uppercase flex items-center gap-1">
                <MapPin className="size-3" /> 주소
              </p>
              {sug!.addresses.map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => applyAndSubmit(a)}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors truncate"
                >
                  {a}
                </button>
              ))}
            </div>
          )}
          {sug!.employees.length > 0 && (
            <div>
              <p className="px-3 py-1 mt-1 text-[10px] font-semibold text-[#b0acd6] uppercase flex items-center gap-1">
                <User className="size-3" /> 담당자
              </p>
              {sug!.employees.map(e => (
                <button
                  key={e.name}
                  type="button"
                  onClick={() => applyAndSubmit(e.name)}
                  className="w-full text-left px-3 py-1.5 text-sm text-[#090c1d] hover:bg-[#f5f4ff] transition-colors flex items-center justify-between"
                >
                  <span>{e.name}</span>
                  <span className="text-[10px] text-[#b0acd6]">{e.count}건</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
