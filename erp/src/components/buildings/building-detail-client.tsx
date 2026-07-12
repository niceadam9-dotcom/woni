'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, Pencil, X, Check, AlertTriangle, Search } from 'lucide-react'
import { updateBuildingAction, deleteBuildingAction } from '@/app/(dashboard)/buildings/actions'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'

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

type Building = {
  id: string
  customer_id: string
  building_name: string
  zipcode: string | null
  address: string | null
  total_area: number | null
  floors_above: number | null
  floors_below: number | null
  purpose: string | null
  year_built: number | null
  notes: string | null
  is_active: boolean
}

// DB(building_purposes) 미조회 시 폴백 — 관리자 > 건물 용도 관리에서 편집
const PURPOSES = ['공동주택', '근린생활시설', '판매시설', '의료시설', '교육시설', '숙박시설', '업무시설', '공장', '창고시설', '위험물저장시설', '기타']

export function BuildingDetailClient({ building, purposes = PURPOSES }: { building: Building; purposes?: string[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState('')
  const [showDeactivate, setShowDeactivate] = useState(false)
  const openPostcode = useDaumPostcode()

  const [form, setForm] = useState({
    building_name: building.building_name,
    zipcode: building.zipcode ?? '',
    address: building.address ?? '',
    total_area: building.total_area?.toString() ?? '',
    floors_above: building.floors_above?.toString() ?? '',
    floors_below: building.floors_below?.toString() ?? '',
    purpose: building.purpose ?? '',
    year_built: building.year_built?.toString() ?? '',
    notes: building.notes ?? '',
    is_active: building.is_active,
  })
  const [addrJibun, setAddrJibun] = useState('')

  function setField(key: keyof typeof form, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleAddressSearch() {
    openPostcode(data => {
      setAddrJibun(data.jibunAddress)
      setForm(prev => ({
        ...prev,
        zipcode: data.zonecode,
        address: data.roadAddress,
      }))
    })
  }

  function handleSave() {
    setError('')
    if (!form.building_name.trim()) { setError('건물명을 입력해주세요.'); return }

    startTransition(async () => {
      const result = await updateBuildingAction({
        id: building.id,
        building_name: form.building_name.trim(),
        zipcode: form.zipcode.trim() || undefined,
        address: form.address.trim() || undefined,
        total_area: form.total_area ? parseFloat(form.total_area) : undefined,
        floors_above: form.floors_above ? parseInt(form.floors_above) : undefined,
        floors_below: form.floors_below ? parseInt(form.floors_below) : undefined,
        purpose: form.purpose || undefined,
        year_built: form.year_built ? parseInt(form.year_built) : undefined,
        notes: form.notes.trim() || undefined,
        is_active: form.is_active,
      })
      if (result.error) { setError(result.error); return }
      setIsEditing(false)
      router.refresh()
    })
  }

  function handleDeactivate() {
    startTransition(async () => {
      await deleteBuildingAction(building.id)
      router.push('/buildings')
      router.refresh()
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* 기본정보 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#090c1d]">건물 기본정보</h2>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
            >
              <Pencil className="size-3" />
              수정
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setIsEditing(false); setError('') }}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                <X className="size-3" />
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={isPending}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                저장
              </button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-4">
            <Field label="건물명" required>
              <input
                value={form.building_name}
                onChange={e => setField('building_name', e.target.value)}
                className={inputCls}
              />
            </Field>

            {/* 주소 검색 섹션 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className={labelCls}>주소</label>
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
                  <input
                    value={form.zipcode}
                    readOnly
                    placeholder="검색 후 자동입력"
                    className={readonlyCls}
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <p className="text-xs text-[#b0acd6]">지번주소 (참고)</p>
                  <input
                    value={addrJibun}
                    readOnly
                    placeholder="검색 후 자동입력"
                    className={readonlyCls}
                  />
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

            <div className="flex items-center gap-3">
              <label className={labelCls}>활성 상태</label>
              <button
                type="button"
                onClick={() => setField('is_active', !form.is_active)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_active ? 'bg-[#7b68ee]' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-xs text-[#514b81]">{form.is_active ? '활성' : '비활성'}</span>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-[#514b81]">건물명</dt>
              <dd className="mt-1 text-sm font-medium text-[#090c1d]">{building.building_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#514b81]">상태</dt>
              <dd className="mt-1">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${building.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {building.is_active ? '활성' : '비활성'}
                </span>
              </dd>
            </div>
            {building.zipcode && (
              <div>
                <dt className="text-xs text-[#514b81]">우편번호</dt>
                <dd className="mt-1 text-sm text-[#090c1d] font-mono">{building.zipcode}</dd>
              </div>
            )}
            <div className={building.zipcode ? '' : 'col-span-2'}>
              <dt className="text-xs text-[#514b81]">주소</dt>
              <dd className="mt-1 text-sm text-[#090c1d]">
                {building.address ? (
                  <span className="flex items-start gap-1.5">
                    <MapPin className="size-3.5 text-[#b0acd6] shrink-0 mt-0.5" />
                    {building.address}
                  </span>
                ) : '-'}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* 건물 상세정보 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">건물 상세정보</h2>

        {isEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="용도">
                <select
                  value={form.purpose}
                  onChange={e => setField('purpose', e.target.value)}
                  className={inputCls}
                >
                  <option value="">용도 선택</option>
                  {purposes.map(p => <option key={p} value={p}>{p}</option>)}
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
                rows={3}
                className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
              />
            </Field>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-[#514b81]">용도</dt>
              <dd className="mt-1">
                {building.purpose ? (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">{building.purpose}</span>
                ) : (
                  <span className="text-sm text-[#090c1d]">-</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#514b81]">준공연도</dt>
              <dd className="mt-1 text-sm text-[#090c1d]">{building.year_built ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#514b81]">연면적</dt>
              <dd className="mt-1 text-sm text-[#090c1d]">
                {building.total_area != null ? `${building.total_area.toLocaleString()}㎡` : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#514b81]">층수</dt>
              <dd className="mt-1 text-sm text-[#090c1d]">
                {building.floors_above != null
                  ? `지상 ${building.floors_above}층${building.floors_below ? ` / 지하 ${building.floors_below}층` : ''}`
                  : '-'}
              </dd>
            </div>
            {building.notes && (
              <div className="col-span-2">
                <dt className="text-xs text-[#514b81]">비고</dt>
                <dd className="mt-1 text-sm text-[#090c1d] whitespace-pre-wrap">{building.notes}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* 비활성화 */}
      {building.is_active && !isEditing && (
        <section className="bg-white rounded-xl border border-red-100 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700">건물 비활성화</p>
              <p className="text-xs text-red-500 mt-1">비활성화하면 점검 대상에서 제외됩니다. 언제든 다시 활성화할 수 있습니다.</p>
            </div>
            {!showDeactivate ? (
              <button
                onClick={() => setShowDeactivate(true)}
                className="h-8 px-3 rounded-lg border border-red-200 text-xs text-red-600 hover:bg-red-50 transition-colors shrink-0"
              >
                비활성화
              </button>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowDeactivate(false)}
                  className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleDeactivate}
                  disabled={isPending}
                  className="h-8 px-3 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="size-3 animate-spin" /> : '확인'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
