'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search, MapPin } from 'lucide-react'
import { updateCustomerAction, type ConfirmedPlanItemInfo, type UpdateCustomerInput } from '@/app/(dashboard)/customers/actions'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { ConfirmedDecisionDialog } from './confirmed-decision-dialog'
import type { Customer } from '@/types'

type Props = {
  customer: Pick<Customer, 'id' | 'customer_name' | 'contract_date' | 'use_approval_date' | 'plan_anchor_date' | 'zipcode' | 'address' | 'region_si' | 'region_myeon' | 'region_ri' | 'notes' | 'fire_station' | 'inspection_type' | 'monthly_fee_taxed' | 'monthly_fee_untaxed' | 'fee_taxed' | 'fee_untaxed'>
}

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'
const readonlyCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-[#f8f9fa] px-3 text-sm text-[#514b81] outline-none cursor-default'
const labelCls = 'text-xs font-medium text-[#514b81]'

function makeInitial(c: Props['customer']) {
  return {
    customer_name: c.customer_name,
    contract_date: c.contract_date ?? '',
    use_approval_date: c.use_approval_date ?? '',
    plan_anchor_date: c.plan_anchor_date ?? '',
    zipcode: c.zipcode ?? '',
    address: c.address ?? '',
    region_si: c.region_si ?? '',
    region_myeon: c.region_myeon ?? '',
    region_ri: c.region_ri ?? '',
    notes: c.notes ?? '',
    fire_station: c.fire_station ?? '',
  }
}

export function EditCustomerInfoClient({ customer }: Props) {
  const router = useRouter()
  const openPostcode = useDaumPostcode()
  const [form, setForm] = useState(() => makeInitial(customer))
  const [addrJibun, setAddrJibun] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  // 기준일 변경 시 확정 일정 처리 선택 팝업(B안)
  const [confirmedDlg, setConfirmedDlg] = useState<ConfirmedPlanItemInfo[] | null>(null)

  // customer props가 갱신(router.refresh)되면 form 초기화
  const syncKey = [customer.customer_name, customer.contract_date, customer.use_approval_date, customer.plan_anchor_date, customer.address, customer.notes].join('|')
  useEffect(() => {
    setForm(makeInitial(customer))
    setAddrJibun('')
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey])

  const initial = makeInitial(customer)
  const isDirty = (Object.keys(initial) as (keyof typeof initial)[]).some(k => form[k] !== initial[k])

  // 점검료: 종합/작동=월정액, 일반관리=건별 (읽기전용 표시 — 편집은 청구 화면 P4)
  const isMonthlyFee = customer.inspection_type !== '일반관리'
  const feeTaxed = isMonthlyFee ? customer.monthly_fee_taxed : customer.fee_taxed
  const feeStr = feeTaxed != null ? `${feeTaxed.toLocaleString()}원${isMonthlyFee ? '/월' : ''}` : '-'

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

  function buildInput(): UpdateCustomerInput {
    // 비우기는 명시적 null로 전달 — undefined는 "변경 없음"으로 처리됨 (부분 업데이트 안전화, 2026-07-14)
    return {
      customer_name: form.customer_name.trim(),
      contract_date: form.contract_date || null,
      use_approval_date: form.use_approval_date || null,
      plan_anchor_date: form.plan_anchor_date,
      zipcode: form.zipcode.trim() || null,
      address: form.address.trim() || null,
      region_si: form.region_si.trim() || null,
      region_myeon: form.region_myeon.trim() || null,
      region_ri: form.region_ri.trim() || null,
      notes: form.notes.trim() || null,
      fire_station: form.fire_station.trim() || null,
    }
  }

  function handleSave(confirmedDecision?: 'unconfirm' | 'keep') {
    if (!form.customer_name.trim()) { setError('고객명은 필수입니다'); return }
    if (!form.plan_anchor_date) { setError('점검계획일은 필수입니다 — 연간 점검계획의 기산일을 입력해주세요.'); return }
    for (const [label, v] of [['계약일', form.contract_date], ['점검계획일', form.plan_anchor_date], ['사용승인일', form.use_approval_date]] as const) {
      if (v && !isCompleteDate(v)) { setError(`${label}을(를) YYYY-MM-DD 형식으로 입력해주세요.`); return }
    }
    setError('')
    startTransition(async () => {
      const result = await updateCustomerAction(customer.id, buildInput(), confirmedDecision ? { confirmedDecision } : undefined)
      // 확정 일정 보유 고객의 기준일 변경 — 아직 저장 안 됨, 사용자 선택 팝업 표시
      if (result.requiresConfirmedDecision && result.confirmedItems) {
        setConfirmedDlg(result.confirmedItems)
        return
      }
      if (result.error) { setError(result.error); return }
      setConfirmedDlg(null)
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
          <label className={labelCls}>계약일</label>
          <DateInput
            value={form.contract_date}
            onChange={e => set('contract_date', e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>사용승인일</label>
          <DateInput
            value={form.use_approval_date}
            onChange={e => set('use_approval_date', e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>점검계획일 <span className="text-red-500">*</span> <span className="text-xs text-[#b0acd6] font-normal">(계획 기산일)</span></label>
          <DateInput
            value={form.plan_anchor_date}
            onChange={e => set('plan_anchor_date', e.target.value)}
            className={inputCls}
          />
          <p className="text-[11px] text-[#b0acd6]">등록일이 아닌 연간 점검의 기산일 — 이 날짜의 월·일 기준으로 특별·정기점검이 배치됩니다</p>
        </div>
      </div>

      {/* 관할 소방서 + 점검료 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className={labelCls}>관할 소방서 <span className="text-xs text-[#b0acd6] font-normal">(보고서)</span></label>
          <input
            type="text"
            value={form.fire_station}
            onChange={e => set('fire_station', e.target.value)}
            placeholder="예: 양평소방서"
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>점검료 <span className="text-xs text-[#b0acd6] font-normal">{isMonthlyFee ? '(월정액)' : '(건별)'}</span></label>
          <input readOnly value={feeStr} className={readonlyCls} title="편집은 청구·수금 화면에서" />
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

      {/* 지역 필드는 화면에서 숨김 (ADD-1 방식) — 주소검색 시 자동 세팅되는 form.region_* 값이 저장 시 그대로 반영됨 */}

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

      {confirmedDlg && (
        <ConfirmedDecisionDialog
          items={confirmedDlg}
          isPending={isPending}
          onDecide={d => handleSave(d)}
          onCancel={() => setConfirmedDlg(null)}
        />
      )}
    </form>
  )
}
