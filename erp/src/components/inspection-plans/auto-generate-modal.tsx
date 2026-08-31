'use client'

import { useState, useTransition } from 'react'
import { X, RefreshCw, CheckCircle } from 'lucide-react'
import { autoGeneratePlanAction } from '@/app/(dashboard)/inspection-plans/actions'

interface Props {
  year: number
  month: number
  onClose: () => void
  onGenerated: (planId: string) => void
}

export function AutoGenerateModal({ year, month, onClose, onGenerated }: Props) {
  const [isPending, startTransition] = useTransition()
  const [done,  setDone]  = useState(false)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')

  const prevYear  = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1

  async function handleGenerate() {
    setError('')
    startTransition(async () => {
      const res = await autoGeneratePlanAction({ year, month })
      if (res.error) { setError(res.error); return }
      setCount(res.itemCount ?? 0)
      setDone(true)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/30 dark:bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-line-soft">
          <h2 className="text-sm font-semibold text-ink">자동 생성</h2>
          <button onClick={onClose} className="p-1 hover:bg-brand-tint rounded-lg transition-colors">
            <X className="size-4 text-ink-sub" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {done ? (
            <div className="text-center space-y-3">
              <CheckCircle className="size-10 text-green-500 mx-auto" />
              <p className="text-sm font-semibold text-ink">{year}년 {month}월 계획 생성 완료</p>
              <p className="text-xs text-ink-sub">
                전월 ({prevYear}년 {prevMonth}월) 기준으로<br />
                <span className="font-semibold text-brand">{count}건</span>의 점검 항목이 초안으로 생성되었습니다.
              </p>
              <p className="text-xs text-ink-meta">점검 예정일은 직접 입력해주세요.</p>
              <button
                onClick={() => onGenerated('')}
                className="w-full py-2.5 text-sm bg-brand text-white rounded-lg font-medium hover:bg-brand-strong transition-colors"
              >
                확인
              </button>
            </div>
          ) : (
            <>
              <div className="bg-brand-tint rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-brand">{year}년 {month}월 점검계획</p>
                <div className="text-xs text-ink-sub space-y-1">
                  <p>• 참조 계획: <span className="font-medium">{prevYear}년 {prevMonth}월</span></p>
                  <p>• 전월 담당직원·고객 정보를 유지하여 초안 생성</p>
                  <p>• 점검 예정일은 초안 생성 후 수동 입력 필요</p>
                </div>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-line rounded-lg text-ink-sub hover:bg-paper transition-colors">
                  취소
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={isPending}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm bg-brand text-white rounded-lg font-medium hover:bg-brand-strong transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`size-3.5 ${isPending ? 'animate-spin' : ''}`} />
                  {isPending ? '생성 중…' : '생성 시작'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
