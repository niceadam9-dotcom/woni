'use client'

import * as React from 'react'

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

/** 전사 공용 날짜 입력 — 표시·입력 형식을 YYYY-MM-DD로 고정.
 *  숫자만 쳐도(20260714) 하이픈이 자동 삽입되고, 붙여넣기(2026.07.14 등)도 숫자만 추려 변환.
 *  기존 <input type="date">의 onChange(e.target.value) 계약을 그대로 유지하므로 드롭인 교체 가능. */
export function DateInput({ onChange, className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const value = typeof props.value === 'string' ? props.value : ''
  const incomplete = value !== '' && !COMPLETE_RE.test(value)
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="YYYY-MM-DD"
      maxLength={10}
      pattern="\d{4}-\d{2}-\d{2}"
      title="YYYY-MM-DD 형식 (숫자만 입력해도 됩니다)"
      {...props}
      className={`${className ?? ''}${incomplete ? ' !border-red-400' : ''}`}
      onChange={e => {
        e.target.value = formatDateDigits(e.target.value)
        onChange?.(e)
      }}
    />
  )
}
