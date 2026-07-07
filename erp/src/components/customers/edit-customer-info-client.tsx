'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search, Wand2, MapPin } from 'lucide-react'
import { updateCustomerAction } from '@/app/(dashboard)/customers/actions'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { extractRegionFromAddress } from '@/lib/address-parser'
import type { Customer } from '@/types'

type Props = {
  customer: Pick<Customer, 'id' | 'customer_name' | 'contract_date' | 'use_approval_date' | 'zipcode' | 'address' | 'region_si' | 'region_myeon' | 'region_ri' | 'notes'>
}

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'
const readonlyCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-[#f8f9fa] px-3 text-sm text-[#514b81] outline-none cursor-default'
const labelCls = 'text-xs font-medium text-[#514b81]'

function makeInitial(c: Props['customer']) {
  return {
    customer_name: c.customer_name,
    contract_date: c.contract_date,
    use_approval_date: c.use_approval_date ?? '',
    zipcode: c.zipcode ?? '',
    address: c.address ?? '',
    region_si: c.region_si ?? '',
    region_myeon: c.region_myeon ?? '',
    region_ri: c.region_ri ?? '',
    notes: c.notes ?? '',
  }
}

export function EditCustomerInfoClient({ customer }: Props) {
  const router = useRouter()
  const openPostcode = useDaumPostcode()
  const [form, setForm] = useState(() => makeInitial(customer))
  const [addrJibun, setAddrJibun] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  // customer props가 갱신(router.refresh)되면 form 초기화
  const syncKey = [customer.customer_name, customer.contract_date, customer.use_approval_date, customer.address, customer.notes].join('|')
  useEffect(() => {
    setForm(makeInitial(customer))
    setAddrJibun('')
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey])

  const initial = makeInitial(customer)
  const isDirty = (Object.keys(initial) as (keyof typeof initial)[]).some(k => form[k] !== initial[k])

  function set(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleAddressSearch() {
    openPostcode(data => {
      setAddrJibun(data.jibunAddress)
      setForm(prev => ({
        ...prev,
        zipcode: data.zonecode,
        address: data.roadAddress,
        region_si: data.sigungu,
        region_myeon: data.bname1 || data.bname,
        region_ri: data.bname2 || '',
      }))
    })
  }

  function handleReset() {
    setForm(makeInitial(customer))
    setAddrJibun('')
    setError('')
  }

  function handleSave() {
    if (!form.customer_name.trim()) { setError('고객명은 필수입니다'); return }
    if (!form.contract_date) { setError('계약일은 필수입니다'); return }
    setError('')
    startTransition(async () => {
      const result = await updateCustomerAction(customer.id, {
        customer_name: form.customer_name.trim(),
        contract_date: form.contract_date,
        use_approval_date: form.use_approval_date || undefined,
        zipcode: form.zipcode.trim() || undefined,
        address: form.address.trim() || undefined,
        region_si: form.region_si.trim() || undefined,
        region_myeon: form.region_myeon.trim() || undefined,
        region_ri: form.region_ri.trim() || undefined,
        notes: form.notes.trim() || undefined,
      })
      if (result.error) { setError(result.error); return }
      router.refresh()
    })
  }

  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!isPending && isDirty) handleSave() }}>
      {/* 고객명 */}
      <div className="space-y-1">
        <label className={labelCls}>고객명 <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={form.customer_name}
          onChange={e => set('customer_name', e.target.value)}
          className={inputCls}
        />
      </div>

      {/* 계약일 + 사용승인일 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className={labelCls}>계약일 <span className="text-red-500">*</span></label>
          <input
            type="date"
            value={form.contract_date}
            onChange={e => set('contract_date', e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>사용승인일</label>
          <input
            type="date"
            value={form.use_approval_date}
            onChange={e => set('use_approval_date', e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      {/* 주소 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className={labelCls}>주소</label>
          <button
            type="button"
            onClick={handleAddressSearch}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-xs font-medium transition-colors border border-[#d0ccf5]"
          >
            <Search className="size-3" />
            주소 검색
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <p className="text-xs text-[#b0acd6]">우편번호</p>
            <input value={form.zipcode} readOnly placeholder="자동입력" className={readonlyCls} />
          </div>
          <div className="col-span-2 space-y-1">
            <p className="text-xs text-[#b0acd6]">지번주소 (참고)</p>
            <input value={addrJibun} readOnly placeholder="자동입력" className={readonlyCls} />
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-[#b0acd6]">도로명주소</p>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
            <input
              type="text"
              value={form.address}
              onChange={e => set('address', e.target.value)}
              placeholder="주소 검색 후 동/호수 추가 가능"
              className={`${inputCls} pl-8`}
            />
          </div>
        </div>
      </div>

      {/* 지역 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className={labelCls}>시/군/구 · 읍/면/동 · 리/동</label>
          {form.address && (
            <button
              type="button"
              onClick={() => {
                const extracted = extractRegionFromAddress(form.address)
                if (extracted.region_si) setForm(s => ({ ...s, ...extracted }))
              }}
              className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-[11px] font-medium transition-colors border border-[#d0ccf5]"
            >
              <Wand2 className="size-3" />
              주소에서 추출
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input type="text" value={form.region_si} onChange={e => set('region_si', e.target.value)} placeholder="광주시" className={inputCls} />
          <input type="text" value={form.region_myeon} onChange={e => set('region_myeon', e.target.value)} placeholder="오포읍" className={inputCls} />
          <input type="text" value={form.region_ri} onChange={e => set('region_ri', e.target.value)} placeholder="신현리" className={inputCls} />
        </div>
      </div>

      {/* 비고 */}
      <div className="space-y-1">
        <label className={labelCls}>비고</label>
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="특이사항 메모"
          rows={2}
          className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* 변경 시에만 저장/취소 표시 */}
      {isDirty && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleReset}
            className="flex-1 h-9 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 h-9 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : '저장'}
          </button>
        </div>
      )}
    </form>
  )
}
