'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search } from 'lucide-react'
import { updateCustomerAction, quickAddressApplyAction, checkAddressAction, previewAnchorChangeAction, type ConfirmedPlanItemInfo, type AnchorPreview, type UpdateCustomerInput, type AddressDuplicateCustomer, type AddressDuplicateBuilding } from '@/app/(dashboard)/customers/actions'
import { useDaumPostcode, type DaumPostcodeData } from '@/hooks/use-daum-postcode'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { ConfirmedDecisionDialog } from './confirmed-decision-dialog'
import { AnchorChangePreview, LegalScheduleBadge } from './anchor-change-preview'
import { resolveAnchor, anchorSourceLabel } from '@/lib/plan-anchor'
import { AddressDuplicateDialog } from './address-duplicate-dialog'
import type { Customer } from '@/types'

type Props = {
  customer: Pick<Customer, 'id' | 'customer_name' | 'contract_date' | 'use_approval_date' | 'plan_anchor_date' | 'zipcode' | 'address' | 'region_si' | 'region_myeon' | 'region_ri' | 'notes' | 'fire_station' | 'inspection_type' | 'monthly_fee_taxed' | 'monthly_fee_untaxed' | 'fee_taxed' | 'fee_untaxed'>
  /** §11: 점검유형 뱃지(+인라인 유형 편집) 슬롯과 연n회 라벨은 페이지가 구성 */
  typeSlot?: ReactNode
  /** 점검 종류(종합/작동) — 법정 시기 배지가 2차 유무를 판정하는 데 쓴다 */
  inspectionSubType?: '종합' | '작동' | null
  /** 기산점 예외 플래그(마이그레이션 155). **undefined면 레거시**로 해석한다 —
   *  그게 코드가 실제로 하는 일이므로 배지도 같은 답을 내야 한다 */
  planAnchorManual?: boolean | null
  annualLabel?: string
  lastChangeText?: string | null
  canManage?: boolean
}

// §11(2026-08-05): 요약/편집 모드 통합 — 모든 필드를 항상 편집 가능한 촘촘한 그리드로 표시([편집] 버튼 폐기)
const inputCls = 'h-9 w-full rounded-lg border border-brand-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'
const readonlyCls = 'h-9 w-full rounded-lg border border-brand-line bg-paper px-2.5 text-sm text-ink-sub outline-none cursor-default'
const labelCls = 'text-[11px] font-medium text-ink-sub'

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

export function EditCustomerInfoClient({ customer, typeSlot, annualLabel, lastChangeText, canManage = true, inspectionSubType, planAnchorManual }: Props) {
  const router = useRouter()
  const openPostcode = useDaumPostcode()
  const [form, setForm] = useState(() => makeInitial(customer))
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  // 기준일 변경 시 확정 일정 처리 선택 팝업(B안)
  const [confirmedDlg, setConfirmedDlg] = useState<ConfirmedPlanItemInfo[] | null>(null)
  /** 기산점 변경 미리보기 — 저장 전에 한 번만 띄운다 */
  const [preview, setPreview] = useState<{ before: AnchorPreview; after: AnchorPreview; confirmedItems: ConfirmedPlanItemInfo[] } | null>(null)
  const previewAckRef = useRef(false)
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
    // 관할 소방서 필수 — 다만 **주소가 있으면 서버가 자동 지정**(actions.ts D-3)하므로 여기서 막지 않는다.
    // 둘 다 비어 있을 때만 즉시 막는다: 서버도 채울 근거가 없어 어차피 실패하니 왕복을 아낀다.
    // 실측(2026-08-20, 스테이징): 소방서 공란 28건 중 주소 있는 17건은 자동 지정 17/17 성공 —
    // 여기서 공란이라는 이유만으로 일괄로 막으면 그 17건까지 손입력을 강요하게 된다.
    if (!form.fire_station.trim() && !form.address.trim()) {
      setError('관할 소방서는 필수입니다 — 주소를 입력하면 자동 지정되고, 아니면 직접 입력해주세요.')
      return
    }
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
        gateThenSave(confirmedDecision)
      })
      return
    }
    gateThenSave(confirmedDecision)
  }

  /** 기산점이 바뀌면 **저장 전에** 무엇이 되는지 보여준다.
   *  종전엔 저장하고 나서야 알 수 있었고, 확정 일정이 있으면 그때 **또 한 번** 멈췄다 —
   *  이제 미리보기 한 화면에서 확정 처리까지 함께 고른다. */
  function gateThenSave(confirmedDecision?: 'unconfirm' | 'keep') {
    const anchorish =
      (form.use_approval_date || null) !== (customer.use_approval_date ?? null)
      || (form.plan_anchor_date || null) !== (customer.plan_anchor_date ?? null)
    // 미리보기에서 결정하고 돌아온 호출이면 그대로 저장한다(무한 반복 방지)
    if (!anchorish || confirmedDecision !== undefined || previewAckRef.current) { doSave(confirmedDecision); return }
    startTransition(async () => {
      const res = await previewAnchorChangeAction(customer.id, {
        use_approval_date: form.use_approval_date || null,
        plan_anchor_date: form.plan_anchor_date || null,
      }).catch(() => null)
      // ⚠ 미리보기를 못 받아도 저장을 막지 않는다 — 안내는 부가 기능이지 관문이 아니다
      if (!res?.before || !res.after) { doSave(confirmedDecision); return }
      setPreview({ before: res.before, after: res.after, confirmedItems: res.confirmedItems ?? [] })
    })
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
            {annualLabel && <span className="text-[10px] text-ink-meta">{annualLabel}</span>}
          </div>
        )}
        {field(<>점검계획일 {req} <span className="text-[10px] text-ink-meta font-normal">(기산일)</span></>,
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
        {field(<>관할 소방서 {req}</>,
          <input id="cf-station" type="text" value={form.fire_station} onChange={e => set('fire_station', e.target.value)} disabled={dis} placeholder="예: 양평소방서" className={inputCls} />
        )}
        {field(<>점검료 <span className="text-[10px] text-ink-meta font-normal">{isMonthlyFee ? '(월정액)' : '(건별)'}</span></>,
          <input readOnly value={feeStr} className={readonlyCls} title="편집은 청구·수금 화면에서" />
        )}
        {/* 주소 — 검색은 즉시 저장·전파, 도로명은 수기 보정 가능 */}
        <div className="col-span-2 md:col-span-3 space-y-1 min-w-0">
          <div className="flex items-center justify-between">
            <label className={labelCls}>주소</label>
            {canManage && (
              <button type="button" onClick={handleAddressSearch} disabled={isPending}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-brand-tint hover:bg-brand-tint text-brand text-xs font-medium transition-colors border border-brand-line disabled:opacity-50">
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
            className="w-full rounded-lg border border-brand-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition resize-none" />,
          { wide: true }
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* 변경 시에만 저장/취소 노출 */}
      <div className="flex items-center gap-3 pt-1 border-t border-brand-line-soft">
        {isDirty && canManage ? (
          <>
            <button type="submit" disabled={isPending}
              className="h-8 px-4 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null} 저장
            </button>
            <button type="button" onClick={handleReset} disabled={isPending}
              className="h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors">
              취소
            </button>
          </>
        ) : (
          lastChangeText && <span className="text-[11px] text-ink-meta truncate">최근 변경: {lastChangeText}</span>
        )}
      </div>

      {/* 법정 시기 상시 배지 — **입력하는 즉시** 바뀐다(순수 계산이라 서버 왕복 0).
          별지 9호 표기와 같은 성격이다: 늘 보이니 잘못을 눈치챈다.
          ⚠ planAnchorManual이 undefined면 레거시로 해석한다 — 코드가 실제로 하는 그대로여야
            배지가 거짓말을 하지 않는다. */}
      {(() => {
        const r = resolveAnchor({
          use_approval_date: form.use_approval_date || null,
          plan_anchor_date: form.plan_anchor_date || null,
          plan_anchor_manual: planAnchorManual,
        })
        if (!r.date) return null
        const m = Number(r.date.slice(5, 7))
        const isComp = inspectionSubType === '종합'
        const months = [{ seq: 1, month: m, planType: `special_${isComp ? '종합' : '작동'}` }]
        if (isComp) months.push({ seq: 2, month: ((m - 1 + 6) % 12) + 1, planType: 'special_작동' })
        // 최초점검 기한 — 종합 대상이고 사용승인일 기준일 때만, 그리고 **아직 안 지났을 때만** 띄운다
        const due = (isComp && form.use_approval_date && isCompleteDate(form.use_approval_date))
          ? new Date(Date.UTC(+form.use_approval_date.slice(0, 4), +form.use_approval_date.slice(5, 7) - 1, +form.use_approval_date.slice(8, 10)) + 60 * 86_400_000).toISOString().slice(0, 10)
          : null
        const stillOpen = due && due >= new Date().toISOString().slice(0, 10)
        return (
          <div className="mt-2">
            <LegalScheduleBadge
              months={months} anchorSource={anchorSourceLabel(r.source)} anchorDate={r.date}
              divergent={r.divergent} initialDueDate={stillOpen ? due : null}
            />
          </div>
        )
      })()}

      {/* 기산점 변경 미리보기 — 저장 **전**에 무엇이 될지 보여주고, 확정 일정 처리까지 한 화면에서 고른다.
          종전엔 저장 → 확정팝업으로 두 번 멈췄다. */}
      {preview && (
        <AnchorChangePreview
          before={preview.before}
          after={preview.after}
          confirmedItems={preview.confirmedItems}
          isPending={isPending}
          onConfirm={d => { previewAckRef.current = true; setPreview(null); doSave(d) }}
          onCancel={() => setPreview(null)}
        />
      )}

      {/* 미리보기를 못 띄운 경로(기산점 무관 변경 등)에서 서버가 확정 선택을 요구할 때의 폴백 */}
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
