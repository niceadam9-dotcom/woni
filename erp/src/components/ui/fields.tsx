'use client'

import { useEffect, type ReactNode } from 'react'

/** §11-4 입력 컴포넌트 공통 규칙 (P8) — 서식 화면 공용.
 *  단위 표시(NumField) · 숫자 키패드(inputMode) · 전화 자동 하이픈(PhoneField) ·
 *  month picker(MonthField, 'YYYY년 M월' 저장 형식 유지) · 표 모바일 가로 스크롤(TableWrap) ·
 *  미저장 이탈 경고(useUnsavedWarning — 브라우저 이탈, 탭 내 이동은 plan-tab-view 확인과 이중) */

const inputCls = 'h-8 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee] disabled:opacity-60'

/** 숫자 입력 + 단위 서픽스 — 모바일 숫자 키패드(inputMode) */
export function NumField({ value, onChange, unit, disabled, decimal = false, className = 'w-24', placeholder, id }: {
  value: string
  onChange: (v: string) => void
  unit?: string          // ㎡ · kW · 명 · 대 · 개소 · km · 분 …
  disabled?: boolean
  decimal?: boolean      // 소수 허용 (기본 정수)
  className?: string
  placeholder?: string
  id?: string
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input id={id} value={value} disabled={disabled} placeholder={placeholder}
        inputMode={decimal ? 'decimal' : 'numeric'}
        onChange={e => {
          const v = e.target.value.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, '')
          onChange(decimal ? v.replace(/(\..*)\./g, '$1') : v)
        }}
        className={`${inputCls} ${className}`} />
      {unit && <span className="text-[11px] text-[#847ba8] shrink-0">{unit}</span>}
    </span>
  )
}

/** 전화번호 자동 하이픈 — 02 지역·0507 안심·휴대전화 공통 */
export function formatPhoneKR(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length < 4) return d
  if (d.startsWith('02')) {
    if (d.length < 6) return `${d.slice(0, 2)}-${d.slice(2)}`
    if (d.length < 10) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`
  }
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`
  if (d.length < 11) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
}

export function PhoneField({ value, onChange, disabled, className = 'w-32', placeholder = '010-0000-0000', id }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  id?: string
}) {
  return (
    <input id={id} value={value} disabled={disabled} placeholder={placeholder} inputMode="tel"
      onChange={e => onChange(formatPhoneKR(e.target.value))}
      className={`${inputCls} ${className}`} />
  )
}

/** 연월 선택 — 표시·저장은 'YYYY년 M월'(서식·병합 형식), 입력은 네이티브 month picker */
export function MonthField({ value, onChange, disabled, className = 'w-36', id }: {
  value: string          // 'YYYY년 M월' | ''
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
  id?: string
}) {
  const m = value.match(/(\d{4})년\s*(\d{1,2})월/)
  const iso = m ? `${m[1]}-${m[2].padStart(2, '0')}` : ''
  return (
    <input id={id} type="month" value={iso} disabled={disabled}
      onChange={e => {
        const v = e.target.value // YYYY-MM | ''
        if (!v) { onChange(''); return }
        const [y, mm] = v.split('-')
        onChange(`${y}년 ${parseInt(mm, 10)}월`)
      }}
      className={`${inputCls} ${className}`} />
  )
}

/** 표 모바일 폴백 — 가로 스크롤 래퍼 (7-6: 카드형 대신 채택 — 열 구조 보존) */
export function TableWrap({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-x-auto -mx-1 px-1 ${className}`}>{children}</div>
}

/** §1-2 카드 앵커 점프 바 — 다카드 서식 상단 칩. 클릭 시 해당 카드로 스크롤 + URL 해시(#c-…) 동기화(딥링크 공유용) */
export function CardAnchorBar({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    <div className="flex items-center gap-1 flex-wrap mb-3">
      {items.map(it => (
        <button key={it.id} type="button"
          onClick={() => {
            document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            const url = new URL(window.location.href)
            url.hash = it.id
            window.history.replaceState(null, '', url.toString())
          }}
          className="inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-medium border bg-[#f5f4ff] text-[#7b68ee] border-[#d0ccf5] hover:bg-[#eceafd] transition-colors">
          {it.label}
        </button>
      ))}
    </div>
  )
}

/** 미저장 브라우저 이탈 경고 — dirty 동안 beforeunload (탭 내 이동 확인은 plan-tab-view가 담당) */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
