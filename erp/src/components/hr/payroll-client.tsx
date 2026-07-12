'use client'

import { useState, useTransition } from 'react'
import {
  createPayrollAction,
  updatePayrollAction,
  updatePayrollStatusAction,
  deletePayrollAction,
} from '@/app/(dashboard)/hr/payroll/actions'
import { DateInput } from '@/components/ui/date-input'

type Employee = { id: string; full_name: string; department: string | null }

type PayrollRow = {
  id: string
  employee_id: string
  pay_year: number
  pay_month: number
  base_salary: number
  overtime_pay: number
  bonus: number
  allowances: number
  gross_pay: number
  income_tax: number
  local_income_tax: number
  national_pension: number
  health_insurance: number
  employment_insurance: number
  other_deductions: number
  total_deductions: number
  net_pay: number
  pay_date: string | null
  status: '작성중' | '확정' | '지급완료'
  notes: string | null
  profiles: { id: string; full_name: string; department: string | null } | null
}

const STATUS_STYLE: Record<string, string> = {
  '작성중':  'bg-gray-100 text-gray-600',
  '확정':    'bg-blue-100 text-blue-700',
  '지급완료': 'bg-emerald-100 text-emerald-700',
}

function fmt(n: number) { return n.toLocaleString('ko-KR') }

const EMPTY_FORM = {
  employee_id: '',
  pay_year: new Date().getFullYear(),
  pay_month: new Date().getMonth() + 1,
  base_salary: 0,
  overtime_pay: 0,
  bonus: 0,
  allowances: 0,
  income_tax: 0,
  local_income_tax: 0,
  national_pension: 0,
  health_insurance: 0,
  employment_insurance: 0,
  other_deductions: 0,
  pay_date: '',
  notes: '',
}

type FormState = typeof EMPTY_FORM

function calcGross(f: FormState) {
  return f.base_salary + f.overtime_pay + f.bonus + f.allowances
}
function calcDeductions(f: FormState) {
  return f.income_tax + f.local_income_tax + f.national_pension +
         f.health_insurance + f.employment_insurance + f.other_deductions
}
function calcNet(f: FormState) { return calcGross(f) - calcDeductions(f) }

function PayrollModal({
  employees,
  editing,
  onClose,
}: {
  employees: Employee[]
  editing: PayrollRow | null
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          employee_id: editing.employee_id,
          pay_year: editing.pay_year,
          pay_month: editing.pay_month,
          base_salary: editing.base_salary,
          overtime_pay: editing.overtime_pay,
          bonus: editing.bonus,
          allowances: editing.allowances,
          income_tax: editing.income_tax,
          local_income_tax: editing.local_income_tax,
          national_pension: editing.national_pension,
          health_insurance: editing.health_insurance,
          employment_insurance: editing.employment_insurance,
          other_deductions: editing.other_deductions,
          pay_date: editing.pay_date ?? '',
          notes: editing.notes ?? '',
        }
      : EMPTY_FORM
  )
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function num(val: string) { return parseFloat(val) || 0 }
  function set(field: keyof FormState, val: string | number) {
    setForm(prev => ({ ...prev, [field]: val }))
  }

  function handleSubmit() {
    if (!form.employee_id) { setError('직원을 선택하세요.'); return }
    setError('')
    startTransition(async () => {
      const payload = {
        ...form,
        base_salary: form.base_salary,
        overtime_pay: form.overtime_pay,
        bonus: form.bonus,
        allowances: form.allowances,
        income_tax: form.income_tax,
        local_income_tax: form.local_income_tax,
        national_pension: form.national_pension,
        health_insurance: form.health_insurance,
        employment_insurance: form.employment_insurance,
        other_deductions: form.other_deductions,
      }
      const res = editing
        ? await updatePayrollAction(editing.id, payload)
        : await createPayrollAction(payload)
      if (res?.error) { setError(res.error); return }
      onClose()
    })
  }

  const gross = calcGross(form)
  const deductions = calcDeductions(form)
  const net = gross - deductions

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-[#090c1d]">{editing ? '급여 수정' : '급여 등록'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-6 space-y-5">
          {/* 직원·기간 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">직원<span className="text-red-500 ml-0.5">*</span></label>
              <select
                value={form.employee_id}
                onChange={e => set('employee_id', e.target.value)}
                disabled={!!editing}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7b68ee]/40 outline-none disabled:bg-gray-50"
              >
                <option value="">선택</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">연도</label>
              <input
                type="number"
                value={form.pay_year}
                onChange={e => set('pay_year', parseInt(e.target.value))}
                disabled={!!editing}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7b68ee]/40 outline-none disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">월</label>
              <select
                value={form.pay_month}
                onChange={e => set('pay_month', parseInt(e.target.value))}
                disabled={!!editing}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7b68ee]/40 outline-none disabled:bg-gray-50"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>
          </div>

          {/* 지급 항목 */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">지급 항목</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '기본급', field: 'base_salary' as const },
                { label: '시간외수당', field: 'overtime_pay' as const },
                { label: '상여금', field: 'bonus' as const },
                { label: '기타수당', field: 'allowances' as const },
              ].map(({ label, field }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input
                    type="number" min={0}
                    value={form[field]}
                    onChange={e => set(field, num(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7b68ee]/40 outline-none"
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 bg-[#f5f4ff] rounded-lg px-4 py-2 flex justify-between text-sm font-semibold text-[#7b68ee]">
              <span>지급 합계 (총지급액)</span>
              <span>{fmt(gross)}원</span>
            </div>
          </div>

          {/* 공제 항목 */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">공제 항목</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '소득세', field: 'income_tax' as const },
                { label: '지방소득세', field: 'local_income_tax' as const },
                { label: '국민연금', field: 'national_pension' as const },
                { label: '건강보험', field: 'health_insurance' as const },
                { label: '고용보험', field: 'employment_insurance' as const },
                { label: '기타공제', field: 'other_deductions' as const },
              ].map(({ label, field }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input
                    type="number" min={0}
                    value={form[field]}
                    onChange={e => set(field, num(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7b68ee]/40 outline-none"
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 bg-red-50 rounded-lg px-4 py-2 flex justify-between text-sm font-semibold text-red-600">
              <span>공제 합계</span>
              <span>{fmt(deductions)}원</span>
            </div>
          </div>

          {/* 실수령액 */}
          <div className={`rounded-xl p-4 border ${net >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex justify-between items-center">
              <span className={`font-bold text-sm ${net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>실수령액</span>
              <span className={`text-2xl font-bold ${net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(net)}원</span>
            </div>
          </div>

          {/* 지급일·메모 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">지급일</label>
              <DateInput
                value={form.pay_date}
                onChange={e => set('pay_date', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7b68ee]/40 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">비고</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="비고 사항"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7b68ee]/40 outline-none"
              />
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">취소</button>
          <button
            onClick={handleSubmit}
            disabled={pending}
            className="px-4 py-2 text-sm rounded-lg bg-[#7b68ee] text-white hover:bg-[#6a5acd] disabled:opacity-60"
          >
            {pending ? '저장 중…' : (editing ? '수정' : '등록')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PayrollClient({
  payrolls,
  employees,
  year,
}: {
  payrolls: Record<string, unknown>[]
  employees: Employee[]
  year: number
}) {
  const list = payrolls as unknown as PayrollRow[]

  const [filterMonth, setFilterMonth] = useState<number | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<PayrollRow | null>(null)
  const [expanding, setExpanding] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const filtered = list.filter(p => {
    if (filterMonth !== 'all' && p.pay_month !== filterMonth) return false
    if (filterStatus !== 'all' && p.status !== filterStatus) return false
    if (search) {
      const name = p.profiles?.full_name ?? ''
      if (!name.includes(search)) return false
    }
    return true
  })

  const totalGross   = filtered.reduce((s, p) => s + p.gross_pay, 0)
  const totalNet     = filtered.reduce((s, p) => s + p.net_pay, 0)
  const totalDeduct  = filtered.reduce((s, p) => s + p.total_deductions, 0)

  function handleStatusChange(id: string, status: '작성중' | '확정' | '지급완료') {
    startTransition(async () => { await updatePayrollStatusAction(id, status) })
  }

  function handleDelete(id: string) {
    if (!confirm('작성중 급여를 삭제하시겠습니까?')) return
    startTransition(async () => { await deletePayrollAction(id) })
  }

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '총지급액 합계',   value: totalGross,  color: 'text-[#7b68ee]' },
          { label: '공제액 합계',     value: totalDeduct, color: 'text-red-500' },
          { label: '실수령액 합계',   value: totalNet,    color: 'text-emerald-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{fmt(s.value)}<span className="text-sm font-normal ml-0.5">원</span></p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap gap-3 items-center">
        <span className="text-sm font-medium text-gray-500">{year}년</span>
        {/* 월 필터 */}
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setFilterMonth('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium ${filterMonth === 'all' ? 'bg-[#7b68ee] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            전체
          </button>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <button key={m} onClick={() => setFilterMonth(m)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium ${filterMonth === m ? 'bg-[#7b68ee] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {m}월
            </button>
          ))}
        </div>
        {/* 상태 필터 */}
        <div className="flex gap-1">
          {['all', '작성중', '확정', '지급완료'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium ${filterStatus === s ? 'bg-[#7b68ee] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {s === 'all' ? '전체상태' : s}
            </button>
          ))}
        </div>
        <input
          type="text" placeholder="직원명 검색"
          value={search} onChange={e => setSearch(e.target.value)}
          className="ml-auto border rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#7b68ee]/40 w-40"
        />
        <button
          onClick={() => { setEditing(null); setShowModal(true) }}
          className="bg-[#7b68ee] text-white text-sm px-4 py-1.5 rounded-lg hover:bg-[#6a5acd]"
        >
          + 급여 등록
        </button>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                {['직원', '부서', '기간', '총지급액', '공제액', '실수령액', '지급일', '상태', '관리'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400 text-sm">급여 데이터가 없습니다.</td></tr>
              ) : filtered.map(row => (
                <>
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpanding(expanding === row.id ? null : row.id)}
                  >
                    <td className="px-4 py-2.5 font-medium">{row.profiles?.full_name ?? '-'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{row.profiles?.department ?? '-'}</td>
                    <td className="px-4 py-2.5">{row.pay_year}년 {row.pay_month}월</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[#7b68ee]">{fmt(row.gross_pay)}</td>
                    <td className="px-4 py-2.5 text-right text-red-500">{fmt(row.total_deductions)}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-emerald-600">{fmt(row.net_pay)}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{row.pay_date ?? '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[row.status]}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {row.status === '작성중' && (
                          <>
                            <button
                              onClick={() => { setEditing(row); setShowModal(true) }}
                              className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
                            >수정</button>
                            <button
                              onClick={() => handleStatusChange(row.id, '확정')}
                              disabled={pending}
                              className="text-xs px-2 py-1 rounded border text-blue-600 hover:bg-blue-50"
                            >확정</button>
                            <button
                              onClick={() => handleDelete(row.id)}
                              disabled={pending}
                              className="text-xs px-2 py-1 rounded border text-red-500 hover:bg-red-50"
                            >삭제</button>
                          </>
                        )}
                        {row.status === '확정' && (
                          <button
                            onClick={() => handleStatusChange(row.id, '지급완료')}
                            disabled={pending}
                            className="text-xs px-2 py-1 rounded border text-emerald-600 hover:bg-emerald-50"
                          >지급완료</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanding === row.id && (
                    <tr key={`${row.id}-detail`} className="bg-[#faf9ff]">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="grid grid-cols-2 gap-6 text-sm">
                          <div>
                            <p className="text-xs font-semibold text-gray-400 mb-2">지급 내역</p>
                            <table className="w-full">
                              <tbody>
                                {[
                                  ['기본급', row.base_salary],
                                  ['시간외수당', row.overtime_pay],
                                  ['상여금', row.bonus],
                                  ['기타수당', row.allowances],
                                ].map(([label, val]) => (
                                  <tr key={label as string}>
                                    <td className="py-0.5 text-gray-500">{label}</td>
                                    <td className="py-0.5 text-right">{fmt(val as number)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t font-semibold text-[#7b68ee]">
                                  <td className="pt-1">총지급액</td>
                                  <td className="pt-1 text-right">{fmt(row.gross_pay)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-400 mb-2">공제 내역</p>
                            <table className="w-full">
                              <tbody>
                                {[
                                  ['소득세', row.income_tax],
                                  ['지방소득세', row.local_income_tax],
                                  ['국민연금', row.national_pension],
                                  ['건강보험', row.health_insurance],
                                  ['고용보험', row.employment_insurance],
                                  ['기타공제', row.other_deductions],
                                ].map(([label, val]) => (
                                  <tr key={label as string}>
                                    <td className="py-0.5 text-gray-500">{label}</td>
                                    <td className="py-0.5 text-right">{fmt(val as number)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t font-semibold text-red-500">
                                  <td className="pt-1">공제 합계</td>
                                  <td className="pt-1 text-right">{fmt(row.total_deductions)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                        {row.notes && (
                          <p className="mt-3 text-xs text-gray-400">비고: {row.notes}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <PayrollModal
          employees={employees}
          editing={editing}
          onClose={() => { setShowModal(false); setEditing(null) }}
        />
      )}
    </div>
  )
}
