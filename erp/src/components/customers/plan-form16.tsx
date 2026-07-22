'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'

/** 서식 1.6 기타시설 현황 (1.6.1) — 전기·가스·위험물 (소방계획서_4.md §3, sections.etcFacility)
 *  §11-3: 가스 [LPG 프리셋], 위험물 [해당없음] 원클릭 */

export type EtcFacilitySection = {
  electric: { kw: string; kva: string; location: string; qty: string; generator: boolean; generatorNote: string; note: string }
  gas: { kind: string; location: string; usage: string; regulator: boolean; shutoff: boolean; shutoffLocation: string }
  hazmat: { none: boolean; note: string }
}
export const EMPTY_ETC_FACILITY: EtcFacilitySection = {
  electric: { kw: '', kva: '', location: '', qty: '', generator: false, generatorNote: '', note: '' },
  gas: { kind: '', location: '', usage: '', regulator: false, shutoff: false, shutoffLocation: '' },
  hazmat: { none: false, note: '' },
}

export function PlanForm16({ customerId, canManage, initial }: {
  customerId: string; canManage: boolean; initial: EtcFacilitySection
}) {
  const router = useRouter()
  const [v, setV] = useState<EtcFacilitySection>({ ...EMPTY_ETC_FACILITY, ...initial })
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function pe(p: Partial<EtcFacilitySection['electric']>) { setV(x => ({ ...x, electric: { ...x.electric, ...p } })); setDirty(true) }
  function pg(p: Partial<EtcFacilitySection['gas']>) { setV(x => ({ ...x, gas: { ...x.gas, ...p } })); setDirty(true) }
  function ph(p: Partial<EtcFacilitySection['hazmat']>) { setV(x => ({ ...x, hazmat: { ...x.hazmat, ...p } })); setDirty(true) }
  function lpgPreset() {
    pg({ kind: 'LPG', location: '주방·보일러실', usage: '취사·난방', regulator: true, shutoff: true })
  }
  function save() {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, { etcFacility: v })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.6 저장됨')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'
  const chip = (on: boolean) => `h-6 px-2 rounded-full text-[11px] border transition-colors ${
    on ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`
  const field = (label: string, node: React.ReactNode) => (
    <div><label className="text-[10px] text-[#b0acd6] block">{label}</label>{node}</div>
  )

  return (
    <div className="space-y-4">
      {/* 전기 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
        <p className="text-xs font-semibold text-[#514b81]">전기 시설</p>
        <div className="flex items-end gap-2 flex-wrap">
          {field('수전 용량(kW)', <input value={v.electric.kw} disabled={!canManage} inputMode="decimal" onChange={e => pe({ kw: e.target.value })} className={`${inputCls} w-24`} />)}
          {field('변압기(kVA)', <input value={v.electric.kva} disabled={!canManage} inputMode="decimal" onChange={e => pe({ kva: e.target.value })} className={`${inputCls} w-24`} />)}
          {field('위치', <input value={v.electric.location} disabled={!canManage} onChange={e => pe({ location: e.target.value })} className={`${inputCls} w-32`} />)}
          {field('수량', <input value={v.electric.qty} disabled={!canManage} inputMode="numeric" onChange={e => pe({ qty: e.target.value })} className={`${inputCls} w-16`} />)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[#514b81]">비상발전기</span>
          <button disabled={!canManage} className={chip(v.electric.generator)} onClick={() => pe({ generator: !v.electric.generator })}>
            {v.electric.generator ? '있음' : '없음'}
          </button>
          {v.electric.generator && (
            <input value={v.electric.generatorNote} disabled={!canManage} placeholder="용량·위치" onChange={e => pe({ generatorNote: e.target.value })} className={`${inputCls} w-40`} />
          )}
          <input value={v.electric.note} disabled={!canManage} placeholder="비고" onChange={e => pe({ note: e.target.value })} className={`${inputCls} flex-1 min-w-32`} />
        </div>
      </div>

      {/* 가스 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-[#514b81]">가스 시설</p>
          {canManage && (
            <button onClick={lpgPreset} className="h-6 px-2 rounded-full border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              + LPG 프리셋
            </button>
          )}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          {field('종류', <input value={v.gas.kind} disabled={!canManage} placeholder="LPG/LNG" onChange={e => pg({ kind: e.target.value })} className={`${inputCls} w-24`} />)}
          {field('사용 위치', <input value={v.gas.location} disabled={!canManage} onChange={e => pg({ location: e.target.value })} className={`${inputCls} w-32`} />)}
          {field('용도', <input value={v.gas.usage} disabled={!canManage} placeholder="취사·난방" onChange={e => pg({ usage: e.target.value })} className={`${inputCls} w-28`} />)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[#514b81]">정압기</span>
          <button disabled={!canManage} className={chip(v.gas.regulator)} onClick={() => pg({ regulator: !v.gas.regulator })}>{v.gas.regulator ? '있음' : '없음'}</button>
          <span className="text-[11px] font-medium text-[#514b81]">차단기구</span>
          <button disabled={!canManage} className={chip(v.gas.shutoff)} onClick={() => pg({ shutoff: !v.gas.shutoff })}>{v.gas.shutoff ? '있음' : '없음'}</button>
          {v.gas.shutoff && (
            <input value={v.gas.shutoffLocation} disabled={!canManage} placeholder="차단기 위치" onChange={e => pg({ shutoffLocation: e.target.value })} className={`${inputCls} w-36`} />
          )}
        </div>
      </div>

      {/* 위험물 — 해당없음 원클릭 (§11-3) */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-[#514b81]">위험물</p>
          <button disabled={!canManage} className={chip(v.hazmat.none)} onClick={() => ph({ none: !v.hazmat.none })}>해당없음</button>
          {!v.hazmat.none && (
            <input value={v.hazmat.note} disabled={!canManage} placeholder="품명·수량·저장 위치" onChange={e => ph({ note: e.target.value })} className={`${inputCls} flex-1 min-w-48`} />
          )}
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.6 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
