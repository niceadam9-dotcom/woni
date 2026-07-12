'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Printer, Trash2, Check, X } from 'lucide-react'
import { issueCertificateAction, deleteCertificateAction, type CertificateType, CERT_TYPE_LABELS } from '@/app/(dashboard)/hr/certificates/actions'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

type Employee = { id: string; name: string; employee_id: string; position: string | null; department: string | null; hire_date: string | null }
type Certificate = {
  id: string; cert_type: string; purpose: string | null; notes: string | null
  issued_at: string; issued_by: string
  employee: { name: string; employee_id: string; position: string | null } | null
  issuer: { name: string } | null
}

export function CertificatesClient({
  certificates, employees,
}: {
  certificates: Record<string, unknown>[]
  employees: Employee[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')
  const [printTarget, setPrintTarget] = useState<Certificate | null>(null)

  const [form, setForm] = useState({
    employee_id: '', cert_type: 'employment' as CertificateType, purpose: '', notes: '',
  })

  const rows = certificates as Certificate[]

  function handleIssue() {
    setError('')
    if (!form.employee_id) { setError('직원을 선택해주세요.'); return }
    startTransition(async () => {
      const result = await issueCertificateAction({
        employee_id: form.employee_id,
        cert_type: form.cert_type,
        purpose: form.purpose || undefined,
        notes: form.notes || undefined,
      })
      if (result.error) { setError(result.error); return }
      setShowNew(false)
      setForm({ employee_id: '', cert_type: 'employment', purpose: '', notes: '' })
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    if (!confirm('발급 이력을 삭제하시겠습니까?')) return
    startTransition(async () => {
      await deleteCertificateAction(id)
      router.refresh()
    })
  }

  function handlePrint(cert: Certificate) {
    setPrintTarget(cert)
    setTimeout(() => window.print(), 300)
  }

  const selectedEmployee = employees.find(e => e.id === form.employee_id)

  return (
    <div className="space-y-4">
      {/* 인쇄용 숨김 영역 */}
      {printTarget && (
        <div id="print-area" className="hidden print:block p-10 font-sans">
          <div className="text-center text-2xl font-bold mb-8">{CERT_TYPE_LABELS[printTarget.cert_type as CertificateType]}</div>
          <table className="w-full border-collapse text-sm mb-6">
            <tbody>
              {[
                ['성명', printTarget.employee?.name],
                ['사번', printTarget.employee?.employee_id],
                ['직책', printTarget.employee?.position ?? '-'],
                ['발급일자', printTarget.issued_at.slice(0, 10)],
                ['발급목적', printTarget.purpose ?? '-'],
              ].map(([k, v]) => (
                <tr key={k as string} className="border border-gray-300">
                  <td className="p-2 bg-gray-50 font-medium w-24">{k}</td>
                  <td className="p-2">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-center mt-10">위와 같이 증명합니다.</p>
          <p className="text-center mt-4">{printTarget.issued_at.slice(0, 10)}</p>
          <div className="text-center mt-16 text-lg font-bold">(주) 승진소방 대표</div>
          <div className="text-center mt-2">(인)</div>
        </div>
      )}

      <div className="print:hidden">
        {showNew ? (
          <div className="bg-[#fafafe] border border-[#d0ccf5] rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[#514b81]">직원<span className="text-red-500 ml-0.5">*</span></label>
                <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))} className={inputCls}>
                  <option value="">직원 선택</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.employee_id})</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[#514b81]">증명서 종류<span className="text-red-500 ml-0.5">*</span></label>
                <select value={form.cert_type} onChange={e => setForm(p => ({ ...p, cert_type: e.target.value as CertificateType }))} className={inputCls}>
                  {Object.entries(CERT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[#514b81]">발급 목적</label>
              <input value={form.purpose} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} placeholder="예: 금융기관 제출용" className={inputCls} />
            </div>
            {selectedEmployee && (
              <div className="bg-white border border-[#c8c4d0] rounded-lg p-3 text-xs text-[#514b81] space-y-1">
                <p>부서: {selectedEmployee.department ?? '-'} | 직책: {selectedEmployee.position ?? '-'}</p>
                <p>입사일: {selectedEmployee.hire_date ?? '-'}</p>
              </div>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowNew(false); setError('') }}
                className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center gap-1"><X className="size-3" />취소</button>
              <button onClick={handleIssue} disabled={isPending}
                className="h-8 px-4 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50 flex items-center gap-1">
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}발급</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowNew(true)}
            className="w-full h-10 rounded-xl border-2 border-dashed border-[#d0ccf5] text-sm text-[#b0acd6] hover:border-[#7b68ee] hover:text-[#7b68ee] transition-colors flex items-center justify-center gap-1.5">
            <Plus className="size-4" />증명서 발급
          </button>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#c8c4d0]">
                {['직원', '사번', '증명서 종류', '발급 목적', '발급일', '발급자', ''].map(h => (
                  <th key={h} className="py-2.5 px-3 text-left font-medium text-[#514b81] text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-[#514b81]">발급 이력이 없습니다</td></tr>
              ) : rows.map(c => (
                <tr key={c.id} className="border-b border-[#c8c4d0] hover:bg-[#f8f9fa]">
                  <td className="py-3 px-3 font-medium text-[#090c1d]">{c.employee?.name ?? '-'}</td>
                  <td className="py-3 px-3 text-[#514b81]">{c.employee?.employee_id ?? '-'}</td>
                  <td className="py-3 px-3"><span className="text-xs bg-[#f5f4ff] text-[#7b68ee] px-1.5 py-0.5 rounded">{CERT_TYPE_LABELS[c.cert_type as CertificateType] ?? c.cert_type}</span></td>
                  <td className="py-3 px-3 text-[#514b81]">{c.purpose ?? '-'}</td>
                  <td className="py-3 px-3 text-[#514b81]">{c.issued_at.slice(0, 10)}</td>
                  <td className="py-3 px-3 text-[#514b81]">{c.issuer?.name ?? '-'}</td>
                  <td className="py-3 px-3">
                    <div className="flex gap-1">
                      <button onClick={() => handlePrint(c)} className="h-7 px-2 rounded-lg text-xs border border-[#c8c4d0] text-[#514b81] hover:bg-[#f5f4ff] hover:text-[#7b68ee] transition-colors flex items-center gap-1">
                        <Printer className="size-3" />출력
                      </button>
                      <button onClick={() => handleDelete(c.id)} disabled={isPending} className="h-7 px-2 rounded-lg text-xs border border-[#c8c4d0] text-[#b0acd6] hover:bg-red-50 hover:text-red-500 transition-colors">
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
