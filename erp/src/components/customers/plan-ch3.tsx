'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { CardAnchorBar, useUnsavedWarning } from '@/components/ui/fields'
import { ImageSlot } from '@/components/customers/plan-form13'
import type { EvacFireSection } from '@/components/customers/plan-form15'

/** 3장 피난계획 — 서식 3.1~3.7 (소방계획서_4.md §6)
 *  3.1은 1.5 입력(evacFire) 자동 표시(재사용 — 수정은 1.5에서), 3.4 evacPlan은 생성 어댑터(§7-3)로 문서에 반영.
 *  §11-3: 3.5 피난약자 [해당없음] 원클릭, 3.4 절차 프리셋 */

export type EvacDetailRow = { facility: string; location: string; status: string }
export type EvacRouteRow = { floor: string; route: string; guide: string; equip: string }
export type EvacPlanSection = { procedure: string; routes: EvacRouteRow[]; assembly: string; mapImage: string | null }
export type VulnerableSection = {
  none: boolean
  counts: Record<string, { work: string; use: string }>
  plans: Array<{ area: string; count: string; type: string; helper: string; equip: string; method: string }>
}
export type EvacEquipRow = { name: string; location: string; qty: string }

const VULNERABLE_TYPES = ['노인', '어린이', '영유아', '임산부', '장애인', '기타'] as const
const METHOD_PRESETS: Record<string, string> = {
  '노인': '보조자가 동행해 계단으로 부축 이동, 이동이 어려운 경우 대피공간에서 구조 대기',
  '어린이': '인솔자가 인원을 확인해 손을 잡고 줄지어 피난 유도',
  '영유아': '보육 담당자가 안아서 이동하거나 피난용 카트를 이용해 대피',
  '임산부': '보조자가 동행해 무리하지 않는 속도로 계단 이동',
  '장애인': '유형별 보조기구(휠체어 등)와 보조자 2인이 피난층까지 이동 지원',
  '기타': '거동 불편자는 보조자를 사전 지정하고 대피공간 위치를 안내',
}
const PROCEDURE_PRESET = '① 화재 인지 → 비상방송·경보 전파 ② 피난유도반 배치(층별 계단 입구) ③ 재실자 최단 경로 피난 유도(엘리베이터 금지) ④ 집결지 인원 확인·미확인자 보고 ⑤ 소방대 도착 시 잔류 인원 정보 인계'
const CH3_FORMS = [
  { key: '3.1', label: '3.1 일반현황' }, { key: '3.2', label: '3.2 세부현황' }, { key: '3.3', label: '3.3 피난인원' },
  { key: '3.4', label: '3.4 유도·경로' }, { key: '3.5', label: '3.5 피난약자' }, { key: '3.6', label: '3.6 유형별 방법' },
  { key: '3.7', label: '3.7 기구·장비' },
]

export function PlanCh3({ customerId, canManage, evacFire, headcount, initialDetail, initialHeadcountNote, initialPlan, initialVulnerable, initialMethods, initialEquip }: {
  customerId: string
  canManage: boolean
  evacFire: EvacFireSection | null                     // 1.5 입력 — 3.1 자동 표시
  headcount: { worker: string; resident: string; max: string } // 1.1 운영현황 자동
  initialDetail: EvacDetailRow[]
  initialHeadcountNote: string
  initialPlan: EvacPlanSection | null
  initialVulnerable: VulnerableSection | null
  initialMethods: Record<string, string>
  initialEquip: EvacEquipRow[]
}) {
  const router = useRouter()
  const [detail, setDetail] = useState<EvacDetailRow[]>(initialDetail)
  const [hcNote, setHcNote] = useState(initialHeadcountNote)
  const [plan, setPlan] = useState<EvacPlanSection>(initialPlan ?? { procedure: '', routes: [], assembly: '', mapImage: null })
  const [vul, setVul] = useState<VulnerableSection>(initialVulnerable ?? { none: false, counts: {}, plans: [] })
  const [methods, setMethods] = useState<Record<string, string>>(initialMethods)
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty) // §11-4 이탈 경고
  const [msg, setMsg] = useState('')
  const [equip, setEquip] = useState<EvacEquipRow[]>(initialEquip)
  const [isPending, startTransition] = useTransition()

  function saveKeys(patch: Record<string, unknown>, label: string) {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, patch)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg(`✅ ${label} 저장됨`)
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'
  const chip = (on: boolean) => `h-6 px-2 rounded-full text-[11px] border transition-colors ${
    on ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`
  const saveBtn = (patch: Record<string, unknown>, label: string) => canManage && (
    <div className="flex items-center gap-2">
      <button onClick={() => saveKeys(patch, label)} disabled={!dirty || isPending}
        className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {label} 저장
      </button>
      {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* §1-2 세로 스크롤 카드 + 앵커 점프 (내부 서브탭 폐기) */}
      <CardAnchorBar items={CH3_FORMS.map(f => ({ id: `c-${f.key}`, label: f.label }))} />

      {/* 3.1 — 1.5 입력 자동 표시 (수정은 1.5에서, §9-6⑦ 단일 입력처) */}
      <div id="c-3.1" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-1.5">
          <p className="text-xs font-semibold text-[#514b81]">3.1 피난시설 및 기타시설 일반현황
            <span className="font-normal text-[#b0acd6] ml-2">서식 1.5 입력값 자동 표시 — 수정은 1장 &gt; 1.5에서</span>
          </p>
          {evacFire ? (
            <>
              <p className="text-xs text-[#514b81]">계단: {Object.entries(evacFire.stairs ?? {}).map(([k, n]) => `${k}${n ? ` ${n}개소` : ''}`).join(' · ') || '—'}</p>
              <p className="text-xs text-[#514b81]">기타: {[...(evacFire.etc ?? []), evacFire.etcNote].filter(Boolean).join(' · ') || '—'}</p>
              <p className="text-xs text-[#514b81]">피난층: {evacFire.evacFloor?.location || '—'}{evacFire.evacFloor?.exits ? ` · 출입구 ${evacFire.evacFloor.exits}개소` : ''}{evacFire.evacFloor?.openMethod ? ` · ${evacFire.evacFloor.openMethod}` : ''}</p>
              <p className="text-xs text-[#514b81]">방화구획: {evacFire.compartment === 'none' ? '해당없음' : evacFire.compartment === 'area' ? '면적별' : evacFire.compartment === 'floor' ? '층별' : '—'}</p>
            </>
          ) : (
            <p className="text-[11px] text-[#b0acd6]">1장 &gt; 1.5 피난·방화를 먼저 입력하세요.</p>
          )}
      </div>

      {/* 3.2 세부현황 */}
      <div id="c-3.2" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs font-semibold text-[#514b81]">3.2 피난시설 및 기타시설 세부현황</p>
              {canManage && (
                <button onClick={() => { setDetail(p => [...p, { facility: '', location: '', status: '양호' }]); setDirty(true) }}
                  className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
                  <Plus className="size-3" /> 행 추가
                </button>
              )}
            </div>
            {detail.length === 0 && <p className="text-[11px] text-[#b0acd6]">시설/위치/상태 행을 추가하세요.</p>}
            <div className="space-y-1.5">
              {detail.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-[#b0acd6] w-5">{i + 1}</span>
                  <input value={r.facility} disabled={!canManage} placeholder="시설" onChange={e => { setDetail(p => p.map((x, j) => j === i ? { ...x, facility: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-40`} />
                  <input value={r.location} disabled={!canManage} placeholder="위치" onChange={e => { setDetail(p => p.map((x, j) => j === i ? { ...x, location: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-32`} />
                  <input value={r.status} disabled={!canManage} placeholder="상태" onChange={e => { setDetail(p => p.map((x, j) => j === i ? { ...x, status: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-24`} />
                  {canManage && (
                    <button onClick={() => { setDetail(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제"><Trash2 className="size-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
      </div>

      {/* 3.3 피난인원 */}
      <div id="c-3.3" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
            <p className="text-xs font-semibold text-[#514b81]">3.3 피난인원 현황
              <span className="font-normal text-[#b0acd6] ml-2">인원은 1.1 운영현황 자동 — 수정은 1.1에서</span>
            </p>
            <p className="text-xs text-[#514b81]">근무 {headcount.worker || '—'}명 · 거주 {headcount.resident || '—'}명 · 최대 수용 {headcount.max || '—'}명</p>
            <textarea value={hcNote} disabled={!canManage} rows={2} placeholder="보완 사항 (시간대별 변동, 방문객 등)"
              onChange={e => { setHcNote(e.target.value); setDirty(true) }}
              className="w-full rounded-lg border border-[#d0ccf5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#7b68ee] resize-y" />
      </div>

      {/* 3.4 피난유도 절차·경로 — 생성 문서(3장)에 반영(§7-3) */}
      <div id="c-3.4" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-[#514b81]">3.4 피난유도 절차 및 피난경로 <span className="font-normal text-[#b0acd6]">생성 문서에 반영됨</span></p>
              {canManage && (
                <button onClick={() => { setPlan(p => ({ ...p, procedure: PROCEDURE_PRESET })); setDirty(true) }}
                  className="h-6 px-2 rounded-full border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">절차 프리셋</button>
              )}
            </div>
            <textarea value={plan.procedure} disabled={!canManage} rows={3} placeholder="피난유도 절차"
              onChange={e => { setPlan(p => ({ ...p, procedure: e.target.value })); setDirty(true) }}
              className="w-full rounded-lg border border-[#d0ccf5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#7b68ee] resize-y" />
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-[#514b81]">경로 행</span>
              {canManage && (
                <button onClick={() => { setPlan(p => ({ ...p, routes: [...p.routes, { floor: '', route: '', guide: '', equip: '' }] })); setDirty(true) }}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]"><Plus className="size-3" /> 행 추가</button>
              )}
            </div>
            {plan.routes.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-wrap">
                <input value={r.floor} disabled={!canManage} placeholder="층" onChange={e => { setPlan(p => ({ ...p, routes: p.routes.map((x, j) => j === i ? { ...x, floor: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} w-20`} />
                <input value={r.route} disabled={!canManage} placeholder="피난 경로" onChange={e => { setPlan(p => ({ ...p, routes: p.routes.map((x, j) => j === i ? { ...x, route: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} flex-1 min-w-40`} />
                <input value={r.guide} disabled={!canManage} placeholder="유도자" onChange={e => { setPlan(p => ({ ...p, routes: p.routes.map((x, j) => j === i ? { ...x, guide: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} w-24`} />
                <input value={r.equip} disabled={!canManage} placeholder="장비" onChange={e => { setPlan(p => ({ ...p, routes: p.routes.map((x, j) => j === i ? { ...x, equip: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} w-24`} />
                {canManage && (
                  <button onClick={() => { setPlan(p => ({ ...p, routes: p.routes.filter((_, j) => j !== i) })); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제"><Trash2 className="size-3.5" /></button>
                )}
              </div>
            ))}
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label className="text-[10px] text-[#b0acd6] block">집결지</label>
                <input value={plan.assembly} disabled={!canManage} placeholder="예: 1층 주차장" onChange={e => { setPlan(p => ({ ...p, assembly: e.target.value })); setDirty(true) }} className={`${inputCls} w-48`} />
              </div>
            </div>
            <ImageSlot customerId={customerId} canManage={canManage} path={plan.mapImage}
              onChange={p => { setPlan(prev => ({ ...prev, mapImage: p })); setDirty(true) }} label="피난경로도 (이미지)" />
      </div>

      {/* 3.5 피난약자 */}
      <div id="c-3.5" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-[#514b81]">3.5 피난약자 현황 및 피난계획</p>
              <button disabled={!canManage} className={chip(vul.none)}
                onClick={() => { setVul(p => ({ ...p, none: !p.none })); setDirty(true) }}>해당없음</button>
            </div>
            {!vul.none && (
              <>
                <div className="space-y-1">
                  {VULNERABLE_TYPES.map(tp => {
                    const c = vul.counts[tp] ?? { work: '', use: '' }
                    return (
                      <div key={tp} className="flex items-center gap-2">
                        <span className="text-[11px] text-[#514b81] w-12">{tp}</span>
                        <input value={c.work} disabled={!canManage} inputMode="numeric" placeholder="근무·거주"
                          onChange={e => { setVul(p => ({ ...p, counts: { ...p.counts, [tp]: { ...c, work: e.target.value } } })); setDirty(true) }} className={`${inputCls} w-24`} />
                        <input value={c.use} disabled={!canManage} inputMode="numeric" placeholder="시설 이용"
                          onChange={e => { setVul(p => ({ ...p, counts: { ...p.counts, [tp]: { ...c, use: e.target.value } } })); setDirty(true) }} className={`${inputCls} w-24`} />
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-[#514b81]">피난계획 행</span>
                  {canManage && (
                    <button onClick={() => { setVul(p => ({ ...p, plans: [...p.plans, { area: '', count: '', type: '', helper: '', equip: '', method: '' }] })); setDirty(true) }}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]"><Plus className="size-3" /> 행 추가</button>
                  )}
                </div>
                {vul.plans.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5 flex-wrap">
                    <input value={r.area} disabled={!canManage} placeholder="구역(동·층)" onChange={e => { setVul(p => ({ ...p, plans: p.plans.map((x, j) => j === i ? { ...x, area: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} w-24`} />
                    <input value={r.count} disabled={!canManage} inputMode="numeric" placeholder="인원" onChange={e => { setVul(p => ({ ...p, plans: p.plans.map((x, j) => j === i ? { ...x, count: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} w-16`} />
                    <input value={r.type} disabled={!canManage} placeholder="유형" onChange={e => { setVul(p => ({ ...p, plans: p.plans.map((x, j) => j === i ? { ...x, type: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} w-20`} />
                    <input value={r.helper} disabled={!canManage} placeholder="보조자" onChange={e => { setVul(p => ({ ...p, plans: p.plans.map((x, j) => j === i ? { ...x, helper: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} w-20`} />
                    <input value={r.equip} disabled={!canManage} placeholder="장비" onChange={e => { setVul(p => ({ ...p, plans: p.plans.map((x, j) => j === i ? { ...x, equip: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} w-20`} />
                    <input value={r.method} disabled={!canManage} placeholder="방법" onChange={e => { setVul(p => ({ ...p, plans: p.plans.map((x, j) => j === i ? { ...x, method: e.target.value } : x) })); setDirty(true) }} className={`${inputCls} flex-1 min-w-28`} />
                    {canManage && (
                      <button onClick={() => { setVul(p => ({ ...p, plans: p.plans.filter((_, j) => j !== i) })); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제"><Trash2 className="size-3.5" /></button>
                    )}
                  </div>
                ))}
              </>
            )}
      </div>

      {/* 3.6 유형별 방법 */}
      <div id="c-3.6" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
            <p className="text-xs font-semibold text-[#514b81]">3.6 피난약자 유형별 피난방법
              <span className="font-normal text-[#b0acd6] ml-2">표준 문구 기본 — 빈 칸이면 표준 문구로 출력</span>
            </p>
            {VULNERABLE_TYPES.map(tp => (
              <div key={tp}>
                <label className="text-[11px] font-medium text-[#514b81] block mb-0.5">{tp}</label>
                <textarea value={methods[tp] ?? ''} disabled={!canManage} rows={1} placeholder={METHOD_PRESETS[tp]}
                  onChange={e => { setMethods(p => ({ ...p, [tp]: e.target.value })); setDirty(true) }}
                  className="w-full rounded-lg border border-[#d0ccf5] bg-white px-2 py-1 text-xs outline-none focus:border-[#7b68ee] resize-y" />
              </div>
            ))}
      </div>

      {/* 3.7 기구·장비 */}
      <div id="c-3.7" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs font-semibold text-[#514b81]">3.7 피난 기구·유도장비 세부현황</p>
              {canManage && (
                <button onClick={() => { setEquip(p => [...p, { name: '', location: '', qty: '' }]); setDirty(true) }}
                  className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]"><Plus className="size-3" /> 행 추가</button>
              )}
            </div>
            {equip.length === 0 && <p className="text-[11px] text-[#b0acd6]">장비/위치/수량 행을 추가하세요.</p>}
            <div className="space-y-1.5">
              {equip.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-[#b0acd6] w-5">{i + 1}</span>
                  <input value={r.name} disabled={!canManage} placeholder="장비 (예: 완강기)" onChange={e => { setEquip(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-40`} />
                  <input value={r.location} disabled={!canManage} placeholder="위치" onChange={e => { setEquip(p => p.map((x, j) => j === i ? { ...x, location: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-32`} />
                  <input value={r.qty} disabled={!canManage} inputMode="numeric" placeholder="수량" onChange={e => { setEquip(p => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-16`} />
                  {canManage && (
                    <button onClick={() => { setEquip(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제"><Trash2 className="size-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
      </div>

      {/* §1-2 저장 버튼 서식당 1개 — 3장 전체 일괄 저장 */}
      {saveBtn({
        evacDetail: detail.filter(r => r.facility.trim()),
        evacHeadcount: { note: hcNote },
        evacPlan: plan,
        vulnerable: vul,
        vulnerableMethods: methods,
        evacEquip: equip.filter(r => r.name.trim()),
      }, '3장')}
    </div>
  )
}
