'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { ImageSlot } from '@/components/customers/plan-form13'

/** 서식 1.5 피난·방화시설 및 제연, 방염 관련 현황 — 섹션 카드 2개 (소방계획서_4.md §3)
 *  1.5.1 일반현황(sections.evacFire) + 1.5.2 방화·제연구획 현황도(sections.evacMaps + plan-assets) */

const STAIRS = ['직통계단', '피난계단', '특별피난계단', '옥외계단'] as const
const ETC_EVAC = ['대피공간', '경량칸막이', '피난안전구역', '옥상광장'] as const

export type EvacFireSection = {
  stairs: Record<string, string>            // 계단 종류 → 개소 ('' = 미설치)
  etc: string[]                             // 기타 피난시설 체크
  etcNote: string
  evacFloor: { location: string; exits: string; openMethod: string }
  compartment: 'none' | 'area' | 'floor' | ''  // 방화구획 — 해당없음/면적별/층별
  fireDoor: { has: boolean; note: string }
  smokeControl: { has: boolean; note: string }
  flameRetardant: { has: boolean; note: string }
}
export type EvacMapRow = { floor: string; image: string | null; desc: string }

export const EMPTY_EVAC_FIRE: EvacFireSection = {
  stairs: {}, etc: [], etcNote: '',
  evacFloor: { location: '1층', exits: '', openMethod: '' },
  compartment: '', fireDoor: { has: false, note: '' },
  smokeControl: { has: false, note: '' }, flameRetardant: { has: false, note: '' },
}

export function PlanForm15({ customerId, canManage, initialEvacFire, initialMaps }: {
  customerId: string
  canManage: boolean
  initialEvacFire: EvacFireSection
  initialMaps: EvacMapRow[]
}) {
  const router = useRouter()
  const [ef, setEf] = useState<EvacFireSection>({ ...EMPTY_EVAC_FIRE, ...initialEvacFire })
  const [maps, setMaps] = useState<EvacMapRow[]>(initialMaps)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function patch(p: Partial<EvacFireSection>) { setEf(v => ({ ...v, ...p })); setDirty(true) }
  function save() {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, {
        evacFire: ef,
        evacMaps: maps.filter(m => m.floor.trim() || m.image || m.desc.trim()),
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.5 저장됨')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'
  const chip = (on: boolean) => `h-6 px-2 rounded-full text-[11px] border transition-colors ${
    on ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`
  const toggleRow = (label: string, v: { has: boolean; note: string }, set: (nv: { has: boolean; note: string }) => void, ph: string) => (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-medium text-[#514b81] w-14">{label}</span>
      <button onClick={() => canManage && set({ ...v, has: !v.has })} disabled={!canManage} className={chip(v.has)}>
        {v.has ? '설치·해당' : '미설치·해당없음'}
      </button>
      {v.has && (
        <input value={v.note} onChange={e => set({ ...v, note: e.target.value })} disabled={!canManage}
          placeholder={ph} className={`${inputCls} flex-1 min-w-40`} />
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 1.5.1 일반현황 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
        <p className="text-xs font-semibold text-[#514b81]">1.5.1 피난·방화시설 일반현황</p>
        {/* 계단 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[#514b81] w-14">계단</span>
          {STAIRS.map(s => {
            const on = ef.stairs[s] !== undefined
            return (
              <span key={s} className="inline-flex items-center gap-1">
                <button disabled={!canManage} className={chip(on)}
                  onClick={() => {
                    const next = { ...ef.stairs }
                    if (on) delete next[s]
                    else next[s] = ''
                    patch({ stairs: next })
                  }}>
                  {s}
                </button>
                {on && (
                  <input value={ef.stairs[s]} disabled={!canManage} inputMode="numeric" placeholder="개소"
                    onChange={e => patch({ stairs: { ...ef.stairs, [s]: e.target.value } })}
                    className={`${inputCls} w-14`} />
                )}
              </span>
            )
          })}
        </div>
        {/* 기타 피난시설 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[#514b81] w-14">기타</span>
          {ETC_EVAC.map(s => (
            <button key={s} disabled={!canManage} className={chip(ef.etc.includes(s))}
              onClick={() => patch({ etc: ef.etc.includes(s) ? ef.etc.filter(x => x !== s) : [...ef.etc, s] })}>
              {s}
            </button>
          ))}
          <input value={ef.etcNote} onChange={e => patch({ etcNote: e.target.value })} disabled={!canManage}
            placeholder="기타 (직접 입력)" className={`${inputCls} w-36`} />
        </div>
        {/* 피난층 */}
        <div className="flex items-end gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[#514b81] w-14 pb-1.5">피난층</span>
          <div>
            <label className="text-[10px] text-[#b0acd6] block">위치</label>
            <input value={ef.evacFloor.location} disabled={!canManage}
              onChange={e => patch({ evacFloor: { ...ef.evacFloor, location: e.target.value } })} className={`${inputCls} w-24`} />
          </div>
          <div>
            <label className="text-[10px] text-[#b0acd6] block">출입구 개소</label>
            <input value={ef.evacFloor.exits} disabled={!canManage} inputMode="numeric"
              onChange={e => patch({ evacFloor: { ...ef.evacFloor, exits: e.target.value } })} className={`${inputCls} w-20`} />
          </div>
          <div>
            <label className="text-[10px] text-[#b0acd6] block">개폐 방법</label>
            <input value={ef.evacFloor.openMethod} disabled={!canManage} placeholder="예: 자동문, 수동"
              onChange={e => patch({ evacFloor: { ...ef.evacFloor, openMethod: e.target.value } })} className={`${inputCls} w-36`} />
          </div>
        </div>
        {/* 방화구획 — 해당없음 원클릭 (§11-3) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[#514b81] w-14">방화구획</span>
          {([['area', '면적별'], ['floor', '층별'], ['none', '해당없음']] as Array<[EvacFireSection['compartment'], string]>).map(([v, label]) => (
            <button key={v} disabled={!canManage} className={chip(ef.compartment === v)}
              onClick={() => patch({ compartment: ef.compartment === v ? '' : v })}>
              {label}
            </button>
          ))}
        </div>
        {toggleRow('방화문', ef.fireDoor, v => patch({ fireDoor: v }), '예: 갑종 4, 자동방화셔터 2')}
        {toggleRow('제연', ef.smokeControl, v => patch({ smokeControl: v }), '예: 부속실 제연 — 계단실')}
        {toggleRow('방염', ef.flameRetardant, v => patch({ flameRetardant: v }), '예: 커튼·카펫 방염물품')}
      </div>

      {/* 1.5.2 방화·제연구획 현황도 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-[#514b81]">1.5.2 방화·제연구획 현황도</p>
          <span className="text-[10px] text-[#b0acd6]">연면적 1,000㎡ 이상 작성 권장</span>
          {canManage && (
            <button onClick={() => { setMaps(p => [...p, { floor: '', image: null, desc: '' }]); setDirty(true) }}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              <Plus className="size-3" /> 구역 추가
            </button>
          )}
        </div>
        {maps.length === 0 && <p className="text-[11px] text-[#b0acd6]">구역(층)별 평면도와 설명을 등록하세요.</p>}
        {maps.map((m, i) => (
          <div key={i} className="rounded-lg border border-[#e0ddf5] bg-white p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={m.floor} disabled={!canManage} placeholder="층 (예: 지상 1층)"
                onChange={e => { setMaps(p => p.map((x, j) => j === i ? { ...x, floor: e.target.value } : x)); setDirty(true) }}
                className={`${inputCls} w-32`} />
              <input value={m.desc} disabled={!canManage} placeholder="설명 (구획·제연 방식)"
                onChange={e => { setMaps(p => p.map((x, j) => j === i ? { ...x, desc: e.target.value } : x)); setDirty(true) }}
                className={`${inputCls} flex-1`} />
              {canManage && (
                <button onClick={() => { setMaps(p => p.filter((_, j) => j !== i)); setDirty(true) }}
                  className="text-[#b0acd6] hover:text-red-500" aria-label="구역 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <ImageSlot customerId={customerId} canManage={canManage} path={m.image}
              onChange={p => { setMaps(prev => prev.map((x, j) => j === i ? { ...x, image: p } : x)); setDirty(true) }}
              label="평면도" />
          </div>
        ))}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.5 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
