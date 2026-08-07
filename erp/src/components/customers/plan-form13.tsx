'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, ImagePlus, Trash2 } from 'lucide-react'
import {
  saveFirePlanSectionsAction, uploadPlanAssetAction, deletePlanAssetAction, getPlanAssetUrlAction,
  suggestSurroundingsAction,
} from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { getFireRouteAction, generateRouteImageAction } from '@/app/(dashboard)/customers/fire-route-actions'
import { NumField, useUnsavedWarning } from '@/components/ui/fields'

/** 서식 1.3 건축물 위치·운영현황 및 소방차 세부진입 계획 — 섹션 카드 2개 (소방계획서_4.md §3)
 *  sections.location(위치도·주변 현황·관할 소방서·거리·도착예상·운영 개요) + sections.fireAccess(진입경로·경로도·진입장소·주변 소방시설) */

export type LocationSection = { mapImage: string | null; surroundings: string; fireStation: string; distance: string; eta: string; operation: string }
export type FireAccessSection = { routeDesc: string; routeImage: string | null; entryPoint: string; nearbyFacilities: string }

export function ImageSlot({ customerId, canManage, path, onChange, label }: {
  customerId: string
  canManage: boolean
  path: string | null
  onChange: (path: string | null) => void
  label: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!path) return
    let alive = true
    getPlanAssetUrlAction(customerId, path).then(r => { if (alive && r.url) setSigned({ path, url: r.url }) })
    return () => { alive = false }
  }, [customerId, path])
  const url = path && signed?.path === path ? signed.url : null

  async function upload(file: File) {
    setBusy(true)
    setErr('')
    const fd = new FormData()
    fd.set('file', file)
    const res = await uploadPlanAssetAction(customerId, fd)
    setBusy(false)
    if (res.error || !res.path) { setErr(res.error ?? '업로드 실패'); return }
    if (path) await deletePlanAssetAction(customerId, path)
    onChange(res.path)
  }
  async function remove() {
    if (!path) return
    setBusy(true)
    await deletePlanAssetAction(customerId, path)
    setBusy(false)
    onChange(null)
  }

  return (
    <div>
      <p className="text-[11px] font-medium text-[#514b81] mb-1">{label}</p>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="max-h-40 rounded-lg border border-[#e0ddf5]" />
      ) : (
        <p className="text-[11px] text-[#b0acd6]">{path ? '미리보기 로딩…' : '이미지 없음'}</p>
      )}
      {canManage && (
        <div className="flex items-center gap-2 mt-1">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
            {busy ? <Loader2 className="size-3 animate-spin" /> : <ImagePlus className="size-3" />} {path ? '교체' : '업로드'}
          </button>
          {path && (
            <button onClick={remove} disabled={busy} className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#e0ddf5] text-[11px] text-[#b0acd6] hover:text-red-500">
              <Trash2 className="size-3" /> 삭제
            </button>
          )}
          {err && <span className="text-[11px] text-red-500">{err}</span>}
        </div>
      )}
    </div>
  )
}

/** 생성 문서 삽입 사진 (§8-1k — 생성 모달 폐지에 따라 1.3으로 이관)
 *  D-5(소방계획서_11): 건물 전경·위치도·피난경로도는 [지도·사진] 슬롯과 중복 입력 경로였다.
 *  신규 추가는 '기타'만 허용하고, 기존에 그 종류로 저장된 사진은 그대로 인쇄한다(하위호환). */
export type PlanPhotoRow = { path: string | null; kind: string; caption: string }
const PHOTO_KIND_OPTIONS = [
  { value: 'building', label: '건물 전경', legacy: true },
  { value: 'map', label: '위치도(지도)', legacy: true },
  { value: 'evacuation', label: '피난경로도', legacy: true },
  { value: 'etc', label: '기타', legacy: false },
]

/** 방위는 자동 판정이 불가하다(건물 폴리곤 대비 도로 위치가 필요) — 사람이 1클릭으로 지정 */
const BEARINGS = ['북', '동', '남', '서']

/** D-4′ 경로 조회 결과 미리보기 — 화면에서 항목별로 골라 반영한다(일괄 덮어쓰기 금지) */
type RoutePreview = { km: string; min: string; stationName: string; mainRoad: string | null; desc: string }

/** 트리 다른 노드로 이동 — plan-tab-view가 수신해 미저장 확인 후 select() */
export function goPlanNode(key: string) {
  window.dispatchEvent(new CustomEvent('erp:plan-select', { detail: key }))
}

export function PlanForm13({
  customerId, canManage, initialLocation, initialFireAccess, initialPhotos = [],
  hasMapAsset = false, autoFireStation = '', fireStationEstimated = false,
}: {
  customerId: string
  canManage: boolean
  initialLocation: LocationSection
  initialFireAccess: FireAccessSection
  initialPhotos?: PlanPhotoRow[]
  hasMapAsset?: boolean        // [지도·사진] map_location 슬롯 등록 여부 (D-1 단일 원천 판정)
  autoFireStation?: string     // 고객 정보의 관할 소방서 — 1.3이 비면 이 값이 인쇄된다 (D-3)
  fireStationEstimated?: boolean  // 그 값이 '추정'(fire_station_source='estimate')인지 (C-1)
}) {
  const router = useRouter()
  const [loc, setLoc] = useState(initialLocation)
  const [fa, setFa] = useState(initialFireAccess)
  const [photos, setPhotos] = useState<PlanPhotoRow[]>(initialPhotos)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  useUnsavedWarning(dirty) // §11-4 이탈 경고

  // D-2: 주변 현황 자동 초안 — 자동차 도로(대로·로) 기준 도로명으로 뼈대 문장을 만든다
  const [bearing, setBearing] = useState('')
  const [suggested, setSuggested] = useState(false)   // 초안 상태 = 보라 링(미확정 표시)
  const [suggestMsg, setSuggestMsg] = useState('')
  const [suggesting, setSuggesting] = useState(false)

  function patchLoc(p: Partial<LocationSection>) { setLoc(v => ({ ...v, ...p })); setDirty(true) }
  function patchFa(p: Partial<FireAccessSection>) { setFa(v => ({ ...v, ...p })); setDirty(true) }
  function patchPhoto(i: number, p: Partial<PlanPhotoRow>) {
    setPhotos(rows => rows.map((r, j) => (j === i ? { ...r, ...p } : r))); setDirty(true)
  }

  async function suggestSurroundings() {
    if (loc.surroundings.trim() && !window.confirm('이미 입력된 주변 현황을 초안으로 바꿀까요?')) return
    setSuggesting(true)
    setSuggestMsg('')
    const r = await suggestSurroundingsAction(customerId, bearing || undefined)
    setSuggesting(false)
    if (!r.draft) { setSuggestMsg(r.error ?? '초안을 만들지 못했습니다.'); return }
    patchLoc({ surroundings: r.draft })
    setSuggested(true)
    const via = r.source === 'geocode' ? '지오코딩' : '저장된 주소'
    setSuggestMsg(r.tier === 'gil'
      ? `${r.road}은 이면도로입니다${r.mainRoad ? ` (자동차 도로: ${r.mainRoad})` : ''} — 빈칸(__)을 채워 저장하세요 · ${via}`
      : `${r.road} 기준 초안입니다 — 빈칸(__)을 채워 저장하세요 · ${via}`)
  }

  // D-4′(§9): 관할 소방서 → 건물 경로 조회. 조회 결과는 캐시되고, 반영은 **항목별로 사용자가 고른다**
  const [route, setRoute] = useState<RoutePreview | null>(null)
  const [routeBusy, setRouteBusy] = useState<'' | 'fetch' | 'image'>('')
  const [routeMsg, setRouteMsg] = useState('')

  async function fetchRoute(refresh = false) {
    setRouteBusy('fetch')
    setRouteMsg('')
    const r = await getFireRouteAction(customerId, { refresh })
    setRouteBusy('')
    if (r.unavailable) {
      setRouteMsg('경로 API가 준비되지 않았습니다 (NCP Directions 미활성 또는 키 없음) — 거리·도착예상은 직접 입력해주세요.')
      return
    }
    if (r.error || !r.meta) { setRouteMsg(`❌ ${r.error ?? '경로를 가져오지 못했습니다.'}`); return }
    setRoute({
      km: (r.meta.distanceM / 1000).toFixed(1),
      min: String(Math.max(1, Math.round(r.meta.durationMs / 60000))),
      stationName: r.meta.stationName,
      mainRoad: r.meta.mainRoad,
      desc: r.meta.routeDesc,
    })
    setRouteMsg(r.cacheFailed
      ? '⚠ 경로는 가져왔지만 저장에 실패했습니다 — 다음에도 다시 조회합니다.'
      : r.cached ? '저장된 경로입니다 — [다시 가져오기]로 갱신할 수 있습니다.' : '경로를 가져왔습니다.')
  }

  async function applyRouteImage() {
    if (fa.routeImage && !window.confirm('이미 등록된 진입 경로도를 새 초안으로 바꿀까요?')) return
    setRouteBusy('image')
    setRouteMsg('')
    const r = await generateRouteImageAction(customerId)
    setRouteBusy('')
    if (r.unavailable) { setRouteMsg('경로 API가 준비되지 않아 경로도를 만들 수 없습니다 — 직접 업로드해주세요.'); return }
    if (r.error || !r.path) { setRouteMsg(`❌ ${r.error ?? '경로도 생성 실패'}`); return }
    if (fa.routeImage) await deletePlanAssetAction(customerId, fa.routeImage)
    patchFa({ routeImage: r.path })
    setRouteMsg('경로도 초안을 넣었습니다 — 진입 지점·정문·장애물은 직접 표시해 교체하세요. [서식 1.3 저장]을 눌러야 확정됩니다.')
  }

  /** D-1 레거시 정리 — 서식에 저장돼 있던 옛 위치도 제거([지도·사진] 슬롯으로 일원화) */
  function removeLegacyMap() {
    if (!loc.mapImage) return
    if (!window.confirm('서식에 저장된 옛 위치도를 삭제할까요? ([지도·사진]의 위치도는 그대로 유지됩니다)')) return
    const path = loc.mapImage
    startTransition(async () => {
      await deletePlanAssetAction(customerId, path)
      patchLoc({ mapImage: null })
    })
  }

  function save() {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, {
        location: loc, fireAccess: fa,
        photos: photos.filter(p => p.path).map(p => ({ path: p.path, kind: p.kind || 'etc', caption: p.caption })),
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.3 저장됨')
      router.refresh()
    })
  }

  const inputCls = 'h-8 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]'
  const taCls = 'w-full rounded-lg border border-[#d0ccf5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#7b68ee] resize-y'
  return (
    <div className="space-y-4">
      {/* 위치·운영현황 (2.1+2.2) */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
        <p className="text-xs font-semibold text-[#514b81]">건축물 위치·운영현황</p>
        {/* D-1: 위치도는 [지도·사진]이 단일 원천 — 여기서는 상태만 보여주고 업로드하지 않는다(중복 입력 제거) */}
        <div className="rounded-lg border border-[#eceafd] bg-white p-2.5">
          <p className="text-[11px] font-medium text-[#514b81]">위치도 (지도 이미지)</p>
          <p className="text-[11px] text-[#7d78a8] mt-0.5">
            {hasMapAsset
              ? '✅ [지도·사진]에 등록됨 — 생성 문서에는 이 이미지가 인쇄됩니다.'
              : '⚠ 미등록 — [지도·사진]에서 주소 기반 자동 생성·붙여넣기로 한 번만 등록하세요.'}
          </p>
          <button type="button" onClick={() => goPlanNode('assets')} data-testid="form13-goto-assets"
            className="mt-1.5 inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
            지도·사진 열기 →
          </button>
          {loc.mapImage && (
            <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
              이 서식에 저장된 옛 위치도가 있습니다 — {hasMapAsset
                ? '문서에는 [지도·사진]의 위치도만 인쇄됩니다(중복 방지).'
                : '[지도·사진]이 비어 있어 문서에는 이 이미지가 인쇄됩니다.'}
              {canManage && (
                <button type="button" onClick={removeLegacyMap} className="ml-1 underline hover:text-red-600">삭제</button>
              )}
            </p>
          )}
        </div>
        {/* D-2: 자동차 도로 기반 초안 — 도로명은 자동, 차로수·인접 건물은 사람이 채운다 */}
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <label className="text-[11px] font-medium text-[#514b81]">주변 현황</label>
            <span className="text-[11px] text-[#b0acd6]">소방차 진입·연소 확대 판단 근거</span>
            {canManage && (
              <>
                <span className="text-[11px] text-[#b0acd6] ml-1">방위</span>
                {BEARINGS.map(b => (
                  <button key={b} type="button" onClick={() => setBearing(v => (v === b ? '' : b))}
                    className={`h-6 px-1.5 rounded-md border text-[11px] ${bearing === b
                      ? 'border-[#7b68ee] bg-[#7b68ee] text-white'
                      : 'border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff]'}`}>{b}</button>
                ))}
                <button type="button" onClick={suggestSurroundings} disabled={suggesting} data-testid="form13-suggest-surroundings"
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
                  {suggesting ? <Loader2 className="size-3 animate-spin" /> : '✨'} 자동 문장 만들기
                </button>
              </>
            )}
          </div>
          <textarea value={loc.surroundings} data-testid="form13-surroundings"
            onChange={e => { patchLoc({ surroundings: e.target.value }); setSuggested(false) }} disabled={!canManage}
            rows={2} placeholder="예: 북측 마유산로에 접함(왕복 2차로). 동측 5층 근린생활시설, 서측 공지 인접."
            className={`${taCls} ${suggested ? 'ring-2 ring-[#a78bfa]' : ''}`} />
          {suggestMsg && <p className="text-[11px] text-[#7d78a8] mt-0.5">{suggestMsg}</p>}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-[11px] font-medium text-[#514b81] block mb-1">관할 소방서</label>
            <input value={loc.fireStation} onChange={e => patchLoc({ fireStation: e.target.value })} disabled={!canManage}
              placeholder={autoFireStation ? `자동: ${autoFireStation}` : ''} className={`${inputCls} w-36`} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#514b81] block mb-1">거리</label>
            <NumField value={loc.distance} onChange={distance => patchLoc({ distance })} disabled={!canManage} decimal unit="km" className={`${inputCls} w-20`} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#514b81] block mb-1">도착 예상</label>
            <NumField value={loc.eta} onChange={eta => patchLoc({ eta })} disabled={!canManage} unit="분" className={`${inputCls} w-16`} />
          </div>
        </div>
        {/* D-3: 관할 소방서는 주소 저장 시 고객 정보에 자동 지정된다 — 여기서 또 쓰지 않아도 인쇄된다 */}
        {autoFireStation && !loc.fireStation.trim() && (
          <p className="text-[11px] text-[#7d78a8]">
            비워두면 고객 정보의 관할 소방서(<strong>{autoFireStation}</strong>)가 인쇄됩니다 — 다르면 여기에 직접 입력하세요.
          </p>
        )}
        {/* C-1: 마지막 폴백은 '시/군명+소방서' 규칙 추정이라 틀릴 수 있다.
            BLK-2(독립검증): 표시 조건을 `!loc.fireStation.trim()`으로 뒀더니, page.tsx가 1.3 미저장 고객의
            fireStation을 **고객 값으로 프리필**해서 조건이 항상 false → 배지가 한 번도 뜨지 않았다.
            그래서 '1.3 값이 비었거나, 채워진 값이 그 추정값 그대로일 때'로 바꾼다(사용자가 다른 값을 넣었으면 숨김). */}
        {fireStationEstimated && (!loc.fireStation.trim() || loc.fireStation.trim() === autoFireStation.trim()) && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1"
            data-testid="form13-station-estimated">
            ⚠ <strong>{autoFireStation}</strong>은 주소에서 <strong>추정</strong>한 값입니다 — 관할이 맞는지 확인하고, 다르면 위 칸에 직접 입력하세요.
          </p>
        )}
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">운영 개요</label>
          <textarea value={loc.operation} onChange={e => patchLoc({ operation: e.target.value })} disabled={!canManage}
            rows={2} placeholder="건물 운영 개요 (용도·운영시간 등)" className={taCls} />
        </div>
      </div>

      {/* 소방차 진입 (2.3+2.4) */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
        <p className="text-xs font-semibold text-[#514b81]">소방차 세부진입 계획</p>
        {/* D-4′(§9) — 관할 소방서에서의 실제 주행 경로. 조회 1회로 거리·도착예상·서술·경로도를 채운다 */}
        {canManage && (
          <div className="rounded-lg border border-[#eceafd] bg-white p-2.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => fetchRoute(false)} disabled={routeBusy !== ''}
                data-testid="form13-fetch-route"
                className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
                {routeBusy === 'fetch' ? <Loader2 className="size-3 animate-spin" /> : '🚒'} 소방서에서 경로 가져오기
              </button>
              {route && (
                <button type="button" onClick={() => fetchRoute(true)} disabled={routeBusy !== ''}
                  className="h-7 px-2 rounded-lg border border-[#e0ddf5] text-[11px] text-[#b0acd6] hover:text-[#7b68ee] disabled:opacity-50">
                  다시 가져오기
                </button>
              )}
              {autoFireStation && <span className="text-[11px] text-[#b0acd6]">관할: {autoFireStation}</span>}
            </div>
            {route && (
              <div className="rounded-lg bg-[#fafaff] border border-[#eceafd] p-2 space-y-1.5">
                <p className="text-[11px] text-[#514b81]">
                  <strong>{route.km}km · {route.min}분</strong>
                  <span className="text-[#b0acd6]"> ⓘ {route.stationName || '관할 소방서'}(본서)에서 일반 차량 기준</span>
                </p>
                {route.mainRoad && <p className="text-[11px] text-[#7d78a8]">진입 도로: {route.mainRoad}</p>}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* §9-6: 기존 값이 있으면 확인 후 교체 — 조용히 덮어쓰지 않는다(독립검증 지적) */}
                  <button type="button" data-testid="form13-apply-distance"
                    onClick={() => {
                      const filled = loc.distance.trim() || loc.eta.trim()
                      if (filled && !window.confirm('이미 입력된 거리·도착예상을 조회 값으로 바꿀까요?')) return
                      patchLoc({ distance: route.km, eta: route.min }); setRouteMsg('거리·도착예상을 채웠습니다.')
                    }}
                    className="h-6 px-2 rounded-md border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">거리·시간 채우기</button>
                  <button type="button"
                    onClick={() => {
                      if (fa.routeDesc.trim() && !window.confirm('이미 입력된 진입경로 서술을 초안으로 바꿀까요?')) return
                      patchFa({ routeDesc: route.desc }); setRouteMsg('진입경로 서술 초안을 넣었습니다 — 현장 표현으로 다듬어주세요.')
                    }}
                    className="h-6 px-2 rounded-md border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">서술 초안 넣기</button>
                  <button type="button" onClick={applyRouteImage} disabled={routeBusy !== ''}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
                    {routeBusy === 'image' ? <Loader2 className="size-3 animate-spin" /> : null} 경로도 초안 만들기
                  </button>
                </div>
              </div>
            )}
            {routeMsg && <p data-testid="form13-route-msg" className="text-[11px] text-[#7d78a8]">{routeMsg}</p>}
          </div>
        )}
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">진입경로 서술</label>
          <textarea value={fa.routeDesc} onChange={e => patchFa({ routeDesc: e.target.value })} disabled={!canManage}
            rows={2} placeholder="예: ○○로에서 정문 방면 진입 후 우측 주차장" className={taCls} />
        </div>
        <ImageSlot customerId={customerId} canManage={canManage} path={fa.routeImage}
          onChange={p => patchFa({ routeImage: p })} label="진입 경로도 (이미지)" />
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">진입 장소</label>
          <input value={fa.entryPoint} onChange={e => patchFa({ entryPoint: e.target.value })} disabled={!canManage}
            placeholder="예: 정문 앞 도로, 후문 주차장" className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">주변 소방시설 현황</label>
          <textarea value={fa.nearbyFacilities} onChange={e => patchFa({ nearbyFacilities: e.target.value })} disabled={!canManage}
            rows={2} placeholder="예: 정문 앞 지상식 소화전 1개소" className={taCls} />
        </div>
      </div>

      {/* 생성 문서 삽입 사진 (§8-1k — 종전 생성 모달의 사진 입력 이관) */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
        <p className="text-xs font-semibold text-[#514b81]">생성 문서 삽입 사진 <span className="font-normal text-[#b0acd6]">(그 밖의 참고 사진 — PDF·HWP 생성 시 본문에 삽입)</span></p>
        <p className="text-[11px] text-[#7d78a8]">
          표지 건물 사진·위치도·피난안내도는 여기가 아니라{' '}
          <button type="button" onClick={() => goPlanNode('assets')} className="underline text-[#7b68ee]">[지도·사진]</button>
          에서 관리합니다 — 같은 용도는 <strong>1장만 인쇄</strong>되며, 슬롯에 등록돼 있으면 여기 사진은 인쇄되지 않습니다.
        </p>
        {photos.map((p, i) => {
          const legacyKind = PHOTO_KIND_OPTIONS.find(o => o.value === p.kind && o.legacy)
          return (
          <div key={i} className="flex items-start gap-2 flex-wrap rounded-lg border border-[#eceafd] bg-white p-2">
            <select value={p.kind} disabled={!canManage} data-testid="form13-photo-kind"
              onChange={e => patchPhoto(i, { kind: e.target.value })} className={`${inputCls} w-32`}>
              {/* 신규 선택지는 '기타'만 — 기존 값은 표시·보존을 위해 자기 항목만 남긴다 (D-5) */}
              {PHOTO_KIND_OPTIONS.filter(o => !o.legacy || o.value === p.kind)
                .map(o => <option key={o.value} value={o.value}>{o.legacy ? `${o.label} (구)` : o.label}</option>)}
            </select>
            <input value={p.caption} disabled={!canManage} onChange={e => patchPhoto(i, { caption: e.target.value })}
              placeholder="사진 설명(캡션)" className={`${inputCls} w-52`} />
            <div className="flex-1 min-w-48">
              <ImageSlot customerId={customerId} canManage={canManage} path={p.path}
                onChange={path => patchPhoto(i, { path })} label={`사진 ${i + 1}`} />
            </div>
            {canManage && (
              <button onClick={() => { setPhotos(rows => rows.filter((_, j) => j !== i)); setDirty(true) }}
                data-testid="form13-photo-remove"
                className="text-[#b0acd6] hover:text-red-500 text-xs px-1 mt-1">✕</button>
            )}
            {legacyKind && (
              <p className="w-full text-[11px] text-amber-700">
                ⚠ ‘{legacyKind.label}’은 [지도·사진]과 중복되는 구 종류입니다 — 슬롯에 등록돼 있으면 <strong>이 사진은 인쇄되지 않습니다</strong>. 계속 넣으려면 종류를 ‘기타’로 바꾸세요.
              </p>
            )}
          </div>
          )
        })}
        {canManage && (
          <button onClick={() => { setPhotos(rows => [...rows, { path: null, kind: 'etc', caption: '' }]); setDirty(true) }}
            className="text-[11px] text-[#7b68ee] hover:underline">+ 사진 추가</button>
        )}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.3 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
