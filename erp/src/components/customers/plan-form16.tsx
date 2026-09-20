'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { NumField, useUnsavedWarning } from '@/components/ui/fields'
import { ETC_ITEMS_PLAN } from '@/lib/facility-codes'
import { EtcItemsPanel, type EtcBuildingInit } from '@/components/customers/etc-items-panel'

/** 서식 1.6 기타시설 현황 (1.6.1) — 전기·가스·위험물 (소방계획서_4.md §3, sections.etcFacility)
 *  §11-3: 가스 [LPG 프리셋], 위험물 [해당없음] 원클릭
 *
 *  「기타 — 해당 여부」 4종 (2026-09-20 사용자 확정): 1.4 「기타」에서 위험물 저장·취급/화기/가연성
 *  가스/전기 시설 체크가 이리로 왔다(방화문·비상구·방염 3종은 보고서 탭). ⚠ 두 축이 한 화면에 산다:
 *  체크 = **건물별 fire_facilities**(외관점검표 대상 축) / 아래 현황 입력 = **고객별 sections**(계획서
 *  서술 축). [저장] 버튼 하나가 dirty인 쪽만 골라 둘 다 저장한다(plan-form14 U3 통합 저장 전례). */

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
  /** 위험물 세부 목록(2026-09-17 신설) — 1.6.1 세부 표 **와** 2.12 위험물질 표가 한 축을 나눠 쓴다.
   *  `valve`는 select('유'/'무'/'')다 — boolean이면 「미입력」과 「무」를 못 가른다(차단기구의 교훈). */
  hazmat: { none: boolean; note: string; items?: HazmatItemRow[] }
}
export type HazmatItemRow = {
  kind: string; location: string; category: string; name: string
  amount: string; multiple: string; valve: '' | '유' | '무'; method: string
}
const EMPTY_HAZMAT: HazmatItemRow = { kind: '', location: '', category: '', name: '', amount: '', multiple: '', valve: '', method: '' }
export const EMPTY_ETC_FACILITY: EtcFacilitySection = {
  electric: { kw: '', kva: '', location: '', qty: '', generator: false, generatorNote: '', note: '', genKw: '', genLocation: '', genQty: '' },
  gas: { kind: '', location: '', usage: '', regulator: false, shutoff: false, shutoffLocation: '', regulatorLocation: '' },
  hazmat: { none: false, note: '' },
}

export function PlanForm16({ customerId, canManage, initial, etcBuildings, etcDefaultBuildingId, canRegister = false }: {
  customerId: string; canManage: boolean; initial: EtcFacilitySection
  /** 「기타 — 해당 여부」 4종 카드용 건물별 초기값 (fire_facilities 축) — 미지정이면 카드를 그리지 않는다 */
  etcBuildings?: EtcBuildingInit[]
  /** 카드가 처음 보여줄 건물 = 대표동(lib/primary-building) */
  etcDefaultBuildingId?: string | null
  /** 카드의 점검표 링크·진행 배지 축(inspection_register) */
  canRegister?: boolean
}) {
  const router = useRouter()
  const [v, setV] = useState<EtcFacilitySection>({ ...EMPTY_ETC_FACILITY, ...initial })
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  // 기타 4종 카드(embedded) — dirty·저장을 이 폼의 [저장] 하나로 통합 (plan-form14 registerSpecsSave 전례)
  const [etcDirty, setEtcDirty] = useState(false)
  const etcSaveRef = useRef<(() => Promise<boolean>) | null>(null)
  const registerEtcSave = useCallback((fn: () => Promise<boolean>) => { etcSaveRef.current = fn }, [])
  useUnsavedWarning(dirty || etcDirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]

  function pe(p: Partial<EtcFacilitySection['electric']>) { setV(x => ({ ...x, electric: { ...x.electric, ...p } })); setDirty(true) }
  function pg(p: Partial<EtcFacilitySection['gas']>) { setV(x => ({ ...x, gas: { ...x.gas, ...p } })); setDirty(true) }
  function ph(p: Partial<EtcFacilitySection['hazmat']>) { setV(x => ({ ...x, hazmat: { ...x.hazmat, ...p } })); setDirty(true) }
  function lpgPreset() {
    pg({ kind: 'LPG', location: '주방·보일러실', usage: '취사·난방', regulator: true, shutoff: true })
  }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공).
   *  두 저장소가 독립이라 dirty인 쪽만 병렬 호출 — 실패한 쪽은 dirty가 남아 재클릭이 재시도다. */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const [secRes, etcOk] = await Promise.all([
          dirty ? saveFirePlanSectionsAction(customerId, { etcFacility: v }) : Promise.resolve(null),
          etcDirty && etcSaveRef.current ? etcSaveRef.current() : Promise.resolve(true),
        ])
        const parts: string[] = []
        let ok = true
        if (secRes) {
          if (secRes.error) { ok = false; parts.push(`❌ ${secRes.error}`) }
          else { setDirty(false); parts.push('✅ 서식 1.6 저장됨') }
        }
        // 기타 카드 실패의 상세 메시지는 카드 자신이 띄운다 — 여기선 합산 결과만
        if (!etcOk) { ok = false; parts.push('❌ 기타(해당 여부) 저장 실패') }
        else if (etcDirty) parts.push('✅ 기타(해당 여부) 저장됨')
        setMsg(parts.join(' · '))
        if (ok) router.refresh()
        resolve(ok)
      })
    })
  }

  const inputCls = 'h-form-7 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand'
  const chip = (on: boolean) => `h-form-6 px-2 rounded-full text-form-xs border transition-colors ${
    on ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`
  const field = (label: string, node: React.ReactNode) => (
    <div><label className="text-form-2xs text-ink-meta block">{label}</label>{node}</div>
  )

  return (
    <div className="space-y-4">
      {/* 기타 — 해당 여부 4종 (2026-09-20, 1.4 「기타」에서 분할 이사). ⚠ 아래 현황 입력과 축이 다르다:
          체크는 건물별 fire_facilities(외관점검표 대상 축), 현황은 고객별 sections(계획서 서술 축) */}
      {etcBuildings && etcBuildings.length > 0 && (
        <EtcItemsPanel customerId={customerId} items={ETC_ITEMS_PLAN}
          buildings={etcBuildings} defaultBuildingId={etcDefaultBuildingId}
          canManage={canManage} canRegister={canRegister}
          linkFrom={`/customers/${customerId}?tab=plan&form=1.6`}
          title="기타 — 점검 대상 여부"
          description="※ 해당하면 ☑ — 외관점검표의 대상 축이 됩니다 · 아래 현황 입력(수전·가스·위험물)은 소방계획서 서술로 별개입니다"
          embedded registerSave={registerEtcSave} onDirtyChange={setEtcDirty} />
      )}
      {/* 전기 */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-form-sm font-semibold text-ink-sub">전기 시설</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          {field('수전 용량', <NumField value={v.electric.kw} disabled={!canManage} decimal unit="kW" onChange={kw => pe({ kw })} className="h-form-7 w-24 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand" />)}
          {field('변압기', <NumField value={v.electric.kva} disabled={!canManage} decimal unit="kVA" onChange={kva => pe({ kva })} className="h-form-7 w-24 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand" />)}
          {field('위치', <input value={v.electric.location} disabled={!canManage} onChange={e => pe({ location: e.target.value })} className={`${inputCls} w-32`} />)}
          {field('수량', <NumField value={v.electric.qty} disabled={!canManage} unit="개" onChange={qty => pe({ qty })} className="h-form-7 w-16 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand" />)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-form-xs font-medium text-ink-sub">비상발전기</span>
          <button disabled={!canManage} className={chip(v.electric.generator)} onClick={() => pe({ generator: !v.electric.generator })}>
            {v.electric.generator ? '있음' : '없음'}
          </button>
          {v.electric.generator && (<>
            <NumField value={v.electric.genKw ?? ''} disabled={!canManage} decimal unit="kW" onChange={genKw => pe({ genKw })} className="h-form-7 w-20 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand" />
            <input value={v.electric.genLocation ?? ''} disabled={!canManage} placeholder="위치" onChange={e => pe({ genLocation: e.target.value })} className={`${inputCls} w-28`} />
            <NumField value={v.electric.genQty ?? ''} disabled={!canManage} unit="대" onChange={genQty => pe({ genQty })} className="h-form-7 w-16 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand" />
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
          <p className="text-form-sm font-semibold text-ink-sub">가스 시설</p>
          {canManage && (
            <button onClick={lpgPreset} className="h-form-6 px-2 rounded-full border border-brand-line text-form-xs text-brand hover:bg-brand-tint">
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
          <span className="text-form-xs font-medium text-ink-sub">정압기</span>
          <button disabled={!canManage} className={chip(v.gas.regulator)} onClick={() => pg({ regulator: !v.gas.regulator })}>{v.gas.regulator ? '있음' : '없음'}</button>
          {v.gas.regulator && (
            <input value={v.gas.regulatorLocation ?? ''} disabled={!canManage} placeholder="정압기 위치" onChange={e => pg({ regulatorLocation: e.target.value })} className={`${inputCls} w-36`} />
          )}
          <span className="text-form-xs font-medium text-ink-sub">차단기구</span>
          <button disabled={!canManage} className={chip(v.gas.shutoff)} onClick={() => pg({ shutoff: !v.gas.shutoff })}>{v.gas.shutoff ? '있음' : '없음'}</button>
          {v.gas.shutoff && (
            <input value={v.gas.shutoffLocation} disabled={!canManage} placeholder="차단기 위치" onChange={e => pg({ shutoffLocation: e.target.value })} className={`${inputCls} w-36`} />
          )}
        </div>
      </div>

      {/* 위험물 — 해당없음 원클릭 (§11-3) */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-form-sm font-semibold text-ink-sub">위험물</p>
          <button disabled={!canManage} className={chip(v.hazmat.none)} onClick={() => ph({ none: !v.hazmat.none })}>해당없음</button>
          {!v.hazmat.none && (
            <input value={v.hazmat.note} disabled={!canManage} placeholder="비고" onChange={e => ph({ note: e.target.value })} className={`${inputCls} flex-1 min-w-48`} />
          )}
        </div>
        {/* 위험물 세부 목록 — 1.6.1 세부 표(구분·유별·배수)와 2.12 위험물질 표(밸브·차단방법)가
            이 한 축을 나눠 쓴다. 양식 두 시트 다 3행이라 4번째부터는 엑셀 고지에 세어진다. */}
        {!v.hazmat.none && (
          <div className="mt-2 space-y-1.5">
            {(v.hazmat.items ?? []).map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-wrap">
                <input value={r.name} disabled={!canManage} placeholder="품명 (예: 경유)" onChange={e => ph({ items: (v.hazmat.items ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} className={`${inputCls} w-28`} />
                <input value={r.kind} disabled={!canManage} placeholder="구분" onChange={e => ph({ items: (v.hazmat.items ?? []).map((x, j) => j === i ? { ...x, kind: e.target.value } : x) })} className={`${inputCls} w-20`} />
                <input value={r.category} disabled={!canManage} placeholder="유별 (예: 제4류)" onChange={e => ph({ items: (v.hazmat.items ?? []).map((x, j) => j === i ? { ...x, category: e.target.value } : x) })} className={`${inputCls} w-24`} />
                <input value={r.location} disabled={!canManage} placeholder="설치위치" onChange={e => ph({ items: (v.hazmat.items ?? []).map((x, j) => j === i ? { ...x, location: e.target.value } : x) })} className={`${inputCls} w-24`} />
                <input value={r.amount} disabled={!canManage} placeholder="보유량(ℓ,㎏)" onChange={e => ph({ items: (v.hazmat.items ?? []).map((x, j) => j === i ? { ...x, amount: e.target.value } : x) })} className={`${inputCls} w-24`} />
                <input value={r.multiple} disabled={!canManage} placeholder="지정수량 배수" onChange={e => ph({ items: (v.hazmat.items ?? []).map((x, j) => j === i ? { ...x, multiple: e.target.value } : x) })} className={`${inputCls} w-24`} />
                <select value={r.valve} disabled={!canManage} onChange={e => ph({ items: (v.hazmat.items ?? []).map((x, j) => j === i ? { ...x, valve: e.target.value as HazmatItemRow['valve'] } : x) })} className={`${inputCls} w-24`}>
                  <option value="">차단밸브?</option><option value="유">밸브 유</option><option value="무">밸브 무</option>
                </select>
                <input value={r.method} disabled={!canManage} placeholder="차단방법" onChange={e => ph({ items: (v.hazmat.items ?? []).map((x, j) => j === i ? { ...x, method: e.target.value } : x) })} className={`${inputCls} w-28`} />
                {canManage && (
                  <button onClick={() => ph({ items: (v.hazmat.items ?? []).filter((_, j) => j !== i) })} className="text-ink-meta hover:text-red-500" aria-label="행 삭제">✕</button>
                )}
              </div>
            ))}
            {canManage && (
              <button onClick={() => ph({ items: [...(v.hazmat.items ?? []), { ...EMPTY_HAZMAT }] })}
                className="inline-flex items-center gap-1 text-form-xs text-brand hover:underline">+ 위험물 행 추가</button>
            )}
          </div>
        )}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={(!dirty && !etcDirty) || isPending}
            className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg bg-brand text-white text-form-sm font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.6 저장
          </button>
          {msg && <span className="text-form-sm text-ink-sub">{msg}</span>}
        </div>
      )}
    </div>
  )
}
