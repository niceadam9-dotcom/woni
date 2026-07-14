'use client'

import { Loader2, X, AlertTriangle } from 'lucide-react'
import type { ConfirmedPlanItemInfo } from '@/app/(dashboard)/customers/actions'

/** 기준일(점검계획일/사용승인일) 변경 시 확정 일정 처리 선택 팝업 (B안)
 *  - 확정해지 후 전체 재계산 / 확정 유지(미확정만 재계산) / 취소 */
export function ConfirmedDecisionDialog({
  items, isPending, onDecide, onCancel,
}: {
  items: ConfirmedPlanItemInfo[]
  isPending?: boolean
  onDecide: (decision: 'unconfirm' | 'keep') => void
  onCancel: () => void
}) {
  function planTypeLabel(t: string | null, seq: number) {
    if (t?.startsWith('special_')) return seq === 2 ? '특별점검 2차' : '특별점검'
    return '정기점검'
  }
  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={e => e.stopPropagation()}>
      <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#c8c4d0]">
          <h2 className="text-base font-semibold text-[#090c1d] flex items-center gap-2">
            <AlertTriangle className="size-4 text-orange-500" />
            확정된 점검 일정이 있습니다
          </h2>
          <button onClick={onCancel} className="text-[#514b81] hover:text-[#090c1d]">
            <X className="size-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-xs text-[#514b81] leading-relaxed">
            점검계획일(기준일)을 변경해도 <b>이미 확정된 일정 {items.length}건은 자동으로 바뀌지 않습니다.</b><br />
            확정 일정까지 새 기준일로 다시 계산하려면 확정해지를 선택하세요.
          </p>
          <ul className="max-h-40 overflow-y-auto rounded-lg bg-[#f5f4ff] divide-y divide-[#e6e3f7]">
            {items.map(it => (
              <li key={it.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="text-[#090c1d] font-medium">{it.year}년 {it.month}월 — {planTypeLabel(it.plan_type, it.sequence_num)}</span>
                <span className="text-[#514b81]">{it.scheduled_date ? `확정일 ${it.scheduled_date}` : '확정일 미지정'}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 px-6 py-4 border-t border-[#c8c4d0]">
          <button
            onClick={() => onDecide('unconfirm')}
            disabled={isPending}
            className="h-10 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : `확정해지 후 전체 재계산 (${items.length}건 포함)`}
          </button>
          <button
            onClick={() => onDecide('keep')}
            disabled={isPending}
            className="h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors disabled:opacity-50"
          >
            확정 유지 — 미확정 일정만 재계산
          </button>
          <button
            onClick={onCancel}
            disabled={isPending}
            className="h-9 rounded-lg text-xs text-[#b0acd6] hover:text-[#514b81] transition-colors"
          >
            취소 (변경하지 않음)
          </button>
        </div>
      </div>
    </div>
  )
}
