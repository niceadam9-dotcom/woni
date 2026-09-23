'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { updateCustomerAction, quickAddressApplyAction, checkAddressAction, previewAnchorChangeAction, type AnchorPreview, type UpdateCustomerInput, type AddressDuplicateCustomer, type AddressDuplicateBuilding } from '@/app/(dashboard)/customers/actions'
import { useDaumPostcode, type DaumPostcodeData } from '@/hooks/use-daum-postcode'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { AnchorChangePreview, LegalScheduleBadge, anchorPreviewWorthShowing } from './anchor-change-preview'
import { todayKst } from '@/lib/kst-date'
import { resolveAnchor, anchorSourceLabel, isProvisionalAnchor } from '@/lib/plan-anchor'
import { AddressDuplicateDialog } from './address-duplicate-dialog'
import { GroupBox, SubRow, Cell, RoleBadge, SaveBar, keyInputCls, emptyRequiredCls } from './key-fields'
import { anchorRoles } from '@/lib/anchor-role'
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
  /** 담당직원 칸 — 즉시 저장 컴포넌트(AssignEmployeeInline 등)를 페이지가 넣는다.
   *  2026-09-23 고객명과 **같은 첫 줄**로 들였다(종전엔 폼 밖 머리에 따로 떠 있었다). */
  assigneeSlot?: ReactNode
  /** 담당 미배정 — 상자 테두리를 붉게 */
  unassigned?: boolean
}

// §11(2026-08-05): 요약/편집 모드 통합 — 모든 필드를 항상 편집 가능한 촘촘한 그리드로 표시([편집] 버튼 폐기)
const inputCls = 'h-form-9 w-full rounded-lg border border-brand-line bg-surface px-2.5 text-form-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'
const readonlyCls = 'h-form-9 w-full rounded-lg border border-brand-line bg-paper px-2.5 text-form-base text-ink-sub outline-none cursor-default'

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

export function EditCustomerInfoClient({ customer, typeSlot, annualLabel, lastChangeText, canManage = true, inspectionSubType, planAnchorManual, assigneeSlot, unassigned }: Props) {
  const router = useRouter()
  const openPostcode = useDaumPostcode()
  const [form, setForm] = useState(() => makeInitial(customer))
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  // 확정 보호 팝업(B안)은 2026-09-12 폐지 — 전건 확정 체계라 보호할 사람 결정이 없다
  /** 기산점 변경 미리보기 — 저장 전에 한 번만 띄운다 */
  const [preview, setPreview] = useState<{ before: AnchorPreview; after: AnchorPreview } | null>(null)
  const previewAckRef = useRef(false)
  // 주소 중복 안내 팝업 — 자기 자신은 제외하고 '다른 고객'과 겹칠 때만
  const [dupInfo, setDupInfo] = useState<{
    customer?: AddressDuplicateCustomer; building?: AddressDuplicateBuilding; address: string
  } | null>(null)
  const dupAckRef = useRef('')                                  // '계속 적용'으로 확인 완료된 주소
  // 팝업 확인 후 이어서 실행할 동작. null/false = 대기 없음.
  const pendingAddrRef = useRef<DaumPostcodeData | null>(null)  // 주소 검색 결과 적용
  const pendingSaveRef = useRef(false)                          // [저장]

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

  function handleSave() {
    if (!form.customer_name.trim()) { setError('고객명은 필수입니다'); return }
    if (!form.plan_anchor_date) { setError('점검일자는 필수입니다 — 연간 점검계획의 기산일을 입력해주세요.'); return }
    // 관할 소방서 필수 — 다만 **주소가 있으면 서버가 자동 지정**(actions.ts D-3)하므로 여기서 막지 않는다.
    // 둘 다 비어 있을 때만 즉시 막는다: 서버도 채울 근거가 없어 어차피 실패하니 왕복을 아낀다.
    // 실측(2026-08-20, 스테이징): 소방서 공란 28건 중 주소 있는 17건은 자동 지정 17/17 성공 —
    // 여기서 공란이라는 이유만으로 일괄로 막으면 그 17건까지 손입력을 강요하게 된다.
    if (!form.fire_station.trim() && !form.address.trim()) {
      setError('관할 소방서는 필수입니다 — 주소를 입력하면 자동 지정되고, 아니면 직접 입력해주세요.')
      return
    }
    for (const [label, v] of [['계약일', form.contract_date], ['점검일자', form.plan_anchor_date], ['사용승인일', form.use_approval_date]] as const) {
      if (v && !isCompleteDate(v)) { setError(`${label}을(를) YYYY-MM-DD 형식으로 입력해주세요.`); return }
    }
    setError('')
    // 주소를 실제로 바꾼 경우에만 중복 재검증 (수기 보정 대비) — 이미 확인했거나 원래 주소 그대로면 통과
    const addr = form.address.trim()
    if (addr && addr !== (customer.address ?? '').trim() && dupAckRef.current !== addr) {
      startTransition(async () => {
        const dup = await checkAddressAction(addr, { excludeCustomerId: customer.id }).catch(() => null)
        if (dup?.duplicate || dup?.duplicateBuilding) {
          pendingSaveRef.current = true
          setDupInfo({ customer: dup.duplicate, building: dup.duplicateBuilding, address: addr })
          return
        }
        dupAckRef.current = addr
        gateThenSave()
      })
      return
    }
    gateThenSave()
  }

  /** 기산점이 바뀌면 **저장 전에** 무엇이 되는지 보여준다.
   *  종전엔 저장하고 나서야 알 수 있었다. (확정 처리 선택은 2026-09-12 폐지 — 미시작 전건이 자동 동행) */
  function gateThenSave() {
    const anchorish =
      (form.use_approval_date || null) !== (customer.use_approval_date ?? null)
      || (form.plan_anchor_date || null) !== (customer.plan_anchor_date ?? null)
    // 미리보기에서 확인하고 돌아온 호출이면 그대로 저장한다(무한 반복 방지)
    if (!anchorish || previewAckRef.current) { doSave(); return }
    startTransition(async () => {
      const res = await previewAnchorChangeAction(customer.id, {
        use_approval_date: form.use_approval_date || null,
        plan_anchor_date: form.plan_anchor_date || null,
      }).catch(() => null)
      // ⚠ 미리보기를 못 받아도 저장을 막지 않는다 — 안내는 부가 기능이지 관문이 아니다
      if (!res?.before || !res.after) { doSave(); return }
      // 바뀌는 게 없으면 조용히 저장한다 — 인라인 경로와 **같은 함수**로 판정한다
      if (!anchorPreviewWorthShowing(res.before, res.after, todayKst())) { doSave(); return }
      setPreview({ before: res.before, after: res.after })
    })
  }

  function doSave() {
    startTransition(async () => {
      const result = await updateCustomerAction(customer.id, buildInput())
      if (result.error) { setError(result.error); return }
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

  const dis = !canManage

  /* 법정 시기 상시 배지 — **입력하는 즉시** 바뀐다(순수 계산이라 서버 왕복 0).
     별지 9호 표기와 같은 성격이다: 늘 보이니 잘못을 눈치챈다.
     ⚠ planAnchorManual이 undefined면 레거시로 해석한다 — 코드가 실제로 하는 그대로여야
       배지가 거짓말을 하지 않는다.
     2026-09-23 — 탭 맨 아래에 작게 있던 것을 **기준일 줄 안으로 올렸다**(날짜를 고치면 바로 옆에서 결과가 바뀐다). */
  const anchorInput = {
    use_approval_date: form.use_approval_date || null,
    plan_anchor_date: form.plan_anchor_date || null,
    plan_anchor_manual: planAnchorManual,
  }
  const roles = anchorRoles(anchorInput)
  const legalBadge = (() => {
    const r = resolveAnchor(anchorInput)
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
      <LegalScheduleBadge
        months={months} anchorSource={anchorSourceLabel(r.source)} anchorDate={r.date}
        divergent={r.divergent} initialDueDate={stillOpen ? due : null}
        provisional={isProvisionalAnchor(anchorInput)}
      />
    )
  })()
  // 필수 현황(머리 알약) — 고객명·점검일자·관할 소방서(주소가 있으면 서버가 자동 지정하므로 주소로도 충족)
  const reqs = [!!form.customer_name.trim(), !!form.plan_anchor_date, !!(form.fire_station.trim() || form.address.trim())]

  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!isPending && isDirty) handleSave() }}>
      {/* ① 기본정보 — 그룹 단위 정렬(2026-09-23 사용자 요청). 등록 화면의 ① 상자와 **같은 부품·같은 줄 순서**다.
          첫 줄 = 고객명 | 담당직원 | 관할 소방서 — 사용자 요청 「고객명을 담당 왼쪽으로」.
          ★ 기준일 줄 = 사용승인일 | 점검일자 | 이 날짜로 잡히는 일정(보라 바탕 + 큰 칸 + 기산점 배지). */}
      <GroupBox n={1} title="기본정보" testId="info-group" alert={unassigned} status={[reqs.filter(Boolean).length, reqs.length]}>
        <SubRow label="기본">
          <Cell span={2} label="고객명" required htmlFor="cf-name" missing={!form.customer_name.trim()}>
            <input id="cf-name" type="text" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} disabled={dis}
              className={`${inputCls} ${keyInputCls} ${!form.customer_name.trim() ? emptyRequiredCls : ''}`} />
          </Cell>
          <Cell label="담당직원" testId="info-assignee">
            {assigneeSlot}
          </Cell>
          <Cell label="관할 소방서" required htmlFor="cf-station">
            <input id="cf-station" type="text" value={form.fire_station} onChange={e => set('fire_station', e.target.value)} disabled={dis} placeholder="예: 양평소방서"
              className={`${inputCls} !h-12`} />
          </Cell>
        </SubRow>

        <SubRow label="기준일" accent testId="info-keydates">
          <Cell label="사용승인일" htmlFor="cf-approval" badge={<RoleBadge role={roles.approval} testId="info-role-approval" />}>
            <DateInput id="cf-approval" value={form.use_approval_date} onChange={e => set('use_approval_date', e.target.value)} disabled={dis}
              className={`${inputCls} ${keyInputCls}`} />
          </Cell>
          <Cell label={<>점검일자 <span className="text-form-2xs text-ink-sub font-normal">(기산일)</span></>} required htmlFor="cf-plan"
            missing={!form.plan_anchor_date} badge={<RoleBadge role={roles.plan} testId="info-role-plan" />}>
            <DateInput id="cf-plan" value={form.plan_anchor_date} onChange={e => set('plan_anchor_date', e.target.value)} disabled={dis}
              className={`${inputCls} ${keyInputCls} ${!form.plan_anchor_date ? emptyRequiredCls : ''}`} />
          </Cell>
          <Cell span={2} label="이 날짜로 잡히는 일정" testId="info-legal">
            {legalBadge ?? <p className="text-form-xs text-ink-meta">날짜를 넣으면 법정 점검 시기가 여기 표시됩니다.</p>}
          </Cell>
        </SubRow>

        <SubRow label="점검·계약">
          <Cell label="점검유형">
            <div className="flex items-center gap-1.5 h-form-9 flex-wrap">
              {typeSlot}
              {/* 12px 계층은 ink-meta(5.03:1)를 쓰지 않는다 — 크기가 작을수록 대비가 필요하다 */}
              {annualLabel && <span className="text-form-2xs text-ink-sub">{annualLabel}</span>}
            </div>
          </Cell>
          <Cell label="계약일" htmlFor="cf-contract">
            <DateInput id="cf-contract" value={form.contract_date} onChange={e => set('contract_date', e.target.value)} disabled={dis} className={inputCls} />
          </Cell>
          <Cell label={<>점검료 <span className="text-form-2xs text-ink-sub font-normal">{isMonthlyFee ? '(월정액)' : '(건별)'}</span></>}>
            <input readOnly tabIndex={-1} value={feeStr} className={readonlyCls} title="편집은 청구·수금 화면에서" />
          </Cell>
        </SubRow>

        {/* 주소 — 검색은 즉시 저장·전파, 도로명은 수기 보정 가능 */}
        <SubRow label="주소">
          <Cell label="우편번호">
            <input value={form.zipcode} readOnly tabIndex={-1} placeholder="우편번호" className={readonlyCls} />
          </Cell>
          <Cell span={2} label="도로명주소" htmlFor="cf-address">
            <input id="cf-address" type="text" value={form.address} onChange={e => set('address', e.target.value)} disabled={dis}
              placeholder="주소 검색 후 동/호수 추가 가능" className={inputCls} />
          </Cell>
          <Cell label={<span className="invisible">검색</span>}>
            {canManage && (
              <button type="button" onClick={handleAddressSearch} disabled={isPending}
                className="w-full inline-flex items-center justify-center gap-1.5 h-form-9 px-3 rounded-lg bg-brand-tint text-brand text-form-sm font-medium transition-colors border border-brand-line disabled:opacity-50">
                <Search className="size-3.5" /> 주소 검색
              </button>
            )}
          </Cell>
        </SubRow>

        <SubRow label="메모">
          <Cell span={4} label="비고" htmlFor="cf-notes">
            <textarea id="cf-notes" value={form.notes} onChange={e => set('notes', e.target.value)} disabled={dis}
              placeholder="특이사항 메모" rows={2}
              className="w-full rounded-lg border border-brand-line bg-surface px-2.5 py-1.5 text-form-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition resize-none" />
          </Cell>
        </SubRow>

        {/* 저장 줄 — **늘 보인다**(2026-09-23 사용자: 「기본정보 저장버튼은 없네?」).
            종전엔 고쳐야만 버튼이 나타나 「저장이 없는 화면」으로 읽혔다. 이제 버튼은 늘 있고,
            고친 게 없으면 흐리게(변경 없음), 고치면 진하게. 상자 아래에 붙어(sticky) 스크롤해도 보인다. */}
        {canManage && (
          <SaveBar testId="info-save-bar" saveTestId="info-save" submit
            dirty={isDirty} pending={isPending} onCancel={handleReset}
            idle={lastChangeText ? `최근 변경: ${lastChangeText}` : undefined} />
        )}
        {!canManage && lastChangeText && (
          <div className="px-5 py-3 bg-paper text-form-xs text-ink-meta truncate">최근 변경: {lastChangeText}</div>
        )}
      </GroupBox>

      {error && (
        <p className="text-form-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* 기산점 변경 미리보기 — 저장 **전**에 무엇이 될지 보여준다.
          확정 처리 선택 팝업(B안)은 2026-09-12 폐지 — 미시작 전건이 자동 동행한다. */}
      {preview && (
        <AnchorChangePreview
          before={preview.before}
          after={preview.after}
          isPending={isPending}
          onConfirm={() => { previewAckRef.current = true; setPreview(null); doSave() }}
          onCancel={() => setPreview(null)}
        />
      )}

      {/* 주소 중복 안내 — 다른 고객과 겹칠 때만. 확인 후 원래 하려던 동작(주소 적용 또는 저장)을 이어서 실행 */}
      {dupInfo && (
        <AddressDuplicateDialog
          customer={dupInfo.customer}
          building={dupInfo.building}
          address={dupInfo.address}
          onClose={() => { pendingAddrRef.current = null; pendingSaveRef.current = false; setDupInfo(null) }}
          onContinue={() => {
            dupAckRef.current = dupInfo.address
            setDupInfo(null)
            const addr = pendingAddrRef.current
            if (addr) { pendingAddrRef.current = null; applyAddress(addr); return }
            if (pendingSaveRef.current) { pendingSaveRef.current = false; doSave() }
          }}
          continueLabel="계속 적용"
        />
      )}
    </form>
  )
}
