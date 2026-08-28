'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { NumField, useUnsavedWarning } from '@/components/ui/fields'

/** 서식 1.6 기타시설 현황 (1.6.1) — 전기·가스·위험물 (소방계획서_4.md §3, sections.etcFacility)
 *  §11-3: 가스 [LPG 프리셋], 위험물 [해당없음] 원클릭 */

export type EtcFacilitySection = {
  // M-17(소방계획서_15, 2026-08-11 보강): 비상발전기 용량·위치·수량 구조화(genKw·genLocation·genQty).
  // generatorNote는 레거시 자유 텍스트('용량·위치') — 비고로 존치, 기존 저장 데이터 보존
  electric: {
    kw: string; kva: string; location: string; qty: string
    generator: boolean; generatorNote: string; note: string
    genKw?: string; genLocation?: string; genQty?: string
  }
  // M-17: 정압기 위치(regulatorLocation) — 설계 4.md §3-6 '정압기위치'
  gas: {
    kind: string; location: string; usage: string
    regulator: boolean; shutoff: boolean; shutoffLocation: string
    regulatorLocation?: string
  }
  hazmat: { none: boolean; note: string }
}
export const EMPTY_ETC_FACILITY: EtcFacilitySection = {
  electric: { kw: '', kva: '', location: '', qty: '', generator: false, generatorNote: '', note: '', genKw: '', genLocation: '', genQty: '' },
  gas: { kind: '', location: '', usage: '', regulator: false, shutoff: false, shutoffLocation: '', regulatorLocation: '' },
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
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]

  function pe(p: Partial<EtcFacilitySection['electric']>) { setV(x => ({ ...x, electric: { ...x.electric, ...p } })); setDirty(true) }
  function pg(p: Partial<EtcFacilitySection['gas']>) { setV(x => ({ ...x, gas: { ...x.gas, ...p } })); setDirty(true) }
  function ph(p: Partial<EtcFacilitySection['hazmat']>) { setV(x => ({ ...x, hazmat: { ...x.hazmat, ...p } })); setDirty(true) }
  function lpgPreset() {
    pg({ kind: 'LPG', location: '주방·보일러실', usage: '취사·난방', regulator: true, shutoff: true })
  }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, { etcFacility: v })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 서식 1.6 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-7 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand'
  const chip = (on: boolean) => `h-6 px-2 rounded-full text-[11px] border transition-colors ${
    on ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`
  const field = (label: string, node: React.ReactNode) => (
    <div><label className="text-[10px] text-ink-faint block">{label}</label>{node}</div>
  )

  return (
    <div className="space-y-4">
      {/* 전기 */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-ink-sub">전기 시설</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          {field('수전 용량', <NumField value={v.electric.kw} disabled={!canManage} decimal unit="kW" onChange={kw => pe({ kw })} className="h-7 w-24 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand" />)}
          {field('변압기', <NumField value={v.electric.kva} disabled={!canManage} decimal unit="kVA" onChange={kva => pe({ kva })} className="h-7 w-24 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand" />)}
          {field('위치', <input value={v.electric.location} disabled={!canManage} onChange={e => pe({ location: e.target.value })} className={`${inputCls} w-32`} />)}
          {field('수량', <NumField value={v.electric.qty} disabled={!canManage} unit="개" onChange={qty => pe({ qty })} className="h-7 w-16 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand" />)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-ink-sub">비상발전기</span>
          <button disabled={!canManage} className={chip(v.electric.generator)} onClick={() => pe({ generator: !v.electric.generator })}>
            {v.electric.generator ? '있음' : '없음'}
          </button>
          {v.electric.generator && (<>
            <NumField value={v.electric.genKw ?? ''} disabled={!canManage} decimal unit="kW" onChange={genKw => pe({ genKw })} className="h-7 w-20 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand" />
            <input value={v.electric.genLocation ?? ''} disabled={!canManage} placeholder="위치" onChange={e => pe({ genLocation: e.target.value })} className={`${inputCls} w-28`} />
            <NumField value={v.electric.genQty ?? ''} disabled={!canManage} unit="대" onChange={genQty => pe({ genQty })} className="h-7 w-16 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand" />
            {v.electric.generatorNote.trim() !== '' && (
              <input value={v.electric.generatorNote} disabled={!canManage} placeholder="비고(구 자유입력)" onChange={e => pe({ generatorNote: e.target.value })} className={`${inputCls} w-36`} />
            )}
          </>)}
          <input value={v.electric.note} disabled={!canManage} placeholder="비고" onChange={e => pe({ note: e.target.value })} className={`${inputCls} flex-1 min-w-32`} />
        </div>
      </div>

      {/* 가스 */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-ink-sub">가스 시설</p>
          {canManage && (
            <button onClick={lpgPreset} className="h-6 px-2 rounded-full border border-brand-line text-[11px] text-brand hover:bg-brand-tint">
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
          <span className="text-[11px] font-medium text-ink-sub">정압기</span>
          <button disabled={!canManage} className={chip(v.gas.regulator)} onClick={() => pg({ regulator: !v.gas.regulator })}>{v.gas.regulator ? '있음' : '없음'}</button>
          {v.gas.regulator && (
            <input value={v.gas.regulatorLocation ?? ''} disabled={!canManage} placeholder="정압기 위치" onChange={e => pg({ regulatorLocation: e.target.value })} className={`${inputCls} w-36`} />
          )}
          <span className="text-[11px] font-medium text-ink-sub">차단기구</span>
          <button disabled={!canManage} className={chip(v.gas.shutoff)} onClick={() => pg({ shutoff: !v.gas.shutoff })}>{v.gas.shutoff ? '있음' : '없음'}</button>
          {v.gas.shutoff && (
            <input value={v.gas.shutoffLocation} disabled={!canManage} placeholder="차단기 위치" onChange={e => pg({ shutoffLocation: e.target.value })} className={`${inputCls} w-36`} />
          )}
        </div>
      </div>

      {/* 위험물 — 해당없음 원클릭 (§11-3) */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-ink-sub">위험물</p>
          <button disabled={!canManage} className={chip(v.hazmat.none)} onClick={() => ph({ none: !v.hazmat.none })}>해당없음</button>
          {!v.hazmat.none && (
            <input value={v.hazmat.note} disabled={!canManage} placeholder="품명·수량·저장 위치" onChange={e => ph({ note: e.target.value })} className={`${inputCls} flex-1 min-w-48`} />
          )}
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.6 저장
          </button>
          {msg && <span className="text-xs text-ink-sub">{msg}</span>}
        </div>
      )}
    </div>
  )
}
