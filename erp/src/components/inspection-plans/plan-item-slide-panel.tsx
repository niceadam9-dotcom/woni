'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { X, Save, PlayCircle, ExternalLink, CheckCircle2, AlertCircle, Loader2, ClipboardList, CalendarDays } from 'lucide-react'
import type { InspectionType, PlanItemStatus } from '@/types'
import { inspectionTypeLabel } from '@/types'
import { updatePlanItemAction, startInspectionAction, getInspectionStepsForItemAction } from '@/app/(dashboard)/inspection-plans/actions'
import { completeStepAction } from '@/app/(dashboard)/inspections/actions'

type StepInfo = {
  id: string; step_num: number; name_ko: string
  due_date: string | null; status: string; completed_at: string | null
}

type Employee = { id: string; name: string; position: string | null }
type ItemView = Record<string, unknown> & {
  id: string; customer_id: string; inspection_type: InspectionType
  sequence_num: 1 | 2; scheduled_date: string | null; status: PlanItemStatus
  notes: string | null; assigned_employee_id: string | null
  inspection_id: string | null
  customers: { customer_name: string; customer_code: string } | null
  profiles: { name: string } | null
}

const STATUS_OPTIONS: { value: PlanItemStatus; label: string }[] = [
  { value: 'planned',   label: '계획' },
  { value: 'confirmed', label: '확정' },
  { value: 'completed', label: '완료' },
  { value: 'cancelled', label: '취소' },
]

interface Props {
  item: ItemView
  employees: Employee[]
  canManage: boolean
  /** 담당직원 변경 권한 — B안: 매니저 이상만 (미지정 시 canManage 따름) */
  canAssign?: boolean
  canEditOwnItem?: boolean
  onClose: () => void
  onSaved: () => void
}

export function PlanItemSlidePanel({ item, employees, canManage, canAssign = canManage, canEditOwnItem = false, onClose, onSaved }: Props) {
  const canEdit = canManage || canEditOwnItem
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const todayStr = new Date().toISOString().split('T')[0]
  const [scheduledDate,       setScheduledDate]       = useState(item.scheduled_date ?? todayStr)
  const [assignedEmployeeId,  setAssignedEmployeeId]  = useState(item.assigned_employee_id ?? '')
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
    setCompleteErr('')
    const res = await completeStepAction(stepId, item.inspection_id)
    if (res.error) { setCompleteErr(res.error); return }
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
        scheduledDate:      scheduledDate || null,
        assignedEmployeeId: assignedEmployeeId || null,
        status,
        notes:              notes || null,
      })
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  const customerName = (item.customers as { customer_name: string } | null)?.customer_name ?? '—'

  return (
    <>
      {/* 오버레이 */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* 패널 */}
      <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e0ddf5]">
          <div>
            <p className="text-sm font-semibold text-[#090c1d]">{customerName}</p>
            <p className="text-xs text-[#514b81] mt-0.5">
              {inspectionTypeLabel(item.inspection_type)} · {item.sequence_num}차
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#f5f4ff] rounded-lg transition-colors">
            <X className="size-4 text-[#514b81]" />
          </button>
        </div>

        {/* 탭 헤더 — 점검 있는 경우에만 표시 */}
        {item.inspection_id && (
          <div className="flex border-b border-[#e0ddf5]">
            <button
              onClick={() => setActiveTab('plan')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                activeTab === 'plan'
                  ? 'text-[#7b68ee] border-b-2 border-[#7b68ee] -mb-px'
                  : 'text-[#514b81] hover:text-[#7b68ee]'
              }`}
            >
              <CalendarDays className="size-3.5" />
              점검 계획
            </button>
            <button
              onClick={() => setActiveTab('work')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                activeTab === 'work'
                  ? 'text-[#7b68ee] border-b-2 border-[#7b68ee] -mb-px'
                  : 'text-[#514b81] hover:text-[#7b68ee]'
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
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#514b81]">점검 예정일</label>
                  {!item.scheduled_date && canEdit && (
                    <span className="text-[10px] text-[#7b68ee] bg-[#f5f4ff] px-1.5 py-0.5 rounded-full font-medium">
                      자동 — 오늘 날짜
                    </span>
                  )}
                </div>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  disabled={!canEdit}
                  className="w-full text-sm border border-[#c8c4d0] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#7b68ee] disabled:bg-[#fafafa]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[#514b81] mb-1 block">담당직원</label>
                <select
                  value={assignedEmployeeId}
                  onChange={e => setAssignedEmployeeId(e.target.value)}
                  disabled={!canAssign}
                  className="w-full text-sm border border-[#c8c4d0] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#7b68ee] disabled:bg-[#fafafa]"
                >
                  <option value="">미배정</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-[#514b81] mb-1 block">상태</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value as PlanItemStatus)}
                  disabled={!canEdit}
                  className="w-full text-sm border border-[#c8c4d0] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#7b68ee] disabled:bg-[#fafafa]"
                >
                  {STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-[#514b81] mb-1 block">메모</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  disabled={!canEdit}
                  rows={3}
                  className="w-full text-sm border border-[#c8c4d0] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#7b68ee] disabled:bg-[#fafafa]"
                />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="p-5 border-t border-[#e0ddf5] space-y-2">
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
                        점검 예정일 {item.scheduled_date ? '설정됨' : '설정 필요'}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {canEdit && (
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 bg-[#7b68ee] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-[#6a5acd] transition-colors disabled:opacity-50"
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
                <p className="text-xs font-semibold text-[#090c1d]">6단계 업무체크리스트</p>
                <Link
                  href={`/inspections/${item.inspection_id}`}
                  className="flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline"
                >
                  <ExternalLink className="size-3" />
                  상세보기
                </Link>
              </div>

              {loadingSteps ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="size-5 animate-spin text-[#7b68ee]" />
                </div>
              ) : steps && steps.length > 0 ? (
                <div className="space-y-2">
                  {steps.map(step => {
                    const done = step.status === 'completed'
                    const overdue = !done && step.due_date && step.due_date < new Date().toISOString().split('T')[0]
                    // 현재 진행 단계(미완료 중 가장 낮은 step_num)에만 완료 버튼 표시
                    const isCurrent = !done && steps.every(s => s.step_num >= step.step_num || s.status === 'completed')
                    return (
                      <div
                        key={step.id}
                        className={`rounded-lg border p-3 ${
                          done
                            ? 'bg-green-50 border-green-200'
                            : overdue
                            ? 'bg-red-50 border-red-200'
                            : 'bg-white border-[#e0ddf5]'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 size-4 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            done ? 'bg-green-500 text-white' : overdue ? 'bg-red-400 text-white' : 'bg-[#e0ddf5] text-[#7b68ee]'
                          }`}>
                            {step.step_num}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium leading-tight ${done ? 'text-green-700 line-through' : overdue ? 'text-red-700' : 'text-[#090c1d]'}`}>
                              {step.name_ko}
                            </p>
                            {step.due_date && (
                              <p className={`text-[10px] mt-0.5 ${done ? 'text-green-500' : overdue ? 'text-red-500' : 'text-[#514b81]'}`}>
                                {done ? `완료: ${step.completed_at?.split('T')[0] ?? '—'}` : `마감: ${step.due_date}`}
                              </p>
                            )}
                          </div>
                          {isCurrent && (
                            <button
                              onClick={() => handleCompleteStep(step.id)}
                              className="shrink-0 text-[10px] px-2 py-1 rounded-md bg-[#7b68ee] text-white hover:bg-[#6a5acd] transition-colors"
                            >
                              완료
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#514b81] text-center py-8">단계 정보가 없습니다.</p>
              )}

              {completeErr && <p className="text-xs text-red-500 mt-2">{completeErr}</p>}
            </div>

            <div className="p-5 border-t border-[#e0ddf5]">
              <Link
                href={`/inspections/${item.inspection_id}`}
                className="w-full flex items-center justify-center gap-2 bg-[#7b68ee] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-[#6a5acd] transition-colors"
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
