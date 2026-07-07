'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { patchCustomerFieldAction } from '@/app/(dashboard)/customers/actions'
import type { InspectionType } from '@/types'

type Field = 'customer_name' | 'inspection_type' | 'contract_date' | 'use_approval_date' | 'assigned_employee_id'

interface Props {
  customerId: string
  field: Field
  value: string | null
  displayValue?: string
  employees?: Array<{ id: string; name: string }>
  renderDisplay?: (v: string | null) => React.ReactNode
}

const INSPECTION_TYPES: InspectionType[] = ['종합', '작동', '일반관리']

export function InlineCustomerFieldClient({
  customerId, field, value, displayValue, employees, renderDisplay,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  useEffect(() => {
    if (editing) {
      setTimeout(() => (inputRef.current as HTMLElement | null)?.focus(), 0)
    }
  }, [editing])

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft(value ?? '')
    setEditing(true)
  }

  function handleSave(e?: React.MouseEvent) {
    e?.stopPropagation()
    const trimmed = draft.trim() || null
    if (trimmed === (value ?? null)) { setEditing(false); return }
    startTransition(async () => {
      const res = await patchCustomerFieldAction(customerId, field, trimmed)
      if (res.error) alert(res.error)
      setEditing(false)
    })
  }

  function handleCancel(e: React.MouseEvent) {
    e.stopPropagation()
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') { setEditing(false) }
  }

  if (!editing) {
    return (
      <div
        className="flex items-center gap-1 group cursor-pointer"
        onClick={handleEdit}
        title="클릭하여 수정"
      >
        <span>{renderDisplay ? renderDisplay(value) : (displayValue ?? value ?? <span className="text-[#b0acd6] italic text-xs">—</span>)}</span>
        <Pencil className="size-3 text-[#b0acd6] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    )
  }

  if (field === 'inspection_type') {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={e => { setDraft(e.target.value); }}
          onBlur={() => handleSave()}
          disabled={isPending}
          className="h-7 px-1 text-xs border border-[#7b68ee] rounded outline-none bg-white"
        >
          {INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    )
  }

  if (field === 'assigned_employee_id') {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => handleSave()}
          disabled={isPending}
          className="h-7 px-1 text-xs border border-[#7b68ee] rounded outline-none bg-white max-w-[120px]"
        >
          <option value="">미배정</option>
          {(employees ?? []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
    )
  }

  // text / date inputs
  const inputType =
    field === 'contract_date' || field === 'use_approval_date' ? 'date' : 'text'

  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={inputType}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => handleSave()}
        disabled={isPending}
        className="h-7 px-1.5 text-xs border border-[#7b68ee] rounded outline-none bg-white min-w-0 w-32"
      />
      <button
        onMouseDown={e => { e.preventDefault(); handleSave(e) }}
        disabled={isPending}
        className="p-0.5 text-green-600 hover:text-green-700 disabled:opacity-40"
      >
        <Check className="size-3.5" />
      </button>
      <button
        onMouseDown={e => { e.preventDefault(); handleCancel(e) }}
        className="p-0.5 text-[#b0acd6] hover:text-red-500"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
