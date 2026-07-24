'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, AlertTriangle, Clock, Trash2, Loader2, Sparkles, X } from 'lucide-react'
import { completeStepAction, deleteInspectionAction } from '@/app/(dashboard)/inspections/actions'
import { requestReport9Action } from '@/app/(dashboard)/inspections/report9-actions'
import type { InspectionStep, StepStatus } from '@/types'

const AUTO_GEN9_KEY = 'sjfire:autoGenReport9'   // R0-7: 완료 시 별지 9호 자동 생성 선호(브라우저 저장)

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
  // R0-7: 점검 완료 → 별지 9호 후속 제안 (배너) + 완료 시 자동 생성 선호
  const [autoGen9, setAutoGen9] = useState(false)
  const [suggest9, setSuggest9] = useState(false)
  const [gen9Msg, setGen9Msg] = useState<string | null>(null)
  const [gen9Busy, setGen9Busy] = useState(false)

  useEffect(() => {
    try { setAutoGen9(localStorage.getItem(AUTO_GEN9_KEY) === '1') } catch { /* SSR·차단 환경 무시 */ }
  }, [])

  function setAutoGen9Pref(on: boolean) {
    setAutoGen9(on)
    try { localStorage.setItem(AUTO_GEN9_KEY, on ? '1' : '0') } catch { /* 무시 */ }
  }

  async function fireReport9() {
    setGen9Busy(true)
    setGen9Msg(null)
    const res = await requestReport9Action(inspectionId, 'report9')
    setGen9Busy(false)
    setSuggest9(false)
    if (res.error) { setGen9Msg(`❌ ${res.error}`); return }
    setGen9Msg('✅ 별지 9호 생성 요청됨 — 워커 처리 후 아래 타임라인·문서 현황에 등록됩니다')
    router.refresh()
  }

  async function handleComplete(stepId: string) {
    setCompleting(stepId)
    setError(null)
    const result = await completeStepAction(stepId, inspectionId)
    setCompleting(null)
    if (result.error) { setError(result.error); return }
    // R0-7: 점검이 방금 완료됐고 별지 9호 대상이면 — 자동 생성 켜짐이면 바로, 아니면 제안 배너
    if (result.justCompleted && result.report9Eligible) {
      if (autoGen9) void fireReport9()
      else setSuggest9(true)
    }
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
        <div className="px-5 py-4 border-b border-[#e0ddf5] flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#090c1d]">{steps.length}단계 업무 체크리스트</h2>
          {/* R0-7: 완료 시 별지 9호 자동 생성 선호 토글 */}
          {canComplete && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[#514b81] cursor-pointer select-none"
              title="점검 완료 시 별지 9호 생성을 자동으로 요청합니다 (이 브라우저에만 저장)">
              <input type="checkbox" checked={autoGen9} onChange={e => setAutoGen9Pref(e.target.checked)}
                className="size-3.5 accent-[#7b68ee]" />
              완료 시 9호 자동 생성
            </label>
          )}
        </div>
        <div className="divide-y divide-[#e0ddf5]">
          {steps.map((step, idx) => {
            const isOverdue = step.status !== 'completed' && step.due_date !== null && step.due_date < today
            const isDueSoon = step.status !== 'completed' && step.due_date !== null &&
              step.due_date >= today && step.due_date <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
            const actualStatus: StepStatus = isOverdue ? 'overdue' : step.status as StepStatus
            const cfg = STEP_STATUS_CONFIG[actualStatus]
            // 현재 진행 단계(미완료 중 가장 낮은 step_num)에만 완료 버튼 표시
            const isCurrent = step.status !== 'completed'
              && steps.every(s => s.step_num >= step.step_num || s.status === 'completed')

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

                {/* 완료 버튼 — 현재 진행 단계에만 표시 */}
                {canComplete && isCurrent && (
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

      {/* R0-7: 점검 완료 후속 제안 — 별지 9호 바로 생성 */}
      {suggest9 && (
        <div className="bg-[#f5f4ff] border border-[#c3bdf5] rounded-lg px-4 py-3 flex items-center gap-3">
          <Sparkles className="size-4 text-[#7b68ee] shrink-0" />
          <p className="text-sm text-[#514b81] flex-1">점검이 완료됐습니다 — 별지 9호를 바로 생성할까요?</p>
          <label className="inline-flex items-center gap-1 text-[11px] text-[#514b81] cursor-pointer select-none">
            <input type="checkbox" checked={autoGen9} onChange={e => setAutoGen9Pref(e.target.checked)} className="size-3 accent-[#7b68ee]" />
            다음부턴 자동
          </label>
          <button onClick={fireReport9} disabled={gen9Busy}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50">
            {gen9Busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} 별지 9호 생성
          </button>
          <button onClick={() => setSuggest9(false)} className="text-[#b0acd6] hover:text-[#514b81]" title="닫기"><X className="size-4" /></button>
        </div>
      )}
      {gen9Msg && (
        <p className={`text-sm rounded-lg px-4 py-3 ${gen9Msg.startsWith('✅') ? 'text-green-700 bg-green-50 border border-green-100' : 'text-red-500 bg-red-50 border border-red-100'}`}>{gen9Msg}</p>
      )}

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
