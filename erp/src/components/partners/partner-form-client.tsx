'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, Phone, Mail, User, Building, Hash } from 'lucide-react'
import { createPartnerAction, updatePartnerAction, type PartnerType } from '@/app/(dashboard)/partners/actions'

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

const TYPE_OPTIONS: { value: PartnerType; label: string }[] = [
  { value: 'supplier', label: '공급업체' },
  { value: 'subcontractor', label: '협력업체' },
  { value: 'client', label: '고객사' },
  { value: 'other', label: '기타' },
]

type Partner = {
  id: string; partner_name: string; partner_type: string
  business_number: string | null; representative: string | null
  phone: string | null; email: string | null; address: string | null
  notes: string | null; is_active: boolean
}

export function PartnerFormClient({ existing }: { existing?: Partner }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    partner_name: existing?.partner_name ?? '',
    partner_type: (existing?.partner_type ?? 'supplier') as PartnerType,
    business_number: existing?.business_number ?? '',
    representative: existing?.representative ?? '',
    phone: existing?.phone ?? '',
    email: existing?.email ?? '',
    address: existing?.address ?? '',
    notes: existing?.notes ?? '',
    is_active: existing?.is_active ?? true,
  })

  function setField(key: keyof typeof form, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    setError('')
    if (!form.partner_name.trim()) { setError('업체명을 입력해주세요.'); return }

    startTransition(async () => {
      if (existing) {
        const result = await updatePartnerAction({
          id: existing.id,
          partner_name: form.partner_name.trim(),
          partner_type: form.partner_type,
          business_number: form.business_number.trim() || undefined,
          representative: form.representative.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          notes: form.notes.trim() || undefined,
          is_active: form.is_active,
        })
        if (result.error) { setError(result.error); return }
        router.refresh()
      } else {
        const result = await createPartnerAction({
          partner_name: form.partner_name.trim(),
          partner_type: form.partner_type,
          business_number: form.business_number.trim() || undefined,
          representative: form.representative.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          notes: form.notes.trim() || undefined,
        })
        if (result.error) { setError(result.error); return }
        router.push(`/partners/${result.partnerId}`)
        router.refresh()
      }
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">거래처 기본정보</h2>

        <div className="grid grid-cols-2 gap-4">
          <Field label="업체명" required>
            <div className="relative">
              <Building className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.partner_name} onChange={e => setField('partner_name', e.target.value)}
                placeholder="업체명" className={`${inputCls} pl-8`} />
            </div>
          </Field>
          <Field label="유형" required>
            <select value={form.partner_type} onChange={e => setField('partner_type', e.target.value as PartnerType)} className={inputCls}>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="사업자등록번호">
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.business_number} onChange={e => setField('business_number', e.target.value)}
                placeholder="000-00-00000" className={`${inputCls} pl-8`} />
            </div>
          </Field>
          <Field label="대표자">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.representative} onChange={e => setField('representative', e.target.value)}
                placeholder="대표자명" className={`${inputCls} pl-8`} />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="연락처">
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.phone} onChange={e => setField('phone', e.target.value)}
                placeholder="02-0000-0000" className={`${inputCls} pl-8`} />
            </div>
          </Field>
          <Field label="이메일">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input type="email" value={form.email} onChange={e => setField('email', e.target.value)}
                placeholder="example@company.com" className={`${inputCls} pl-8`} />
            </div>
          </Field>
        </div>

        <Field label="주소">
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
            <input value={form.address} onChange={e => setField('address', e.target.value)}
              placeholder="사업장 주소" className={`${inputCls} pl-8`} />
          </div>
        </Field>

        <Field label="비고">
          <textarea value={form.notes} onChange={e => setField('notes', e.target.value)}
            placeholder="특이사항" rows={2}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none" />
        </Field>

        {existing && (
          <div className="flex items-center gap-3">
            <span className={labelCls}>활성 상태</span>
            <button type="button" onClick={() => setField('is_active', !form.is_active)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_active ? 'bg-[#7b68ee]' : 'bg-gray-200'}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-[#514b81]">{form.is_active ? '활성' : '비활성'}</span>
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

      <div className="flex gap-3 pb-8">
        <button type="button" onClick={() => router.back()}
          className="flex-1 h-11 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors">
          취소
        </button>
        <button type="button" onClick={handleSubmit} disabled={isPending}
          className="flex-1 h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : (existing ? '저장' : '거래처 등록')}
        </button>
      </div>
    </div>
  )
}
