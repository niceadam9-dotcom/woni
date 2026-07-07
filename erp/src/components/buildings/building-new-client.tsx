'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, Search, Sparkles } from 'lucide-react'
import { createBuildingAction } from '@/app/(dashboard)/buildings/actions'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
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

type Customer = {
  id: string
  customer_name: string
  customer_code: string
  address?: string | null
  region_si?: string | null
  region_myeon?: string | null
}

const PURPOSES = ['공동주택', '근린생활시설', '판매시설', '의료시설', '교육시설', '숙박시설', '업무시설', '공장', '창고시설', '위험물저장시설', '기타']

export function BuildingNewClient({
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
    customer_id: defaultCustomerId ?? '',
    building_name: '',
    zipcode: '',
    address: '',
    total_area: '',
    floors_above: '',
    floors_below: '',
    purpose: '',
    year_built: '',
    notes: '',
  })
  const [addrJibun, setAddrJibun] = useState('')
  // 주소 검색 후 지역 매칭된 고객사 후보 (복수일 때 제안 UI)
  const [suggestedCustomers, setSuggestedCustomers] = useState<Customer[]>([])

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleAddressSearch() {
    openPostcode(data => {
      // ── 주소 필드 자동입력 ────────────────────────────
      setAddrJibun(data.jibunAddress)
      const nextForm = {
        ...form,
        zipcode: data.zonecode,
        address: data.roadAddress,
      }

      // ── 건물명 자동입력 (API가 건물명을 제공할 때) ────
      if (data.buildingName && !form.building_name) {
        nextForm.building_name = data.buildingName
      }

      // ── 용도 자동추정 (공동주택 여부) ─────────────────
      if (!form.purpose && data.apartment === 'Y') {
        nextForm.purpose = '공동주택'
      }

      setForm(nextForm)

      // ── 고객사 자동매칭 ───────────────────────────────
      // region 컬럼이 있는 고객은 시군구+읍면동으로 매칭, 없으면 주소 문자열로 매칭
      let matched: Customer[] = []

      const byRegion = customers.filter(
        c => c.region_si === data.sigungu && c.region_myeon === (data.bname1 || data.bname)
      )
      if (byRegion.length > 0) {
        matched = byRegion
      } else {
        // fallback: 주소에 시군구 포함 여부
        matched = customers.filter(
          c => c.address && c.address.includes(data.sigungu)
        )
      }

      if (matched.length === 1) {
        // 1건 매칭 → 자동선택
        setForm(prev => ({ ...prev, ...nextForm, customer_id: matched[0].id }))
        setSuggestedCustomers([])
      } else if (matched.length > 1) {
        // 복수 매칭 → 제안 목록 표시
        setSuggestedCustomers(matched)
      } else {
        setSuggestedCustomers([])
      }
    })
  }

  function handleSubmit() {
    setError('')
    if (!form.customer_id) { setError('고객사를 선택해주세요.'); return }
    if (!form.building_name.trim()) { setError('건물명을 입력해주세요.'); return }

    startTransition(async () => {
      const result = await createBuildingAction({
        customer_id: form.customer_id,
        building_name: form.building_name.trim(),
        zipcode: form.zipcode.trim() || undefined,
        address: form.address.trim() || undefined,
        total_area: form.total_area ? parseFloat(form.total_area) : undefined,
        floors_above: form.floors_above ? parseInt(form.floors_above) : undefined,
        floors_below: form.floors_below ? parseInt(form.floors_below) : undefined,
        purpose: form.purpose || undefined,
        year_built: form.year_built ? parseInt(form.year_built) : undefined,
        notes: form.notes.trim() || undefined,
      })
      if (result.error) { setError(result.error); return }
      router.push(`/buildings/${result.buildingId}`)
      router.refresh()
    })
  }

  return (
    <form className="max-w-2xl space-y-6" onSubmit={e => { e.preventDefault(); handleSubmit() }}>
      {/* 고객사 및 기본정보 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">건물 기본정보</h2>

        {/* 주소 검색 섹션 — 맨 위로 이동, 검색 결과가 다른 필드를 채워줌 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className={labelCls}>
              주소 검색
              <span className="ml-1.5 text-[#7b68ee] font-normal">(검색하면 건물명·고객사·용도 자동입력)</span>
            </label>
            <button
              type="button"
              onClick={handleAddressSearch}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-xs font-medium transition-colors"
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
            <p className="text-xs text-[#b0acd6]">도로명주소 (상세주소 직접 추가 가능)</p>
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

        {/* 고객사 자동매칭 제안 */}
        {suggestedCustomers.length > 0 && !form.customer_id && (
          <div className="rounded-lg border border-[#7b68ee]/30 bg-[#f5f4ff] p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-[#7b68ee]" />
              <p className="text-xs font-medium text-[#7b68ee]">
                해당 지역 고객사 {suggestedCustomers.length}건 매칭 — 클릭하여 선택
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedCustomers.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setField('customer_id', c.id)
                    setSuggestedCustomers([])
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-[#7b68ee]/30 text-[#514b81] hover:border-[#7b68ee] hover:text-[#7b68ee] transition-colors font-medium"
                >
                  {c.customer_name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 고객사 선택 */}
        <Field label="고객사" required>
          <CustomerCombobox
            customers={customers}
            value={form.customer_id}
            onChange={id => { setField('customer_id', id); setSuggestedCustomers([]) }}
          />
        </Field>

        {/* 건물명 */}
        <Field label="건물명" required>
          <input
            value={form.building_name}
            onChange={e => setField('building_name', e.target.value)}
            placeholder="주소 검색 시 자동입력 또는 직접 입력"
            className={inputCls}
          />
        </Field>
      </section>

      {/* 건물 상세정보 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">건물 상세정보</h2>

        <div className="grid grid-cols-2 gap-4">
          <Field label="용도">
            <select
              value={form.purpose}
              onChange={e => setField('purpose', e.target.value)}
              className={inputCls}
            >
              <option value="">용도 선택</option>
              {PURPOSES.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="준공연도">
            <input
              type="number"
              value={form.year_built}
              onChange={e => setField('year_built', e.target.value)}
              placeholder="예: 2010"
              min={1900}
              max={new Date().getFullYear()}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="연면적 (㎡)">
          <input
            type="number"
            value={form.total_area}
            onChange={e => setField('total_area', e.target.value)}
            placeholder="예: 5420.5"
            min={0}
            step={0.01}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="지상 층수">
            <input
              type="number"
              value={form.floors_above}
              onChange={e => setField('floors_above', e.target.value)}
              placeholder="예: 10"
              min={1}
              className={inputCls}
            />
          </Field>
          <Field label="지하 층수">
            <input
              type="number"
              value={form.floors_below}
              onChange={e => setField('floors_below', e.target.value)}
              placeholder="예: 2"
              min={0}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="비고">
          <textarea
            value={form.notes}
            onChange={e => setField('notes', e.target.value)}
            placeholder="특이사항 메모"
            rows={3}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
          />
        </Field>
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
          {isPending ? <Loader2 className="size-4 animate-spin" /> : '건물 등록'}
        </button>
      </div>
    </form>
  )
}
