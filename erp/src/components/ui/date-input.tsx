'use client'

import * as React from 'react'
import { Calendar } from 'lucide-react'

/** 숫자 나열을 YYYY-MM-DD로 자동 포맷 — "20260714" → "2026-07-14", 부분 입력도 진행형으로 하이픈 삽입 */
export function formatDateDigits(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 4) return d
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
}

const COMPLETE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 완성된 YYYY-MM-DD인지 — 제출 전 검증용 (부분 입력 "2026-07" 차단) */
export function isCompleteDate(v: string): boolean {
  return COMPLETE_RE.test(v)
}

// 호출부 className 중 레이아웃 담당 토큰은 래퍼로 올리고, 나머지(테두리·패딩·글꼴)는 입력에 유지
const LAYOUT_RE = /^(w-|min-w-|max-w-|flex-1|flex-auto|flex-none|grow|shrink|basis-|col-span-)/

/** 전사 공용 날짜 입력 — 표시·입력 형식을 YYYY-MM-DD로 고정.
 *  숫자만 쳐도(20260714) 하이픈이 자동 삽입되고, 붙여넣기(2026.07.14 등)도 숫자만 추려 변환.
 *  오른쪽 달력 버튼으로 네이티브 달력 팝업(showPicker)도 사용 가능.
 *  기존 <input type="date">의 onChange(e.target.value) 계약을 그대로 유지하므로 드롭인 교체 가능. */
export function DateInput({ onChange, className, disabled, ref, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const textRef = React.useRef<HTMLInputElement | null>(null)
  const pickerRef = React.useRef<HTMLInputElement>(null)
  const value = typeof props.value === 'string' ? props.value : ''
  const incomplete = value !== '' && !COMPLETE_RE.test(value)

  const tokens = (className ?? '').split(/\s+/).filter(Boolean)
  const layoutCls = tokens.filter(t => LAYOUT_RE.test(t)).join(' ')
  const innerCls = tokens.filter(t => !LAYOUT_RE.test(t)).join(' ')

  function setRefs(el: HTMLInputElement | null) {
    textRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = el
  }

  function openPicker() {
    const p = pickerRef.current
    if (!p) return
    const current = props.value === undefined ? (textRef.current?.value ?? '') : value
    p.value = COMPLETE_RE.test(current) ? current : ''
    if (typeof p.showPicker === 'function') p.showPicker()
    else { p.focus(); p.click() }
  }

  return (
    <span className={`relative inline-flex items-center align-middle ${layoutCls}`}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        maxLength={10}
        pattern="\d{4}-\d{2}-\d{2}"
        title="YYYY-MM-DD 형식 (숫자만 입력해도 됩니다)"
        disabled={disabled}
        {...props}
        ref={setRefs}
        className={`${innerCls} w-full pr-7${incomplete ? ' !border-red-400' : ''}`}
        onChange={e => {
          e.target.value = formatDateDigits(e.target.value)
          onChange?.(e)
        }}
      />
      {!disabled && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="달력에서 선택"
          // mousedown 기본동작 차단 — 텍스트 입력의 blur(저장) 트리거 없이 팝업 열기
          onMouseDown={e => e.preventDefault()}
          onClick={openPicker}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[#b0acd6] hover:text-[#7b68ee] transition-colors"
        >
          <Calendar className="size-3.5" />
        </button>
      )}
      {/* 달력 팝업 전용 히든 date 입력 — 선택값은 동일한 onChange 계약(e.target.value)으로 전달 */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        name={props.name}
        onChange={e => {
          if (!e.target.value) return
          // 비제어 사용(react-hook-form register 등) 시 텍스트 입력 표시도 동기화
          if (props.value === undefined && textRef.current) textRef.current.value = e.target.value
          onChange?.(e)
        }}
        className="absolute right-0 bottom-0 h-0 w-0 p-0 border-0 opacity-0 pointer-events-none"
      />
    </span>
  )
}
