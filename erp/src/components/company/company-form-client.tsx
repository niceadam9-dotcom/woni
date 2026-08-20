'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, Phone, Mail, User, Building, Hash, Printer } from 'lucide-react'
import { upsertCompanyAction } from '@/app/(dashboard)/company/actions'
import { DateInput } from '@/components/ui/date-input'
import { formatPhoneKR } from '@/components/ui/fields'
import { formatBizNo, formatBizNoKR, formatTel } from '@/lib/format-contact'

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
  management_reg_no: string | null
  phone: string | null; fax: string | null; email: string | null; address: string | null
  industry: string | null; established_date: string | null; logo_url: string | null
  /** 공문 발신 명의 (147) — 레터헤드·표지·위임장과 별개 축 */
  official_sender_name?: string | null; official_rep_title?: string | null
}

export function CompanyFormClient({ existing }: { existing?: CompanyInfo }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState({
    company_name: existing?.company_name ?? '',
    // 사업자번호·전화·팩스는 과거 자유 입력분도 열자마자 정규 형식으로 (저장 시 그대로 정착)
    business_number: formatBizNo(existing?.business_number),
    management_reg_no: existing?.management_reg_no ?? '',
    representative: existing?.representative ?? '',
    phone: formatTel(existing?.phone),
    fax: formatTel(existing?.fax),
    email: existing?.email ?? '',
    address: existing?.address ?? '',
    industry: existing?.industry ?? '',
    established_date: existing?.established_date ?? '',
    logo_url: existing?.logo_url ?? '',
    official_sender_name: existing?.official_sender_name ?? '',
    official_rep_title: existing?.official_rep_title ?? '',
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
        management_reg_no: form.management_reg_no.trim() || undefined,
        representative: form.representative.trim() || undefined,
        phone: form.phone.trim() || undefined,
        fax: form.fax.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        industry: form.industry.trim() || undefined,
        established_date: form.established_date || undefined,
        logo_url: form.logo_url.trim() || undefined,
        official_sender_name: form.official_sender_name.trim() || undefined,
        official_rep_title: form.official_rep_title.trim() || undefined,
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
              <input value={form.business_number} onChange={e => setField('business_number', formatBizNoKR(e.target.value))}
                inputMode="numeric" placeholder="000-00-00000" className={`${inputCls} pl-8`} />
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
              <input value={form.phone} onChange={e => setField('phone', formatPhoneKR(e.target.value))}
                inputMode="tel" placeholder="02-0000-0000" className={`${inputCls} pl-8`} />
            </div>
          </Field>
          <Field label="팩스">
            <div className="relative">
              <Printer className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.fax} onChange={e => setField('fax', formatPhoneKR(e.target.value))}
                inputMode="tel" placeholder="02-0000-0001" className={`${inputCls} pl-8`} />
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

        <div className="grid grid-cols-2 gap-4">
          <Field label="업종">
            <input value={form.industry} onChange={e => setField('industry', e.target.value)}
              placeholder="예: 소방시설 점검업" className={inputCls} />
          </Field>
          <Field label="관리업 등록번호">
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.management_reg_no} onChange={e => setField('management_reg_no', e.target.value)}
                placeholder="예: 2026-15 → 별지4호 (제 2026-15 호)" className={`${inputCls} pl-8`} />
            </div>
          </Field>
        </div>

        <Field label="주소">
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
            <input value={form.address} onChange={e => setField('address', e.target.value)}
              placeholder="본사 주소" className={`${inputCls} pl-8`} />
          </div>
        </Field>
      </section>

      {/* 공문 발신 명의 (147) — 회사명과 **일부러 분리**한 축.
          회사명은 공문 레터헤드·표지·위임장이 함께 읽으므로, 거기에 법인격을 붙이면 세 곳이 같이 바뀐다. */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[#090c1d]">공문 발신 명의</h2>
          <p className="mt-1 text-xs text-[#847ba8]">
            결과보고서 제출 공문 맨 아래에 찍히는 이름입니다. 상단 레터헤드·표지·위임장은 위 [회사명]을 그대로 씁니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="상호 (법인 정식 상호)">
            <div className="relative">
              <Building className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.official_sender_name} onChange={e => setField('official_sender_name', e.target.value)}
                placeholder="예: 주식회사 승진소방ENG" className={`${inputCls} pl-8`} />
            </div>
          </Field>
          <Field label="대표 직함">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={form.official_rep_title} onChange={e => setField('official_rep_title', e.target.value)}
                placeholder="대표이사" className={`${inputCls} pl-8`} />
            </div>
          </Field>
        </div>
        {/* 비워도 되는 칸이라는 걸 미리보기로 말한다 — 폴백 규약을 글로만 적으면 안 읽는다 */}
        <div className="rounded-lg border border-[#e0ddf5] bg-[#fafaff] px-4 py-3">
          <p className="text-[11px] font-medium text-[#514b81]">공문에 이렇게 찍힙니다</p>
          <p className="mt-1.5 text-center text-sm font-bold leading-relaxed text-[#090c1d]">
            {form.official_sender_name.trim() || form.company_name.trim() || '회사명'}<br />
            {(form.official_rep_title.trim() || '대표이사')} {form.representative.trim() || '대표자'}(직인생략)
          </p>
          <p className="mt-1.5 text-[11px] text-[#b0acd6]">
            비워두면 상호는 [회사명], 직함은 &lsquo;대표이사&rsquo;로 나갑니다 · 대표자 이름은 위 [대표자] 칸을 씁니다
          </p>
        </div>
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
