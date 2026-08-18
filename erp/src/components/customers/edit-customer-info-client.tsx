'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search } from 'lucide-react'
import { updateCustomerAction, quickAddressApplyAction, checkAddressAction, type ConfirmedPlanItemInfo, type UpdateCustomerInput, type AddressDuplicateCustomer, type AddressDuplicateBuilding } from '@/app/(dashboard)/customers/actions'
import { useDaumPostcode, type DaumPostcodeData } from '@/hooks/use-daum-postcode'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { ConfirmedDecisionDialog } from './confirmed-decision-dialog'
import { AddressDuplicateDialog } from './address-duplicate-dialog'
import type { Customer } from '@/types'

type Props = {
  customer: Pick<Customer, 'id' | 'customer_name' | 'contract_date' | 'use_approval_date' | 'plan_anchor_date' | 'zipcode' | 'address' | 'region_si' | 'region_myeon' | 'region_ri' | 'notes' | 'fire_station' | 'inspection_type' | 'monthly_fee_taxed' | 'monthly_fee_untaxed' | 'fee_taxed' | 'fee_untaxed'>
  /** §11: 점검유형 뱃지(+인라인 유형 편집) 슬롯과 연n회 라벨은 페이지가 구성 */
  typeSlot?: ReactNode
  annualLabel?: string
  lastChangeText?: string | null
  canManage?: boolean
}

// §11(2026-08-05): 요약/편집 모드 통합 — 모든 필드를 항상 편집 가능한 촘촘한 그리드로 표시([편집] 버튼 폐기)
const inputCls = 'h-9 w-full rounded-lg border border-[#d0ccf5] bg-white px-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'
const readonlyCls = 'h-9 w-full rounded-lg border border-[#d0ccf5] bg-[#f8f9fa] px-2.5 text-sm text-[#514b81] outline-none cursor-default'
const labelCls = 'text-[11px] font-medium text-[#514b81]'

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

export function EditCustomerInfoClient({ customer, typeSlot, annualLabel, lastChangeText, canManage = true }: Props) {
  const router = useRouter()
  const openPostcode = useDaumPostcode()
  const [form, setForm] = useState(() => makeInitial(customer))
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  // 기준일 변경 시 확정 일정 처리 선택 팝업(B안)
  const [confirmedDlg, setConfirmedDlg] = useState<ConfirmedPlanItemInfo[] | null>(null)
  // 주소 중복 안내 팝업 — 자기 자신은 제외하고 '다른 고객'과 겹칠 때만
  const [dupInfo, setDupInfo] = useState<{
    customer?: AddressDuplicateCustomer; building?: AddressDuplicateBuilding; address: string
  } | null>(null)
  const dupAckRef = useRef('')                                  // '계속 적용'으로 확인 완료된 주소
  // 팝업 확인 후 이어서 실행할 동작. null = 대기 없음. (decision은 undefined일 수 있어 객체로 감싼다)
  const pendingAddrRef = useRef<DaumPostcodeData | null>(null)  // 주소 검색 결과 적용
  const pendingSaveRef = useRef<{ decision?: 'unconfirm' | 'keep' } | null>(null)  // [저장]

  // customer props가 갱신(router.refresh)되면 form 초기화 — 렌더 중 상태 조정 패턴 (effect 아님)
  const syncKey = [customer.customer_name, customer.contract_date, customer.use_approval_date, customer.plan_anchor_date, customer.address, customer.notes, customer.fire_station].join('|')
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey)
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey)
    setForm(makeInitial(customer))
    setError('')
  }

  const initial = makeInitial(customer)
  const isDirty = (Object.keys(initial) as (keyof typeof initial)[]).some(k => form[k] !== initial[k])

  // 점검료: 종합/작동=월정액, 일반관리=건별 (읽기전용 표시 — 편집은 청구 화면 P4)
  const isMonthlyFee = customer.inspection_type !== '일반관리'
  const feeTaxed = isMonthlyFee ? customer.monthly_fee_taxed : customer.fee_taxed
  const feeStr = feeTaxed != null ? `${feeTaxed.toLocaleString()}원${isMonthlyFee ? '/월' : ''}` : '-'

  function set(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // 주소 검색 = 선택 즉시 저장 + 전파(관할소방서 자동 매핑·건물 주소·bcode). 도로명 수기 보정은 아래 [저장]으로.
  // 즉시 저장 구조이므로 **적용 전에** 중복을 확인한다 — 저장 후 알리면 되돌릴 방법이 없다.
  function handleAddressSearch() {
    if (!canManage) return
    openPostcode(data => {
      startTransition(async () => {
        if (dupAckRef.current !== data.roadAddress) {
          const dup = await checkAddressAction(data.roadAddress, { excludeCustomerId: customer.id }).catch(() => null)
          if (dup?.duplicate || dup?.duplicateBuilding) {
            pendingAddrRef.current = data
            setDupInfo({ customer: dup.duplicate, building: dup.duplicateBuilding, address: data.roadAddress })
            return
          }
        }
        applyAddress(data)
      })
    })
  }

  function applyAddress(data: DaumPostcodeData) {
    startTransition(async () => {
      const result = await quickAddressApplyAction(customer.id, {
        zonecode: data.zonecode,
        roadAddress: data.roadAddress,
        jibunAddress: data.jibunAddress,
        bcode: data.bcode,
        sigungu: data.sigungu,
        bname1: data.bname1,
        bname2: data.bname2,
        bname: data.bname,
      })
      if (result.error) { setError(result.error); return }
      const a = result.applied
      if (a && (a.fireStation || a.buildings > 0)) {
        const parts = ['주소 저장됨']
        if (a.fireStation) parts.push(`관할소방서 자동 입력: ${a.fireStation}`)
        if (a.buildings > 0) parts.push(`건물 주소 ${a.buildings}건 채움`)
        alert(`✅ ${parts.join(' · ')}`)
      }
      router.refresh()
    })
  }

  function handleReset() {
    setForm(makeInitial(customer))
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
    // 주소를 실제로 바꾼 경우에만 중복 재검증 (수기 보정 대비) — 이미 확인했거나 원래 주소 그대로면 통과
    const addr = form.address.trim()
    if (addr && addr !== (customer.address ?? '').trim() && dupAckRef.current !== addr) {
      startTransition(async () => {
        const dup = await checkAddressAction(addr, { excludeCustomerId: customer.id }).catch(() => null)
        if (dup?.duplicate || dup?.duplicateBuilding) {
          pendingSaveRef.current = { decision: confirmedDecision }
          setDupInfo({ customer: dup.duplicate, building: dup.duplicateBuilding, address: addr })
          return
        }
        dupAckRef.current = addr
        doSave(confirmedDecision)
      })
      return
    }
    doSave(confirmedDecision)
  }

  function doSave(confirmedDecision?: 'unconfirm' | 'keep') {
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

  // §11-5: 누락 칩(소방계획서 탭) → 기본정보 필드 포커스 — 항상 편집이므로 해당 입력칸으로 스크롤·포커스만
  useEffect(() => {
    const onFocusReq = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (!id?.startsWith('cf-') || !canManage) return
      const el = document.getElementById(id)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      ;(el as HTMLElement | null)?.focus({ preventScroll: true })
    }
    window.addEventListener('erp:focus-missing', onFocusReq)
    return () => window.removeEventListener('erp:focus-missing', onFocusReq)
  }, [canManage])

  // 촘촘 그리드 셀 — 라벨 + 입력 (wide면 전체 폭)
  const field = (label: ReactNode, node: ReactNode, opts?: { wide?: boolean }) => (
    <div className={`space-y-1 min-w-0 ${opts?.wide ? 'col-span-2 md:col-span-3' : ''}`}>
      <label className={labelCls}>{label}</label>
      {node}
    </div>
  )
  const req = <span className="text-red-500">*</span>
  const dis = !canManage

  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!isPending && isDirty) handleSave() }}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
        {field('점검유형',
          <div className="flex items-center gap-1.5 h-9">
            {typeSlot}
            {annualLabel && <span className="text-[10px] text-[#b0acd6]">{annualLabel}</span>}
          </div>
        )}
        {field(<>점검계획일 {req} <span className="text-[10px] text-[#b0acd6] font-normal">(기산일)</span></>,
          <DateInput id="cf-plan" value={form.plan_anchor_date} onChange={e => set('plan_anchor_date', e.target.value)} disabled={dis} className={inputCls} />
        )}
        {field(<>고객명 {req}</>,
          <input id="cf-name" type="text" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} disabled={dis} className={inputCls} />
        )}
        {field('계약일',
          <DateInput id="cf-contract" value={form.contract_date} onChange={e => set('contract_date', e.target.value)} disabled={dis} className={inputCls} />
        )}
        {field('사용승인일',
          <DateInput id="cf-approval" value={form.use_approval_date} onChange={e => set('use_approval_date', e.target.value)} disabled={dis} className={inputCls} />
        )}
        {field('관할 소방서',
          <input id="cf-station" type="text" value={form.fire_station} onChange={e => set('fire_station', e.target.value)} disabled={dis} placeholder="예: 양평소방서" className={inputCls} />
        )}
        {field(<>점검료 <span className="text-[10px] text-[#b0acd6] font-normal">{isMonthlyFee ? '(월정액)' : '(건별)'}</span></>,
          <input readOnly value={feeStr} className={readonlyCls} title="편집은 청구·수금 화면에서" />
        )}
        {/* 주소 — 검색은 즉시 저장·전파, 도로명은 수기 보정 가능 */}
        <div className="col-span-2 md:col-span-3 space-y-1 min-w-0">
          <div className="flex items-center justify-between">
            <label className={labelCls}>주소</label>
            {canManage && (
              <button type="button" onClick={handleAddressSearch} disabled={isPending}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-xs font-medium transition-colors border border-[#d0ccf5] disabled:opacity-50">
                <Search className="size-3" /> 주소 검색
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <input value={form.zipcode} readOnly placeholder="우편번호" className={readonlyCls} />
            <input id="cf-address" type="text" value={form.address} onChange={e => set('address', e.target.value)} disabled={dis}
              placeholder="주소 검색 후 동/호수 추가 가능" className={`${inputCls} col-span-3`} />
          </div>
        </div>
        {field('비고',
          <textarea id="cf-notes" value={form.notes} onChange={e => set('notes', e.target.value)} disabled={dis}
            placeholder="특이사항 메모" rows={2}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-2.5 py-1.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none" />,
          { wide: true }
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* 변경 시에만 저장/취소 노출 */}
      <div className="flex items-center gap-3 pt-1 border-t border-[#f0eefb]">
        {isDirty && canManage ? (
          <>
            <button type="submit" disabled={isPending}
              className="h-8 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null} 저장
            </button>
            <button type="button" onClick={handleReset} disabled={isPending}
              className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors">
              취소
            </button>
          </>
        ) : (
          lastChangeText && <span className="text-[11px] text-[#b0acd6] truncate">최근 변경: {lastChangeText}</span>
        )}
      </div>

      {confirmedDlg && (
        <ConfirmedDecisionDialog
          items={confirmedDlg}
          isPending={isPending}
          onDecide={d => handleSave(d)}
          onCancel={() => setConfirmedDlg(null)}
        />
      )}

      {/* 주소 중복 안내 — 다른 고객과 겹칠 때만. 확인 후 원래 하려던 동작(주소 적용 또는 저장)을 이어서 실행 */}
      {dupInfo && (
        <AddressDuplicateDialog
          customer={dupInfo.customer}
          building={dupInfo.building}
          address={dupInfo.address}
          onClose={() => { pendingAddrRef.current = null; pendingSaveRef.current = null; setDupInfo(null) }}
          onContinue={() => {
            dupAckRef.current = dupInfo.address
            setDupInfo(null)
            const addr = pendingAddrRef.current
            if (addr) { pendingAddrRef.current = null; applyAddress(addr); return }
            const save = pendingSaveRef.current
            if (save) { pendingSaveRef.current = null; doSave(save.decision) }
          }}
          continueLabel="계속 적용"
        />
      )}
    </form>
  )
}
