'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserCheck, X, Loader2, ChevronDown } from 'lucide-react'
import { assignEmployeeAction } from '@/app/(dashboard)/customers/actions'

type Employee = { id: string; name: string; position: string | null }

type Props = {
  customerId: string
  customerName: string
  currentEmployeeId: string | null
  employees: Employee[]
}

export function AssignEmployeeClient({ customerId, customerName, currentEmployeeId, employees }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(currentEmployeeId ?? '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const current = employees.find(e => e.id === currentEmployeeId)

  function handleSave() {
    setError('')
    startTransition(async () => {
      const result = await assignEmployeeAction(customerId, selected || null)
      if (result.error) { setError(result.error); return }
      router.refresh()
      setOpen(false)
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
      >
        <UserCheck className="size-3.5" />
        {currentEmployeeId ? '담당자 변경' : '담당자 배정'}
        <ChevronDown className="size-3" />
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#c8c4d0]">
              <h2 className="text-base font-semibold text-[#090c1d]">담당직원 배정</h2>
              <button onClick={() => setOpen(false)} className="text-[#514b81] hover:text-[#090c1d]">
                <X className="size-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-xs text-[#514b81]">
                <span className="font-medium text-[#090c1d]">{customerName}</span> 고객의 담당직원을 설정합니다.
              </p>

              {current && (
                <div className="flex items-center gap-2 bg-[#f5f4ff] rounded-lg px-3 py-2.5">
                  <UserCheck className="size-3.5 text-[#7b68ee] shrink-0" />
                  <div className="text-xs">
                    <span className="text-[#514b81]">현재 담당자: </span>
                    <span className="font-medium text-[#090c1d]">{current.name}</span>
                    {current.position && <span className="text-[#b0acd6]"> ({current.position})</span>}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#514b81]">담당직원 선택</label>
                <select
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                  className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition"
                >
                  <option value="">배정 안함</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name}{e.position ? ` (${e.position})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selected && selected !== currentEmployeeId && (
                <p className="text-xs text-[#514b81] bg-[#f8f9fa] rounded-lg px-3 py-2">
                  저장 시 해당 직원에게 배정 알림이 발송됩니다.
                </p>
              )}

              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-[#c8c4d0]">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={isPending || selected === currentEmployeeId}
                className="flex-1 h-10 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
