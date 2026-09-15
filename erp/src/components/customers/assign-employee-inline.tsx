'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { assignEmployeeAction } from '@/app/(dashboard)/customers/actions'
import { assigneeLabel } from '@/lib/default-assignee'

/** 담당 인라인 배정 (설계 §11-3) — 모달 없이 드롭다운 선택 즉시 저장(배정 알림 유지).
 *  미배정이면 빨간 강조 — 지역 추천 [원클릭 배정](§6-E-info-2)과 병행. */
export function AssignEmployeeInline({ customerId, currentEmployeeId, assignedSource, employees, canAssign }: {
  customerId: string
  currentEmployeeId: string | null
  /** 'default'면 「(기본)」 — 사람이 고른 배정과 구분한다(2026-09-15) */
  assignedSource?: string | null
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
      <p className="text-form-base font-semibold text-ink">
        {assigneeLabel(current.name, assignedSource)}
        {current.position && <span className="text-form-sm text-ink-meta font-normal ml-1.5">({current.position})</span>}
      </p>
    ) : (
      <p className="text-form-base font-semibold text-red-500">미배정</p>
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
        className={`h-form-8 rounded-lg border bg-surface px-2 text-form-base outline-none focus:border-brand min-w-[150px] ${
          unassigned ? 'border-red-300 text-red-500 font-medium' : 'border-brand-line text-ink'}`}
      >
        <option value="">미배정</option>
        {employees.map(e => (
          <option key={e.id} value={e.id}>{e.name}{e.position ? ` (${e.position})` : ''}</option>
        ))}
      </select>
      {isPending && <Loader2 className="size-3.5 animate-spin text-brand" />}
      {/* 🚨 읽기 전용 표시에만 「(기본)」을 붙이면 **관리자는 영영 못 본다** — 배정 권한이 있으면
          드롭다운이 그려지기 때문이다. 정작 정식 배정으로 바꿔야 할 사람이 그 사람이다. */}
      {assignedSource === 'default' && currentEmployeeId && (
        <span data-testid="assign-default-badge"
          title="기본 담당자로 자동 채워진 배정입니다 — 실제 담당자를 고르면 정식 배정으로 바뀝니다"
          className="rounded-md border border-brand-line bg-brand-tint px-1.5 py-0.5 text-form-2xs text-ink-sub">
          기본
        </span>
      )}
      {/* 12px 계층은 ink-meta(5.03:1)를 쓰지 않는다 — 크기가 작을수록 대비가 필요하다 */}
      <span className="text-form-2xs text-ink-sub">선택 즉시 저장 · 배정 알림 발송</span>
      {err && <span className="text-form-xs text-red-500">{err}</span>}
    </span>
  )
}
