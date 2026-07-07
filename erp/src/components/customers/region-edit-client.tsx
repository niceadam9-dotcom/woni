'use client'

import { useState, useTransition } from 'react'
import { Pencil, X, Loader2, Wand2, Search, MapPin } from 'lucide-react'
import { updateCustomerRegionAction } from '@/app/(dashboard)/customers/actions'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { extractRegionFromAddress } from '@/lib/address-parser'

const inputCls =
  'w-full h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

type Props = {
  customerId: string
  customerName: string
  address: string | null
  region_si: string | null
  region_myeon: string | null
  region_ri: string | null
}

export function RegionEditClient({
  customerId,
  customerName,
  address,
  region_si,
  region_myeon,
  region_ri,
}: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const openPostcode = useDaumPostcode()

  const [form, setForm] = useState({
    region_si: region_si ?? '',
    region_myeon: region_myeon ?? '',
    region_ri: region_ri ?? '',
  })

  function handleOpen() {
    setForm({
      region_si: region_si ?? '',
      region_myeon: region_myeon ?? '',
      region_ri: region_ri ?? '',
    })
    setError('')
    setOpen(true)
  }

  function handleAddressSearch() {
    openPostcode(data => {
      setForm({
        region_si: data.sigungu,
        region_myeon: data.bname1 || data.bname,
        region_ri: data.bname2 || '',
      })
    })
  }

  function handleExtract() {
    if (!address) return
    const extracted = extractRegionFromAddress(address)
    if (extracted.region_si) {
      setForm({
        region_si: extracted.region_si,
        region_myeon: extracted.region_myeon,
        region_ri: extracted.region_ri,
      })
    }
  }

  function handleSave() {
    setError('')
    startTransition(async () => {
      const result = await updateCustomerRegionAction(customerId, form)
      if (result.error) { setError(result.error); return }
      setOpen(false)
    })
  }

  // 표시용 지역 텍스트
  const regionText = [region_si, region_myeon, region_ri].filter(Boolean).join(' ')

  return (
    <>
      {/* 테이블 셀 내 표시 */}
      <button
        type="button"
        onClick={handleOpen}
        className="group flex items-center gap-1.5 text-xs text-[#514b81] hover:text-[#7b68ee] transition-colors text-left"
      >
        <span className={regionText ? '' : 'text-[#b0acd6]'}>
          {regionText || '지역 미입력'}
        </span>
        <Pencil className="size-3 opacity-0 group-hover:opacity-100 text-[#7b68ee] transition-opacity shrink-0" />
      </button>

      {/* 편집 모달 */}
      {open && (
        <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-sm">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
              <div>
                <h2 className="text-sm font-semibold text-[#090c1d]">지역 편집</h2>
                <p className="text-xs text-[#514b81] mt-0.5">{customerName}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-[#514b81] hover:text-[#090c1d]">
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={e => { e.preventDefault(); if (!isPending) handleSave() }}>
            <div className="px-5 py-4 space-y-4">
              {/* 주소 참고 */}
              {address && (
                <div className="flex items-start gap-1.5 text-xs text-[#514b81] bg-[#f8f9fa] rounded-lg px-3 py-2">
                  <MapPin className="size-3.5 shrink-0 mt-0.5 text-[#b0acd6]" />
                  <span className="break-all">{address}</span>
                </div>
              )}

              {/* 빠른 입력 버튼 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddressSearch}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-xs font-medium transition-colors"
                >
                  <Search className="size-3.5" />
                  주소 검색
                </button>
                {address && (
                  <button
                    type="button"
                    onClick={handleExtract}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-[#d0ccf5] bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-xs font-medium transition-colors"
                  >
                    <Wand2 className="size-3.5" />
                    주소에서 추출
                  </button>
                )}
              </div>

              {/* 지역 입력 필드 */}
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#514b81]">시/군/구</label>
                    <input
                      value={form.region_si}
                      onChange={e => setForm(s => ({ ...s, region_si: e.target.value }))}
                      placeholder="양평군"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#514b81]">읍/면/동</label>
                    <input
                      value={form.region_myeon}
                      onChange={e => setForm(s => ({ ...s, region_myeon: e.target.value }))}
                      placeholder="양평읍"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#514b81]">리/동</label>
                    <input
                      value={form.region_ri}
                      onChange={e => setForm(s => ({ ...s, region_ri: e.target.value }))}
                      placeholder="양평리"
                      className={inputCls}
                    />
                  </div>
                </div>
                {/* 미리보기 */}
                {(form.region_si || form.region_myeon || form.region_ri) && (
                  <p className="text-xs text-[#7b68ee] bg-[#f5f4ff] rounded-lg px-3 py-1.5">
                    {[form.region_si, form.region_myeon, form.region_ri].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            {/* 버튼 */}
            <div className="flex gap-3 px-5 py-4 border-t border-[#c8c4d0]">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 h-10 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : '저장'}
              </button>
            </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
