'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { X, Search, ChevronDown } from 'lucide-react'
import type { InspectionType } from '@/types'
import { inspectionTypeLabel } from '@/types'
import { addPlanItemAction } from '@/app/(dashboard)/inspection-plans/actions'
import { DateInput } from '@/components/ui/date-input'

type Employee = { id: string; name: string; position: string | null }
type CustomerOption = {
  id: string; customer_name: string; inspection_type: InspectionType
  assigned_employee_id: string | null; address: string | null
  plan_anchor_date: string | null
  /** 기준일: 점검계획일(수동) → 최초 점검시작일 — 예정일 자동 계산용 */
  anchor_date: string | null
}

interface Props {
  planId: string
  planYear: number
  defaultDate: string | null
  employees: Employee[]
  customers: CustomerOption[]
  /** DB에서 조회된 공휴일 날짜 배열 (YYYY-MM-DD). 대체공휴일 포함. */
  holidays: string[]
  onClose: () => void
  onSaved: () => void
}

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

function suggestScheduledDate(useApprovalDate: string, planYear: number, holidaySet: Set<string>): string {
  const approval = new Date(useApprovalDate)
  const month = approval.getMonth()
  const day = approval.getDate()
  const daysInMonth = new Date(planYear, month + 1, 0).getDate()
  const anniversary = new Date(planYear, month, Math.min(day, daysInMonth))
  return toDateStr(nextWorkingDay(anniversary, holidaySet))
}

export function AddPlanItemModal({ planId, planYear, defaultDate, employees, customers, holidays, onClose, onSaved }: Props) {
  const todayStr = new Date().toISOString().split('T')[0]
  const [isPending, startTransition] = useTransition()
  const [customerId, setCustomerId] = useState('')
  const [sequenceNum, setSequenceNum] = useState<1 | 2>(1)
  const [scheduledDate, setScheduledDate] = useState(defaultDate ?? todayStr)
  const [autoFilled, setAutoFilled] = useState(!defaultDate)
  const [assignedEmployeeId, setAssignedEmployeeId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const holidaySet = new Set(holidays)

  // 주소검색 combobox state
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const comboRef = useRef<HTMLDivElement>(null)

  const selectedCustomer = customers.find(c => c.id === customerId)

  // 검색 필터: 건물명 OR 주소 포함
  const filtered = query.trim() === ''
    ? customers
    : customers.filter(c => {
        const q = query.toLowerCase()
        return (
          c.customer_name.toLowerCase().includes(q) ||
          (c.address ?? '').toLowerCase().includes(q)
        )
      })

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSelect(c: CustomerOption) {
    setCustomerId(c.id)
    setQuery(c.customer_name)
    setOpen(false)
    if (c.assigned_employee_id) setAssignedEmployeeId(c.assigned_employee_id)
    // 점검계획일(기준일) 다음 영업일(토·일·공휴일·대체공휴일 제외) 자동 설정 (오늘 날짜 기본값보다 우선)
    if (c.anchor_date) {
      setScheduledDate(suggestScheduledDate(c.anchor_date, planYear, holidaySet))
      setAutoFilled(true)
    }
  }

  function handleQueryChange(val: string) {
    setQuery(val)
    setCustomerId('')
    setOpen(true)
    if (autoFilled) setAutoFilled(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!customerId) { setError('고객을 선택해주세요.'); return }
    setError('')
    startTransition(async () => {
      const res = await addPlanItemAction({
        planId,
        customerId,
        inspectionType: selectedCustomer?.inspection_type ?? '종합',
        sequenceNum,
        scheduledDate: scheduledDate || undefined,
        assignedEmployeeId: assignedEmployeeId || undefined,
        notes: notes || undefined,
      })
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0ddf5]">
          <h2 className="text-sm font-semibold text-[#090c1d]">점검 항목 추가</h2>
          <button onClick={onClose} className="p-1 hover:bg-[#f5f4ff] rounded-lg transition-colors">
            <X className="size-4 text-[#514b81]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 건물명 / 주소 검색 combobox */}
          <div>
            <label className="text-xs font-medium text-[#514b81] mb-1 block">건물명 / 주소 검색<span className="text-red-500 ml-0.5">*</span></label>
            <div ref={comboRef} className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
                <input
                  type="text"
                  value={query}
                  onChange={e => handleQueryChange(e.target.value)}
                  onFocus={() => setOpen(true)}
                  placeholder="건물명 또는 주소 입력..."
                  className="w-full text-sm border border-[#c8c4d0] rounded-lg pl-9 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
                />
                <ChevronDown
                  className={`absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6] transition-transform cursor-pointer ${open ? 'rotate-180' : ''}`}
                  onClick={() => setOpen(v => !v)}
                />
              </div>

              {open && (
                <div className="absolute z-10 mt-1 w-full bg-white rounded-xl border border-[#c8c4d0] shadow-lg max-h-52 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="text-xs text-[#b0acd6] px-3 py-3 text-center">일치하는 고객 없음</p>
                  ) : (
                    filtered.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelect(c)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-[#f5f4ff] transition-colors border-b border-[#f5f5f5] last:border-0 ${
                          customerId === c.id ? 'bg-[#f5f4ff]' : ''
                        }`}
                      >
                        <p className="text-sm font-medium text-[#090c1d] truncate">{c.customer_name}</p>
                        {c.address && (
                          <p className="text-[11px] text-[#b0acd6] truncate mt-0.5">{c.address}</p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {!open && filtered.length > 0 && !customerId && query && (
              <p className="text-[11px] text-[#b0acd6] mt-1">↑ 목록에서 선택해주세요</p>
            )}
          </div>

          {selectedCustomer && (
            <div className="flex items-center gap-2 text-xs text-[#514b81] bg-[#f5f4ff] rounded-lg px-3 py-2">
              <span>점검유형:</span>
              <span className="font-medium text-[#7b68ee]">{inspectionTypeLabel(selectedCustomer.inspection_type)}</span>
              {selectedCustomer.address && (
                <>
                  <span className="text-[#c8c4d0]">|</span>
                  <span className="text-[#b0acd6] truncate">{selectedCustomer.address}</span>
                </>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-[#514b81] mb-1 block">차수</label>
            <div className="flex gap-2">
              {([1, 2] as const).map(n => (
                <button
                  key={n} type="button"
                  onClick={() => setSequenceNum(n)}
                  className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                    sequenceNum === n
                      ? 'border-[#7b68ee] bg-[#f5f4ff] text-[#7b68ee] font-medium'
                      : 'border-[#c8c4d0] text-[#514b81] hover:bg-[#fafafa]'
                  }`}
                >
                  {n}차
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[#514b81]">점검 예정일</label>
              {autoFilled && (
                <span className="text-[10px] text-[#7b68ee] bg-[#f5f4ff] px-1.5 py-0.5 rounded-full font-medium">
                  {customerId ? '자동 — 점검계획일 다음 영업일' : '자동 — 오늘 날짜'}
                </span>
              )}
            </div>
            <DateInput
              value={scheduledDate}
              onChange={e => { setScheduledDate(e.target.value); setAutoFilled(false) }}
              className="w-full text-sm border border-[#c8c4d0] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[#514b81] mb-1 block">담당직원</label>
            <select
              value={assignedEmployeeId}
              onChange={e => setAssignedEmployeeId(e.target.value)}
              className="w-full text-sm border border-[#c8c4d0] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
            >
              <option value="">미배정</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-[#514b81] mb-1 block">메모</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full text-sm border border-[#c8c4d0] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-[#c8c4d0] rounded-lg text-[#514b81] hover:bg-[#fafafa] transition-colors">
              취소
            </button>
            <button type="submit" disabled={isPending} className="flex-1 py-2.5 text-sm bg-[#7b68ee] text-white rounded-lg font-medium hover:bg-[#6a5acd] transition-colors disabled:opacity-50">
              {isPending ? '추가 중…' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
