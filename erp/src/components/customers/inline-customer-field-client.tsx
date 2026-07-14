'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { patchCustomerFieldAction, type ConfirmedPlanItemInfo } from '@/app/(dashboard)/customers/actions'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { ConfirmedDecisionDialog } from './confirmed-decision-dialog'
import type { InspectionType } from '@/types'
import { inspectionTypeLabel } from '@/types'

type Field = 'customer_name' | 'inspection_type' | 'contract_date' | 'use_approval_date' | 'plan_anchor_date' | 'assigned_employee_id'

interface Props {
  customerId: string
  field: Field
  value: string | null
  displayValue?: string
  employees?: Array<{ id: string; name: string }>
  /** RSC 직렬화를 위해 렌더 함수 대신 변형 이름으로 표시 방식 지정 */
  displayVariant?: 'name' | 'type-badge' | 'employee'
  /** 값이 없을 때 '—' 대신 표시할 입력 유도 라벨 (빨간색 강조, 예: "미입력") */
  emptyLabel?: string
}

const INSPECTION_TYPES: InspectionType[] = ['종합', '작동', '일반관리']

const TYPE_BADGE_COLORS: Record<string, string> = {
  '종합':   'bg-[#f5f4ff] text-[#7b68ee]',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

export function InlineCustomerFieldClient({
  customerId, field, value, displayValue, employees, displayVariant, emptyLabel,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)
  // 기준일 변경 시 확정 일정 처리 선택 팝업(B안) — 저장 보류된 값과 확정 항목 목록
  const [confirmedDlg, setConfirmedDlg] = useState<ConfirmedPlanItemInfo[] | null>(null)
  const pendingValueRef = useRef<string | null>(null)

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

  const isDateField = field === 'contract_date' || field === 'use_approval_date' || field === 'plan_anchor_date'

  function handleSave(e?: React.MouseEvent) {
    e?.stopPropagation()
    const trimmed = draft.trim() || null
    if (trimmed === (value ?? null)) { setEditing(false); return }
    // 부분 입력된 날짜("2026-07")는 저장하지 않고 편집 종료 (원래 값 유지)
    if (isDateField && trimmed && !isCompleteDate(trimmed)) { setEditing(false); return }
    startTransition(async () => {
      const res = await patchCustomerFieldAction(customerId, field, trimmed)
      // 확정 일정 보유 고객의 기준일 변경 — 아직 저장 안 됨, 사용자 선택 팝업 표시
      if (res.requiresConfirmedDecision && res.confirmedItems) {
        pendingValueRef.current = trimmed
        setConfirmedDlg(res.confirmedItems)
        return
      }
      if (res.error) alert(res.error)
      setEditing(false)
    })
  }

  function handleConfirmedDecision(decision: 'unconfirm' | 'keep') {
    startTransition(async () => {
      const res = await patchCustomerFieldAction(customerId, field, pendingValueRef.current, { confirmedDecision: decision })
      if (res.error) alert(res.error)
      setConfirmedDlg(null)
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

  function renderValue(): React.ReactNode {
    if (displayVariant === 'employee') {
      return value
        ? <span className="text-xs font-medium text-[#090c1d]">{displayValue ?? '-'}</span>
        : <span className="text-xs text-red-500 font-medium">미배정</span>
    }
    if (value == null) {
      return emptyLabel
        ? <span className="text-xs text-red-500 font-medium">{emptyLabel}</span>
        : <span className="text-[#b0acd6] italic text-xs">—</span>
    }
    if (displayVariant === 'name') {
      return <span className="font-medium text-[#090c1d]">{value}</span>
    }
    if (displayVariant === 'type-badge') {
      return (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE_COLORS[value] ?? 'bg-gray-100 text-gray-600'}`}>
          {inspectionTypeLabel(value)}
        </span>
      )
    }
    return displayValue ?? value
  }

  if (!editing) {
    return (
      <div
        className="flex items-center gap-1 group cursor-pointer"
        onClick={handleEdit}
        title="클릭하여 수정"
      >
        <span>{renderValue()}</span>
        <Pencil className="size-3 text-[#b0acd6] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    )
  }

  // 드롭다운도 텍스트 입력과 동일하게 Escape = 편집 취소 (저장 없이 종료)
  function handleSelectKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); setDraft(value ?? ''); setEditing(false) }
  }

  if (field === 'inspection_type') {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={e => { setDraft(e.target.value); }}
          onKeyDown={handleSelectKeyDown}
          onBlur={() => handleSave()}
          disabled={isPending}
          className="h-7 px-1 text-xs border border-[#7b68ee] rounded outline-none bg-white"
        >
          {INSPECTION_TYPES.map(t => <option key={t} value={t}>{inspectionTypeLabel(t)}</option>)}
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
          onKeyDown={handleSelectKeyDown}
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
  const InputComp = isDateField ? DateInput : 'input'

  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <InputComp
        ref={inputRef as React.RefObject<HTMLInputElement>}
        {...(isDateField ? {} : { type: 'text' })}
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
      {confirmedDlg && (
        <ConfirmedDecisionDialog
          items={confirmedDlg}
          isPending={isPending}
          onDecide={handleConfirmedDecision}
          onCancel={() => { setConfirmedDlg(null); setEditing(false) }}
        />
      )}
    </div>
  )
}
