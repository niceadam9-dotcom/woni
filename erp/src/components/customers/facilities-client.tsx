'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Plus, X, Loader2, ShieldCheck, Sparkles, Copy, Layers } from 'lucide-react'
import { saveFacilitiesAction, verifyFacilitiesAction, type FacilityRow, type FloorRow } from '@/app/(dashboard)/customers/facilities-actions'
import { suggestFacilitySet, DETAIL_TYPE_PRESETS, parseDetailChips, serializeDetailChips, type DetailChip } from '@/lib/facility-presets'

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
  // §6-E: 층 자동 생성·기본 세트용
  purpose?: string | null
  floorsAbove?: number | null
  floorsBelow?: number | null
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
  // §12(T11): 설치 시설 중심 편집 — 검색 추가·미설치 접힘·층별 일괄
  const [facSearch, setFacSearch] = useState('')
  const [showAllFac, setShowAllFac] = useState(false)
  const [bulk, setBulk] = useState<Record<string, string>>({})

  const ALL_CODES = CATALOG.flatMap(c => c.items)
  const installedCodes = ALL_CODES.filter(c => fac[c]?.installed)
  const searchMatches = facSearch.trim()
    ? ALL_CODES.filter(c => !fac[c]?.installed && c.includes(facSearch.trim())).slice(0, 8)
    : []
  function addFacility(code: string) {
    setFac(s => ({ ...s, [code]: { ...s[code], installed: true } }))
    setFacSearch('')
  }

  // §12-2: 열 단위 일괄 입력 — 값 하나로 전 층 채움
  function applyBulkCol(c: string, v: string) {
    setBulk(p => ({ ...p, [c]: v }))
    const n = parseInt(v, 10) || 0
    setFloors(s => s.map(x => ({ ...x, counts: { ...x.counts, [c]: n } })))
  }
  // §12-2: 첫 행 전층 적용
  function applyFirstRowToAll() {
    if (floors.length < 2) return
    const first = floors[0].counts
    setFloors(s => s.map((x, i) => (i === 0 ? x : { ...x, counts: { ...first } })))
  }

  // §12-3·§12-A-B: 층별 합계 → 시설 상세 자동 제안 (자탐은 감지기 3열 합계)
  const SUM_SUGGEST: Record<string, { kind: string; cols: string[] }> = {
    '소화기구': { kind: '소화기', cols: ['소화기'] },
    '유도등·유도표지': { kind: '유도등', cols: ['유도등'] },
    '비상조명등': { kind: '비상조명', cols: ['비상조명'] },
    '자동화재탐지설비': { kind: '감지기', cols: ['차동식', '연기식', '정온식'] },
  }
  const colSum = (c: string) => floors.reduce((a, f) => a + (f.counts[c] || 0), 0)
  const sumFor = (code: string) => (SUM_SUGGEST[code]?.cols ?? []).reduce((a, c) => a + colSum(c), 0)

  // §12-A: 종류+수량 칩 편집기 — 저장은 기존 detail 문자열 직렬화 (DB·보고서 무변경)
  const [rawModeCodes, setRawModeCodes] = useState<Set<string>>(new Set())
  const [addKindOpen, setAddKindOpen] = useState<string | null>(null)
  const setDetail = (code: string, detail: string) =>
    setFac(s => ({ ...s, [code]: { ...s[code], detail } }))
  const updateChips = (code: string, chips: DetailChip[]) => setDetail(code, serializeDetailChips(chips))
  function addKind(code: string, chips: DetailChip[], kind: string) {
    setAddKindOpen(null)
    if (!kind.trim() || chips.some(c => c.kind === kind)) return
    updateChips(code, [...chips, { kind: kind.trim(), qty: 1 }])
  }
  function toggleRawMode(code: string) {
    setRawModeCodes(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function reset(nextIdx = bidx) {
    setBidx(nextIdx)
    setTimeout(() => {
      setFac(initFac())
      setFloors((buildings[nextIdx]?.floors ?? []).map((f, i) => ({ floor_label: f.floor_label, sort_order: i, counts: { ...f.counts } })))
      setEditing(false)
      // §12 UI 상태도 초기화 — 건물 전환 시 검색어·일괄 값·종류 드롭다운 잔존 방지
      setFacSearch(''); setShowAllFac(false); setBulk({}); setAddKindOpen(null); setRawModeCodes(new Set())
    }, 0)
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

  // §6-E: 층 자동 생성 — 건물 지상/지하 층수로 행 일괄 생성 후 수량만 입력
  function autoFloors() {
    const fa = b.floorsAbove ?? 0
    const fb = b.floorsBelow ?? 0
    if (fa + fb === 0) { setError('건물의 지상/지하 층수가 없습니다 — 건물 목록에서 먼저 입력하세요.'); return }
    if (floors.length > 0 && !window.confirm('기존 층 목록을 대체할까요?')) return
    setError('')
    const labels: string[] = []
    for (let i = fb; i >= 1; i--) labels.push(`지하${i}층`)
    for (let i = 1; i <= fa; i++) labels.push(`${i}층`)
    setFloors(labels.map((floor_label, i) => ({ floor_label, sort_order: i, counts: {} })))
    setBulk({})  // 층 재생성 시 일괄 입력 값 초기화 (잔존 혼동 방지)
  }

  // §6-E: 용도별 기본 세트 — 추가 체크만 (기존 체크 해제 없음). 매핑표 초안: src/lib/facility-presets.ts
  function applyPresetSet() {
    const set = suggestFacilitySet(b.purpose ?? null)
    if (!set) { setError('건물 용도가 없어 기본 세트를 고를 수 없습니다.'); return }
    setError('')
    setFac(s => {
      const next = { ...s }
      for (const code of set.items) if (next[code]) next[code] = { ...next[code], installed: true }
      return next
    })
  }

  // §6-E: 다른 건물에서 복사 — 시설 체크·상세를 그대로 복사
  function copyFromBuilding(srcIdx: number) {
    const src = buildings[srcIdx]
    if (!src) return
    if (!window.confirm(`'${src.building_name}'의 시설 현황을 복사할까요? (현재 체크를 대체)`)) return
    setError('')
    setFac(s => {
      const next = { ...s }
      for (const code of Object.keys(next)) {
        const ex = src.facilities.find(f => f.facility_code === code)
        next[code] = { ...next[code], installed: ex?.installed ?? false, detail: ex?.detail?.note ?? '' }
      }
      return next
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
        {/* §6-E: 요약 뱃지 — 열지 않고 상태 파악 */}
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">
          설치 {installedList.length}종 · 층별 {b.floors.length}층
        </span>
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
          {/* §12-4: 빠른 시작 — 시설·층이 모두 비어 있을 때 원클릭 */}
          {installedCodes.length === 0 && floors.length === 0 && (
            <button onClick={() => { applyPresetSet(); autoFloors() }}
              className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[11px] text-amber-800 hover:bg-amber-100">
              ⚡ 빠른 시작: 기본 세트{b.purpose ? `(${suggestFacilitySet(b.purpose)?.label ?? ''})` : ''} 적용 + 층 자동 생성
              {(b.floorsAbove || b.floorsBelow) ? ` (지하${b.floorsBelow ?? 0}~지상${b.floorsAbove ?? 0})` : ''} — 클릭 한 번으로 초안을 만들고 조정만 하세요
            </button>
          )}

          {/* §6-E: 기본 세트·복사 도구 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={applyPresetSet}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              <Sparkles className="size-3" /> 기본 세트 적용{b.purpose ? ` (${suggestFacilitySet(b.purpose)?.label ?? ''})` : ''}
            </button>
            {buildings.length > 1 && buildings.map((bd, i) => i !== bidx && (
              <button key={bd.id} onClick={() => copyFromBuilding(i)}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
                <Copy className="size-3" /> {bd.building_name}에서 복사
              </button>
            ))}
            <span className="text-[10px] text-[#b0acd6]">기본 세트는 체크만 추가 — 해제는 직접</span>
          </div>
          {/* §12-1: 설치 시설 중심 — 검색으로 추가, 26종 스캔 제거 */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-semibold text-[#7b68ee]">설치 시설 ({installedCodes.length}종)</p>
              <div className="relative">
                <input value={facSearch} onChange={e => setFacSearch(e.target.value)}
                  placeholder="+ 시설 추가 (이름 검색)"
                  className="h-7 w-44 rounded border border-[#d0ccf5] px-2 text-xs outline-none focus:border-[#7b68ee]" />
                {searchMatches.length > 0 && (
                  <div className="absolute z-10 top-8 left-0 w-64 bg-white border border-[#d0ccf5] rounded-lg shadow-lg max-h-44 overflow-y-auto">
                    {searchMatches.map(code => (
                      <button key={code} onClick={() => addFacility(code)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#f5f4ff]">
                        {code}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {installedCodes.length === 0 && (
              <p className="text-[11px] text-[#b0acd6]">설치 시설 없음 — 검색으로 추가하거나 기본 세트를 적용하세요</p>
            )}
            {installedCodes.map(code => {
              const presetKinds = DETAIL_TYPE_PRESETS[code]
              const parsed = presetKinds && !rawModeCodes.has(code) ? parseDetailChips(fac[code].detail ?? '') : null
              const suggest = SUM_SUGGEST[code]
              const sum = suggest ? sumFor(code) : 0
              // §12-A-C: 불일치 경고 — 자탐은 '감지기' 칩만, 그 외는 칩 수량 합 비교
              const chipTotal = parsed
                ? (code === '자동화재탐지설비'
                  ? (parsed.find(c => c.kind === '감지기')?.qty ?? 0)
                  : parsed.reduce((a, c) => a + c.qty, 0))
                : 0
              const mismatch = parsed !== null && suggest && sum > 0 && chipTotal > 0 && chipTotal !== sum
              const suggestBtn = suggest && sum > 0 && !(fac[code].detail ?? '').trim() && (
                <button onClick={() => setDetail(code, `${suggest.kind} ${sum}`)}
                  className="shrink-0 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 hover:bg-amber-100">
                  층별 합계 {sum} 적용
                </button>
              )
              return (
                <div key={code} className="flex items-start gap-2">
                  <label className="flex items-center gap-1.5 w-40 shrink-0 cursor-pointer h-7">
                    <input type="checkbox" checked
                      onChange={() => setFac(s => ({ ...s, [code]: { ...s[code], installed: false } }))}
                      className="size-3.5 accent-[#7b68ee]" />
                    <span className="text-xs text-[#090c1d]">{code}</span>
                  </label>

                  {parsed !== null ? (
                    /* §12-A: 종류+수량 칩 편집기 */
                    <div className="flex-1 flex items-center gap-1.5 flex-wrap min-w-0">
                      {parsed.map((ch, i) => (
                        <span key={i} className="inline-flex items-center gap-0.5 rounded-full border border-[#d0ccf5] bg-[#f5f4ff] pl-2 pr-0.5 h-6 text-[11px] text-[#090c1d]">
                          {ch.kind}
                          <button onClick={() => updateChips(code, parsed.map((c, j) => j === i ? { ...c, qty: Math.max(1, c.qty - 1) } : c))}
                            className="px-0.5 text-[#7b68ee] hover:text-[#6647f0]">−</button>
                          <input value={ch.qty}
                            onChange={e => updateChips(code, parsed.map((c, j) => j === i ? { ...c, qty: parseInt(e.target.value, 10) || 0 } : c))}
                            className="w-9 h-5 rounded border border-[#d0ccf5] bg-white text-center outline-none focus:border-[#7b68ee]" />
                          <button onClick={() => updateChips(code, parsed.map((c, j) => j === i ? { ...c, qty: c.qty + 1 } : c))}
                            className="px-0.5 text-[#7b68ee] hover:text-[#6647f0]">+</button>
                          <button onClick={() => updateChips(code, parsed.filter((_, j) => j !== i))}
                            className="px-1 text-[#b0acd6] hover:text-red-500">✕</button>
                        </span>
                      ))}
                      <div className="relative">
                        <button onClick={() => setAddKindOpen(addKindOpen === code ? null : code)}
                          className="h-6 px-2 rounded-full border border-dashed border-[#c3bdf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
                          + 종류
                        </button>
                        {addKindOpen === code && (
                          <div className="absolute z-10 top-7 left-0 min-w-32 bg-white border border-[#d0ccf5] rounded-lg shadow-lg">
                            {presetKinds.filter(k => !parsed.some(c => c.kind === k)).map(k => (
                              <button key={k} onClick={() => addKind(code, parsed, k)}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#f5f4ff]">{k}</button>
                            ))}
                            <button onClick={() => addKind(code, parsed, window.prompt('종류 이름 입력') ?? '')}
                              className="w-full text-left px-3 py-1.5 text-xs text-[#514b81] hover:bg-[#f8f9fa] border-t border-[#f0eefb]">
                              직접 입력…
                            </button>
                          </div>
                        )}
                      </div>
                      {suggestBtn}
                      {mismatch && (
                        <span className="text-[10px] text-amber-600" title="칩 수량과 층별 수량 표의 합계가 다릅니다 — 확인해주세요">
                          ⚠ 층별 합계({sum})와 불일치
                        </span>
                      )}
                      <button onClick={() => toggleRawMode(code)} title="자유 텍스트로 입력"
                        className="text-[10px] text-[#b0acd6] hover:text-[#7b68ee]">텍스트</button>
                    </div>
                  ) : (
                    /* 자유 텍스트 폴백 (패턴 불일치 문구·프리셋 없는 시설·수동 전환) */
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                      <input value={fac[code].detail ?? ''}
                        onChange={e => setDetail(code, e.target.value)}
                        placeholder="수량·상세 (예: 분말 12, CO2 2)"
                        className="flex-1 h-7 rounded border border-[#d0ccf5] px-2 text-xs outline-none focus:border-[#7b68ee]" />
                      {suggestBtn}
                      {presetKinds && rawModeCodes.has(code) && parseDetailChips(fac[code].detail ?? '') !== null && (
                        <button onClick={() => toggleRawMode(code)} title="종류+수량 칩으로 입력"
                          className="shrink-0 text-[10px] text-[#b0acd6] hover:text-[#7b68ee]">칩 입력</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            <button onClick={() => setShowAllFac(v => !v)}
              className="text-[11px] text-[#514b81] hover:text-[#7b68ee]">
              {showAllFac ? '▾' : '▸'} 미설치 시설 전체 보기
            </button>
            {showAllFac && CATALOG.map(cat => {
              const rest = cat.items.filter(c => !fac[c]?.installed)
              if (rest.length === 0) return null
              return (
                <div key={cat.category} className="pl-2">
                  <p className="text-[10px] font-semibold text-[#b0acd6] mb-0.5">{cat.category}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {rest.map(code => (
                      <label key={code} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={false}
                          onChange={() => addFacility(code)}
                          className="size-3.5 accent-[#7b68ee]" />
                        <span className="text-xs text-[#514b81]">{code}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 층별 수량 */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-semibold text-[#7b68ee]">층별 수량</p>
              <button onClick={() => setFloors(f => [...f, { floor_label: '', sort_order: f.length, counts: {} }])}
                className="inline-flex items-center gap-0.5 text-[11px] text-[#7b68ee] hover:underline">
                <Plus className="size-3" /> 층 추가
              </button>
              {/* §6-E: 지상/지하 층수 기반 일괄 생성 */}
              <button onClick={autoFloors}
                className="inline-flex items-center gap-0.5 text-[11px] text-[#7b68ee] hover:underline">
                <Layers className="size-3" /> 층 자동 생성
                {(b.floorsAbove || b.floorsBelow) ? ` (지하${b.floorsBelow ?? 0}~지상${b.floorsAbove ?? 0})` : ''}
              </button>
              {/* §12-2: 대표 층 하나 입력 → 나머지 복사 */}
              {floors.length > 1 && (
                <button onClick={applyFirstRowToAll}
                  className="inline-flex items-center gap-0.5 text-[11px] text-[#7b68ee] hover:underline">
                  <Copy className="size-3" /> 첫 행 전층 적용
                </button>
              )}
              <span className="text-[10px] text-[#b0acd6]">셀에서 Enter = 아래 층 이동</span>
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
                    {/* §12-2: 열 단위 일괄 입력 — 값 하나로 전 층 채움 */}
                    <tr className="bg-[#fffbeb]">
                      <td className="px-1 py-0.5 text-[10px] text-amber-600">일괄→</td>
                      {FLOOR_COLS.map(c => (
                        <td key={c} className="px-1 py-0.5">
                          <input type="number" min={0} value={bulk[c] ?? ''} onChange={e => applyBulkCol(c, e.target.value)}
                            placeholder="전층" title="입력하면 전 층에 같은 값이 채워집니다"
                            className="w-11 h-6 rounded border border-amber-200 bg-amber-50 px-1 text-center outline-none focus:border-amber-400 placeholder:text-[9px]" />
                        </td>
                      ))}
                      <td />
                    </tr>
                    {floors.map((fl, i) => (
                      <tr key={i}>
                        <td className="px-1 py-0.5">
                          <input value={fl.floor_label} onChange={e => setFloors(s => s.map((x, j) => j === i ? { ...x, floor_label: e.target.value } : x))}
                            placeholder="1층" className="w-16 h-6 rounded border border-[#d0ccf5] px-1 outline-none focus:border-[#7b68ee]" />
                        </td>
                        {FLOOR_COLS.map(c => (
                          <td key={c} className="px-1 py-0.5">
                            <input id={`fl-${i}-${c}`} type="number" min={0} value={fl.counts[c] ?? ''}
                              onChange={e => setFloors(s => s.map((x, j) => j === i ? { ...x, counts: { ...x.counts, [c]: parseInt(e.target.value) || 0 } } : x))}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById(`fl-${i + 1}-${c}`)?.focus() } }}
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
