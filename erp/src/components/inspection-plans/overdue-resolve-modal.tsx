'use client'

import { useState, useTransition } from 'react'
import { X, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import type { OverdueItem } from '@/app/(dashboard)/inspection-plans/page'
import { resolveOverdueItemsAction } from '@/app/(dashboard)/inspection-plans/actions'
import { inspectionTypeLabel } from '@/types'

const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

interface Props {
  year: number
  items: OverdueItem[]
  onClose: () => void
  onResolved: () => void
}

function itemKey(item: OverdueItem) {
  return `${item.customer_id}-${item.sequence_num}-${item.due_month}`
}

type ResultRow = { month: number; added: number; error?: string }

export function OverdueResolveModal({ year, items, onClose, onResolved }: Props) {
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.map(itemKey))
  )
  const [results, setResults] = useState<ResultRow[]>([])
  const [done, setDone] = useState(false)

  // 월별 그룹
  const byMonth = items.reduce<Record<number, OverdueItem[]>>((acc, item) => {
    acc[item.due_month] = [...(acc[item.due_month] ?? []), item]
    return acc
  }, {})
  const overdueMonths = Object.keys(byMonth).map(Number).sort((a, b) => a - b)

  function toggleItem(key: string) {
    setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }

  function toggleMonth(month: number) {
    const keys = byMonth[month].map(itemKey)
    const allOn = keys.every(k => selected.has(k))
    setSelected(prev => {
      const s = new Set(prev)
      keys.forEach(k => allOn ? s.delete(k) : s.add(k))
      return s
    })
  }

  const selectedCount = selected.size

  function handleApprove() {
    startTransition(async () => {
      const toProcess = items.filter(i => selected.has(itemKey(i))).map(i => ({
        customer_id:          i.customer_id,
        sequence_num:         i.sequence_num,
        due_month:            i.due_month,
        inspection_type:      i.inspection_type,
        assigned_employee_id: i.assigned_employee_id,
      }))
      const { results: res } = await resolveOverdueItemsAction(year, toProcess)
      setResults(res)
      setDone(true)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[88vh]">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0ddf5] shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-orange-500" />
            <div>
              <p className="text-sm font-semibold text-[#090c1d]">{year}년 미점검 초과 자동 해결</p>
              <p className="text-xs text-[#b0acd6] mt-0.5">
                사용승인일 기준 누락 항목을 해당 월 계획에 자동 추가합니다
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#f5f4ff] rounded-lg transition-colors">
            <X className="size-4 text-[#514b81]" />
          </button>
        </div>

        {/* 연간 달력 */}
        <div className="px-6 py-4 border-b border-[#e0ddf5] shrink-0">
          <p className="text-[11px] font-medium text-[#514b81] mb-2">{year}년 사용승인일 점검 현황</p>
          <div className="grid grid-cols-6 gap-1.5">
            {MONTH_NAMES.map((label, i) => {
              const m = i + 1
              const monthItems = byMonth[m]
              const hasOverdue  = !!monthItems
              const selCount    = monthItems?.filter(it => selected.has(itemKey(it))).length ?? 0
              return (
                <button
                  key={m}
                  type="button"
                  disabled={!hasOverdue || done}
                  onClick={() => hasOverdue && toggleMonth(m)}
                  className={`rounded-lg py-2 px-1 text-center transition-colors ${
                    hasOverdue
                      ? selCount > 0
                        ? 'bg-orange-400 border border-orange-400 text-white cursor-pointer hover:bg-orange-500'
                        : 'bg-orange-100 border border-orange-300 text-orange-500 cursor-pointer hover:bg-orange-200'
                      : 'bg-[#f8f9fa] border border-transparent text-[#d0d0d0] cursor-default'
                  }`}
                >
                  <span className="block text-[11px] font-semibold">{label}</span>
                  {hasOverdue && (
                    <span className="block text-[9px] mt-0.5 font-medium opacity-90">
                      {selCount}/{monthItems.length}건
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-[#b0acd6] mt-2">주황색 월을 클릭하면 해당 월 전체 선택/해제</p>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-6">
          {done ? (
            /* 완료 결과 */
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600 text-sm font-semibold mb-4">
                <CheckCircle className="size-4" />처리 완료
              </div>
              {results.map(r => (
                <div
                  key={r.month}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
                    r.error ? 'border-red-200 bg-red-50' : 'border-green-100 bg-green-50'
                  }`}
                >
                  <span className="font-medium text-[#090c1d]">{year}년 {r.month}월</span>
                  {r.error
                    ? <span className="text-xs text-red-500">{r.error}</span>
                    : <span className="text-xs text-green-600 font-medium">{r.added}건 계획 추가됨</span>
                  }
                </div>
              ))}
            </div>
          ) : (
            /* 선택 UI */
            <div className="space-y-5">
              {overdueMonths.map(month => {
                const monthItems  = byMonth[month]
                const allSelected = monthItems.every(i => selected.has(itemKey(i)))
                return (
                  <div key={month}>
                    {/* 월 헤더 */}
                    <label className="flex items-center gap-2 cursor-pointer mb-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => toggleMonth(month)}
                        className="accent-orange-500"
                      />
                      <span className="text-xs font-semibold text-orange-700">
                        {year}년 {month}월
                      </span>
                      <span className="text-[10px] text-orange-400 font-medium">
                        {monthItems.filter(i => selected.has(itemKey(i))).length}/{monthItems.length}건 선택
                      </span>
                    </label>

                    {/* 항목 목록 */}
                    <div className="space-y-1.5 ml-5">
                      {monthItems.map(item => {
                        const key = itemKey(item)
                        const on  = selected.has(key)
                        const d   = new Date(item.use_approval_date)
                        return (
                          <label
                            key={key}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                              on ? 'border-orange-300 bg-orange-50' : 'border-[#c8c4d0] hover:bg-[#fafafa]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleItem(key)}
                              className="accent-orange-500 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-medium text-[#090c1d] truncate">
                                  {item.customer_name}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                                  item.inspection_type === '종합' ? 'bg-[#f5f4ff] text-[#7b68ee]' :
                                  item.inspection_type === '작동' ? 'bg-blue-50 text-blue-600' :
                                  'bg-gray-100 text-gray-600'
                                }`}>{inspectionTypeLabel(item.inspection_type)}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium shrink-0">
                                  {item.sequence_num}차
                                </span>
                              </div>
                              <p className="text-[11px] text-[#b0acd6] mt-0.5">
                                담당: <span className="font-medium text-[#514b81]">{item.assigned_employee_name ?? '미배정'}</span>
                                {' · '}
                                사용승인 {d.getFullYear()}.{String(d.getMonth()+1).padStart(2,'0')}.{String(d.getDate()).padStart(2,'0')}
                              </p>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-[#e0ddf5] flex gap-2 shrink-0">
          {done ? (
            <button
              onClick={onResolved}
              className="flex-1 py-2.5 text-sm bg-[#7b68ee] text-white rounded-lg font-medium hover:bg-[#6a5acd] transition-colors"
            >
              완료 — 달력 새로고침
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 text-sm border border-[#c8c4d0] rounded-lg text-[#514b81] hover:bg-[#fafafa] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleApprove}
                disabled={isPending || selectedCount === 0}
                className="flex-1 py-2.5 text-sm bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isPending
                  ? <><Loader2 className="size-3.5 animate-spin" />처리 중…</>
                  : `승인 — ${selectedCount}건 계획에 추가`
                }
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
