'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { assignEmployeeAction } from '@/app/(dashboard)/customers/actions'

/** 담당 인라인 배정 (설계 §11-3) — 모달 없이 드롭다운 선택 즉시 저장(배정 알림 유지).
 *  미배정이면 빨간 강조 — 지역 추천 [원클릭 배정](§6-E-info-2)과 병행. */
export function AssignEmployeeInline({ customerId, currentEmployeeId, employees, canAssign }: {
  customerId: string
  currentEmployeeId: string | null
  employees: Array<{ id: string; name: string; position: string | null }>
  canAssign: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState('')
  const unassigned = !currentEmployeeId
  const current = employees.find(e => e.id === currentEmployeeId)

  if (!canAssign) {
    return current ? (
      <p className="text-sm font-semibold text-[#090c1d]">
        {current.name}
        {current.position && <span className="text-xs text-[#b0acd6] font-normal ml-1.5">({current.position})</span>}
      </p>
    ) : (
      <p className="text-sm font-semibold text-red-500">미배정</p>
    )
  }

  function change(v: string) {
    setErr('')
    startTransition(async () => {
      const res = await assignEmployeeAction(customerId, v || null)
      if (res.error) { setErr(res.error); return }
      router.refresh()
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={currentEmployeeId ?? ''}
        onChange={e => change(e.target.value)}
        disabled={isPending}
        className={`h-8 rounded-lg border bg-white px-2 text-sm outline-none focus:border-[#7b68ee] min-w-[150px] ${
          unassigned ? 'border-red-300 text-red-500 font-medium' : 'border-[#d0ccf5] text-[#090c1d]'}`}
      >
        <option value="">미배정</option>
        {employees.map(e => (
          <option key={e.id} value={e.id}>{e.name}{e.position ? ` (${e.position})` : ''}</option>
        ))}
      </select>
      {isPending && <Loader2 className="size-3.5 animate-spin text-[#7b68ee]" />}
      <span className="text-[10px] text-[#b0acd6]">선택 즉시 저장 · 배정 알림 발송</span>
      {err && <span className="text-[11px] text-red-500">{err}</span>}
    </span>
  )
}
