'use client'

import { Loader2, PlayCircle } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

/** 미시작 회차 점검일 확정 모달 (소방계획서_8 H-3) — 확정=자동 시작(confirmPlanItemStageOneAction).
 *  소방계획서_20 S3에서 plan-annex-section.tsx에서 분리(문자열·동작 불변). */
export function PlanAnnexStartModal({ label, date, onDateChange, error, isPending, onCancel, onConfirm }: {
  label: string
  date: string
  onDateChange: (v: string) => void
  error: string | null
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => !isPending && onCancel()} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] bg-white rounded-2xl shadow-2xl z-[70] p-5">
        <p className="font-semibold text-sm text-[#090c1d]">{label} 점검을 시작합니다</p>
        <p className="text-xs text-[#514b81] mt-1">점검일을 확정하면 점검이 자동 시작되고 6단계 마감일이 계산됩니다.</p>
        <div className="mt-3">
          <label className="text-xs font-medium text-[#514b81]">점검일</label>
          <DateInput value={date} onChange={e => onDateChange(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-[#d0ccf5] px-2 text-sm" />
        </div>
        {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onCancel} disabled={isPending}
            className="h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">취소</button>
          <button onClick={onConfirm} disabled={isPending}
            className="h-8 px-3.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />} 확정·시작
          </button>
        </div>
      </div>
    </>
  )
}
