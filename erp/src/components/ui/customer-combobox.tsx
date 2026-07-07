'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ComboboxCustomer = {
  id: string
  customer_name: string
  customer_code: string
  [key: string]: unknown
}

interface CustomerComboboxProps {
  customers: ComboboxCustomer[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  renderSub?: (c: ComboboxCustomer) => string
}

export function CustomerCombobox({
  customers,
  value,
  onChange,
  placeholder = '고객사명 또는 코드 입력',
  className,
  renderSub,
}: CustomerComboboxProps) {
  const selected = customers.find(c => c.id === value) ?? null
  const [query, setQuery] = useState(selected?.customer_name ?? '')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 선택값 변경 시 query 동기화
  useEffect(() => {
    setQuery(selected?.customer_name ?? '')
  }, [selected])

  // 키보드 이동 시 활성 항목을 뷰포트 안으로 스크롤
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll<HTMLElement>('[data-item]')
    items[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const filtered = query.trim()
    ? customers.filter(c =>
        c.customer_name.toLowerCase().includes(query.toLowerCase()) ||
        c.customer_code.toLowerCase().includes(query.toLowerCase())
      )
    : customers

  function selectItem(c: ComboboxCustomer) {
    onChange(c.id)
    setQuery(c.customer_name)
    setOpen(false)
    setActiveIndex(-1)
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setOpen(false)
    setActiveIndex(-1)
    inputRef.current?.focus()
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setOpen(true)
    setActiveIndex(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 드롭다운 닫혀 있을 때 방향키로 열기
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setOpen(true)
      setActiveIndex(0)
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(i => (i + 1) % filtered.length)
        break

      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(i => (i <= 0 ? filtered.length - 1 : i - 1))
        break

      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0 && filtered[activeIndex]) {
          selectItem(filtered[activeIndex])
        }
        break

      case 'Tab':
        // 활성 항목이 있으면 선택 후 포커스 이동 허용 (preventDefault 없음)
        if (activeIndex >= 0 && filtered[activeIndex]) {
          selectItem(filtered[activeIndex])
        } else {
          setOpen(false)
          setActiveIndex(-1)
        }
        break

      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setActiveIndex(-1)
        setQuery(selected?.customer_name ?? '')
        break
    }
  }

  const sub = renderSub ?? ((c: ComboboxCustomer) => c.customer_code)

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6] pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white pl-8 pr-14 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && (
            <button type="button" onClick={clear} className="p-1 rounded hover:bg-gray-100">
              <X className="size-3 text-[#b0acd6]" />
            </button>
          )}
          <ChevronDown className={cn('size-3.5 text-[#b0acd6] transition-transform duration-150', open && 'rotate-180')} />
        </div>
      </div>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-white border border-[#d0ccf5] rounded-lg shadow-lg max-h-56 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-3 text-xs text-gray-400 text-center">검색 결과 없음</li>
          ) : (
            filtered.map((c, idx) => {
              const isActive   = idx === activeIndex
              const isSelected = c.id === value && !isActive
              return (
                <li
                  key={c.id}
                  data-item
                  role="option"
                  aria-selected={c.id === value}
                  onMouseDown={() => selectItem(c)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={cn(
                    'px-3 py-2.5 cursor-pointer text-sm flex items-center justify-between select-none',
                    isActive   && 'bg-[#7b68ee] text-white',
                    isSelected && 'bg-[#f5f4ff] text-[#7b68ee] font-medium',
                    !isActive && !isSelected && 'text-[#090c1d] hover:bg-[#f5f4ff]'
                  )}
                >
                  <span>{c.customer_name}</span>
                  <span className={cn('text-xs ml-2 shrink-0', isActive ? 'text-white/70' : 'text-[#b0acd6]')}>
                    {sub(c)}
                  </span>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
