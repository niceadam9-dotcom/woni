'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { patchCustomerFieldAction, updateCustomerAction, previewAnchorChangeAction, type ConfirmedPlanItemInfo, type AnchorPreview } from '@/app/(dashboard)/customers/actions'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { ConfirmedDecisionDialog } from './confirmed-decision-dialog'
import { AnchorChangePreview } from './anchor-change-preview'
import type { InspectionType } from '@/types'

type Field = 'customer_name' | 'inspection_type' | 'contract_date' | 'use_approval_date' | 'plan_anchor_date' | 'assigned_employee_id'

interface Props {
  customerId: string
  field: Field
  value: string | null
  displayValue?: string
  employees?: Array<{ id: string; name: string }>
  /** 일반관리 자체점검 종류 — 점검유형 필드의 일반(종합)/일반(작동) 표시·편집용 (2026-08-05) */
  subType?: '종합' | '작동' | null
  /** RSC 직렬화를 위해 렌더 함수 대신 변형 이름으로 표시 방식 지정.
   *  'pencil-only': 값 표시 없이 연필 아이콘만 (고객명은 Link로 별도 표시 — §6-B-B2) */
  displayVariant?: 'name' | 'type-badge' | 'employee' | 'pencil-only'
  /** 값이 없을 때 '—' 대신 표시할 입력 유도 라벨 (빨간색 강조, 예: "미입력") */
  emptyLabel?: string
}

/** 관리유형 × 종류 4개 조합 — 상세 모달(EditInspectionTypeClient)과 동일 구조, 저장은 updateCustomerAction 공용 경로 */
const TYPE_COMBOS: Array<{ value: string; label: string; type: InspectionType; sub?: '종합' | '작동' }> = [
  { value: '종합',     label: '종합',       type: '종합' },
  { value: '작동',     label: '작동',       type: '작동' },
  { value: '일반종합', label: '일반(종합)', type: '일반관리', sub: '종합' },
  { value: '일반작동', label: '일반(작동)', type: '일반관리', sub: '작동' },
]

const TYPE_BADGE_COLORS: Record<string, string> = {
  '종합':   'bg-brand-tint text-brand',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

export function InlineCustomerFieldClient({
  customerId, field, value, displayValue, employees, subType, displayVariant, emptyLabel,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)
  // 기준일 변경 시 확정 일정 처리 선택 팝업(B안) — 저장 보류된 값과 확정 항목 목록
  const [confirmedDlg, setConfirmedDlg] = useState<ConfirmedPlanItemInfo[] | null>(null)
  const pendingValueRef = useRef<string | null>(null)
  /** 기산점·점검종류 변경 미리보기 — 전체 폼과 **같은 팝업**을 쓴다(화면마다 다르면 사용자가 혼란한다).
   *  `run`은 사용자가 확인했을 때 실제로 저장하는 절차다 — 무엇을 저장할지는 여는 쪽이 정한다. */
  const [preview, setPreview] = useState<
    { before: AnchorPreview; after: AnchorPreview; confirmedItems: ConfirmedPlanItemInfo[]; run: (d?: 'unconfirm' | 'keep') => void } | null
  >(null)

  useEffect(() => {
    if (editing) {
      setTimeout(() => (inputRef.current as HTMLElement | null)?.focus(), 0)
    }
  }, [editing])

  // 점검유형의 현재 조합값 — 일반관리는 종류(sub_type)까지 반영 (110 백필 기본 '작동')
  const typeComboValue = value === '일반관리' ? (subType === '종합' ? '일반종합' : '일반작동') : (value ?? '')

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft(field === 'inspection_type' ? typeComboValue : (value ?? ''))
    setEditing(true)
  }

  const isDateField = field === 'contract_date' || field === 'use_approval_date' || field === 'plan_anchor_date'

  // 점검유형 저장 — 상세 모달과 동일한 updateCustomerAction 경로 (종류 변경 전파 1-11 재사용)
  function handleSaveType() {
    const combo = TYPE_COMBOS.find(c => c.value === draft)
    if (!combo || combo.value === typeComboValue) { setEditing(false); return }
    const nextSub = combo.sub ?? (combo.type === '종합' ? '종합' : '작동')
    const doIt = () => startTransition(async () => {
      const res = await updateCustomerAction(customerId, {
        inspection_type: combo.type,
        ...(combo.sub ? { inspection_sub_type: combo.sub } : {}),
      })
      if (res.error) alert(res.error)
      setPreview(null); setEditing(false)
    })
    // 종류가 바뀌면 2차 유무·법정 달이 함께 바뀐다 — 저장 전에 보여준다
    startTransition(async () => {
      const p = await previewAnchorChangeAction(customerId, { inspection_sub_type: nextSub }).catch(() => null)
      if (!p?.before || !p.after) { doIt(); return }   // 미리보기 실패가 저장을 막지 않는다
      setPreview({ before: p.before, after: p.after, confirmedItems: p.confirmedItems ?? [], run: () => doIt() })
    })
  }

  function handleSave(e?: React.MouseEvent) {
    e?.stopPropagation()
    // 미리보기가 떠 있으면 포커스가 팝업으로 옮겨가며 입력칸 onBlur가 다시 이 함수를 부른다.
    // 막지 않으면 팝업이 뜬 채로 두 번째 저장이 시작된다.
    if (preview) return
    if (field === 'inspection_type') { handleSaveType(); return }
    const trimmed = draft.trim() || null
    if (trimmed === (value ?? null)) { setEditing(false); return }
    // 부분 입력된 날짜("2026-07")는 저장하지 않고 편집 종료 (원래 값 유지)
    if (isDateField && trimmed && !isCompleteDate(trimmed)) { setEditing(false); return }

    const doPatch = (decision?: 'unconfirm' | 'keep') => startTransition(async () => {
      const res = await patchCustomerFieldAction(customerId, field, trimmed, decision ? { confirmedDecision: decision } : undefined)
      // 미리보기를 거치지 않은 경로에서 서버가 확정 선택을 요구하면 기존 팝업으로 폴백
      if (res.requiresConfirmedDecision && res.confirmedItems) {
        pendingValueRef.current = trimmed
        setConfirmedDlg(res.confirmedItems)
        return
      }
      if (res.error) alert(res.error)
      setPreview(null); setEditing(false)
    })

    // 기산점 축(사용승인일·점검계획일)은 저장 전에 무엇이 되는지 보여준다 —
    // 전체 폼과 **같은 팝업**이라 어느 화면으로 고쳐도 같은 경험이 된다.
    if (field === 'use_approval_date' || field === 'plan_anchor_date') {
      startTransition(async () => {
        const p = await previewAnchorChangeAction(customerId, { [field]: trimmed }).catch(() => null)
        if (!p?.before || !p.after) { doPatch(); return }   // 미리보기 실패가 저장을 막지 않는다
        setPreview({ before: p.before, after: p.after, confirmedItems: p.confirmedItems ?? [], run: d => doPatch(d) })
      })
      return
    }
    doPatch()
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
        ? <span className="text-xs font-medium text-ink">{displayValue ?? '-'}</span>
        : <span className="text-xs text-red-500 font-medium">미배정</span>
    }
    if (value == null) {
      return emptyLabel
        ? <span className="text-xs text-red-500 font-medium">{emptyLabel}</span>
        : <span className="text-ink-meta italic text-xs">—</span>
    }
    if (displayVariant === 'name') {
      return <span className="font-medium text-ink">{value}</span>
    }
    if (displayVariant === 'type-badge') {
      return (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE_COLORS[value] ?? 'bg-gray-100 text-gray-600'}`}>
          {TYPE_COMBOS.find(c => c.value === typeComboValue)?.label ?? value}
        </span>
      )
    }
    return displayValue ?? value
  }

  if (!editing) {
    if (displayVariant === 'pencil-only') {
      return (
        <button
          onClick={handleEdit}
          title="수정"
          className="p-0.5 text-ink-meta opacity-0 group-hover:opacity-100 hover:text-brand transition-opacity shrink-0"
        >
          <Pencil className="size-3" />
        </button>
      )
    }
    return (
      <div
        data-testid={`inline-${field}`}
        className="flex items-center gap-1 group cursor-pointer"
        onClick={handleEdit}
        title="클릭하여 수정"
      >
        <span>{renderValue()}</span>
        <Pencil className="size-3 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    )
  }

  // 드롭다운도 텍스트 입력과 동일하게 Escape = 편집 취소 (저장 없이 종료)
  function handleSelectKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(field === 'inspection_type' ? typeComboValue : (value ?? ''))
      setEditing(false)
    }
  }

  /* 편집 분기가 셋(종류 select · 담당자 select · 텍스트/날짜)이라 팝업을 한 분기에만 두면
     나머지에선 setPreview가 되고도 **그릴 자리가 없어** 조용히 아무 일도 안 일어난다.
     실제로 종류 변경이 그렇게 막혀 있었다 — 그래서 자리를 한 군데로 모아 셋 다 붙인다. */
  const dialogs = (
    <>
      {/* 기산점·종류 변경 미리보기 — 전체 폼과 같은 팝업. 확정 일정 선택까지 여기서 함께 한다 */}
      {preview && (
        <AnchorChangePreview
          before={preview.before}
          after={preview.after}
          confirmedItems={preview.confirmedItems}
          isPending={isPending}
          onConfirm={d => preview.run(d)}
          onCancel={() => { setPreview(null); setEditing(false) }}
        />
      )}
      {/* 미리보기를 못 띄운 경로의 폴백 */}
      {confirmedDlg && (
        <ConfirmedDecisionDialog
          items={confirmedDlg}
          isPending={isPending}
          onDecide={handleConfirmedDecision}
          onCancel={() => { setConfirmedDlg(null); setEditing(false) }}
        />
      )}
    </>
  )

  if (field === 'inspection_type') {
    return (
      <div data-testid="inline-inspection_type-edit" className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        {dialogs}
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={e => { setDraft(e.target.value); }}
          onKeyDown={handleSelectKeyDown}
          onBlur={() => handleSave()}
          disabled={isPending}
          className="h-7 px-1 text-xs border border-brand rounded outline-none bg-surface"
        >
          {TYPE_COMBOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    )
  }

  if (field === 'assigned_employee_id') {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        {dialogs}
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleSelectKeyDown}
          onBlur={() => handleSave()}
          disabled={isPending}
          className="h-7 px-1 text-xs border border-brand rounded outline-none bg-surface max-w-[120px]"
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
    <div data-testid={`inline-${field}-edit`} className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <InputComp
        ref={inputRef as React.RefObject<HTMLInputElement>}
        {...(isDateField ? {} : { type: 'text' })}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => handleSave()}
        disabled={isPending}
        className="h-7 px-1.5 text-xs border border-brand rounded outline-none bg-surface min-w-0 w-32"
      />
      <button
        data-testid="inline-save"
        title="저장"
        onMouseDown={e => { e.preventDefault(); handleSave(e) }}
        disabled={isPending}
        className="p-0.5 text-green-600 hover:text-green-700 disabled:opacity-40"
      >
        <Check className="size-3.5" />
      </button>
      <button
        data-testid="inline-cancel"
        title="취소"
        onMouseDown={e => { e.preventDefault(); handleCancel(e) }}
        className="p-0.5 text-ink-meta hover:text-red-500"
      >
        <X className="size-3.5" />
      </button>
      {dialogs}
    </div>
  )
}
