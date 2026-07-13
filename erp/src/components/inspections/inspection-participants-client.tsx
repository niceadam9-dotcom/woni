'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, X, Users, Loader2 } from 'lucide-react'
import { addAuxParticipantAction, removeParticipantAction } from '@/app/(dashboard)/inspections/actions'

type Employee = { id: string; name: string; position: string | null; license_no?: string | null }
type Participant = { id: string; employee_id: string | null; name: string; license_no: string | null }

/** 점검 참여자 (P31-2) — 주된 인력(담당) + 보조 인력. 보고서 개요에 인쇄. */
export function InspectionParticipantsClient({
  inspectionId, mainEmployee, aux, employees, canManage,
}: {
  inspectionId: string
  mainEmployee: { name: string; license_no: string | null } | null
  aux: Participant[]
  employees: Employee[]
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pick, setPick] = useState('')
  const [error, setError] = useState('')

  const usedIds = new Set([...aux.map(a => a.employee_id).filter(Boolean)] as string[])
  const options = employees.filter(e => !usedIds.has(e.id))

  function add() {
    if (!pick) return
    setError('')
    startTransition(async () => {
      const res = await addAuxParticipantAction(inspectionId, pick)
      if (res.error) { setError(res.error); return }
      setPick(''); router.refresh()
    })
  }
  function remove(id: string) {
    startTransition(async () => {
      const res = await removeParticipantAction(id, inspectionId)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <Users className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">점검 참여자</h2>
        <span className="text-xs text-[#b0acd6] ml-auto">보고서 개요에 인쇄</span>
      </div>

      <div className="flex items-center gap-2 py-2 border-b border-[#f0eefb]">
        <span className="text-xs font-semibold text-[#7b68ee] w-14 shrink-0">주된</span>
        <span className="text-sm text-[#090c1d]">{mainEmployee?.name ?? '미배정'}</span>
        {mainEmployee?.license_no && <span className="text-xs text-[#b0acd6]">({mainEmployee.license_no})</span>}
      </div>

      {aux.map(p => (
        <div key={p.id} className="flex items-center gap-2 py-2 border-b border-[#f8f9fa]">
          <span className="text-xs font-medium text-[#514b81] w-14 shrink-0">보조</span>
          <span className="text-sm text-[#090c1d]">{p.name}</span>
          {p.license_no && <span className="text-xs text-[#b0acd6]">({p.license_no})</span>}
          {!p.license_no && <span className="text-[11px] text-amber-500">경력수첩번호 없음</span>}
          {canManage && (
            <button onClick={() => remove(p.id)} disabled={isPending}
              className="ml-auto p-1 text-[#b0acd6] hover:text-red-500 transition-colors disabled:opacity-40">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}

      {canManage && (
        <div className="flex items-center gap-2 mt-3">
          <select value={pick} onChange={e => setPick(e.target.value)}
            className="flex-1 h-9 rounded-lg border border-[#d0ccf5] bg-white px-2 text-sm outline-none focus:border-[#7b68ee]">
            <option value="">보조 인력 추가…</option>
            {options.map(e => <option key={e.id} value={e.id}>{e.name}{e.position ? ` (${e.position})` : ''}</option>)}
          </select>
          <button onClick={add} disabled={!pick || isPending}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />} 추가
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
