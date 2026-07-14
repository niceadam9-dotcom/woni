'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronLeft, Check, RefreshCw, Calendar, Users, AlertCircle } from 'lucide-react'
import {
  autoGeneratePlanAction,
  addPlanItemAction,
  updatePlanStatusAction,
  createInspectionPlanAction,
} from '@/app/(dashboard)/inspection-plans/actions'
import type { InspectionType, PlanItemStatus } from '@/types'
import { inspectionTypeLabel } from '@/types'
import { DateInput } from '@/components/ui/date-input'

type CustomerRow = {
  id: string; customer_name: string; customer_code: string
  inspection_type: string; assigned_employee_id: string | null
  /** 기준일: 점검계획일(수동) → 최초 점검시작일 → 사용승인일 — 날짜 자동 배분용 */
  anchor_date: string | null
}

function _toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function _nextWorkday(base: Date, holidaySet: Set<string>): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + 1)
  while (true) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !holidaySet.has(_toDateStr(d))) break
    d.setDate(d.getDate() + 1)
  }
  return d
}
function _calcDate(anchorDate: string, year: number, month: number, holidaySet: Set<string>): string {
  const approvalDay = new Date(anchorDate).getDate()
  const daysInMonth = new Date(year, month, 0).getDate()
  const base = new Date(year, month - 1, Math.min(approvalDay, daysInMonth))
  return _toDateStr(_nextWorkday(base, holidaySet))
}
type Employee = { id: string; name: string; position: string | null }

interface DraftItem {
  customer_id: string
  customer_name: string
  inspection_type: InspectionType
  sequence_num: 1 | 2
  scheduled_date: string
  assigned_employee_id: string
}

interface Props {
  year: number; month: number
  existingPlanId: string | null
  existingPlanStatus: string | null
  prevPlan: { id: string; year: number; month: number } | null
  customers: CustomerRow[]
  employees: Employee[]
  holidays: string[]
}

const STEPS = ['조건 설정', '미리보기·수동 조정', '확정']

export function AutoGenerateWizard({
  year, month, existingPlanId, existingPlanStatus, prevPlan, customers, employees, holidays,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState(existingPlanId ? 1 : 0)
  const [error, setError] = useState('')

  // Step 0: 조건 설정
  const [useRef, setUseRef]   = useState(!!prevPlan)
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>(
    customers.map(c => c.id)
  )

  // Step 1: 미리보기 항목 (편집 가능)
  const [planId, setPlanId]   = useState(existingPlanId ?? '')
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [generated, setGenerated]   = useState(!!existingPlanId)

  const holidaySet = new Set(holidays)
  function isWeekend(d: Date) { const dow = d.getDay(); return dow === 0 || dow === 6 }
  function isHoliday(d: Date) { return holidaySet.has(d.toISOString().split('T')[0]) }
  function isWorkday(d: Date) { return !isWeekend(d) && !isHoliday(d) }

  // 점검계획일(기준일) 기준 영업일 자동 배분
  function assignDates(items: Omit<DraftItem, 'scheduled_date'>[]): DraftItem[] {
    // 첫 영업일 fallback용
    const daysInMonth = new Date(year, month, 0).getDate()
    let firstWorkday = ''
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d)
      if (isWorkday(date)) { firstWorkday = date.toISOString().split('T')[0]; break }
    }

    return items.map(item => {
      const customer = customers.find(c => c.id === item.customer_id)
      const anchorDate = customer?.anchor_date
      const scheduled_date = anchorDate
        ? _calcDate(anchorDate, year, month, holidaySet)
        : firstWorkday
      return { ...item, scheduled_date }
    })
  }

  // Step 0 → Step 1: 초안 생성
  async function handleGenerate() {
    setError('')
    startTransition(async () => {
      // 계획 헤더 생성 또는 기존 사용
      let pid = planId
      if (!pid) {
        const res = await createInspectionPlanAction({ year, month })
        if (res.error) { setError(res.error); return }
        pid = res.planId!
        setPlanId(pid)
      }

      // 초안 항목 구성
      const filtered = customers.filter(c => selectedCustomers.includes(c.id))
      const rawItems: Omit<DraftItem, 'scheduled_date'>[] = []
      for (const c of filtered) {
        const seqMax = c.inspection_type === '종합' ? 2 : 1
        for (let s = 1; s <= seqMax; s++) {
          rawItems.push({
            customer_id: c.id,
            customer_name: c.customer_name,
            inspection_type: c.inspection_type as InspectionType,
            sequence_num: s as 1 | 2,
            assigned_employee_id: c.assigned_employee_id ?? '',
          })
        }
      }

      setDraftItems(assignDates(rawItems))
      setGenerated(true)
      setStep(1)
    })
  }

  // Step 1 → Step 2: 항목 저장
  async function handleSaveDraft() {
    setError('')
    startTransition(async () => {
      for (const item of draftItems) {
        const res = await addPlanItemAction({
          planId,
          customerId: item.customer_id,
          inspectionType: item.inspection_type,
          sequenceNum: item.sequence_num,
          scheduledDate: item.scheduled_date || undefined,
          assignedEmployeeId: item.assigned_employee_id || undefined,
        })
        if (res.error) { setError(res.error); return }
      }
      setStep(2)
    })
  }

  // Step 2: 확정
  async function handleConfirm() {
    setError('')
    startTransition(async () => {
      const res = await updatePlanStatusAction(planId, 'confirmed')
      if (res.error) { setError(res.error); return }
      router.push('/inspection-plans')
    })
  }

  function updateDraftItem(idx: number, patch: Partial<DraftItem>) {
    setDraftItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
  }

  const toggleCustomer = (id: string) =>
    setSelectedCustomers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )

  return (
    <div className="max-w-3xl space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">
          {year}년 {month}월 점검계획 자동 생성
        </h1>
        <p className="text-sm text-[#514b81] mt-1">전월 계획 기반으로 이달 점검계획 초안을 자동 생성합니다.</p>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="flex items-center gap-0">
        {STEPS.map((label, idx) => (
          <div key={idx} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
              step === idx ? 'bg-[#7b68ee] text-white font-medium' :
              step > idx  ? 'text-green-600' : 'text-[#b0acd6]'
            }`}>
              {step > idx ? <Check className="size-3.5" /> : <span className="text-xs font-bold">{idx + 1}</span>}
              {label}
            </div>
            {idx < STEPS.length - 1 && <ChevronRight className="size-4 text-[#c8c4d0] mx-1" />}
          </div>
        ))}
      </div>

      {/* Step 0: 조건 설정 */}
      {step === 0 && (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-5">
          {prevPlan ? (
            <div className="flex items-start gap-3 p-3 bg-[#f5f4ff] rounded-lg">
              <Calendar className="size-4 text-[#7b68ee] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#090c1d]">참조 계획 발견</p>
                <p className="text-xs text-[#514b81] mt-0.5">
                  {prevPlan.year}년 {prevPlan.month}월 계획을 기반으로 담당직원과 고객 정보를 복사합니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg">
              <AlertCircle className="size-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">전월 계획이 없습니다. 전체 활성 고객으로 초안을 생성합니다.</p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-[#090c1d]">점검 대상 고객 선택</p>
              <div className="flex gap-2 text-xs text-[#514b81]">
                <button onClick={() => setSelectedCustomers(customers.map(c => c.id))} className="hover:text-[#7b68ee]">전체선택</button>
                <span>/</span>
                <button onClick={() => setSelectedCustomers([])} className="hover:text-[#7b68ee]">전체해제</button>
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1 border border-[#e0ddf5] rounded-lg p-2">
              {customers.map(c => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[#fafafa]">
                  <input
                    type="checkbox"
                    checked={selectedCustomers.includes(c.id)}
                    onChange={() => toggleCustomer(c.id)}
                    className="accent-[#7b68ee]"
                  />
                  <span className="text-sm text-[#090c1d] flex-1">{c.customer_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    c.inspection_type === '종합' ? 'bg-[#f5f4ff] text-[#7b68ee]' : 'bg-blue-50 text-blue-600'
                  }`}>{inspectionTypeLabel(c.inspection_type)}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-[#b0acd6] mt-1">선택: {selectedCustomers.length}개 / 전체: {customers.length}개</p>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={isPending || selectedCustomers.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#7b68ee] text-white text-sm font-medium rounded-lg hover:bg-[#6a5acd] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} />
              {isPending ? '생성 중…' : '초안 생성'}
            </button>
          </div>
        </div>
      )}

      {/* Step 1: 미리보기·수동 조정 */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e0ddf5] flex items-center justify-between">
            <p className="text-sm font-semibold text-[#090c1d]">초안 항목 ({draftItems.length}건) — 날짜·담당자 수정 가능</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafafa] border-b border-[#e0ddf5]">
                  {['건물명','유형','차수','점검예정일','담당직원'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-[#514b81] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draftItems.map((item, idx) => (
                  <tr key={idx} className="border-b border-[#f8f9fa] last:border-0">
                    <td className="px-4 py-2 font-medium text-[#090c1d]">{item.customer_name}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        item.inspection_type === '종합' ? 'bg-[#f5f4ff] text-[#7b68ee]' : 'bg-blue-50 text-blue-600'
                      }`}>{inspectionTypeLabel(item.inspection_type)}</span>
                    </td>
                    <td className="px-4 py-2 text-[#514b81]">{item.sequence_num}차</td>
                    <td className="px-4 py-2">
                      <DateInput
                        value={item.scheduled_date}
                        onChange={e => updateDraftItem(idx, { scheduled_date: e.target.value })}
                        className="text-xs border border-[#c8c4d0] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={item.assigned_employee_id}
                        onChange={e => updateDraftItem(idx, { assigned_employee_id: e.target.value })}
                        className="text-xs border border-[#c8c4d0] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
                      >
                        <option value="">미배정</option>
                        {employees.map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="text-xs text-red-500 px-5 py-2">{error}</p>}

          <div className="px-5 py-4 border-t border-[#e0ddf5] flex justify-between">
            <button onClick={() => setStep(0)} className="flex items-center gap-1.5 text-sm text-[#514b81] hover:text-[#7b68ee] transition-colors">
              <ChevronLeft className="size-4" />이전
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#7b68ee] text-white text-sm font-medium rounded-lg hover:bg-[#6a5acd] transition-colors disabled:opacity-50"
            >
              {isPending ? '저장 중…' : '계획 저장 →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: 확정 */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-8 text-center space-y-4">
          <div className="size-14 bg-green-50 rounded-full flex items-center justify-center mx-auto">
            <Check className="size-7 text-green-500" />
          </div>
          <p className="text-base font-semibold text-[#090c1d]">
            {year}년 {month}월 계획 초안이 저장되었습니다
          </p>
          <p className="text-sm text-[#514b81]">
            {draftItems.length}건의 점검 항목이 등록되었습니다.<br />
            계획을 <strong>확정</strong>하거나 나중에 수정할 수 있습니다.
          </p>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={() => router.push('/inspection-plans')}
              className="px-5 py-2.5 text-sm border border-[#c8c4d0] rounded-lg text-[#514b81] hover:bg-[#fafafa] transition-colors"
            >
              나중에 확정
            </button>
            <button
              onClick={handleConfirm}
              disabled={isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#7b68ee] text-white text-sm font-medium rounded-lg hover:bg-[#6a5acd] transition-colors disabled:opacity-50"
            >
              <Check className="size-4" />
              {isPending ? '확정 중…' : '계획 확정'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
