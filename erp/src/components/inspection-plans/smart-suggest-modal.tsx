'use client'

import { useState, useEffect, useTransition } from 'react'
import { X, Lightbulb, AlertCircle } from 'lucide-react'
import type { InspectionType } from '@/types'
import { inspectionTypeLabel } from '@/types'
import {
  getSuggestedItemsAction,
  addPlanItemAction,
  createInspectionPlanAction,
} from '@/app/(dashboard)/inspection-plans/actions'

type SuggestedItem = {
  id: string
  customer_name: string
  customer_code: string
  inspection_type: InspectionType
  /** 기준일: 점검계획일(수동) → 최초 점검시작일 */
  anchor_date: string
  assigned_employee_id: string | null
  sequence_num: 1 | 2
  reason: string
}

interface Props {
  year: number
  month: number
  planId: string | null
  holidays: string[]
  onClose: () => void
  onAdded: () => void
}

// 점검계획일(기준일) 기준, 해당 월의 같은 날짜 다음 영업일 계산
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function nextWorkingDay(base: Date, holidaySet: Set<string>): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + 1)
  while (true) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !holidaySet.has(toDateStr(d))) break
    d.setDate(d.getDate() + 1)
  }
  return d
}
function calcScheduledDate(anchorDate: string, planYear: number, planMonth: number, holidaySet: Set<string>): string {
  const approvalDay = new Date(anchorDate).getDate()
  const daysInMonth = new Date(planYear, planMonth, 0).getDate() // planMonth is 1-indexed
  const base = new Date(planYear, planMonth - 1, Math.min(approvalDay, daysInMonth))
  return toDateStr(nextWorkingDay(base, holidaySet))
}

const TYPE_STYLE: Record<InspectionType, string> = {
  종합:   'bg-brand-tint text-brand',
  작동:   'bg-blue-50 text-blue-600',
  일반관리: 'bg-gray-100 text-gray-600',
}

function itemKey(item: SuggestedItem) {
  return `${item.id}-${item.sequence_num}`
}

export function SmartSuggestModal({ year, month, planId, holidays, onClose, onAdded }: Props) {
  const [isPending, startTransition] = useTransition()
  const [loading, setLoading]       = useState(true)
  const [suggestions, setSuggestions] = useState<SuggestedItem[]>([])
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [error, setError]           = useState('')

  useEffect(() => {
    getSuggestedItemsAction(year, month, planId).then(res => {
      const items = res.suggestions as SuggestedItem[]
      setSuggestions(items)
      setSelected(new Set(items.map(itemKey)))
      setLoading(false)
    })
  }, [year, month, planId])

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleAll() {
    setSelected(
      selected.size === suggestions.length
        ? new Set()
        : new Set(suggestions.map(itemKey))
    )
  }

  function handleAdd() {
    if (selected.size === 0) { setError('추가할 항목을 선택해주세요.'); return }
    setError('')
    const holidaySet = new Set(holidays)
    startTransition(async () => {
      let currentPlanId = planId

      if (!currentPlanId) {
        const res = await createInspectionPlanAction({ year, month })
        if (res.error) { setError(res.error); return }
        currentPlanId = res.planId!
      }

      const toAdd = suggestions.filter(s => selected.has(itemKey(s)))
      for (const item of toAdd) {
        // 점검계획일(기준일) 기준: 해당 월 같은 날짜의 다음 영업일 자동 계산
        const scheduledDate = calcScheduledDate(item.anchor_date, year, month, holidaySet)
        const res = await addPlanItemAction({
          planId:              currentPlanId,
          customerId:          item.id,
          inspectionType:      item.inspection_type,
          sequenceNum:         item.sequence_num,
          assignedEmployeeId:  item.assigned_employee_id ?? undefined,
          scheduledDate,
        })
        if (res.error && res.error !== '항목 추가에 실패했습니다.') {
          // UNIQUE 충돌은 무시, 기타 오류는 표시
          setError(res.error)
          return
        }
      }

      onAdded()
    })
  }

  const allSelected = suggestions.length > 0 && selected.size === suggestions.length

  return (
    <div className="fixed inset-0 bg-black/30 dark:bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-line-soft shrink-0">
          <div className="flex items-center gap-2">
            <Lightbulb className="size-4 text-brand" />
            <div>
              <p className="text-sm font-semibold text-ink">{year}년 {month}월 — 일정 자동 제안</p>
              <p className="text-xs text-ink-faint mt-0.5">점검계획일(기준일) 기준 점검 일정 자동 제안</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-brand-tint rounded-lg transition-colors">
            <X className="size-4 text-ink-sub" />
          </button>
        </div>

        {/* 바디 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-brand border-t-transparent" />
              <span className="ml-3 text-sm text-ink-sub">불러오는 중…</span>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <Lightbulb className="size-8 text-ink-faint mx-auto" />
              <p className="text-sm font-medium text-ink-sub">제안할 고객이 없습니다</p>
              <p className="text-xs text-ink-faint">
                점검계획일(기준일)이 {month}월 또는 {((month - 1 + 6) % 12) + 1}월인 고객 없음
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* 통계 + 전체선택 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs text-ink-sub">
                  <span>
                    총 <span className="font-semibold text-ink">{suggestions.length}건</span> 제안
                  </span>
                  <span className="text-ink-faint">|</span>
                  <span>
                    이번달 <span className="font-semibold">{suggestions.filter(s => s.sequence_num === 1).length}건</span>
                  </span>
                  <span>
                    종합 2차 <span className="font-semibold">{suggestions.filter(s => s.sequence_num === 2).length}건</span>
                  </span>
                </div>
                <button
                  onClick={toggleAll}
                  className="text-xs text-brand hover:underline font-medium"
                >
                  {allSelected ? '전체 해제' : '전체 선택'}
                </button>
              </div>

              {/* 1차 그룹 */}
              {suggestions.some(s => s.sequence_num === 1) && (
                <div>
                  <p className="text-xs font-semibold text-ink-sub mb-1.5 mt-3">
                    점검계획월 {month}월 고객 — 종합 1차 / 작동·일반 연1회
                  </p>
                  <div className="space-y-1.5">
                    {suggestions.filter(s => s.sequence_num === 1).map(item => (
                      <SuggestRow
                        key={itemKey(item)}
                        item={item}
                        checked={selected.has(itemKey(item))}
                        onToggle={() => toggle(itemKey(item))}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 2차 그룹 */}
              {suggestions.some(s => s.sequence_num === 2) && (
                <div>
                  <p className="text-xs font-semibold text-ink-sub mb-1.5 mt-3">
                    2차 점검 — 점검계획월 {((month - 1 + 6) % 12) + 1}월 고객 (+6개월)
                  </p>
                  <div className="space-y-1.5">
                    {suggestions.filter(s => s.sequence_num === 2).map(item => (
                      <SuggestRow
                        key={itemKey(item)}
                        item={item}
                        checked={selected.has(itemKey(item))}
                        onToggle={() => toggle(itemKey(item))}
                      />
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-2">
                  <AlertCircle className="size-3.5 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 푸터 */}
        {!loading && suggestions.length > 0 && (
          <div className="px-6 py-4 border-t border-brand-line-soft flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm border border-line rounded-lg text-ink-sub hover:bg-paper transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleAdd}
              disabled={isPending || selected.size === 0}
              className="flex-1 py-2.5 text-sm bg-brand text-white rounded-lg font-medium hover:bg-brand-strong transition-colors disabled:opacity-50"
            >
              {isPending ? '추가 중…' : `${selected.size}건 계획에 추가`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestRow({
  item, checked, onToggle,
}: {
  item: SuggestedItem
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
        checked
          ? 'border-brand bg-brand-tint'
          : 'border-line hover:bg-paper'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="accent-brand shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-ink truncate">{item.customer_name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${TYPE_STYLE[item.inspection_type]}`}>
            {inspectionTypeLabel(item.inspection_type)}
          </span>
          {item.inspection_type === '종합' ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 font-medium shrink-0">
              {item.sequence_num}차
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium shrink-0">
              연1회
            </span>
          )}
        </div>
        <p className="text-[11px] text-ink-faint mt-0.5">{item.reason}</p>
      </div>
    </label>
  )
}
