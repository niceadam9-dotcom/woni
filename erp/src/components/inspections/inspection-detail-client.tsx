'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, AlertTriangle, Clock, Trash2, Loader2 } from 'lucide-react'
import { completeStepAction, deleteInspectionAction } from '@/app/(dashboard)/inspections/actions'
import type { InspectionStep, StepStatus } from '@/types'

const STEP_STATUS_CONFIG: Record<StepStatus, { label: string; cls: string }> = {
  pending:   { label: '대기',   cls: 'bg-gray-100 text-gray-500' },
  completed: { label: '완료',   cls: 'bg-green-50 text-green-700' },
  overdue:   { label: '기한초과', cls: 'bg-red-50 text-red-600' },
}

interface Props {
  steps: InspectionStep[]
  inspectionId: string
  canComplete: boolean
  canDelete: boolean
  today: string
}

export function InspectionDetailClient({ steps, inspectionId, canComplete, canDelete, today }: Props) {
  const router = useRouter()
  const [completing, setCompleting] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, startDeleteTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function handleComplete(stepId: string) {
    setCompleting(stepId)
    setError(null)
    const result = await completeStepAction(stepId, inspectionId)
    setCompleting(null)
    if (result.error) setError(result.error)
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteInspectionAction(inspectionId)
      if (result.error) {
        setError(result.error)
        setShowDeleteConfirm(false)
      } else {
        router.push('/inspections')
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* 7단계 체크리스트 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e0ddf5]">
          <h2 className="text-sm font-semibold text-[#090c1d]">6단계 업무 체크리스트</h2>
        </div>
        <div className="divide-y divide-[#e0ddf5]">
          {steps.map((step, idx) => {
            const isOverdue = step.status !== 'completed' && step.due_date !== null && step.due_date < today
            const isDueSoon = step.status !== 'completed' && step.due_date !== null &&
              step.due_date >= today && step.due_date <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
            const actualStatus: StepStatus = isOverdue ? 'overdue' : step.status as StepStatus
            const cfg = STEP_STATUS_CONFIG[actualStatus]

            return (
              <div
                key={step.id}
                className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                  isOverdue ? 'border-l-4 border-l-red-400 bg-red-50/30' :
                  isDueSoon ? 'border-l-4 border-l-amber-400 bg-amber-50/20' :
                  step.status === 'completed' ? 'bg-green-50/20' : ''
                }`}
              >
                {/* 단계 번호 */}
                <div className={`size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  step.status === 'completed' ? 'bg-green-100' : isOverdue ? 'bg-red-100' : 'bg-[#f5f4ff]'
                }`}>
                  {step.status === 'completed' ? (
                    <Check className="size-4 text-green-600" />
                  ) : isOverdue ? (
                    <AlertTriangle className="size-4 text-red-500" />
                  ) : (
                    <span className="text-xs font-bold text-[#7b68ee]">{step.step_num}</span>
                  )}
                </div>

                {/* 단계 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${step.status === 'completed' ? 'text-[#514b81] line-through' : 'text-[#090c1d]'}`}>
                      {step.name_ko}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
                      {cfg.label}
                    </span>
                    {isDueSoon && step.status !== 'completed' && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 flex items-center gap-0.5">
                        <Clock className="size-2.5" />
                        마감임박
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                    {step.due_date ? (
                      <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-[#514b81]'}`}>
                        마감일: {step.due_date}
                      </span>
                    ) : (
                      <span className="text-xs text-[#b0acd6]">마감일 없음</span>
                    )}
                    {step.completed_at && (
                      <span className="text-xs text-green-600">
                        완료: {step.completed_at.split('T')[0]}
                      </span>
                    )}
                  </div>
                </div>

                {/* 완료 버튼 */}
                {canComplete && step.status !== 'completed' && (
                  <button
                    onClick={() => handleComplete(step.id)}
                    disabled={completing === step.id}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                      isOverdue
                        ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                        : 'bg-[#f5f4ff] text-[#7b68ee] hover:bg-[#ede9ff] border border-[#c3bdf5]'
                    }`}
                  >
                    {completing === step.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Check className="size-3" />
                    )}
                    완료
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* 삭제 버튼 */}
      {canDelete && (
        <div className="pt-2">
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              <Trash2 className="size-3.5" />
              이 점검 삭제
            </button>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-4">
              <p className="text-sm text-red-700">이 점검을 삭제하면 복구할 수 없습니다. 계속하시겠습니까?</p>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                >
                  {isDeleting && <Loader2 className="size-3 animate-spin" />}
                  삭제
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 border border-[#c8c4d0] text-xs text-[#514b81] rounded-lg hover:bg-white transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
