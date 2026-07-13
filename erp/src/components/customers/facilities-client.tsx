'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Flame, Check, Plus, X, Loader2, ShieldCheck } from 'lucide-react'
import { saveFacilitiesAction, verifyFacilitiesAction, type FacilityRow, type FloorRow } from '@/app/(dashboard)/customers/facilities-actions'

// 표준 소방시설 분류 (보고서 '현황' 대응)
const CATALOG: Array<{ category: string; items: string[] }> = [
  { category: '소화설비', items: ['소화기구', '옥내소화전', '스프링클러', '간이스프링클러', '물분무등소화설비', '옥외소화전'] },
  { category: '경보설비', items: ['자동화재탐지설비', '비상경보설비', '비상방송설비', '자동화재속보설비', '가스누설경보기'] },
  { category: '피난구조설비', items: ['피난기구', '인명구조기구', '유도등·유도표지', '비상조명등'] },
  { category: '소화용수설비', items: ['상수도소화용수설비', '소화수조·저수조'] },
  { category: '소화활동설비', items: ['제연설비', '연결송수관설비', '연결살수설비', '비상콘센트설비', '무선통신보조설비'] },
]
const FLOOR_COLS = ['소화기', '차동식', '연기식', '정온식', '유도등', '비상조명']

type Building = {
  id: string; building_name: string
  verified_at: string | null
  facilities: Array<{ facility_code: string; installed: boolean; detail: { note?: string } | null }>
  floors: Array<{ floor_label: string; counts: Record<string, number> }>
}

export function FacilitiesClient({ customerId, buildings, canManage }: {
  customerId: string; buildings: Building[]; canManage: boolean
}) {
  const router = useRouter()
  const [bidx, setBidx] = useState(0)
  const b = buildings[bidx]
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  // 편집 상태 초기화 (선택 건물 기준)
  const initFac = (): Record<string, FacilityRow> => {
    const map: Record<string, FacilityRow> = {}
    for (const cat of CATALOG) for (const code of cat.items) {
      const ex = b?.facilities.find(f => f.facility_code === code)
      map[code] = { category: cat.category, facility_code: code, installed: ex?.installed ?? false, detail: ex?.detail?.note ?? '' }
    }
    return map
  }
  const [fac, setFac] = useState<Record<string, FacilityRow>>(initFac)
  const [floors, setFloors] = useState<FloorRow[]>(
    () => (b?.floors ?? []).map((f, i) => ({ floor_label: f.floor_label, sort_order: i, counts: { ...f.counts } }))
  )
  const [editing, setEditing] = useState(false)

  function reset(nextIdx = bidx) {
    setBidx(nextIdx)
    setTimeout(() => { setFac(initFac()); setFloors((buildings[nextIdx]?.floors ?? []).map((f, i) => ({ floor_label: f.floor_label, sort_order: i, counts: { ...f.counts } }))); setEditing(false) }, 0)
  }

  function save() {
    setError('')
    startTransition(async () => {
      const res = await saveFacilitiesAction(b.id, customerId, Object.values(fac), floors)
      if (res.error) { setError(res.error); return }
      setEditing(false); router.refresh()
    })
  }
  function verify() {
    startTransition(async () => {
      const res = await verifyFacilitiesAction(b.id, customerId)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  if (!b) return <p className="text-sm text-[#514b81] py-4 text-center">등록된 건물이 없습니다 — 먼저 건물을 등록하세요</p>

  const installedList = b.facilities.filter(f => f.installed)

  return (
    <div>
      {/* 건물(동) 선택 */}
      {buildings.length > 1 && (
        <div className="flex gap-1 mb-3">
          {buildings.map((bd, i) => (
            <button key={bd.id} onClick={() => reset(i)}
              className={`h-7 px-2.5 rounded-lg text-xs font-medium transition-colors ${i === bidx ? 'bg-[#7b68ee] text-white' : 'bg-[#f5f4ff] text-[#7b68ee] hover:bg-[#ebe9ff]'}`}>
              {bd.building_name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 text-xs">
        <span className="text-[#514b81]">최종 확인:</span>
        <span className={b.verified_at ? 'text-[#090c1d] font-medium' : 'text-amber-500'}>{b.verified_at ?? '미확인'}</span>
        {canManage && !editing && (
          <div className="ml-auto flex gap-1.5">
            <button onClick={verify} disabled={isPending}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">
              <ShieldCheck className="size-3" /> 변경없음
            </button>
            <button onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6647f0]">
              수정
            </button>
          </div>
        )}
      </div>

      {!editing ? (
        /* 읽기 뷰 */
        <div className="space-y-2">
          {installedList.length === 0 ? (
            <p className="text-sm text-[#b0acd6] py-3 text-center">입력된 소방시설이 없습니다{canManage ? ' — [수정]으로 입력' : ''}</p>
          ) : CATALOG.map(cat => {
            const rows = installedList.filter(f => cat.items.includes(f.facility_code))
            if (!rows.length) return null
            return (
              <div key={cat.category} className="flex gap-2 text-sm">
                <span className="text-xs font-semibold text-[#514b81] w-20 shrink-0 pt-0.5">{cat.category}</span>
                <span className="text-[#090c1d]">
                  {rows.map(r => r.facility_code + (r.detail?.note ? ` (${r.detail.note})` : '')).join(' · ')}
                </span>
              </div>
            )
          })}
          {b.floors.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[#f0eefb] text-xs text-[#514b81]">
              층별 수량 {b.floors.length}개 층 입력됨
            </div>
          )}
        </div>
      ) : (
        /* 편집 뷰 */
        <div className="space-y-3">
          {CATALOG.map(cat => (
            <div key={cat.category}>
              <p className="text-xs font-semibold text-[#7b68ee] mb-1">{cat.category}</p>
              <div className="grid grid-cols-1 gap-1">
                {cat.items.map(code => (
                  <div key={code} className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 w-40 shrink-0 cursor-pointer">
                      <input type="checkbox" checked={fac[code].installed}
                        onChange={e => setFac(s => ({ ...s, [code]: { ...s[code], installed: e.target.checked } }))}
                        className="size-3.5 accent-[#7b68ee]" />
                      <span className="text-xs text-[#090c1d]">{code}</span>
                    </label>
                    <input value={fac[code].detail ?? ''} disabled={!fac[code].installed}
                      onChange={e => setFac(s => ({ ...s, [code]: { ...s[code], detail: e.target.value } }))}
                      placeholder="수량·상세 (예: 분말 12, CO2 2)"
                      className="flex-1 h-7 rounded border border-[#d0ccf5] px-2 text-xs outline-none focus:border-[#7b68ee] disabled:bg-[#f8f9fa]" />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* 층별 수량 */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-semibold text-[#7b68ee]">층별 수량</p>
              <button onClick={() => setFloors(f => [...f, { floor_label: '', sort_order: f.length, counts: {} }])}
                className="inline-flex items-center gap-0.5 text-[11px] text-[#7b68ee] hover:underline">
                <Plus className="size-3" /> 층 추가
              </button>
            </div>
            {floors.length > 0 && (
              <div className="overflow-x-auto">
                <table className="text-xs">
                  <thead>
                    <tr className="text-[#514b81]">
                      <th className="px-1 py-0.5 text-left">층</th>
                      {FLOOR_COLS.map(c => <th key={c} className="px-1 py-0.5 w-12">{c}</th>)}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {floors.map((fl, i) => (
                      <tr key={i}>
                        <td className="px-1 py-0.5">
                          <input value={fl.floor_label} onChange={e => setFloors(s => s.map((x, j) => j === i ? { ...x, floor_label: e.target.value } : x))}
                            placeholder="1층" className="w-16 h-6 rounded border border-[#d0ccf5] px-1 outline-none focus:border-[#7b68ee]" />
                        </td>
                        {FLOOR_COLS.map(c => (
                          <td key={c} className="px-1 py-0.5">
                            <input type="number" min={0} value={fl.counts[c] ?? ''} onChange={e => setFloors(s => s.map((x, j) => j === i ? { ...x, counts: { ...x.counts, [c]: parseInt(e.target.value) || 0 } } : x))}
                              className="w-11 h-6 rounded border border-[#d0ccf5] px-1 text-center outline-none focus:border-[#7b68ee]" />
                          </td>
                        ))}
                        <td><button onClick={() => setFloors(s => s.filter((_, j) => j !== i))} className="p-0.5 text-[#b0acd6] hover:text-red-500"><X className="size-3" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => reset()} disabled={isPending}
              className="flex-1 h-8 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">취소</button>
            <button onClick={save} disabled={isPending}
              className="flex-1 h-8 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium flex items-center justify-center disabled:opacity-50">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-3.5 mr-1" /> 저장</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
