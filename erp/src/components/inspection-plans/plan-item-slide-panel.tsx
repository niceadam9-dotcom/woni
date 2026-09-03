'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { X, Save, PlayCircle, ExternalLink, CheckCircle2, AlertCircle, Loader2, ClipboardList, CalendarDays } from 'lucide-react'
import type { InspectionType, PlanItemStatus } from '@/types'
import { inspectionTypeLabel } from '@/types'
import { updatePlanItemAction, startInspectionAction, getInspectionStepsForItemAction } from '@/app/(dashboard)/inspection-plans/actions'
import { completeStepAction } from '@/app/(dashboard)/inspections/actions'
import { DateInput } from '@/components/ui/date-input'
import { InlineCustomerFieldClient } from '@/components/customers/inline-customer-field-client'
import { stepInputLink } from '@/lib/inspection-step-links'
import { kstDate, todayKst } from '@/lib/kst-date'

type StepInfo = {
  id: string; step_num: number; name_ko: string
  due_date: string | null; status: string; completed_at: string | null
}

type ItemView = Record<string, unknown> & {
  id: string; customer_id: string; inspection_type: InspectionType
  sequence_num: 1 | 2; scheduled_date: string | null; status: PlanItemStatus
  notes: string | null; assigned_employee_id: string | null
  inspection_id: string | null
  customers: { customer_name: string; customer_code: string } | null
  profiles: { name: string } | null
}

// 완료·취소는 수동 변경 불가 — 완료는 점검 6단계 완료 시 자동 전환(P-19), 취소는 전용 플로우
const STATUS_OPTIONS: { value: PlanItemStatus; label: string }[] = [
  { value: 'planned',   label: '계획' },
  { value: 'confirmed', label: '확정' },
]
const STATUS_READONLY_LABEL: Partial<Record<PlanItemStatus, string>> = {
  completed: '완료', cancelled: '취소',
}

interface Props {
  item: ItemView
  canManage: boolean
  canEditOwnItem?: boolean
  /** 고객의 점검계획일 원본(customers.plan_anchor_date) — 고객관리와 단일 소스로 동기화, 편집 시 기준일 변경 플로우(B안 팝업) 적용 */
  planAnchorDate?: string | null
  onClose: () => void
  onSaved: () => void
}

export function PlanItemSlidePanel({ item, canManage, canEditOwnItem = false, planAnchorDate = null, onClose, onSaved }: Props) {
  const canEdit = canManage || canEditOwnItem
  // 완료·취소 항목은 일정·상태 잠금 (담당·메모 정리만 허용)
  const statusEditable = item.status === 'planned' || item.status === 'confirmed'
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const todayStr = todayKst()
  const [scheduledDate,       setScheduledDate]       = useState(item.scheduled_date ?? todayStr)
  const [status,              setStatus]              = useState<PlanItemStatus>(item.status)
  const [notes,               setNotes]               = useState(item.notes ?? '')
  const [error,               setError]               = useState('')

  // P-18: 탭 전환 + 점검 단계 lazy 로드
  const [activeTab,    setActiveTab]    = useState<'plan' | 'work'>('plan')
  const [steps,        setSteps]        = useState<StepInfo[] | null>(null)
  const [loadingSteps, setLoadingSteps] = useState(false)
  const [completeErr,  setCompleteErr]  = useState('')

  useEffect(() => {
    if (activeTab === 'work' && item.inspection_id && steps === null) {
      setLoadingSteps(true)
      getInspectionStepsForItemAction(item.inspection_id).then(r => {
        setSteps(r.steps)
        setLoadingSteps(false)
      })
    }
  }, [activeTab, item.inspection_id, steps])

  async function handleCompleteStep(stepId: string) {
    if (!item.inspection_id) return
    // R4-9(소방계획서_21): 근거 없는 완료는 증거 기반 동기화가 되돌린다 — 사유를 남긴다(D34-2)
    const reason = window.prompt(
      '이 단계를 완료 처리합니다.\n점검표 응답·파일·제출일이 등록되면 자동으로 완료됩니다.\n\n'
      + '완료 사유를 입력하세요 (5자 이상 — 증빙으로 남습니다):',
    )
    if (reason === null) return
    setCompleteErr('')
    const res = await completeStepAction(stepId, item.inspection_id, reason)
    if (res.error) { setCompleteErr(res.error); return }
    // 39 S3-2 — 필수 미입력으로 점검 완료 전환이 보류된 경우 지금 알린다(달력과 같은 채널·같은 문구 축)
    if (res.completionHeld) {
      window.alert(
        `단계는 완료됐지만 점검 완료 전환은 보류되었습니다.\n\n`
        + `필수 미입력 항목 ${res.completionHeld.required}건`
        + `${res.completionHeld.comp > 0 ? ` (종합 필수 ● ${res.completionHeld.comp}건 포함)` : ''}이 남아 있습니다.\n`
        + `설치된 설비의 점검표는 항목마다 ○/✕/／ 중 하나를 기재해야 합니다 — 점검표 입력 화면에서 채우면 자동으로 완료됩니다.`)
    }
    // 단계 목록 새로고침
    const r = await getInspectionStepsForItemAction(item.inspection_id)
    setSteps(r.steps)
    onSaved()
  }

  // 담당 미배정이어도 시작 가능 — 시작한 직원이 담당으로 자동 배정됨 (수정사항리스트 2번 A안)
  const canStart = canManage
    && !item.inspection_id
    && item.status !== 'cancelled'
    && !!item.scheduled_date

  function handleStart() {
    if (!item.assigned_employee_id
      && !confirm('담당자가 미배정입니다. 점검을 시작하면 본인이 담당자로 배정됩니다. 계속할까요?')) return
    setError('')
    startTransition(async () => {
      const res = await startInspectionAction(item.id)
      if (res.error) { setError(res.error); return }
      onSaved()
      onClose()
      router.push(`/inspections/${res.inspectionId}`)
    })
  }

  async function handleSave() {
    setError('')
    startTransition(async () => {
      const res = await updatePlanItemAction({
        itemId: item.id,
        // 완료·취소 항목은 일정·상태를 보내지 않음 (메모만 수정)
        ...(statusEditable ? { scheduledDate: scheduledDate || null, status } : {}),
        notes: notes || null,
      })
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  const customerName = (item.customers as { customer_name: string } | null)?.customer_name ?? '—'

  return (
    <>
      {/* 오버레이 */}
      <div className="fixed inset-0 bg-black/20 dark:bg-black/60 z-40" onClick={onClose} />

      {/* 패널 */}
      <div className="fixed right-0 top-0 h-full w-80 bg-surface shadow-2xl z-50 flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-line-soft">
          <div>
            <p className="text-sm font-semibold text-ink">{customerName}</p>
            <p className="text-xs text-ink-sub mt-0.5">
              {inspectionTypeLabel(item.inspection_type)} · {item.sequence_num}차
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-brand-tint rounded-lg transition-colors">
            <X className="size-4 text-ink-sub" />
          </button>
        </div>

        {/* 탭 헤더 — 점검 있는 경우에만 표시 */}
        {item.inspection_id && (
          <div className="flex border-b border-brand-line-soft">
            <button
              onClick={() => setActiveTab('plan')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                activeTab === 'plan'
                  ? 'text-brand border-b-2 border-brand -mb-px'
                  : 'text-ink-sub hover:text-brand'
              }`}
            >
              <CalendarDays className="size-3.5" />
              점검 계획
            </button>
            <button
              onClick={() => setActiveTab('work')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                activeTab === 'work'
                  ? 'text-brand border-b-2 border-brand -mb-px'
                  : 'text-ink-sub hover:text-brand'
              }`}
            >
              <ClipboardList className="size-3.5" />
              점검 업무
            </button>
          </div>
        )}

        {/* 점검 계획 탭 */}
        {activeTab === 'plan' && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 고객 단위 필드 — 고객관리 > 점검계획일과 단일 소스 동기화 */}
              <div>
                <label className="text-xs font-medium text-ink-sub mb-1 block">
                  점검계획일 <span className="text-[10px] text-ink-meta font-normal">(계획 기산일 · 고객관리와 동기화)</span>
                </label>
                <div className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-paper">
                  {canManage ? (
                    <InlineCustomerFieldClient
                      customerId={item.customer_id}
                      field="plan_anchor_date"
                      value={planAnchorDate}
                      emptyLabel="미입력"
                    />
                  ) : planAnchorDate ? (
                    <span className="text-ink">{planAnchorDate}</span>
                  ) : (
                    <span className="text-red-500 font-medium text-xs">미입력</span>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-ink-sub">점검일</label>
                  {!item.scheduled_date && canEdit && (
                    <span className="text-[10px] text-brand bg-brand-tint px-1.5 py-0.5 rounded-full font-medium">
                      자동 — 오늘 날짜
                    </span>
                  )}
                </div>
                <DateInput
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  disabled={!canEdit || !statusEditable}
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-paper"
                />
                {canEdit && statusEditable && (
                  <p className="text-[11px] text-ink-meta mt-1">
                    점검일 저장 시 자동으로 <b className="text-brand">확정</b>되고 1~6단계 일정이 재계산됩니다
                  </p>
                )}
              </div>

              {/* 담당은 고객관리와 단일 소스 — 여기서 바꾸면 고객관리로 전파되지 않아 편집 제거 (2026-07-14) */}
              <div>
                <label className="text-xs font-medium text-ink-sub mb-1 block">담당직원</label>
                <div className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-paper flex items-center justify-between">
                  <span className="text-ink">
                    {(item.profiles as { name: string } | null)?.name ?? <span className="text-ink-meta">미배정</span>}
                  </span>
                  <span className="text-[10px] text-ink-meta">고객관리에서 변경</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-ink-sub mb-1 block">상태</label>
                {statusEditable ? (
                  <>
                    <select
                      value={status}
                      onChange={e => setStatus(e.target.value as PlanItemStatus)}
                      disabled={!canEdit}
                      className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-paper"
                    >
                      {STATUS_OPTIONS.map(o => (
                        // 점검이 시작된 항목은 계획으로 되돌릴 수 없음
                        <option key={o.value} value={o.value} disabled={o.value === 'planned' && !!item.inspection_id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {item.inspection_id ? (
                      <p className="text-[11px] text-ink-meta mt-1">
                        점검이 시작된 항목은 <b>계획</b>으로 되돌릴 수 없습니다
                      </p>
                    ) : item.status === 'confirmed' && status === 'planned' ? (
                      <p className="text-[11px] text-orange-500 mt-1 flex items-center gap-1">
                        <AlertCircle className="size-3 shrink-0" />
                        저장 시 확정이 해제되고 1~6단계 일정이 초기화됩니다
                      </p>
                    ) : item.status === 'confirmed' ? (
                      <p className="text-[11px] text-ink-meta mt-1">
                        점검 시작 전에는 <b>계획</b>으로 되돌릴 수 있습니다 (해제 시 1~6단계 일정 초기화)
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-paper flex items-center justify-between">
                    <span className="text-ink">{STATUS_READONLY_LABEL[item.status]}</span>
                    <span className="text-[10px] text-ink-meta">
                      {item.status === 'completed' ? '점검 완료 시 자동 전환' : '수동 변경 불가'}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-ink-sub mb-1 block">메모</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  disabled={!canEdit}
                  rows={3}
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-paper"
                />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="p-5 border-t border-brand-line-soft space-y-2">
              {item.inspection_id ? (
                <button
                  onClick={() => setActiveTab('work')}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  <ClipboardList className="size-4" />
                  점검 업무 보기
                </button>
              ) : item.status !== 'cancelled' && canManage ? (
                <div className="space-y-1.5">
                  <button
                    onClick={handleStart}
                    disabled={isPending || !canStart}
                    className={`w-full flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-lg transition-colors ${
                      canStart
                        ? 'bg-[#202023] hover:bg-[#292d34] text-white disabled:opacity-50'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <PlayCircle className="size-4" />
                    {isPending ? '시작 중…' : '점검 시작'}
                  </button>
                  {!canStart && (
                    <div className="space-y-1 pt-0.5">
                      <div className={`flex items-center gap-1.5 text-[11px] ${item.assigned_employee_id ? 'text-green-600' : 'text-orange-500'}`}>
                        {item.assigned_employee_id
                          ? <CheckCircle2 className="size-3 shrink-0" />
                          : <AlertCircle className="size-3 shrink-0" />
                        }
                        담당직원 {item.assigned_employee_id ? '배정됨' : '배정 필요'}
                      </div>
                      <div className={`flex items-center gap-1.5 text-[11px] ${item.scheduled_date ? 'text-green-600' : 'text-orange-500'}`}>
                        {item.scheduled_date
                          ? <CheckCircle2 className="size-3 shrink-0" />
                          : <AlertCircle className="size-3 shrink-0" />
                        }
                        점검일 {item.scheduled_date ? '설정됨' : '설정 필요'}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {canEdit && (
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 bg-brand text-white text-sm font-medium py-2.5 rounded-lg hover:bg-brand-strong transition-colors disabled:opacity-50"
                >
                  <Save className="size-4" />
                  {isPending ? '저장 중…' : '저장'}
                </button>
              )}
            </div>
          </>
        )}

        {/* 점검 업무 탭 */}
        {activeTab === 'work' && item.inspection_id && (
          <>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-ink">6단계 업무체크리스트</p>
                <Link
                  href={`/inspections/${item.inspection_id}`}
                  className="flex items-center gap-1 text-[11px] text-brand hover:underline"
                >
                  <ExternalLink className="size-3" />
                  상세보기
                </Link>
              </div>

              {loadingSteps ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="size-5 animate-spin text-brand" />
                </div>
              ) : steps && steps.length > 0 ? (
                <div className="space-y-2">
                  {steps.map(step => {
                    const done = step.status === 'completed'
                    const overdue = !done && step.due_date && step.due_date < todayKst()
                    // 현재 진행 단계(미완료 중 가장 낮은 step_num)에만 [사유 완료] 표시
                    const isCurrent = !done && steps.every(s => s.step_num >= step.step_num || s.status === 'completed')
                    // [입력]은 모든 미완료 단계에 — 서버는 R4-4에서 순서 강제를 폐지했다(달력 패널과 같은 규칙)
                    const inputLink = !done && item.inspection_id
                      ? stepInputLink(item.inspection_id, step.step_num)
                      : null
                    return (
                      <div
                        key={step.id}
                        className={`rounded-lg border p-3 ${
                          done
                            ? 'bg-green-50 border-green-200'
                            : overdue
                            ? 'bg-red-50 border-red-200'
                            : 'bg-surface border-brand-line-soft'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 size-4 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            done ? 'bg-green-500 text-white' : overdue ? 'bg-red-400 text-white' : 'bg-brand-line-soft text-brand'
                          }`}>
                            {step.step_num}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium leading-tight ${done ? 'text-green-700 line-through' : overdue ? 'text-red-700' : 'text-ink'}`}>
                              {step.name_ko}
                            </p>
                            {step.due_date && (
                              <p className={`text-[10px] mt-0.5 ${done ? 'text-green-500' : overdue ? 'text-red-500' : 'text-ink-sub'}`}>
                                {/* F-14: completed_at은 UTC — 자르면 00:00~09:00 KST 완료분이 어제로 보인다 */}
                                {done ? `완료: ${kstDate(step.completed_at) || '—'}` : `마감: ${step.due_date}`}
                              </p>
                            )}
                          </div>
                          {/* 정상 경로(채움) 위 · 예외 경로(테두리만) 아래 — 달력 패널과 같은 위계 */}
                          {(inputLink || isCurrent) && (
                            <div className="shrink-0 flex flex-col items-stretch gap-1">
                              {inputLink && (
                                <Link
                                  href={inputLink.href}
                                  title={inputLink.title}
                                  className="text-[10px] px-2 py-1 rounded-md bg-brand text-white hover:bg-brand-strong transition-colors text-center whitespace-nowrap"
                                >
                                  {inputLink.label}
                                </Link>
                              )}
                              {isCurrent && (
                                <button
                                  onClick={() => handleCompleteStep(step.id)}
                                  title="증거 없이 사람이 확정합니다 — 사유가 증빙으로 기록됩니다"
                                  className="text-[10px] px-2 py-1 rounded-md border border-line text-ink-soft hover:bg-brand-tint hover:text-ink-sub transition-colors whitespace-nowrap"
                                >
                                  사유 완료
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-ink-sub text-center py-8">단계 정보가 없습니다.</p>
              )}

              {completeErr && <p className="text-xs text-red-500 mt-2">{completeErr}</p>}
            </div>

            <div className="p-5 border-t border-brand-line-soft">
              <Link
                href={`/inspections/${item.inspection_id}`}
                className="w-full flex items-center justify-center gap-2 bg-brand text-white text-sm font-medium py-2.5 rounded-lg hover:bg-brand-strong transition-colors"
              >
                <ExternalLink className="size-4" />
                점검 상세 페이지
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  )
}
