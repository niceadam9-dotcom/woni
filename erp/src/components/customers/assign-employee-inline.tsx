'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { assignEmployeeAction } from '@/app/(dashboard)/customers/actions'
import { assigneeLabel } from '@/lib/default-assignee'

/** 담당 인라인 배정 (설계 §11-3) — 모달 없이 드롭다운 선택 즉시 저장(배정 알림 유지).
 *  미배정이면 빨간 강조 — 지역 추천 [원클릭 배정](§6-E-info-2)과 병행. */
export function AssignEmployeeInline({ customerId, currentEmployeeId, assignedSource, employees, canAssign, fill }: {
  customerId: string
  currentEmployeeId: string | null
  /** 'default'면 「(기본)」 — 사람이 고른 배정과 구분한다(2026-09-15) */
  assignedSource?: string | null
  employees: Array<{ id: string; name: string; position: string | null }>
  canAssign: boolean
  /** 격자 칸을 **꽉 채운다**(칸 폭 전체·옆 칸과 같은 높이 h-12) — 기본정보 그룹 상자 첫 줄용(2026-09-23) */
  fill?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState('')
  const unassigned = !currentEmployeeId
  const current = employees.find(e => e.id === currentEmployeeId)

  if (!canAssign) {
    return current ? (
      <p className={`text-form-base font-semibold text-ink ${fill ? 'h-12 flex items-center' : ''}`}>
        {assigneeLabel(current.name, assignedSource)}
        {current.position && <span className="text-form-sm text-ink-meta font-normal ml-1.5">({current.position})</span>}
      </p>
    ) : (
      <p className={`text-form-base font-semibold text-red-500 ${fill ? 'h-12 flex items-center' : ''}`}>미배정</p>
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
    <span className={fill ? 'flex w-full items-center gap-2' : 'inline-flex items-center gap-2'}>
      <select
        value={currentEmployeeId ?? ''}
        onChange={e => change(e.target.value)}
        disabled={isPending}
        aria-label="담당직원"
        // 「선택 즉시 저장 · 배정 알림 발송」 — 칸 옆 글씨였는데 격자 칸 안에서 한 글자씩 꺾여 산만했다
        // (2026-09-23 사용자 지적). 알아야 할 사실이라 지우지 않고 **툴팁**으로 옮겼다.
        title="선택 즉시 저장 · 배정 알림 발송"
        className={`rounded-lg border bg-surface px-2 text-form-base outline-none focus:border-brand ${
          fill ? 'h-12 flex-1 min-w-0' : 'h-form-8 min-w-[150px]'} ${
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
          className="shrink-0 whitespace-nowrap rounded-md border border-brand-line bg-brand-tint px-1.5 py-0.5 text-form-2xs text-ink-sub">
          기본
        </span>
      )}
      {err && <span className="text-form-xs text-red-500">{err}</span>}
    </span>
  )
}
