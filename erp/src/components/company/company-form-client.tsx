'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, Phone, Mail, User, Building, Hash, Printer } from 'lucide-react'
import { upsertCompanyAction } from '@/app/(dashboard)/company/actions'
import { DateInput } from '@/components/ui/date-input'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[#514b81]">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}

type CompanyInfo = {
  company_name: string; business_number: string | null; representative: string | null
  phone: string | null; fax: string | null; email: string | null; address: string | null
  industry: string | null; established_date: string | null; logo_url: string | null
}

export function CompanyFormClient({ existing }: { existing?: CompanyInfo }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState({
    company_name: existing?.company_name ?? '',
    business_number: existing?.business_number ?? '',
    representative: existing?.representative ?? '',
    phone: existing?.phone ?? '',
    fax: existing?.fax ?? '',
    email: existing?.email ?? '',
    address: existing?.address ?? '',
    industry: existing?.industry ?? '',
    established_date: existing?.established_date ?? '',
    logo_url: existing?.logo_url ?? '',
  })

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    setError(''); setSaved(false)
    if (!form.company_name.trim()) { setError('회사명을 입력해주세요.'); return }

    startTransition(async () => {
      const result = await upsertCompanyAction({
        company_name: form.company_name.trim(),
        business_number: form.business_number.trim() || undefined,
        representative: form.representative.trim() || undefined,
        phone: form.phone.trim() || undefined,
        fax: form.fax.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        industry: form.industry.trim() || undefined,
        established_date: form.established_date || undefined,
        logo_url: form.logo_url.trim() || undefined,
      })
      if (result.error) { setError(result.error); return }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">본사 기본정보</h2>

        <Field label="회사명" required>
          <div className="relative">
            <Building className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
            <input value={form.company_name} onChange={e => setField('company_name', e.target.value)}
              placeholder="(주)승진소방" className={`${inputCls} pl-8`} />
          </div>
        </Field>

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
          <Field label="대표전화">
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.phone} onChange={e => setField('phone', e.target.value)}
                placeholder="02-0000-0000" className={`${inputCls} pl-8`} />
            </div>
          </Field>
          <Field label="팩스">
            <div className="relative">
              <Printer className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.fax} onChange={e => setField('fax', e.target.value)}
                placeholder="02-0000-0001" className={`${inputCls} pl-8`} />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="이메일">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input type="email" value={form.email} onChange={e => setField('email', e.target.value)}
                placeholder="info@company.com" className={`${inputCls} pl-8`} />
            </div>
          </Field>
          <Field label="설립일">
            <DateInput value={form.established_date} onChange={e => setField('established_date', e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="업종">
          <input value={form.industry} onChange={e => setField('industry', e.target.value)}
            placeholder="예: 소방시설 점검업" className={inputCls} />
        </Field>

        <Field label="주소">
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
            <input value={form.address} onChange={e => setField('address', e.target.value)}
              placeholder="본사 주소" className={`${inputCls} pl-8`} />
          </div>
        </Field>
      </section>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>}
      {saved && <p className="text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">저장되었습니다.</p>}

      <div className="pb-8">
        <button type="button" onClick={handleSubmit} disabled={isPending}
          className="w-full h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : '저장'}
        </button>
      </div>
    </div>
  )
}
