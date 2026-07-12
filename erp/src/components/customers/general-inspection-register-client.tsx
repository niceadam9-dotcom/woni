'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, Loader2, X } from 'lucide-react'
import { registerGeneralInspectionAction } from '@/app/(dashboard)/customers/actions'
import { DateInput } from '@/components/ui/date-input'

interface Props {
  customerId: string
  customerName: string
  employees: Array<{ id: string; name: string }>
  defaultEmployeeId?: string | null
}

/** 일반관리 고객 — [점검일 등록 +] 버튼 + 팝업 (V10 §6-C) */
export function GeneralInspectionRegisterClient({ customerId, customerName, employees, defaultEmployeeId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? '')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    setError('')
    if (!date) { setError('점검 예정일을 선택해주세요.'); return }
    startTransition(async () => {
      const res = await registerGeneralInspectionAction({
        customerId,
        plannedDate: date,
        assignedEmployeeId: employeeId || undefined,
        memo: memo || undefined,
      })
      if (res.error) { setError(res.error); return }
      setOpen(false)
      setDate(''); setMemo('')
      router.refresh()
    })
  }

  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true) }}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded text-[#7b68ee] hover:bg-[#f5f4ff] font-medium transition-colors whitespace-nowrap"
        title="일반관리 점검일 등록"
      >
        <CalendarPlus className="size-3" />
        점검일 등록
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => !isPending && setOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-[#d0ccf5] shadow-xl w-full max-w-sm p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#090c1d]">{customerName} 점검일 등록</h3>
              <button onClick={() => setOpen(false)} className="text-[#b0acd6] hover:text-[#514b81]">
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#514b81]">점검 예정일 <span className="text-red-500">*</span></label>
                <DateInput
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full h-9 rounded-lg border border-[#d0ccf5] px-3 text-sm outline-none focus:border-[#7b68ee]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#514b81]">담당자</label>
                <select
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-[#d0ccf5] px-2 text-sm outline-none focus:border-[#7b68ee] bg-white"
                >
                  <option value="">미배정</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#514b81]">메모</label>
                <input
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="예: 연간 1차"
                  className="w-full h-9 rounded-lg border border-[#d0ccf5] px-3 text-sm outline-none focus:border-[#7b68ee]"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="flex-1 h-9 rounded-lg border border-[#d0ccf5] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="flex-1 h-9 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
