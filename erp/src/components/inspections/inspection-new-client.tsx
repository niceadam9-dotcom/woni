'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Calendar, ChevronRight } from 'lucide-react'
import { createInspectionAction } from '@/app/(dashboard)/inspections/actions'
import { CustomerCombobox } from '@/components/ui/customer-combobox'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { previewInspectionSteps, stepBaseDate } from '@/lib/step-dates'
import { formatTel } from '@/lib/format-contact'
import type { InspectionType } from '@/types'

const inputCls = 'w-full h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'
const labelCls = 'text-xs font-medium text-ink-sub'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}

type CustomerOption = { id: string; customer_name: string; customer_code: string; inspection_type: string; use_approval_date: string | null }
type ContactOption  = { id: string; customer_id: string; role: string; name: string; phone: string | null }
type EmployeeOption = { id: string; name: string; position: string | null }

interface Props {
  customers: CustomerOption[]
  contacts: ContactOption[]
  employees: EmployeeOption[]
  holidayDates: string[]
  currentUserId: string
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

  // 마감일은 DB 트리거가 만든다 — 미리보기도 같은 산식(lib/step-dates)을 쓴다.
  // 사용승인일이 있는 고객은 트리거가 그 응당일을 기준일로 삼으므로 점검일과 다를 수 있어 아래에 근거를 표시한다.
  const stepPreview = useMemo(
    () => previewInspectionSteps({ startDate, useApprovalDate: selectedCustomer?.use_approval_date, holidays: holidaySet }),
    [startDate, selectedCustomer?.use_approval_date, holidaySet],
  )
  const anchorDate = startDate && isCompleteDate(startDate)
    ? stepBaseDate(startDate, selectedCustomer?.use_approval_date) : ''

  const today = new Date().toISOString().split('T')[0]

  function handleSubmit() {
    setError('')
    if (!customerId) { setError('고객을 선택해주세요.'); return }
    if (!assignedEmployeeId) { setError('담당직원을 선택해주세요.'); return }
    if (!startDate) { setError('점검 시작일을 입력해주세요.'); return }
    if (!isCompleteDate(startDate)) { setError('점검 시작일을 YYYY-MM-DD 형식으로 입력해주세요.'); return }
    if (startDate < today) { setError('점검 시작일은 오늘 이후 날짜여야 합니다.'); return }

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
      <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <h2 className="text-sm font-semibold text-ink mb-4">점검 기본정보</h2>
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
                className={`${inputCls} bg-paper cursor-not-allowed text-ink-sub`}
              />
            </Field>
            <Field label="차수" required>
              <select
                value={sequenceNum}
                onChange={e => setSequenceNum(parseInt(e.target.value) as 1 | 2)}
                disabled={!isJongHap}
                className={`${inputCls} ${!isJongHap ? 'bg-paper cursor-not-allowed text-ink-sub' : ''}`}
              >
                <option value={1}>1차</option>
                {isJongHap && <option value={2}>2차</option>}
              </select>
            </Field>
          </div>

          <Field label="점검 시작일" required>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
              <DateInput
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className={`${inputCls} pl-8`}
              />
            </div>
          </Field>
        </div>
      </div>

      {/* 담당 정보 */}
      <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <h2 className="text-sm font-semibold text-ink mb-4">담당 정보</h2>
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
              className={`${inputCls} ${!customerId ? 'bg-paper cursor-not-allowed text-ink-sub' : ''}`}
            >
              <option value="">관계인 선택 (선택사항)</option>
              {filteredContacts.map(c => (
                <option key={c.id} value={c.id}>
                  [{c.role}] {c.name}{c.phone ? ` — ${formatTel(c.phone)}` : ''}
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
              className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition resize-none"
            />
          </Field>
        </div>
      </div>

      {/* 6단계 예상 일정 미리보기 — 등록 후 생성되는 실제 마감일과 같은 산식 */}
      {startDate && stepPreview.length > 0 && (
        <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
          <h2 className="text-sm font-semibold text-ink mb-1">6단계 예상 일정</h2>
          <p className="text-xs text-ink-faint mb-4">
            공휴일·주말 제외 작업일 기준으로 자동 계산됩니다 (⑤ 소방보수 완료만 달력일)
            {anchorDate && anchorDate !== startDate && (
              <><br />기준일 {anchorDate} — 이 고객은 사용승인일 응당일이 기준입니다 (점검일 아님)</>
            )}
          </p>
          <div className="space-y-2">
            {stepPreview.map((step, idx) => (
              <div key={step.step_num} className="flex items-center gap-3">
                <div className="size-6 rounded-full bg-brand-tint flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-brand">{step.step_num}</span>
                </div>
                {idx < stepPreview.length - 1 && (
                  <ChevronRight className="size-3 text-ink-faint shrink-0 -mx-1.5" />
                )}
                <span className="text-xs text-ink flex-1">{step.name_ko}</span>
                <span className="text-xs font-medium text-ink-sub ml-auto">
                  {step.due_date ?? <span className="text-ink-faint">마감일 없음</span>}
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
          className="flex items-center gap-2 h-10 px-6 rounded-lg bg-brand hover:bg-brand-strong text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          점검 배정
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="h-10 px-4 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper transition-colors"
        >
          취소
        </button>
      </div>
    </div>
  )
}
