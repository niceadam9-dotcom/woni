'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, UserCheck, Users, Phone, Mail, MapPin, Search, X, Building2, Plus, AlertTriangle } from 'lucide-react'
import { createCustomerAction, generateCustomerCodeAction, checkAddressAction, fetchBuildingLedgerAction, type ContactInput, type BuildingLedgerInfo } from '@/app/(dashboard)/customers/actions'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import type { InspectionType } from '@/types'
import { inspectionTypeLabel } from '@/types'

function extractBuildingName(fullAddress: string): string {
  const match = fullAddress.match(/\(([^)]+)\)$/)
  return match ? match[1].trim() : ''
}

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

type Employee = { id: string; name: string; position: string | null }
type ContactForm = { name: string; phone: string; email: string }
const emptyContact = (): ContactForm => ({ name: '', phone: '', email: '' })

export function CustomerNewClient({ employees, defaultRegionSi = '' }: { employees: Employee[]; defaultRegionSi?: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const openPostcode = useDaumPostcode()
  const customerNameRef = useRef<HTMLInputElement>(null)
  // ADD-2: 주소 중복 등록 감지 팝업 (+저장 시점 재검증)
  const [dupInfo, setDupInfo] = useState<{ id: string; customer_name: string; inspection_type: string; employee_name: string | null } | null>(null)
  const dupAckRef = useRef('')            // '계속 등록'으로 확인 완료된 주소
  const pendingSubmitRef = useRef(false)  // 저장 시점 중복 확인 후 이어서 제출할지
  // 건축물대장 소방안전 자료 (높이/주구조/승강기/세대수) — buildings 저장용
  const ledgerRef = useRef<BuildingLedgerInfo | null>(null)
  const [ledgerNote, setLedgerNote] = useState('')
  // ADD-3: 관계인 — 대표만 기본, [추가] 버튼으로 직원1/직원2 노출
  const [visibleContactRoles, setVisibleContactRoles] = useState<Array<'대표' | '직원1' | '직원2'>>(['대표'])

  const [form, setForm] = useState({
    customer_code: '',
    customer_name: '',
    contract_date: '',
    use_approval_date: '',
    plan_anchor_date: '',
    inspection_type: '종합' as InspectionType,
    zipcode: '',
    address: '',
    region_si: '',
    region_myeon: '',
    region_ri: '',
    notes: '',
    assigned_employee_id: '',
    // 건물 기본정보 (V9-3)
    building_purpose: '',
    building_floors_above: '',
    building_floors_below: '',
    building_total_area: '',
    building_year_built: '',
  })
  const [addrJibun, setAddrJibun] = useState('')

  const [contacts, setContacts] = useState({
    대표: emptyContact(),
    직원1: emptyContact(),
    직원2: emptyContact(),
  })

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function setContact(role: keyof typeof contacts, key: keyof ContactForm, value: string) {
    setContacts(prev => ({
      ...prev,
      [role]: { ...prev[role], [key]: value },
    }))
  }

  async function handleGenerateCode() {
    setIsGenerating(true)
    const result = await generateCustomerCodeAction('C')
    setIsGenerating(false)
    if (result.code) setField('customer_code', result.code)
  }

  useEffect(() => {
    handleGenerateCode()
    // 기본 지역 pre-fill: 시/군/구 ← 회사 기본 지역, 읍/면 ← 최근 사용값(localStorage)
    setForm(prev => ({
      ...prev,
      region_si: prev.region_si || defaultRegionSi,
      region_myeon: prev.region_myeon || (localStorage.getItem('lastUsedMyeon') ?? ''),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleAddressSearch() {
    openPostcode(data => {
      setAddrJibun(data.jibunAddress)
      // ADD-1: 지역 필드는 UI에서 제거됐지만 지역배정/필터/검색이 사용하므로 백그라운드 자동 저장 유지
      setForm(prev => ({
        ...prev,
        zipcode: data.zonecode,
        address: data.roadAddress,
        region_si: data.sigungu,
        region_myeon: data.bname1 || data.bname,
        region_ri: data.bname2 || '',
      }))

      // 주소 끝 괄호 안 건물명 자동추출
      const building = extractBuildingName(data.roadAddress)
      if (building) {
        setForm(prev => ({ ...prev, customer_name: building }))
        setTimeout(() => {
          customerNameRef.current?.select()  // 전체 선택 → 바로 덮어쓰기 가능
        }, 50)
      } else {
        setTimeout(() => {
          customerNameRef.current?.focus()   // 빈 칸 자동 포커스 → 바로 타이핑
        }, 50)
      }

      // ADD-2/ADD-4: 중복 고객 확인 + 기존 건물정보 자동 로드
      checkAddressAction(data.roadAddress).then(res => {
        if (res.duplicate) setDupInfo(res.duplicate)
        if (res.building) {
          const b = res.building
          setForm(prev => ({
            ...prev,
            building_purpose:      prev.building_purpose      || (b.purpose ?? ''),
            building_total_area:   prev.building_total_area   || (b.total_area != null ? String(b.total_area) : ''),
            building_floors_above: prev.building_floors_above || (b.floors_above != null ? String(b.floors_above) : ''),
            building_floors_below: prev.building_floors_below || (b.floors_below != null ? String(b.floors_below) : ''),
            building_year_built:   prev.building_year_built   || (b.year_built != null ? String(b.year_built) : ''),
          }))
        }
      }).catch(() => null)

      // 건축물대장 API: 신규 주소도 소방안전 관련 건물정보 자동 조회 (키 미설정 시 조용히 건너뜀)
      setLedgerNote('')
      if (data.bcode) {
        fetchBuildingLedgerAction(data.bcode, data.jibunAddress).then(res => {
          if (res.unavailable || res.error || !res.info) {
            if (res.error) setLedgerNote(`건축물대장: ${res.error}`)
            return
          }
          const L = res.info
          ledgerRef.current = L
          // 건물 물리정보(용도/연면적/층수/준공연도)만 자동 채움.
          // ★ 사용승인일은 6단계 점검계획의 기산점이라 자동 입력하지 않음 — 사용자가 직접 판단해 입력 (참고값은 안내로만 표시)
          setForm(prev => ({
            ...prev,
            building_purpose:      prev.building_purpose      || (L.purpose ?? ''),
            building_total_area:   prev.building_total_area   || (L.total_area != null ? String(L.total_area) : ''),
            building_floors_above: prev.building_floors_above || (L.floors_above != null ? String(L.floors_above) : ''),
            building_floors_below: prev.building_floors_below || (L.floors_below != null ? String(L.floors_below) : ''),
            building_year_built:   prev.building_year_built   || (L.use_approval_date ? L.use_approval_date.slice(0, 4) : ''),
          }))
          const extras = [
            L.use_approval_date && `대장상 사용승인일 ${L.use_approval_date}(참고)`,
            L.height != null && `높이 ${L.height}m`,
            L.main_structure && `구조 ${L.main_structure}`,
            L.elevator_count != null && `승강기 ${L.elevator_count}대`,
            L.emergency_elevator_count != null && `비상용 ${L.emergency_elevator_count}대`,
            L.households != null && `세대 ${L.households}`,
            L.seismic_design && `내진설계 ${L.seismic_design === '1' || L.seismic_design === 'Y' ? '적용' : '미적용'}`,
          ].filter(Boolean).join(' · ')
          setLedgerNote(`건축물대장 자동 조회 완료${extras ? ` — ${extras}` : ''}`)
        }).catch(() => null)
      }
    })
  }

  function handleSubmit() {
    setError('')
    if (!form.customer_code.trim()) { setError('고객코드 생성 중입니다. 잠시 후 다시 시도해주세요.'); return }
    if (!form.customer_name.trim()) { setError('고객명을 입력해주세요.'); return }
    if (!form.contract_date) { setError('계약일을 선택해주세요.'); return }
    if (!form.plan_anchor_date) { setError('점검계획일을 선택해주세요.'); return }
    for (const [label, v] of [['계약일', form.contract_date], ['점검계획일', form.plan_anchor_date], ['사용승인일', form.use_approval_date]] as const) {
      if (v && !isCompleteDate(v)) { setError(`${label}을(를) YYYY-MM-DD 형식으로 입력해주세요.`); return }
    }
    if (!contacts['대표'].name.trim()) { setError('대표 관계인 이름을 입력해주세요. (대표 1명 필수)'); return }

    // 저장 시점 중복 재검증 (주소 수동 입력 대비) — 이미 확인한 주소는 통과
    const addr = form.address.trim()
    if (addr && dupAckRef.current !== addr) {
      startTransition(async () => {
        const res = await checkAddressAction(addr)
        if (res.duplicate) {
          pendingSubmitRef.current = true
          setDupInfo(res.duplicate)
          return
        }
        dupAckRef.current = addr
        doSubmit()
      })
      return
    }
    doSubmit()
  }

  function doSubmit() {
    const contactInputs: ContactInput[] = (
      Object.entries(contacts) as [keyof typeof contacts, ContactForm][]
    )
      .filter(([, c]) => c.name.trim())
      .map(([role, c]) => ({
        role,
        name: c.name.trim(),
        phone: c.phone.trim() || undefined,
        email: c.email.trim() || undefined,
      }))

    startTransition(async () => {
      const result = await createCustomerAction({
        customer_code: form.customer_code.trim(),
        customer_name: form.customer_name.trim(),
        contract_date: form.contract_date,
        use_approval_date: form.use_approval_date || undefined,
        plan_anchor_date: form.plan_anchor_date,
        inspection_type: form.inspection_type,
        zipcode: form.zipcode.trim() || undefined,
        address: form.address.trim() || undefined,
        region_si: form.region_si.trim() || undefined,
        region_myeon: form.region_myeon.trim() || undefined,
        region_ri: form.region_ri.trim() || undefined,
        notes: form.notes.trim() || undefined,
        assigned_employee_id: form.assigned_employee_id || undefined,
        contacts: contactInputs,
        building_purpose:      form.building_purpose.trim() || undefined,
        building_floors_above: form.building_floors_above ? parseInt(form.building_floors_above) : undefined,
        building_floors_below: form.building_floors_below ? parseInt(form.building_floors_below) : undefined,
        building_total_area:   form.building_total_area   ? parseFloat(form.building_total_area)  : undefined,
        building_year_built:   form.building_year_built   ? parseInt(form.building_year_built)    : undefined,
        // 건축물대장 소방안전 자료 (migration 037/038)
        building_height:          ledgerRef.current?.height ?? undefined,
        building_main_structure:  ledgerRef.current?.main_structure ?? undefined,
        building_elevator_count:  ledgerRef.current?.elevator_count ?? undefined,
        building_households:      ledgerRef.current?.households ?? undefined,
        building_emergency_elevator_count: ledgerRef.current?.emergency_elevator_count ?? undefined,
        building_roof_structure:  ledgerRef.current?.roof_structure ?? undefined,
        building_etc_purpose:     ledgerRef.current?.etc_purpose ?? undefined,
        building_ho_count:        ledgerRef.current?.ho_count ?? undefined,
        building_attached_count:  ledgerRef.current?.attached_building_count ?? undefined,
        building_seismic_design:  ledgerRef.current?.seismic_design ?? undefined,
      })
      if (result.error) { setError(result.error); return }
      // 다음 등록을 위한 최근 읍/면 기억
      if (form.region_myeon.trim()) localStorage.setItem('lastUsedMyeon', form.region_myeon.trim())
      router.push(`/customers/${result.customerId}`)
      router.refresh()
    })
  }

  const INSPECTION_ANNUAL: Record<InspectionType, string> = {
    '종합':     '연 12회 자동 생성 (종합 2회 + 정기 10회)',
    '작동':     '연 12회 자동 생성 (작동 1회 + 정기 11회)',
    '일반관리': '수동 등록 (자동 생성 없음)',
  }

  return (
    <form className="max-w-2xl space-y-6" onSubmit={e => { e.preventDefault(); handleSubmit() }}>
      {/* 기본 정보 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">고객 기본정보</h2>

        {/* ① 주소 검색 섹션 — 최상단 배치 */}
        <div className="space-y-3 pb-4 border-b border-[#e8e6f5]">
          <div className="flex items-center justify-between">
            <label className={`${labelCls} flex items-center gap-1`}>
              <MapPin className="size-3.5 text-[#7b68ee]" />
              주소 검색
              <span className="text-xs text-[#b0acd6] font-normal ml-1">— 검색 후 건물명 자동입력</span>
            </label>
            <button
              type="button"
              onClick={handleAddressSearch}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6a59d9] text-white text-xs font-medium transition-colors"
            >
              <Search className="size-3.5" />
              주소 검색
            </button>
          </div>

          {/* 우편번호 + 지번주소 */}
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1">
              <p className="text-xs text-[#b0acd6]">우편번호</p>
              <input value={form.zipcode} readOnly placeholder="자동입력" className={readonlyCls} />
            </div>
            <div className="col-span-3 space-y-1">
              <p className="text-xs text-[#b0acd6]">지번주소 (참고)</p>
              <input value={addrJibun} readOnly placeholder="자동입력" className={readonlyCls} />
            </div>
          </div>

          {/* 도로명주소 */}
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

          {/* ADD-1: 지역 입력 UI 제거 — 주소검색 시 region_si/myeon/ri는 백그라운드 자동 저장 (지역배정·필터·검색에서 사용) */}
        </div>

        {/* ② 고객명(건물명) — 고객코드는 내부 자동생성(V9 §6: UI 미노출) */}
        <div className="grid grid-cols-1 gap-4">
          <Field label="고객명 (건물명)" required>
            <div className="relative">
              <input
                ref={customerNameRef}
                value={form.customer_name}
                onChange={e => setField('customer_name', e.target.value)}
                placeholder="주소 검색 시 자동입력 또는 직접 입력"
                className={inputCls}
              />
              {form.customer_name && (
                <button
                  type="button"
                  onClick={() => { setField('customer_name', ''); customerNameRef.current?.focus() }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#b0acd6] hover:text-[#514b81]"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="계약일" required>
            <DateInput
              value={form.contract_date}
              onChange={e => setField('contract_date', e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="사용승인일">
            <DateInput
              value={form.use_approval_date}
              onChange={e => setField('use_approval_date', e.target.value)}
              className={inputCls}
            />
            {ledgerRef.current?.use_approval_date && !form.use_approval_date && (
              <button
                type="button"
                onClick={() => setField('use_approval_date', ledgerRef.current!.use_approval_date!)}
                className="mt-1 text-[11px] text-[#7b68ee] hover:underline"
              >
                건축물대장 사용승인일 {ledgerRef.current.use_approval_date} 적용
              </button>
            )}
          </Field>
          <Field label="점검계획일" required>
            <DateInput
              value={form.plan_anchor_date}
              onChange={e => setField('plan_anchor_date', e.target.value)}
              className={inputCls}
            />
            <p className="text-[11px] text-[#b0acd6]">연간 점검계획의 기산일 — 이 날짜의 월·일 기준으로 계획이 생성됩니다</p>
          </Field>
        </div>

        <Field label="점검유형" required>
          <div className="flex gap-6">
            {(['소방안전관리', '일반관리'] as const).map(cat => (
              <label key={cat} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="inspection_category"
                  checked={cat === '일반관리' ? form.inspection_type === '일반관리' : form.inspection_type !== '일반관리'}
                  onChange={() => setField('inspection_type', cat === '일반관리' ? '일반관리' : '종합')}
                  className="accent-[#7b68ee]"
                />
                <span className="text-sm font-medium text-[#090c1d]">{cat}</span>
              </label>
            ))}
          </div>
          {form.inspection_type !== '일반관리' && (
            <div className="flex gap-6 mt-2 pl-3 border-l-2 border-[#e0ddf5]">
              {(['종합', '작동'] as const).map(sub => (
                <label key={sub} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="inspection_sub_type"
                    checked={form.inspection_type === sub}
                    onChange={() => setField('inspection_type', sub)}
                    className="accent-[#7b68ee]"
                  />
                  <span className="text-sm text-[#090c1d]">
                    {sub} <span className="text-xs text-[#7b7b8d]">({sub === '종합' ? '연2회' : '연1회'})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Field>

        {form.inspection_type && (
          <p className="text-xs text-[#7b68ee] bg-[#f5f4ff] rounded-lg px-3 py-2">
            {form.inspection_type !== '일반관리' ? `소방안전관리 › ${form.inspection_type}` : '일반관리'}: {INSPECTION_ANNUAL[form.inspection_type]}
          </p>
        )}

        <Field label="비고">
          <textarea
            value={form.notes}
            onChange={e => setField('notes', e.target.value)}
            placeholder="특이사항 메모"
            rows={2}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
          />
        </Field>
      </section>

      {/* 담당직원 배정 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">담당직원 배정</h2>
          <span className="text-xs text-[#514b81]">(나중에 변경 가능)</span>
        </div>

        <Field label="담당직원">
          <select
            value={form.assigned_employee_id}
            onChange={e => setField('assigned_employee_id', e.target.value)}
            className={inputCls}
          >
            <option value="">배정 안함</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.name}{e.position ? ` (${e.position})` : ''}
              </option>
            ))}
          </select>
        </Field>

        {form.assigned_employee_id && (
          <p className="text-xs text-[#514b81] bg-[#f8f9fa] rounded-lg px-3 py-2">
            배정 즉시 해당 직원에게 알림이 발송됩니다.
          </p>
        )}
      </section>

      {/* 관계인 정보 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">관계인 정보</h2>
          <span className="text-xs text-[#514b81]">(대표 필수)</span>
          {/* ADD-3: 대표만 기본 표시 — 필요 시 [추가]로 최대 2명 더 */}
          {visibleContactRoles.length < 3 && (
            <button
              type="button"
              onClick={() => setVisibleContactRoles(prev =>
                prev.length === 1 ? [...prev, '직원1'] : [...prev, '직원2']
              )}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-xs font-medium transition-colors border border-[#d0ccf5]"
            >
              <Plus className="size-3" />
              관계인 추가
            </button>
          )}
        </div>

        {visibleContactRoles.map(role => {
          const roleLabel = role === '대표' ? '대표' : '추가 관계인'
          return (
          <div key={role} className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#c8c4d0] pb-1.5">
              <label
                htmlFor={`contact-${role}-name`}
                className="text-xs font-semibold text-[#514b81] cursor-pointer hover:text-[#7b68ee] transition-colors"
              >
                {roleLabel}
              </label>
              {role !== '대표' && (
                <button
                  type="button"
                  onClick={() => {
                    setContact(role, 'name', ''); setContact(role, 'phone', ''); setContact(role, 'email', '')
                    setVisibleContactRoles(prev => prev.filter(r => r !== role))
                  }}
                  className="text-[#b0acd6] hover:text-red-500 transition-colors"
                  title="관계인 제거"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="이름">
                <input
                  id={`contact-${role}-name`}
                  value={contacts[role].name}
                  onChange={e => setContact(role, 'name', e.target.value)}
                  placeholder={`${roleLabel} 이름`}
                  className={inputCls}
                />
              </Field>
              <Field label="연락처">
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3 text-[#b0acd6]" />
                  <input
                    value={contacts[role].phone}
                    onChange={e => setContact(role, 'phone', e.target.value)}
                    placeholder="010-0000-0000"
                    className={`${inputCls} pl-7`}
                  />
                </div>
              </Field>
              <Field label="이메일">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3 text-[#b0acd6]" />
                  <input
                    type="email"
                    value={contacts[role].email}
                    onChange={e => setContact(role, 'email', e.target.value)}
                    placeholder="example@email.com"
                    className={`${inputCls} pl-7`}
                  />
                </div>
              </Field>
            </div>
          </div>
          )
        })}
      </section>

      {/* 건물 기본정보 (V9-3) */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">건물 기본정보</h2>
          <span className="text-xs text-[#514b81]">(선택)</span>
          {ledgerNote && (
            <span className={`text-[11px] ml-auto ${ledgerNote.startsWith('건축물대장 자동') ? 'text-green-600' : 'text-amber-500'}`}>
              {ledgerNote}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="건물용도">
            <input
              value={form.building_purpose}
              onChange={e => setField('building_purpose', e.target.value)}
              placeholder="예: 업무시설, 근린생활시설"
              className={inputCls}
            />
          </Field>
          <Field label="연면적 (㎡)">
            <input
              type="number"
              value={form.building_total_area}
              onChange={e => setField('building_total_area', e.target.value)}
              placeholder="예: 1500.5"
              min="0"
              step="0.01"
              className={inputCls}
            />
          </Field>
          <Field label="지상층수">
            <input
              type="number"
              value={form.building_floors_above}
              onChange={e => setField('building_floors_above', e.target.value)}
              placeholder="예: 5"
              min="0"
              className={inputCls}
            />
          </Field>
          <Field label="지하층수">
            <input
              type="number"
              value={form.building_floors_below}
              onChange={e => setField('building_floors_below', e.target.value)}
              placeholder="예: 1"
              min="0"
              className={inputCls}
            />
          </Field>
          <Field label="준공연도">
            <input
              type="number"
              value={form.building_year_built}
              onChange={e => setField('building_year_built', e.target.value)}
              placeholder="예: 2005"
              min="1900"
              max={new Date().getFullYear()}
              className={inputCls}
            />
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
          type="submit"
          disabled={isPending}
          className="flex-1 h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : '고객 등록'}
        </button>
      </div>

      {/* ADD-2: 주소 중복 등록 안내 팝업 — 확인 후 등록 진행 가능 */}
      {dupInfo && (
        <div
          className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setDupInfo(null)}
        >
          <div
            className="bg-white rounded-xl border border-[#d0ccf5] shadow-xl w-full max-w-sm p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="size-4 text-amber-500" />
              <h3 className="text-sm font-bold text-[#090c1d]">이미 등록된 주소입니다</h3>
            </div>
            <div className="rounded-lg bg-[#f8f9fa] border border-[#e0ddf5] p-3 space-y-1 text-sm">
              <p className="font-medium text-[#090c1d]">{dupInfo.customer_name}</p>
              <p className="text-xs text-[#514b81]">점검유형: {inspectionTypeLabel(dupInfo.inspection_type)} · 담당: {dupInfo.employee_name ?? '미배정'}</p>
            </div>
            <p className="text-xs text-[#514b81] mt-3">같은 주소의 고객이 이미 있습니다. 기존 고객 정보를 확인하거나, 별도 고객이 맞으면 계속 등록할 수 있습니다.</p>
            <div className="flex gap-2 mt-4">
              <Link
                href={`/customers/${dupInfo.id}`}
                className="flex-1 h-9 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center justify-center"
              >
                기존 고객 보기
              </Link>
              <button
                type="button"
                onClick={() => {
                  dupAckRef.current = form.address.trim()
                  setDupInfo(null)
                  if (pendingSubmitRef.current) { pendingSubmitRef.current = false; doSubmit() }
                }}
                className="flex-1 h-9 rounded-lg border border-[#d0ccf5] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                계속 등록
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}
