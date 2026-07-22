'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2, Layers } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'

/** 서식 1.2 건축물 세부현황 — 섹션 카드 2개 (소방계획서_4.md §3)
 *  1.2.1 구역별 세부현황(sections.zones) + 1.2.2 화재취약장소(sections.hazards), 저장 버튼은 서식당 1개(§1) */

export type ZoneRow = { zone: string; name: string; area: string; workersWeekday: string; workersHoliday: string; company: string; phone: string }
export type HazardRow = { place: string; loc: string; risks: string[] }

const RISKS = ['전기', '기계', '화학', '가스누출', '부주의', '자연재해'] as const
const HAZARD_PRESETS: HazardRow[] = [
  { place: '보일러실', loc: '', risks: ['기계', '가스누출'] },
  { place: '주방', loc: '', risks: ['가스누출', '부주의'] },
  { place: '전기실', loc: '', risks: ['전기'] },
]
const EMPTY_ZONE: ZoneRow = { zone: '', name: '', area: '', workersWeekday: '', workersHoliday: '', company: '', phone: '' }

export function PlanForm12({ customerId, canManage, initialZones, initialHazards, floorsAbove, floorsBelow }: {
  customerId: string
  canManage: boolean
  initialZones: ZoneRow[]
  initialHazards: HazardRow[]
  floorsAbove: number | null
  floorsBelow: number | null
}) {
  const router = useRouter()
  const [zones, setZones] = useState<ZoneRow[]>(initialZones.length > 0 ? initialZones : [{ ...EMPTY_ZONE }])
  const [hazards, setHazards] = useState<HazardRow[]>(initialHazards)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function setZone(i: number, patch: Partial<ZoneRow>) {
    setZones(p => p.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  function setHazard(i: number, patch: Partial<HazardRow>) {
    setHazards(p => p.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  function toggleRisk(i: number, risk: string) {
    setHazards(p => p.map((r, j) => j === i
      ? { ...r, risks: r.risks.includes(risk) ? r.risks.filter(x => x !== risk) : [...r.risks, risk] }
      : r))
    setDirty(true)
  }
  function autoFloors() {
    const fa = floorsAbove ?? 0
    const fb = floorsBelow ?? 0
    if (fa + fb === 0) { setMsg('⚠ 건물 층수가 없습니다 — 건물·시설 탭에서 층수를 먼저 입력해주세요.'); return }
    const rows: ZoneRow[] = []
    for (let i = fb; i >= 1; i--) rows.push({ ...EMPTY_ZONE, zone: `지하 ${i}층` })
    for (let i = 1; i <= fa; i++) rows.push({ ...EMPTY_ZONE, zone: `지상 ${i}층` })
    setZones(rows)
    setDirty(true)
  }
  function save() {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, {
        zones: zones.filter(z => Object.values(z).some(v => String(v).trim())),
        hazards: hazards.filter(h => h.place.trim() || h.loc.trim() || h.risks.length > 0),
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.2 저장됨')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee] w-full'
  return (
    <div className="space-y-4">
      {/* 1.2.1 구역별 세부현황 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-[#514b81]">1.2.1 구역별 세부현황</p>
          {canManage && (
            <button onClick={autoFloors} className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              <Layers className="size-3" /> 층 자동 생성
            </button>
          )}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-[#514b81] border-b border-[#e0ddf5]">
              <th className="pb-1 pr-1 w-24 font-medium">구역</th>
              <th className="pb-1 pr-1 font-medium">명칭(용도)</th>
              <th className="pb-1 pr-1 w-20 font-medium">면적(㎡)</th>
              <th className="pb-1 pr-1 w-16 font-medium">평일(명)</th>
              <th className="pb-1 pr-1 w-16 font-medium">휴일(명)</th>
              <th className="pb-1 pr-1 font-medium">관리업체</th>
              <th className="pb-1 pr-1 w-28 font-medium">연락처</th>
              <th className="pb-1 w-7" />
            </tr>
          </thead>
          <tbody>
            {zones.map((z, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-1"><input value={z.zone} onChange={e => setZone(i, { zone: e.target.value })} disabled={!canManage} className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.name} onChange={e => setZone(i, { name: e.target.value })} disabled={!canManage} className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.area} onChange={e => setZone(i, { area: e.target.value })} disabled={!canManage} inputMode="decimal" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.workersWeekday} onChange={e => setZone(i, { workersWeekday: e.target.value })} disabled={!canManage} inputMode="numeric" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.workersHoliday} onChange={e => setZone(i, { workersHoliday: e.target.value })} disabled={!canManage} inputMode="numeric" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.company} onChange={e => setZone(i, { company: e.target.value })} disabled={!canManage} className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.phone} onChange={e => setZone(i, { phone: e.target.value })} disabled={!canManage} className={inputCls} /></td>
                <td className="py-0.5">
                  {canManage && (
                    <button onClick={() => { setZones(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canManage && (
          <button onClick={() => { setZones(p => [...p, { ...EMPTY_ZONE }]); setDirty(true) }}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline">
            <Plus className="size-3" /> 행 추가
          </button>
        )}
      </div>

      {/* 1.2.2 화재취약장소 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <p className="text-xs font-semibold text-[#514b81]">1.2.2 화재취약장소</p>
          {canManage && HAZARD_PRESETS.map(pz => (
            <button key={pz.place}
              onClick={() => { setHazards(p => [...p, { ...pz, risks: [...pz.risks] }]); setDirty(true) }}
              className="h-6 px-2 rounded-full border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              + {pz.place}
            </button>
          ))}
        </div>
        {hazards.length === 0 && <p className="text-[11px] text-[#b0acd6]">프리셋 버튼 또는 [행 추가]로 화재취약장소를 등록하세요.</p>}
        <div className="space-y-1.5">
          {hazards.map((h, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <input value={h.place} onChange={e => setHazard(i, { place: e.target.value })} disabled={!canManage}
                placeholder="장소" className="h-7 w-28 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]" />
              <input value={h.loc} onChange={e => setHazard(i, { loc: e.target.value })} disabled={!canManage}
                placeholder="위치 (예: 지하 1층)" className="h-7 w-32 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]" />
              {RISKS.map(r => (
                <button key={r} onClick={() => canManage && toggleRisk(i, r)} disabled={!canManage}
                  className={`h-6 px-2 rounded-full text-[11px] border transition-colors ${
                    h.risks.includes(r) ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'
                  }`}>
                  {r}
                </button>
              ))}
              {canManage && (
                <button onClick={() => { setHazards(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {canManage && (
          <button onClick={() => { setHazards(p => [...p, { place: '', loc: '', risks: [] }]); setDirty(true) }}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline">
            <Plus className="size-3" /> 행 추가
          </button>
        )}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.2 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
