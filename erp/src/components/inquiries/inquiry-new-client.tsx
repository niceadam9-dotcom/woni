'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Phone, User, MapPin, Search, Wand2 } from 'lucide-react'
import { createInquiryAction, type InquiryType } from '@/app/(dashboard)/inquiries/actions'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { extractRegionFromAddress } from '@/lib/address-parser'
import { CustomerCombobox } from '@/components/ui/customer-combobox'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'
const readonlyCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-[#f8f9fa] px-3 text-sm text-[#514b81] outline-none cursor-default'
const labelCls = 'text-xs font-medium text-[#514b81]'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}

type CustomerContact = { role: string; name: string; phone: string | null }
type Customer = {
  id: string
  customer_name: string
  customer_code: string
  zipcode: string | null
  address: string | null
  region_si: string | null
  region_myeon: string | null
  region_ri: string | null
  assigned_employee: { name: string } | null
  customer_contacts: CustomerContact[]
}

const TYPE_OPTIONS: { value: InquiryType; label: string }[] = [
  { value: 'as_request', label: 'AS 요청' },
  { value: 'schedule', label: '일정 조율' },
  { value: 'quote', label: '견적 문의' },
  { value: 'other', label: '기타' },
]

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export function InquiryNewClient({
  customers,
  defaultCustomerId,
}: {
  customers: Customer[]
  defaultCustomerId?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const openPostcode = useDaumPostcode()

  const [form, setForm] = useState({
    customer_id:   defaultCustomerId ?? '',
    inquiry_type:  'as_request' as InquiryType,
    title:         '',
    content:       '',
    contact_name:  '',
    contact_phone: '',
    zipcode:       '',
    address:       '',
    region_si:     '',
    region_myeon:  '',
    region_ri:     '',
  })
  const [addrJibun, setAddrJibun] = useState('')

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // 고객 선택 시 담당자·연락처·주소 자동 세팅
  useEffect(() => {
    if (!form.customer_id) {
      setAddrJibun('')
      return
    }
    const c = customers.find(c => c.id === form.customer_id)
    if (!c) return

    const contacts = Array.isArray(c.customer_contacts) ? c.customer_contacts : []
    const primary = contacts.find(ct => ct.role === '대표') ?? contacts[0] ?? null

    setAddrJibun('')
    setForm(prev => ({
      ...prev,
      contact_name:  primary?.name  ?? c.assigned_employee?.name ?? '',
      contact_phone: primary?.phone ?? '',
      zipcode:       c.zipcode      ?? '',
      address:       c.address      ?? '',
      region_si:     c.region_si    ?? '',
      region_myeon:  c.region_myeon ?? '',
      region_ri:     c.region_ri    ?? '',
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.customer_id])

  function handleAddressSearch() {
    openPostcode(data => {
      setAddrJibun(data.jibunAddress)
      setForm(prev => ({
        ...prev,
        zipcode:      data.zonecode,
        address:      data.roadAddress,
        region_si:    data.sigungu,
        region_myeon: data.bname1 || data.bname,
        region_ri:    data.bname2 || '',
      }))
    })
  }

  const selectedCustomer = customers.find(c => c.id === form.customer_id)
  const assignedEmployee = selectedCustomer?.assigned_employee?.name ?? null

  function handleSubmit() {
    setError('')
    if (!form.customer_id)    { setError('고객사를 선택해주세요.'); return }
    if (!form.title.trim())   { setError('제목을 입력해주세요.'); return }
    if (!form.content.trim()) { setError('내용을 입력해주세요.'); return }

    startTransition(async () => {
      const result = await createInquiryAction({
        customer_id:   form.customer_id,
        inquiry_type:  form.inquiry_type,
        title:         form.title.trim(),
        content:       form.content.trim(),
        contact_name:  form.contact_name.trim()  || undefined,
        contact_phone: form.contact_phone.trim() || undefined,
        zipcode:       form.zipcode.trim()       || undefined,
        address:       form.address.trim()       || undefined,
        region_si:     form.region_si.trim()     || undefined,
        region_myeon:  form.region_myeon.trim()  || undefined,
        region_ri:     form.region_ri.trim()     || undefined,
      })
      if (result.error) { setError(result.error); return }
      router.push(`/inquiries/${result.inquiryId}`)
      router.refresh()
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* 문의 기본정보 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">문의 기본정보</h2>

        <Field label="고객사" required>
          <CustomerCombobox
            customers={customers}
            value={form.customer_id}
            onChange={id => setField('customer_id', id)}
          />
        </Field>

        {/* 내부 담당자 표시 */}
        {assignedEmployee && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[#f5f4ff] rounded-lg text-xs text-[#514b81]">
            <User className="size-3.5 text-[#7b68ee] shrink-0" />
            <span>내부 담당자: <strong className="text-[#090c1d]">{assignedEmployee}</strong></span>
          </div>
        )}

        {/* 주소 섹션 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className={labelCls}>방문 주소</label>
            <button
              type="button"
              onClick={handleAddressSearch}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-xs font-medium transition-colors border border-[#d0ccf5]"
            >
              <Search className="size-3.5" />
              주소 검색
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1">
              <p className="text-xs text-[#b0acd6]">우편번호</p>
              <input value={form.zipcode} readOnly placeholder="검색 후 자동입력" className={readonlyCls} />
            </div>
            <div className="col-span-3 space-y-1">
              <p className="text-xs text-[#b0acd6]">지번주소 (참고)</p>
              <input value={addrJibun} readOnly placeholder="검색 후 자동입력" className={readonlyCls} />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-[#b0acd6]">도로명주소 (상세주소 직접 입력 가능)</p>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input
                value={form.address}
                onChange={e => setField('address', e.target.value)}
                placeholder="주소 검색 후 동/호수 등 추가 입력"
                className={`${inputCls} pl-8`}
              />
            </div>
          </div>
        </div>

        {/* 시/면/리 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className={labelCls}>시/군/구 · 읍/면/동 · 리/동</label>
            {form.address && !form.region_si && (
              <button
                type="button"
                onClick={() => {
                  const extracted = extractRegionFromAddress(form.address)
                  if (extracted.region_si) setForm(prev => ({ ...prev, ...extracted }))
                }}
                className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-[11px] font-medium transition-colors border border-[#d0ccf5]"
              >
                <Wand2 className="size-3" />
                주소에서 추출
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input value={form.region_si}    onChange={e => setField('region_si', e.target.value)}    placeholder="예: 광주시" className={inputCls} />
            <input value={form.region_myeon} onChange={e => setField('region_myeon', e.target.value)} placeholder="예: 오포읍" className={inputCls} />
            <input value={form.region_ri}    onChange={e => setField('region_ri', e.target.value)}    placeholder="예: 신현리" className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="문의 유형" required>
            <select
              value={form.inquiry_type}
              onChange={e => setField('inquiry_type', e.target.value as InquiryType)}
              className={inputCls}
            >
              {TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="제목" required>
          <input
            value={form.title}
            onChange={e => setField('title', e.target.value)}
            placeholder="문의 제목을 입력하세요"
            className={inputCls}
          />
        </Field>

        <Field label="내용" required>
          <textarea
            value={form.content}
            onChange={e => setField('content', e.target.value)}
            placeholder="문의 내용을 상세히 입력하세요"
            rows={5}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
          />
        </Field>
      </section>

      {/* 담당 연락처 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">담당 연락처 <span className="text-[#514b81] font-normal">(선택)</span></h2>

        <div className="grid grid-cols-2 gap-4">
          <Field label="담당자명">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input
                value={form.contact_name}
                onChange={e => setField('contact_name', e.target.value)}
                placeholder="담당자 이름"
                className={`${inputCls} pl-8`}
              />
            </div>
          </Field>
          <Field label="연락처">
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input
                value={form.contact_phone}
                onChange={e => setField('contact_phone', e.target.value)}
                placeholder="010-0000-0000"
                className={`${inputCls} pl-8`}
              />
            </div>
          </Field>
        </div>
      </section>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="flex gap-3 pb-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 h-11 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="flex-1 h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : '문의 등록'}
        </button>
      </div>
    </div>
  )
}
