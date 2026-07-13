'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarRange, Loader2 } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { updateInspectionMultidayAction } from '@/app/(dashboard)/inspections/actions'

/** 다일 점검(2~3일) 설정 (P32-9) — 종료일 지정 시 6단계 기산점이 종료일로 재계산됨 */
export function InspectionMultidayClient({ inspectionId, startDate, endDate, days, canManage }: {
  inspectionId: string; startDate: string; endDate: string | null; days: number; canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [end, setEnd] = useState(endDate ?? '')
  const [d, setD] = useState(String(days || 1))
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  function save() {
    setMsg(''); setErr('')
    startTransition(async () => {
      const res = await updateInspectionMultidayAction(inspectionId, { endDate: end || null, days: parseInt(d, 10) || 1 })
      if (res.error) { setErr(res.error); return }
      setMsg('저장했습니다. 종료일 기준으로 미완료 단계 마감일이 재계산됩니다.')
      router.refresh()
    })
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4">
      <div className="flex items-center gap-2 mb-2">
        <CalendarRange className="size-4 text-[#7b68ee]" />
        <h3 className="text-sm font-semibold text-[#090c1d]">점검 기간 <span className="text-xs font-normal text-[#b0acd6]">다일 점검 시 종료일</span></h3>
        <span className="ml-auto text-xs text-[#514b81]">시작 {startDate}{end ? ` ~ 종료 ${end}` : ''}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[#514b81]">종료일</span>
        <DateInput value={end} onChange={e => setEnd(e.target.value)} disabled={!canManage} className="text-sm h-8" />
        <span className="text-xs text-[#514b81] ml-2">일수</span>
        <input value={d} onChange={e => setD(e.target.value.replace(/\D/g, ''))} disabled={!canManage}
          className="h-8 w-14 rounded-lg border border-[#d0ccf5] px-2 text-sm outline-none focus:border-[#7b68ee]" />
        {canManage && (
          <button onClick={save} disabled={isPending} className="h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1">
            {isPending && <Loader2 className="size-3.5 animate-spin" />} 저장
          </button>
        )}
      </div>
      {msg && <p className="text-[11px] text-green-600 mt-1.5">{msg}</p>}
      {err && <p className="text-[11px] text-red-600 mt-1.5">{err}</p>}
    </div>
  )
}
