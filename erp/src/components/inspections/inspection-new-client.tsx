'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Calendar, ChevronRight } from 'lucide-react'
import { createInspectionAction } from '@/app/(dashboard)/inspections/actions'
import { CustomerCombobox } from '@/components/ui/customer-combobox'
import type { InspectionType } from '@/types'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'
const labelCls = 'text-xs font-medium text-[#514b81]'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}

type CustomerOption = { id: string; customer_name: string; customer_code: string; inspection_type: string }
type ContactOption  = { id: string; customer_id: string; role: string; name: string; phone: string | null }
type EmployeeOption = { id: string; name: string; position: string | null }

interface Props {
  customers: CustomerOption[]
  contacts: ContactOption[]
  employees: EmployeeOption[]
  holidayDates: string[]
  currentUserId: string
}

const STEP_DEFS = [
  { step_num: 1, name_ko: '점검일자확정',                            days: 0  },
  { step_num: 2, name_ko: '배치확인서 보고서 작성',                  days: 7  },
  { step_num: 3, name_ko: '관계인 보고서 제출',                      days: 14 },
  { step_num: 4, name_ko: '소방서 보고서 제출 및 이행계획서 등록',   days: 21 },
  { step_num: 5, name_ko: '소방보수 완료',                          days: 28 },
  { step_num: 6, name_ko: '이행완료보고서 제출',                    days: 35 },
]

function calcStepDates(startDate: string, _holidaySet: Set<string>) {
  if (!startDate) return []
  const start = new Date(startDate + 'T12:00:00')
  return STEP_DEFS.map(def => {
    const d = new Date(start)
    d.setDate(d.getDate() + def.days)
    return {
      step_num: def.step_num,
      name_ko: def.name_ko,
      due_date: d.toISOString().split('T')[0],
    }
  })
}

export function InspectionNewClient({ customers, contacts, employees, holidayDates, currentUserId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [customerId, setCustomerId] = useState('')
  const [contactId, setContactId] = useState('')
  const [assignedEmployeeId, setAssignedEmployeeId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [sequenceNum, setSequenceNum] = useState<1 | 2>(1)
  const [notes, setNotes] = useState('')

  const holidaySet = useMemo(() => new Set(holidayDates), [holidayDates])

  const selectedCustomer = customers.find(c => c.id === customerId) ?? null
  const filteredContacts = contacts.filter(c => c.customer_id === customerId)
  const isJongHap = selectedCustomer?.inspection_type === '종합'

  const stepPreview = useMemo(() => calcStepDates(startDate, holidaySet), [startDate, holidaySet])

  const today = new Date().toISOString().split('T')[0]

  function handleSubmit() {
    setError('')
    if (!customerId) { setError('고객을 선택해주세요.'); return }
    if (!assignedEmployeeId) { setError('담당직원을 선택해주세요.'); return }
    if (!startDate) { setError('점검 시작일을 입력해주세요.'); return }

    startTransition(async () => {
      const result = await createInspectionAction({
        customer_id: customerId,
        contact_id: contactId || undefined,
        assigned_employee_id: assignedEmployeeId,
        inspection_type: (selectedCustomer?.inspection_type ?? '작동') as InspectionType,
        inspection_start_date: startDate,
        sequence_num: sequenceNum,
        notes: notes.trim() || undefined,
      })
      if (result.error) {
        setError(result.error)
      } else {
        router.push(`/inspections/${result.inspectionId}`)
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* 점검 기본정보 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <h2 className="text-sm font-semibold text-[#090c1d] mb-4">점검 기본정보</h2>
        <div className="space-y-4">
          <Field label="고객" required>
            <CustomerCombobox
              customers={customers as Parameters<typeof CustomerCombobox>[0]['customers']}
              value={customerId}
              onChange={id => { setCustomerId(id); setContactId('') }}
              placeholder="고객명 또는 코드 입력"
              renderSub={c => `${(c as Record<string,unknown>).inspection_type ?? ''}`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="점검유형">
              <input
                readOnly
                value={selectedCustomer?.inspection_type ?? '—'}
                className={`${inputCls} bg-[#f8f9fa] cursor-not-allowed text-[#514b81]`}
              />
            </Field>
            <Field label="차수" required>
              <select
                value={sequenceNum}
                onChange={e => setSequenceNum(parseInt(e.target.value) as 1 | 2)}
                disabled={!isJongHap}
                className={`${inputCls} ${!isJongHap ? 'bg-[#f8f9fa] cursor-not-allowed text-[#514b81]' : ''}`}
              >
                <option value={1}>1차</option>
                {isJongHap && <option value={2}>2차</option>}
              </select>
            </Field>
          </div>

          <Field label="점검 시작일" required>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input
                type="date"
                value={startDate}
                min={today}
                onChange={e => setStartDate(e.target.value)}
                className={`${inputCls} pl-8`}
              />
            </div>
          </Field>
        </div>
      </div>

      {/* 담당 정보 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <h2 className="text-sm font-semibold text-[#090c1d] mb-4">담당 정보</h2>
        <div className="space-y-4">
          <Field label="담당직원" required>
            <select
              value={assignedEmployeeId}
              onChange={e => setAssignedEmployeeId(e.target.value)}
              className={inputCls}
            >
              <option value="">담당직원 선택</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.position ? ` (${e.position})` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="관계인">
            <select
              value={contactId}
              onChange={e => setContactId(e.target.value)}
              disabled={!customerId}
              className={`${inputCls} ${!customerId ? 'bg-[#f8f9fa] cursor-not-allowed text-[#514b81]' : ''}`}
            >
              <option value="">관계인 선택 (선택사항)</option>
              {filteredContacts.map(c => (
                <option key={c.id} value={c.id}>
                  [{c.role}] {c.name}{c.phone ? ` — ${c.phone}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="비고">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="추가 메모"
              rows={2}
              className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
            />
          </Field>
        </div>
      </div>

      {/* 7단계 예상 일정 미리보기 */}
      {startDate && stepPreview.length > 0 && (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
          <h2 className="text-sm font-semibold text-[#090c1d] mb-1">6단계 예상 일정</h2>
          <p className="text-xs text-[#b0acd6] mb-4">공휴일·주말 제외 작업일 기준으로 자동 계산됩니다</p>
          <div className="space-y-2">
            {stepPreview.map((step, idx) => (
              <div key={step.step_num} className="flex items-center gap-3">
                <div className="size-6 rounded-full bg-[#f5f4ff] flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-[#7b68ee]">{step.step_num}</span>
                </div>
                {idx < stepPreview.length - 1 && (
                  <ChevronRight className="size-3 text-[#b0acd6] shrink-0 -mx-1.5" />
                )}
                <span className="text-xs text-[#090c1d] flex-1">{step.name_ko}</span>
                <span className="text-xs font-medium text-[#514b81] ml-auto">
                  {step.due_date ?? <span className="text-[#b0acd6]">마감일 없음</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="flex items-center gap-2 h-10 px-6 rounded-lg bg-[#7b68ee] hover:bg-[#6a58d6] text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          점검 배정
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="h-10 px-4 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
        >
          취소
        </button>
      </div>
    </div>
  )
}
