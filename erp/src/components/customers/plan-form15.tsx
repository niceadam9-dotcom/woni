'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { useUnsavedWarning, NumStepper } from '@/components/ui/fields'
import { ImageSlot } from '@/components/customers/plan-form13'
import { COMPARTMENT_KINDS, type CompartmentValue } from '@/lib/evac-compartment'
import { useCustomerTabs } from '@/components/customers/customer-tabs'
/* 계단 4종 — 판정·이름을 여기 다시 적지 않는다(건물 폼·엑셀·PDF와 **같은 모듈**) */
import { STAIR_KINDS, STAIR_LABEL, checkFromCount, type StairKind } from '@/lib/facility-status'

/** 서식 1.5 피난·방화시설 및 제연, 방염 관련 현황 — 섹션 카드 2개 (소방계획서_4.md §3)
 *  1.5.1 일반현황(sections.evacFire) + 1.5.2 방화·제연구획 현황도(sections.evacMaps + plan-assets) */

/* 계단 종류 목록은 `lib/facility-status`의 `STAIR_KINDS`가 정본이다(2026-09-16).
 * 여기 사본을 두면 서식 1.1 네 상자와 이 화면이 다른 순서·다른 이름을 들 수 있다. */
const ETC_EVAC = ['대피공간', '경량칸막이', '피난안전구역', '옥상광장'] as const

export type EvacFireSection = {
  stairs: Record<string, string>            // 계단 종류 → 개소 ('' = 미설치)
  etc: string[]                             // 기타 피난시설 체크
  etcNote: string
  evacFloor: { location: string; exits: string; openMethod: string }
  compartment: CompartmentValue             // 방화구획 4갈래 — 종류·표기는 `lib/evac-compartment`가 단일 원천
  fireDoor: { has: boolean; note: string }
  smokeControl: { has: boolean; note: string }
  flameRetardant: { has: boolean; note: string }
}
/** imageBase·annots는 화살표 편집의 되돌림 재료 — 인쇄는 종전대로 image만 본다 (2026-09-08) */
export type EvacMapRow = {
  floor: string; image: string | null; desc: string
  imageBase?: string | null; annots?: string | null
}

export const EMPTY_EVAC_FIRE: EvacFireSection = {
  stairs: {}, etc: [], etcNote: '',
  evacFloor: { location: '1층', exits: '', openMethod: '' },
  compartment: '', fireDoor: { has: false, note: '' },
  smokeControl: { has: false, note: '' }, flameRetardant: { has: false, note: '' },
}

/** §11-3: 용도 기반 기본값 — 보수적 최소 구성(입력 후 현장 확인·수정 전제)
 *
 *  🚨 2026-09-16: `stairs` 프리셋을 뺐다. 용도만 보고 「주택형이니 직통계단 1개소」를 찍던 값인데,
 *    계단 원천이 건물 컬럼으로 옮겨 간 뒤로는 그 추정이 **서식 1.1 네 상자와 별지 9호 합계까지**
 *    끌고 간다. 「모르면 안 켠다」 — 계단은 사람이 건물·시설 탭에서 말한 것만 인쇄한다.
 *    (여기 남겨 두면 이 JSON이 조립기 폴백이라 다동 고객에게 실제로 인쇄된다.) */
const EVAC_PRESETS: Record<string, Partial<EvacFireSection>> = {
  '주택형': {
    compartment: 'floor',
    evacFloor: { location: '1층', exits: '1', openMethod: '수동(자유 개방)' }, fireDoor: { has: true, note: '' },
  },
  '상가형': {
    compartment: 'area',
    evacFloor: { location: '1층', exits: '2', openMethod: '수동(자유 개방)' }, fireDoor: { has: true, note: '' },
  },
  '공장형': {
    compartment: 'area',
    evacFloor: { location: '1층', exits: '2', openMethod: '수동(자유 개방)' }, fireDoor: { has: true, note: '' },
  },
}

export function PlanForm15({ customerId, canManage, initialEvacFire, initialMaps, presetType = '', stairCounts }: {
  customerId: string
  canManage: boolean
  initialEvacFire: EvacFireSection
  initialMaps: EvacMapRow[]
  presetType?: string // 용도 기반 추천 (주택형/상가형/공장형 — §11-3)
  /** 계단 4종 개소(대표동) — **읽기 전용 표시**다. 입력구는 건물·시설 탭 하나뿐이다(마이그 165) */
  stairCounts?: Partial<Record<StairKind, string>>
}) {
  const router = useRouter()
  const tabs = useCustomerTabs()   // 탭 셸 밖에서는 null — 옵셔널로 부른다
  const [ef, setEf] = useState<EvacFireSection>({ ...EMPTY_EVAC_FIRE, ...initialEvacFire })
  const [maps, setMaps] = useState<EvacMapRow[]>(initialMaps)
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function patch(p: Partial<EvacFireSection>) { setEf(v => ({ ...v, ...p })); setDirty(true) }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, {
          evacFire: ef,
          evacMaps: maps.filter(m => m.floor.trim() || m.image || m.desc.trim()),
        })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 서식 1.5 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-form-7 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand'
  const chip = (on: boolean) => `h-form-6 px-2 rounded-full text-form-xs border transition-colors ${
    on ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`
  const toggleRow = (label: string, v: { has: boolean; note: string }, set: (nv: { has: boolean; note: string }) => void, ph: string) => (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-form-xs font-medium text-ink-sub w-14">{label}</span>
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
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-form-sm font-semibold text-ink-sub">1.5.1 피난·방화시설 일반현황</p>
          {canManage && presetType && EVAC_PRESETS[presetType] && (
            <button onClick={() => patch(EVAC_PRESETS[presetType])}
              title="용도 기반 기본값 — 채운 뒤 현장 기준으로 수정하세요"
              className="inline-flex items-center gap-1 h-form-6 px-2 rounded-full border border-brand-line text-form-xs text-brand hover:bg-brand-tint">
              용도 기본값 ({presetType})
            </button>
          )}
        </div>
        {/* 계단 — **읽기 전용**. 원천은 건물·시설 탭이다(2026-09-16 마이그 165).
            🚨 종전엔 같은 「계단」을 세 화면이 각자 받았다(건물 폼 합계칸 · 소방계획서 정보 패널 ·
              여기 4종 칩). 그래서 송학떡집·별그리다는 **서식 1.1엔 ☑인데 별지 9호 2쪽은 공란**으로
              인쇄되고 있었다. 입력구를 하나로 모으고 여기는 그 결과를 비춘다.
            ⚠ 저장된 옛 JSON(`ef.stairs`)은 지우지 않는다 — 마이그 165 백필이 「활성 건물 1동」인
              고객만 옮겼으므로, 다동 고객에겐 조립기가 이 값을 폴백으로 계속 쓴다. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-form-xs font-medium text-ink-sub w-14">계단</span>
          {STAIR_KINDS.map(k => {
            const n = (stairCounts?.[k] ?? '').trim()
            const on = checkFromCount(n)
            return (
              <span key={k} className={`inline-flex items-center gap-1 text-form-xs ${on ? 'text-brand font-medium' : 'text-ink-meta'}`}>
                <span aria-hidden>{on ? '☑' : '☐'}</span>{STAIR_LABEL[k]}{on && n ? ` ${n}개소` : ''}
              </span>
            )
          })}
          <button type="button" onClick={() => tabs?.goTab('buildings')}
            className="text-form-xs text-brand underline underline-offset-2 hover:text-brand-strong">
            건물·시설 탭에서 수정
          </button>
        </div>
        {/* 기타 피난시설 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-form-xs font-medium text-ink-sub w-14">기타</span>
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
          <span className="text-form-xs font-medium text-ink-sub w-14 pb-1.5">피난층</span>
          <div>
            <label className="text-form-2xs text-ink-meta block">위치</label>
            <input value={ef.evacFloor.location} disabled={!canManage}
              onChange={e => patch({ evacFloor: { ...ef.evacFloor, location: e.target.value } })} className={`${inputCls} w-24`} />
          </div>
          <div>
            <label className="text-form-2xs text-ink-meta block">출입구 개소</label>
            <NumStepper value={ef.evacFloor.exits} disabled={!canManage} label="출입구 개소"
              onChange={v => patch({ evacFloor: { ...ef.evacFloor, exits: v } })}>
              <input value={ef.evacFloor.exits} disabled={!canManage} inputMode="numeric"
                onChange={e => patch({ evacFloor: { ...ef.evacFloor, exits: e.target.value } })} className={`${inputCls} w-14`} />
            </NumStepper>
          </div>
          <div>
            <label className="text-form-2xs text-ink-meta block">개폐 방법</label>
            <input value={ef.evacFloor.openMethod} disabled={!canManage} placeholder="예: 자동문, 수동"
              onChange={e => patch({ evacFloor: { ...ef.evacFloor, openMethod: e.target.value } })} className={`${inputCls} w-36`} />
          </div>
        </div>
        {/* 방화구획 — 해당없음 원클릭 (§11-3) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-form-xs font-medium text-ink-sub w-14">방화구획</span>
          {COMPARTMENT_KINDS.map(({ key, label }) => (
            <button key={key} disabled={!canManage} className={chip(ef.compartment === key)}
              onClick={() => patch({ compartment: ef.compartment === key ? '' : key })}>
              {label}
            </button>
          ))}
        </div>
        {toggleRow('방화문', ef.fireDoor, v => patch({ fireDoor: v }), '예: 갑종 4, 자동방화셔터 2')}
        {toggleRow('제연', ef.smokeControl, v => patch({ smokeControl: v }), '예: 부속실 제연 — 계단실')}
        {toggleRow('방염', ef.flameRetardant, v => patch({ flameRetardant: v }), '예: 커튼·카펫 방염물품')}
      </div>

      {/* 1.5.2 방화·제연구획 현황도 */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-form-sm font-semibold text-ink-sub">1.5.2 방화·제연구획 현황도</p>
          <span className="text-form-2xs text-ink-meta">연면적 1,000㎡ 이상 작성 권장</span>
          {canManage && (
            <button onClick={() => { setMaps(p => [...p, { floor: '', image: null, desc: '' }]); setDirty(true) }}
              className="ml-auto inline-flex items-center gap-1 h-form-7 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint">
              <Plus className="size-3" /> 구역 추가
            </button>
          )}
        </div>
        {maps.length === 0 && <p className="text-form-xs text-ink-meta">구역(층)별 평면도와 설명을 등록하세요.</p>}
        {maps.map((m, i) => (
          <div key={i} className="rounded-lg border border-brand-line-soft bg-surface p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={m.floor} disabled={!canManage} placeholder="층 (예: 지상 1층)"
                onChange={e => { setMaps(p => p.map((x, j) => j === i ? { ...x, floor: e.target.value } : x)); setDirty(true) }}
                className={`${inputCls} w-32`} />
              <input value={m.desc} disabled={!canManage} placeholder="설명 (구획·제연 방식)"
                onChange={e => { setMaps(p => p.map((x, j) => j === i ? { ...x, desc: e.target.value } : x)); setDirty(true) }}
                className={`${inputCls} flex-1`} />
              {canManage && (
                <button onClick={() => { setMaps(p => p.filter((_, j) => j !== i)); setDirty(true) }}
                  className="text-ink-meta hover:text-red-500" aria-label="구역 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <ImageSlot customerId={customerId} canManage={canManage} path={m.image}
              onChange={p => { setMaps(prev => prev.map((x, j) => j === i ? { ...x, image: p } : x)); setDirty(true) }}
              label="평면도"
              annot={{
                basePath: m.imageBase ?? null,
                annots: m.annots ?? null,
                onChange: v => {
                  setMaps(prev => prev.map((x, j) => j === i ? { ...x, imageBase: v.basePath, annots: v.annots } : x))
                  setDirty(true)
                },
              }} />
          </div>
        ))}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg bg-brand text-white text-form-sm font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.5 저장
          </button>
          {msg && <span className="text-form-sm text-ink-sub">{msg}</span>}
        </div>
      )}
    </div>
  )
}
