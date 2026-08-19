'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/** 목록 제안 + 자유 입력 콤보 — `<input list>` + `<datalist>` 대체.
 *
 *  왜 datalist를 버리나(2026-08-19 사용자 보고): 브라우저 기본 datalist는 **타이핑을 시작해야**
 *  제안이 뜬다. 칸을 눌러도 아무것도 안 보이니 "선택하거나 직접 입력"이라는 안내가 거짓말이 됐고,
 *  사용자는 목록이 있는 줄도 몰랐다. 여기서는 **누르면 전체 목록이 펼쳐지고** 타이핑하면 걸러진다.
 *
 *  ⚠ 목록에 없는 값도 그대로 쓴다 — 강제 선택(select)으로 바꾸면 안 된다.
 *  건축물대장이 목록에 없는 용도를 넣는 경우가 있어 강제하면 값이 잘린다(buildings.purpose는 자유 TEXT).
 *  그래서 '선택'은 어디까지나 입력 보조이고, 원천은 입력칸의 문자열이다. */
export function ComboInput({
  value, onChange, options, placeholder, className, id, disabled, ariaLabel, emptyHint,
}: {
  value: string
  onChange: (v: string) => void
  /** 제안 목록. 비면 평범한 자유 입력칸처럼 동작한다(펼침 버튼도 숨긴다) */
  options: string[]
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
  ariaLabel?: string
  /** 걸러진 결과가 0건일 때 보여줄 안내 — '그래도 이 값으로 저장된다'를 알린다 */
  emptyHint?: string
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  // 입력값이 이미 목록의 한 항목과 같으면 **전체**를 보여준다 — 그래야 다른 값으로 바꿀 수 있다.
  // (여기서 걸러 버리면 선택 직후 목록이 1건으로 쪼그라들어 갈아타기가 막힌다)
  const q = value.trim().toLowerCase()
  const exact = options.some(o => o.toLowerCase() === q)
  const filtered = !q || exact ? options : options.filter(o => o.toLowerCase().includes(q))

  // 바깥을 누르면 닫는다. mousedown으로 잡아야 blur→클릭 순서 문제에 걸리지 않는다
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  useEffect(() => { if (!open) setHi(-1) }, [open])

  function pick(v: string) {
    onChange(v)
    setOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (options.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); setHi(0); return }
      setHi(i => (i + 1) % Math.max(filtered.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return
      setHi(i => (i <= 0 ? filtered.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      // 목록에서 고르는 중일 때만 가로챈다 — 그냥 타이핑 중이면 폼 제출을 막지 않는다
      if (open && hi >= 0 && filtered[hi]) { e.preventDefault(); pick(filtered[hi]) }
    } else if (e.key === 'Escape') {
      // 열려 있을 때만 삼킨다 — 닫힌 상태의 ESC는 바깥(모달 등)이 쓰게 둔다
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full" data-combo-input>
      <input
        ref={inputRef}
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={e => { onChange(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { if (options.length > 0) setOpen(true) }}
        onClick={() => { if (options.length > 0) setOpen(true) }}
        onKeyDown={onKeyDown}
        className={options.length > 0 ? `${className ?? ''} pr-7` : className}
      />
      {options.length > 0 && !disabled && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="목록 열기"
          data-combo-toggle
          // mousedown 기본동작 차단 — 입력 포커스를 잃지 않고 토글만 한다
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o); inputRef.current?.focus() }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[#b0acd6] transition-colors hover:text-[#7b68ee]"
        >
          <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          data-combo-list
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[#d0ccf5] bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-2.5 py-1.5 text-[11px] text-[#b0acd6]">
              {emptyHint ?? '목록에 없는 값입니다 — 입력한 그대로 저장됩니다.'}
            </li>
          ) : filtered.map((o, i) => (
            <li key={o}>
              <button
                type="button"
                role="option"
                aria-selected={o === value}
                data-combo-option
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(o)}
                onMouseEnter={() => setHi(i)}
                className={`block w-full px-2.5 py-1.5 text-left text-xs transition-colors ${
                  i === hi ? 'bg-[#f5f4ff] text-[#7b68ee]' : 'text-[#514b81] hover:bg-[#f5f4ff]'
                } ${o === value ? 'font-semibold' : ''}`}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
