'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, ShieldCheck, Layers, Plus, Trash2, Pencil } from 'lucide-react'
import { saveFacilitiesAction, verifyFacilitiesAction, type FacilityRow, type FloorRow } from '@/app/(dashboard)/customers/facilities-actions'
import { FACILITY_STANDARD, EVAC_SUB_ITEMS } from '@/lib/facility-codes'

/** 서식 1.4 소방시설 현황 — 양식(image-1.png) 재현 입력 화면 (소방계획서_4.md §4)
 *  표 괘선·좌측 분류 세로 병합·셀 전체 클릭 토글·피난기구 하위 8종 연동·항목별 비고(detail.note)·
 *  층별 수량 접기(fire_facility_floors)·시설 확인 완료(verified_at). 저장 = 기존 saveFacilitiesAction. */

type Cell = string | null
type GroupRow = { full?: string; evacSub?: boolean; pair?: [Cell, Cell] }
const LAYOUT: Array<{ category: string; rows: GroupRow[] }> = [
  { category: '소화설비', rows: [
    { full: '소화기구 및 자동소화장치' },
    { pair: ['옥내소화전설비', '옥외소화전설비'] },
    { pair: ['스프링클러설비', '이산화탄소소화설비'] },
    { pair: ['간이스프링클러설비', '할론소화설비'] },
    { pair: ['화재조기진압용 스프링클러설비', '할로겐화합물 및 불활성기체소화설비'] },
    { pair: ['물분무소화설비', '분말소화설비'] },
    { pair: ['미분무소화설비', '강화액소화설비'] },
    { pair: ['포소화설비', '고체에어로졸소화설비'] },
  ] },
  { category: '경보설비', rows: [
    { pair: ['단독경보형감지기', '통합감시시설'] },
    { pair: ['비상경보설비', '자동화재속보설비'] },
    { pair: ['자동화재탐지설비 및 시각경보기', '누전경보기'] },
    { pair: ['화재알림설비', '가스누설경보기'] },
    { pair: ['비상방송설비', null] },
  ] },
  { category: '피난구조설비', rows: [
    { evacSub: true },
    { pair: ['인명구조기구', '피난유도선'] },
    { pair: ['유도등', '비상조명등'] },
    { pair: ['유도표지', '휴대용비상조명등'] },
  ] },
  { category: '소화용수설비', rows: [{ pair: ['상수도소화용수설비', '소화수조 및 저수조'] }] },
  { category: '소화활동설비', rows: [
    { full: '거실제연설비' },
    { pair: ['부속실 등 제연설비', '비상콘센트설비'] },
    { pair: ['연결송수관설비', '무선통신보조설비'] },
    { pair: ['연결살수설비', '연소방지설비'] },
  ] },
]
const CATEGORY_OF: Record<string, string> = {}
for (const g of LAYOUT) for (const r of g.rows) {
  if (r.full) CATEGORY_OF[r.full] = g.category
  if (r.pair) for (const c of r.pair) if (c) CATEGORY_OF[c] = g.category
}
CATEGORY_OF['피난기구'] = '피난구조설비'
for (const s of EVAC_SUB_ITEMS) CATEGORY_OF[s] = '피난구조설비'

const FLOOR_COLS = ['소화기', '차동식', '연기식', '정온식', '유도등', '비상조명']

type Building = {
  id: string; building_name: string; verified_at: string | null
  facilities: Array<{ facility_code: string; installed: boolean; detail: { note?: string } | null }>
  floors: Array<{ floor_label: string; counts: Record<string, number> }>
  floorsAbove?: number | null; floorsBelow?: number | null
}
type FacState = Record<string, { installed: boolean; note: string }>

export function PlanForm14({ customerId, buildings, canManage }: {
  customerId: string; buildings: Building[]; canManage: boolean
}) {
  const router = useRouter()
  const [bidx, setBidx] = useState(0)
  const b = buildings[bidx]
  const allCodes = [...FACILITY_STANDARD.flatMap(g => g.items), ...EVAC_SUB_ITEMS]
  const initFac = (bld?: Building): FacState => {
    const map: FacState = {}
    for (const code of allCodes) {
      const ex = bld?.facilities.find(f => f.facility_code === code)
      map[code] = { installed: ex?.installed ?? false, note: ex?.detail?.note ?? '' }
    }
    return map
  }
  const [fac, setFac] = useState<FacState>(() => initFac(b))
  const [floors, setFloors] = useState<FloorRow[]>(
    () => (b?.floors ?? []).map((f, i) => ({ floor_label: f.floor_label, sort_order: i, counts: { ...f.counts } })))
  const [dirty, setDirty] = useState(false)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function switchBuilding(i: number) {
    setBidx(i)
    setFac(initFac(buildings[i]))
    setFloors((buildings[i]?.floors ?? []).map((f, j) => ({ floor_label: f.floor_label, sort_order: j, counts: { ...f.counts } })))
    setDirty(false)
    setNoteFor(null)
  }
  function toggle(code: string) {
    if (!canManage) return
    setFac(p => {
      const on = !p[code].installed
      const next = { ...p, [code]: { ...p[code], installed: on } }
      if (code === '피난기구' && !on) {
        for (const s of EVAC_SUB_ITEMS) next[s] = { ...next[s], installed: false } // 부모 해제 → 하위 해제
      }
      if (EVAC_SUB_ITEMS.includes(code) && on) {
        next['피난기구'] = { ...next['피난기구'], installed: true } // 하위 체크 → 피난기구 자동 체크
      }
      return next
    })
    setDirty(true)
  }
  function setNote(code: string, note: string) {
    setFac(p => ({ ...p, [code]: { ...p[code], note } }))
    setDirty(true)
  }
  function autoFloors() {
    const fa = b?.floorsAbove ?? 0
    const fb = b?.floorsBelow ?? 0
    if (fa + fb === 0) { setMsg('⚠ 건물 층수가 없습니다 — 건물·시설 탭에서 층수를 먼저 입력해주세요.'); return }
    const rows: FloorRow[] = []
    for (let i = fb; i >= 1; i--) rows.push({ floor_label: `지하${i}층`, sort_order: rows.length, counts: {} })
    for (let i = 1; i <= fa; i++) rows.push({ floor_label: `${i}층`, sort_order: rows.length, counts: {} })
    setFloors(rows)
    setDirty(true)
  }
  function save() {
    startTransition(async () => {
      const rows: FacilityRow[] = allCodes.map(code => ({
        category: CATEGORY_OF[code] ?? '기타', facility_code: code,
        installed: fac[code].installed, detail: fac[code].note || null,
      }))
      const res = await saveFacilitiesAction(b.id, customerId, rows, floors)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.4 저장됨 — 계획서·별지 9호 출력에 반영됩니다')
      router.refresh()
    })
  }
  function verifyOnly() {
    startTransition(async () => {
      const res = await verifyFacilitiesAction(b.id, customerId)
      setMsg(res.error ? `❌ ${res.error}` : '✅ 시설 확인 완료로 기록됨')
      if (!res.error) router.refresh()
    })
  }

  if (!b) {
    return <p className="text-sm text-[#514b81] py-6 text-center">등록된 활성 건물이 없습니다 — 건물·시설 탭에서 먼저 등록해주세요.</p>
  }

  const installedCount = allCodes.filter(c => fac[c].installed).length
  const evacOn = fac['피난기구'].installed

  /** 체크 셀 — 셀 전체 클릭, 체크 시 굵게(양식 ■ 느낌), 비고 ✎ */
  const cell = (code: Cell, opts?: { sub?: boolean }) => {
    if (!code) return <td className="border border-[#c8c4d0]" />
    const st = fac[code]
    const disabled = opts?.sub && !evacOn && !st.installed
    return (
      <td className={`border border-[#c8c4d0] p-0 ${disabled ? 'bg-[#f8f8fb]' : ''}`}>
        <div role="button" tabIndex={0} aria-disabled={disabled}
          onClick={() => !disabled && toggle(code)}
          onKeyDown={e => { if (e.key === 'Enter' && !disabled) toggle(code) }}
          className={`flex items-center gap-1.5 px-2 py-1 min-h-7 cursor-pointer select-none ${
            disabled ? 'cursor-not-allowed text-[#c8c4d0]' : 'hover:bg-[#f5f4ff]'}`}>
          <span className="text-sm leading-none">{st.installed ? '☑' : '☐'}</span>
          <span className={`text-xs ${st.installed ? 'font-bold text-[#090c1d]' : 'text-[#514b81]'}`}>{code}</span>
          {st.note && <span className="text-[10px] text-amber-600 truncate max-w-24" title={st.note}>({st.note})</span>}
          {canManage && st.installed && (
            <button onClick={e => { e.stopPropagation(); setNoteFor(noteFor === code ? null : code) }}
              className="ml-auto text-[#b0acd6] hover:text-[#7b68ee]" title="비고 (예: 소화기 12대)" aria-label={`${code} 비고`}>
              <Pencil className="size-3" />
            </button>
          )}
        </div>
        {noteFor === code && (
          <div className="px-2 pb-1">
            <input value={st.note} onChange={e => setNote(code, e.target.value)} placeholder="비고 — 예: 소화기 12대"
              className="h-6 w-full rounded border border-[#d0ccf5] bg-white px-1.5 text-[11px] outline-none focus:border-[#7b68ee]" />
          </div>
        )}
      </td>
    )
  }

  return (
    <div className="space-y-3">
      {/* 타이틀 + 대상명 (양식 비고 2 — 대상물별 세트) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-[#090c1d]">서식 1.4 소방시설 현황</span>
        <span className="text-[11px] text-[#b0acd6]">※ 해당되는 곳을 클릭해 √ 표시합니다</span>
        {buildings.length > 1 && (
          <select value={bidx} onChange={e => switchBuilding(parseInt(e.target.value, 10))}
            className="ml-auto h-7 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none">
            {buildings.map((bb, i) => <option key={bb.id} value={i}>{bb.building_name}</option>)}
          </select>
        )}
        {buildings.length === 1 && <span className="ml-auto text-xs text-[#514b81]">대상명: {b.building_name}</span>}
      </div>

      {/* 양식 재현 표 — 좌측 분류 세로 병합 */}
      <table className="w-full border-collapse">
        <tbody>
          {LAYOUT.map(g => g.rows.map((r, ri) => (
            <tr key={`${g.category}-${ri}`}>
              {ri === 0 && (
                <th rowSpan={g.rows.length} className="border border-[#c8c4d0] bg-[#fafaff] w-12 px-1 text-[11px] font-semibold text-[#514b81]">
                  {g.category.replace('설비', '').split('').join(' ')}<br />설 비
                </th>
              )}
              {r.full && cell(r.full)}
              {r.full && <td className="border border-[#c8c4d0]" />}
              {r.evacSub && (
                <td colSpan={2} className="border border-[#c8c4d0] p-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1">
                    <div role="button" tabIndex={0} onClick={() => toggle('피난기구')}
                      onKeyDown={e => { if (e.key === 'Enter') toggle('피난기구') }}
                      className="flex items-center gap-1.5 cursor-pointer select-none hover:bg-[#f5f4ff] rounded px-1">
                      <span className="text-sm leading-none">{fac['피난기구'].installed ? '☑' : '☐'}</span>
                      <span className={`text-xs ${fac['피난기구'].installed ? 'font-bold text-[#090c1d]' : 'text-[#514b81]'}`}>피난기구</span>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 pl-2 border-l border-[#e0ddf5]">
                      {EVAC_SUB_ITEMS.map(sname => {
                        const on = fac[sname].installed
                        // 피난기구 미체크 시 흐림 표시 — 클릭하면 피난기구가 자동 체크됨 (§4-2)
                        const dim = !evacOn && !on
                        return (
                          <button key={sname} onClick={() => canManage && toggle(sname)} disabled={!canManage}
                            className={`inline-flex items-center gap-1 text-[11px] ${
                              on ? 'font-bold text-[#090c1d]' : dim ? 'text-[#c8c4d0] hover:text-[#7b68ee]' : 'text-[#514b81] hover:text-[#7b68ee]'}`}>
                            <span>{on ? '☑' : '☐'}</span>{sname}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </td>
              )}
              {r.pair && cell(r.pair[0])}
              {r.pair && cell(r.pair[1])}
            </tr>
          )))}
        </tbody>
      </table>
      <p className="text-[10px] text-[#b0acd6]">※ 비고 1. 설치장소·규격 등은 자체점검표 참조 2. 건물군은 대상명을 바꿔 대상물별로 작성</p>

      {/* 층별 수량 접기 (fire_facility_floors) */}
      <details className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] px-4 py-2">
        <summary className="text-xs font-semibold text-[#514b81] cursor-pointer">층별 수량 입력 (소화기·감지기·유도등 등)</summary>
        <div className="mt-2">
          {canManage && (
            <div className="flex items-center gap-2 mb-2">
              <button onClick={autoFloors} className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
                <Layers className="size-3" /> 층 자동 생성
              </button>
              <button onClick={() => { setFloors(p => [...p, { floor_label: '', sort_order: p.length, counts: {} }]); setDirty(true) }}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#514b81] hover:bg-[#f5f4ff]">
                <Plus className="size-3" /> 행 추가
              </button>
            </div>
          )}
          {floors.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-[#514b81] border-b border-[#e0ddf5]">
                  <th className="pb-1 pr-1 w-20 font-medium">층</th>
                  {FLOOR_COLS.map(c => <th key={c} className="pb-1 pr-1 font-medium">{c}</th>)}
                  <th className="pb-1 w-7" />
                </tr>
              </thead>
              <tbody>
                {floors.map((fl, i) => (
                  <tr key={i}>
                    <td className="py-0.5 pr-1">
                      <input value={fl.floor_label} disabled={!canManage}
                        onChange={e => { setFloors(p => p.map((x, j) => j === i ? { ...x, floor_label: e.target.value } : x)); setDirty(true) }}
                        className="h-6 w-full rounded border border-[#d0ccf5] bg-white px-1 text-xs outline-none" />
                    </td>
                    {FLOOR_COLS.map(c => (
                      <td key={c} className="py-0.5 pr-1">
                        <input value={fl.counts[c] || ''} disabled={!canManage} inputMode="numeric"
                          onChange={e => {
                            const n = parseInt(e.target.value, 10)
                            setFloors(p => p.map((x, j) => j === i ? { ...x, counts: { ...x.counts, [c]: isNaN(n) ? 0 : n } } : x))
                            setDirty(true)
                          }}
                          className="h-6 w-full rounded border border-[#d0ccf5] bg-white px-1 text-xs outline-none" />
                      </td>
                    ))}
                    <td className="py-0.5">
                      {canManage && (
                        <button onClick={() => { setFloors(p => p.filter((_, j) => j !== i)); setDirty(true) }}
                          className="text-[#b0acd6] hover:text-red-500" aria-label="층 삭제">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      {/* 푸터 — 설치 요약·확인 완료·저장 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-[#514b81]">설치 {installedCount}종{b.verified_at ? ` · 마지막 확인 ${b.verified_at.slice(5)}` : ''}</span>
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={verifyOnly} disabled={isPending}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] disabled:opacity-50">
              <ShieldCheck className="size-3.5" /> 시설 확인 완료
            </button>
            <button onClick={save} disabled={!dirty || isPending}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 저장
            </button>
          </div>
        )}
      </div>
      {msg && <p className="text-xs text-[#514b81]">{msg}</p>}
    </div>
  )
}
