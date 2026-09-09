'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, Save, ImagePlus, Trash2, ClipboardPaste, Download, MoveUpRight, X, ImageIcon,
} from 'lucide-react'
import {
  saveFirePlanSectionsAction, uploadPlanAssetAction, deletePlanAssetAction, getPlanAssetUrlAction,
  suggestSurroundingsAction,
} from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { getFireRouteAction, generateRouteImageAction } from '@/app/(dashboard)/customers/fire-route-actions'
import { NumField, useUnsavedWarning } from '@/components/ui/fields'
import { prepareImageFile } from '@/lib/image-prep'
import { readClipboardImage, CLIPBOARD_EMPTY_MSG } from '@/lib/clipboard-image'
import { ImageAnnotator, parseAnnots, type AnnotDoc } from '@/components/customers/image-annotator'

/** 서식 1.3 건축물 위치·운영현황 및 소방차 세부진입 계획 — 섹션 카드 2개 (소방계획서_4.md §3)
 *  sections.location(위치도·주변 현황·관할 소방서·거리·도착예상·운영 개요) + sections.fireAccess(진입경로·경로도·진입장소·주변 소방시설) */

export type LocationSection = { mapImage: string | null; surroundings: string; fireStation: string; distance: string; eta: string; operation: string }
/** routeImageBase·routeAnnots는 화살표 편집의 되돌림 재료다(2026-09-08) — 인쇄는 종전대로 routeImage만 본다.
 *  둘 다 선택 항목이라 기존 저장분(없음)도 그대로 열린다. */
export type FireAccessSection = {
  routeDesc: string; routeImage: string | null; entryPoint: string; nearbyFacilities: string
  routeImageBase?: string | null; routeAnnots?: string | null
}

/** 화살표 편집을 지원하는 슬롯이 부모와 주고받는 짝 — 넘기지 않으면 종전대로 단순 업로드 슬롯이다 */
export type AnnotBinding = {
  basePath: string | null
  annots: string | null
  onChange: (v: { basePath: string | null; annots: string | null }) => void
}

/** 라벨 → 파일명. 끝의 괄호(‘(이미지)’)는 화면 안내지 이름이 아니라 떼고, 파일명 금지 문자를 걷어낸다 */
const safeName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'image'

/** 서식 첨부 이미지 슬롯 — 업로드·붙여넣기·드래그&드롭·화살표·다운로드·삭제 (1.3 경로도·삽입 사진, 1.5 평면도 공용).
 *
 *  2026-09-08: [지도·사진] 슬롯(customer-assets-client)에만 있던 편의를 여기로 맞췄다.
 *  종전엔 같은 '이미지 넣는 칸'인데 슬롯에선 캡처 붙여넣기가 되고 여기선 안 돼, 사용자가
 *  칸마다 다른 방법을 외워야 했다. 업로드 전 EXIF 회전 보정·리사이즈(prepareImageFile)도 함께 붙는다. */
export function ImageSlot({ customerId, canManage, path, onChange, label, annot, testId }: {
  customerId: string
  canManage: boolean
  path: string | null
  onChange: (path: string | null) => void
  label: string
  annot?: AnnotBinding   // 주면 [화살표] 버튼이 붙고, 원본·주석을 부모 상태에 함께 보관해 재편집이 된다
  testId?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const [annotOpen, setAnnotOpen] = useState(false)

  useEffect(() => {
    if (!path) return
    let alive = true
    getPlanAssetUrlAction(customerId, path).then(r => { if (alive && r.url) setSigned({ path, url: r.url }) })
    return () => { alive = false }
  }, [customerId, path])
  const url = path && signed?.path === path ? signed.url : null

  // 라이트박스 Esc 닫기 ([지도·사진] 슬롯과 같은 규약)
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  /** 지금 슬롯이 붙들고 있는 스토리지 파일 전부 — 합성본과 배경 원본은 별개 파일이라 짝으로 지운다 */
  async function purgeCurrent() {
    const targets = [path, annot?.basePath].filter((p): p is string => !!p)
    for (const p of [...new Set(targets)]) await deletePlanAssetAction(customerId, p)
  }

  async function upload(raw: File) {
    setBusy(true)
    setMsg(null)
    const file = await prepareImageFile(raw)
    const fd = new FormData()
    fd.set('file', file)
    const res = await uploadPlanAssetAction(customerId, fd)
    if (res.error || !res.path) { setBusy(false); setMsg({ text: res.error ?? '업로드 실패', ok: false }); return }
    await purgeCurrent()
    setBusy(false)
    onChange(res.path)
    // 새 그림에 옛 화살표 좌표를 물려주면 엉뚱한 곳을 가리킨다 — 주석은 함께 비운다
    annot?.onChange({ basePath: null, annots: null })
    setMsg({ text: '등록됨', ok: true })
  }

  function paste() {
    setMsg(null)
    void (async () => {
      const f = await readClipboardImage()
      if (!f) { setMsg({ text: CLIPBOARD_EMPTY_MSG, ok: false }); return }
      await upload(f)
    })()
  }

  async function remove() {
    if (!path) return
    setBusy(true)
    await purgeCurrent()
    setBusy(false)
    onChange(null)
    annot?.onChange({ basePath: null, annots: null })
    setMsg(null)
  }

  /** 저장 이름은 칸 이름 그대로 — '1757…png'로 떨어지면 사진 여러 장을 받았을 때 뭐가 뭔지 알 수 없다.
   *
   *  두 경로를 쓴다. 서명 URL을 앵커에 그대로 물리면 교차 출처라 download 속성이 무시되고,
   *  서명 URL의 ?download= 이름은 storage-js가 퍼센트 인코딩해 보내 한글이 '%EC%A7%84…'으로
   *  떨어진다(2026-09-08 실측). 그래서 ① 바이트를 받아 동일 출처 blob으로 만들어 내려받고
   *  ② 그게 막히면(버킷 CORS) 서명 URL에 맡긴다 — 이름은 깨져도 저장은 된다. */
  async function download() {
    if (!path) return
    setMsg(null)
    const ext = (path.split('.').pop() ?? 'png').toLowerCase()
    const name = `${safeName(label)}.${ext}`
    const r = await getPlanAssetUrlAction(customerId, path, { download: name })
    if (!r.url) { setMsg({ text: r.error ?? '다운로드 주소를 만들지 못했습니다.', ok: false }); return }
    const click = (href: string) => {
      const a = document.createElement('a')
      a.href = href
      a.download = name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    try {
      const res = await fetch(r.url)
      if (!res.ok) throw new Error(String(res.status))
      const obj = URL.createObjectURL(await res.blob())
      click(obj)
      setTimeout(() => URL.revokeObjectURL(obj), 30_000)
    } catch {
      click(r.url)
    }
  }

  /** 편집기가 만들어 온 합성 이미지를 올리고, 원본·주석을 부모에 남긴다 */
  async function saveAnnot(file: File, doc: AnnotDoc) {
    if (!annot || !path) return
    setBusy(true)
    setMsg(null)
    const fd = new FormData()
    fd.set('file', file)
    const res = await uploadPlanAssetAction(customerId, fd)
    if (res.error || !res.path) { setBusy(false); setMsg({ text: res.error ?? '업로드 실패', ok: false }); return }
    // 첫 편집이면 지금 보이던 그림이 곧 원본이 된다 — 지우지 않고 배경으로 남긴다.
    // 재편집이면 직전 합성본만 버린다(원본은 계속 배경으로 쓰인다).
    const base = annot.basePath ?? path
    if (annot.basePath && path !== annot.basePath) await deletePlanAssetAction(customerId, path)
    setBusy(false)
    onChange(res.path)
    annot.onChange({ basePath: base, annots: JSON.stringify(doc) })
    setAnnotOpen(false)
    setMsg({ text: '화살표를 넣었습니다 — 아래 [저장]을 눌러야 확정됩니다', ok: true })
  }

  const dropProps = canManage ? {
    tabIndex: 0,
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(true) },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDragOver(false)
      const f = e.dataTransfer.files?.[0]
      if (f) void upload(f)
    },
    onPaste: (e: React.ClipboardEvent) => {
      const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
      const f = item?.getAsFile()
      if (f) { e.preventDefault(); void upload(f) }
    },
  } : {}

  const btn = 'inline-flex items-center gap-1 h-form-7 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint transition-colors disabled:opacity-50'

  return (
    <div {...dropProps} data-testid={testId}
      className={dragOver ? 'rounded-lg border border-dashed border-brand bg-brand-tint p-1.5 -m-1.5' : undefined}>
      <p className="text-form-xs font-medium text-ink-sub mb-1">{label}</p>
      {url ? (
        <button type="button" onClick={() => setLightbox(true)} title="클릭하면 크게 봅니다" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} data-testid={testId ? `${testId}-thumb` : undefined}
            className="max-h-40 rounded-lg border border-brand-line-soft cursor-zoom-in hover:opacity-90 transition-opacity" />
        </button>
      ) : path ? (
        <p className="text-form-xs text-ink-meta">미리보기 로딩…</p>
      ) : (
        <div className="flex h-20 w-full max-w-64 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-brand-line text-ink-meta">
          <ImageIcon className="size-4" />
          <span className="text-form-2xs">{canManage ? '미등록 — 끌어다 놓기·캡처 후 붙여넣기(Ctrl+V) 가능' : '이미지 없음'}</span>
        </div>
      )}
      {canManage && (
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            data-testid={testId ? `${testId}-input` : undefined}
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className={btn}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <ImagePlus className="size-3" />} {path ? '교체' : '업로드'}
          </button>
          <button onClick={paste} disabled={busy} className={btn}
            data-testid={testId ? `${testId}-paste` : undefined}
            title="지도·화면을 캡처(Win+Shift+S)한 뒤 클릭하면 클립보드 이미지가 등록됩니다">
            <ClipboardPaste className="size-3" /> 붙여넣기
          </button>
          {path && annot && (
            <button onClick={() => setAnnotOpen(true)} disabled={busy} className={btn}
              data-testid={testId ? `${testId}-annotate` : undefined}
              title="이미지 위에 진입 방향 화살표·글자·번호를 얹습니다 (원본은 보존되어 다시 고칠 수 있습니다)">
              <MoveUpRight className="size-3" /> {annot.annots ? '화살표 고치기' : '화살표 넣기'}
            </button>
          )}
          {path && (
            <button onClick={() => { void download() }} disabled={busy} className={btn}
              data-testid={testId ? `${testId}-download` : undefined} title="이 이미지를 파일로 내려받습니다">
              <Download className="size-3" /> 다운로드
            </button>
          )}
          {path && (
            <button onClick={() => { void remove() }} disabled={busy}
              data-testid={testId ? `${testId}-delete` : undefined}
              className="inline-flex items-center gap-1 h-form-7 px-2 rounded-lg border border-red-200 text-form-xs text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
              <Trash2 className="size-3" /> 삭제
            </button>
          )}
        </div>
      )}
      {msg && <p className={`text-form-xs mt-0.5 ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.ok ? '✅' : '❌'} {msg.text}</p>}

      {lightbox && url && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(false)} role="dialog" aria-modal="true" aria-label={`${label} 미리보기`}>
          <div className="flex w-full max-w-4xl items-center justify-between px-1 pb-2">
            <span className="text-form-base font-medium text-white">{label}</span>
            <button onClick={() => setLightbox(false)} aria-label="닫기"
              className="inline-flex size-8 items-center justify-center rounded-lg text-white/80 hover:bg-surface/10 hover:text-white">
              <X className="size-5" />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} onClick={e => e.stopPropagation()}
            className="max-h-[85vh] max-w-4xl rounded-lg object-contain shadow-2xl" />
          <p className="mt-2 text-form-xs text-white/60">빈 곳·✕·Esc 로 닫기</p>
        </div>
      )}

      {annotOpen && annot && path && (
        <ImageAnnotator customerId={customerId} basePath={annot.basePath ?? path} label={label}
          initial={parseAnnots(annot.annots)} saving={busy}
          onClose={() => setAnnotOpen(false)} onSave={(f, d) => { void saveAnnot(f, d) }} />
      )}
    </div>
  )
}

/** 생성 문서 삽입 사진 (§8-1k — 생성 모달 폐지에 따라 1.3으로 이관)
 *  D-5(소방계획서_11): 건물 전경·위치도·피난경로도는 [지도·사진] 슬롯과 중복 입력 경로였다.
 *  신규 추가는 '기타'만 허용하고, 기존에 그 종류로 저장된 사진은 그대로 인쇄한다(하위호환). */
export type PlanPhotoRow = {
  path: string | null; kind: string; caption: string
  /** 화살표 편집의 되돌림 재료 — 인쇄는 path만 본다 (2026-09-08) */
  basePath?: string | null; annots?: string | null
}
const PHOTO_KIND_OPTIONS = [
  { value: 'building', label: '건물 전경', legacy: true },
  { value: 'map', label: '위치도(지도)', legacy: true },
  { value: 'evacuation', label: '피난경로도', legacy: true },
  { value: 'etc', label: '기타', legacy: false },
]

/** 방위는 자동 판정이 불가하다(건물 폴리곤 대비 도로 위치가 필요) — 사람이 1클릭으로 지정 */
const BEARINGS = ['북', '동', '남', '서']

/** D-4′ 경로 조회 결과 미리보기 — 화면에서 항목별로 골라 반영한다(일괄 덮어쓰기 금지) */
type RoutePreview = {
  km: string; min: string; stationName: string; mainRoad: string | null; desc: string
  station: string          // 이 결과가 어느 소방서(1.3 선택 라벨) 기준인지 — 낡은 값 판정에 쓴다 (A-5)
  centerFallback: boolean  // 119안전센터를 골랐지만 본서 좌표로 계산됨
}

/** 트리 다른 노드로 이동 — plan-tab-view가 수신해 미저장 확인 후 select() */
export function goPlanNode(key: string) {
  window.dispatchEvent(new CustomEvent('erp:plan-select', { detail: key }))
}

export function PlanForm13({
  customerId, canManage, initialLocation, initialFireAccess, initialPhotos = [], assetsSlot,
  hasMapAsset = false, autoFireStation = '', fireStationEstimated = false, stationCandidates = [],
}: {
  customerId: string
  canManage: boolean
  initialLocation: LocationSection
  initialFireAccess: FireAccessSection
  initialPhotos?: PlanPhotoRow[]
  assetsSlot?: ReactNode       // [지도·사진] 슬롯 UI (CustomerAssetsClient) — 2026-08-08 전용 노드 폐지로 여기에 삽입
  hasMapAsset?: boolean        // [지도·사진] map_location 슬롯 등록 여부 (D-1 단일 원천 판정)
  autoFireStation?: string     // 고객 정보의 관할 소방서 — 1.3이 비면 이 값이 인쇄된다 (D-3)
  fireStationEstimated?: boolean  // 그 값이 '추정'(fire_station_source='estimate')인지 (C-1)
  stationCandidates?: string[] // 행정구역 매핑 드롭다운 후보 — 같은 시/군 → 같은 시/도 순 (listFireStationCandidates)
}) {
  const router = useRouter()
  const [loc, setLoc] = useState(initialLocation)
  const [fa, setFa] = useState(initialFireAccess)
  const [photos, setPhotos] = useState<PlanPhotoRow[]>(initialPhotos)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]

  // D-2: 주변 현황 자동 초안 — 자동차 도로(대로·로) 기준 도로명으로 뼈대 문장을 만든다
  const [bearing, setBearing] = useState('')
  const [suggested, setSuggested] = useState(false)   // 초안 상태 = 보라 링(미확정 표시)
  const [suggestMsg, setSuggestMsg] = useState('')
  const [suggesting, setSuggesting] = useState(false)

  // 관할 소방서 드롭다운 — 관할은 행정구역 기준이라 좌표 근접이 아닌 매핑 후보를 쓴다.
  // 목록에 없는 값(수동 입력·구 명칭)이 저장돼 있으면 직접 입력 모드로 시작한다.
  const stationOptions = [...new Set([autoFireStation, ...stationCandidates].map(st => st.trim()).filter(Boolean))]
  const [stationCustom, setStationCustom] = useState(() => {
    const v = initialLocation.fireStation.trim()
    return !!v && !stationOptions.includes(v)
  })

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

  // D-4′(§9): 관할 소방서 → 건물 경로 조회. 소방서 선택 시 자동, [경로 다시 계산]으로 재조회(A-2).
  // C-1(2026-08-08): 종전엔 '자동 조회'와 '수동 [경로 가져오기]'가 별도 함수·별도 메시지·별도 반영 버튼이라
  // 같은 값을 같은 칸에 넣는 경로가 둘이었다 — 규약·상태를 하나로 합쳐 [거리·시간 채우기]를 폐기했다.
  const [route, setRoute] = useState<RoutePreview | null>(null)
  const [routeBusy, setRouteBusy] = useState<'' | 'fetch' | 'image'>('')
  const [routeMsg, setRouteMsg] = useState('')
  // 기존 입력과 다를 때의 교체 제안 — 조용히 덮어쓰지 않는다(§9-6 규약)
  const [pending, setPending] = useState<RoutePreview | null>(null)
  // 하단 카드(서술·경로도 초안)의 안내 — 상단 조회 안내(routeMsg)와 소관이 달라 분리한다
  const [draftMsg, setDraftMsg] = useState('')

  /** 경로 출발지 — 1.3에서 고른 값이 우선, 비었으면 고객 정보의 자동 지정값(인쇄 규약과 동일) */
  const effectiveStation = loc.fireStation.trim() || autoFireStation.trim()
  // 조회는 왕복 수 초가 걸린다 — 그 사이 사용자가 거리·도착예상을 입력하면 응답 시점의 판정이
  // 옛 값 기준이 되어 "이미 값이 있는데 덮어씀"이 난다. 응답 처리에서만 최신 값을 읽는다.
  const locRef = useRef(loc)
  useEffect(() => { locRef.current = loc })

  function toPreview(meta: NonNullable<Awaited<ReturnType<typeof getFireRouteAction>>['meta']>, centerFallback: boolean): RoutePreview {
    return {
      km: (meta.distanceM / 1000).toFixed(1),
      min: String(Math.max(1, Math.round(meta.durationMs / 60000))),
      stationName: meta.stationName,
      mainRoad: meta.mainRoad,
      desc: meta.routeDesc,
      station: meta.station ?? meta.stationName,
      centerFallback,
    }
  }
  const centerNote = (p: RoutePreview) =>
    p.centerFallback ? ` (센터 좌표가 없어 ${p.stationName} 기준)` : ''

  /** A-2 — 경로 조회 단일 진입점. 소방서 확정(자동)·[경로 다시 계산](수동)이 같은 규약을 쓴다.
   *  station은 방금 고른 값(state 반영 전이라 인자로 받는다). 빈 문자열이면 고객 자동값으로 폴백. */
  async function runRoute(opts?: { station?: string; refresh?: boolean }) {
    const station = ((opts?.station ?? loc.fireStation).trim() || autoFireStation.trim())
    setPending(null)
    setRouteMsg('')
    if (!station) { setRouteMsg('관할 소방서를 먼저 선택해주세요.'); return }
    setRouteBusy('fetch')
    const r = await getFireRouteAction(customerId, { station, refresh: opts?.refresh })
    setRouteBusy('')
    if (r.unavailable) {
      setRouteMsg('경로 API가 준비되지 않았습니다 (NCP Directions 미활성 또는 키 없음) — 거리·도착예상은 직접 입력해주세요.')
      return
    }
    if (r.error || !r.meta) { setRouteMsg(`❌ ${r.error ?? '경로를 가져오지 못했습니다.'}`); return }
    const p = toPreview(r.meta, !!r.centerFallback)
    setRoute(p)   // 아래 [서술 초안]·[경로도 초안]도 같은 결과(캐시)를 쓴다 — 재조회 없음
    const { distance, eta } = locRef.current   // 조회 대기 중 사용자가 넣은 값까지 반영
    if (!distance.trim() && !eta.trim()) {
      patchLoc({ distance: p.km, eta: p.min })
      setRouteMsg(`✅ ${station} 기준 ${p.km}km · ${p.min}분을 채웠습니다${centerNote(p)}.`)
    } else if (distance.trim() !== p.km || eta.trim() !== p.min) {
      setPending(p)   // 기존 입력이 있으면 덮어쓰지 않고 제안만
    } else {
      setRouteMsg(`현재 입력값이 ${station} 기준 조회 결과와 같습니다${centerNote(p)}.`)
    }
  }

  function pickStation(next: string) {
    patchLoc({ fireStation: next })
    void runRoute({ station: next })
  }

  async function applyRouteImage() {
    if (fa.routeImage && !window.confirm('이미 등록된 진입 경로도를 새 초안으로 바꿀까요?')) return
    setRouteBusy('image')
    setDraftMsg('')
    const r = await generateRouteImageAction(customerId, { station: effectiveStation })
    setRouteBusy('')
    if (r.unavailable) { setDraftMsg('경로 API가 준비되지 않아 경로도를 만들 수 없습니다 — 직접 업로드해주세요.'); return }
    if (r.error || !r.path) { setDraftMsg(`❌ ${r.error ?? '경로도 생성 실패'}`); return }
    if (fa.routeImage) await deletePlanAssetAction(customerId, fa.routeImage)
    patchFa({ routeImage: r.path })
    setDraftMsg('경로도 초안을 넣었습니다 — 진입 지점·정문·장애물은 직접 표시해 교체하세요. [서식 1.3 저장]을 눌러야 확정됩니다.')
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

  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, {
          location: loc, fireAccess: fa,
          // basePath·annots를 여기서 빠뜨리면 저장 후 화살표를 다시 고칠 수 없게 된다(화면엔 멀쩡히 보이는 채로)
          photos: photos.filter(p => p.path).map(p => ({
            path: p.path, kind: p.kind || 'etc', caption: p.caption,
            basePath: p.basePath ?? null, annots: p.annots ?? null,
          })),
        })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 서식 1.3 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-form-8 rounded-lg border border-brand-line bg-surface px-2 text-form-sm outline-none focus:border-brand'
  const taCls = 'w-full rounded-lg border border-brand-line bg-surface px-2 py-1.5 text-form-sm outline-none focus:border-brand resize-y'
  return (
    <div className="space-y-4">
      {/* ① 관할 소방서·출동 거리 (소방계획서_13 B안) — 1.3의 기준점이라 최상단 독립 카드로 둔다.
          여기서 소방서를 정하면 거리·도착예상이 따라오고, ③의 서술·경로도 초안도 이 결과를 쓴다. */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-3">
        <p className="text-form-sm font-semibold text-ink-sub">
          관할 소방서·출동 거리
          <span className="ml-1.5 font-normal text-ink-meta">소방서를 고르면 거리·도착예상을 자동으로 계산합니다</span>
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-form-xs font-medium text-ink-sub block mb-1">관할 소방서</label>
            {stationOptions.length > 0 && !stationCustom ? (
              // A-2: 선택 즉시 경로 조회 → 거리·도착예상 자동 기입
              <select value={loc.fireStation} disabled={!canManage} data-testid="form13-station-select"
                onChange={e => { if (e.target.value === '__custom__') setStationCustom(true); else pickStation(e.target.value) }}
                className={`${inputCls} w-44`}>
                <option value="">{autoFireStation ? `(비움 — 자동 ${autoFireStation} 인쇄)` : '(선택)'}</option>
                {stationOptions.map(st => <option key={st} value={st}>{st}{st === autoFireStation ? ' (자동 지정)' : ''}</option>)}
                <option value="__custom__">직접 입력…</option>
              </select>
            ) : (
              <span className="inline-flex items-center gap-1">
                {/* 직접 입력은 타이핑마다 조회하면 API를 낭비한다 — 입력을 마친 시점(blur)에 1회 */}
                <input value={loc.fireStation} onChange={e => patchLoc({ fireStation: e.target.value })} disabled={!canManage}
                  onBlur={e => { void runRoute({ station: e.target.value }) }}
                  placeholder={autoFireStation ? `자동: ${autoFireStation}` : ''} className={`${inputCls} w-36`} />
                {stationOptions.length > 0 && canManage && (
                  <button type="button" onClick={() => setStationCustom(false)}
                    className="h-form-8 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint shrink-0">목록</button>
                )}
              </span>
            )}
          </div>
          <div>
            <label className="text-form-xs font-medium text-ink-sub block mb-1">거리</label>
            <NumField value={loc.distance} onChange={distance => patchLoc({ distance })} disabled={!canManage} decimal unit="km" className={`${inputCls} w-20`} />
          </div>
          <div>
            <label className="text-form-xs font-medium text-ink-sub block mb-1">도착 예상</label>
            <NumField value={loc.eta} onChange={eta => patchLoc({ eta })} disabled={!canManage} unit="분" className={`${inputCls} w-16`} />
          </div>
          {/* C-1: 조회 트리거는 여기 하나 — 값(거리·ETA)이 있는 자리에 근거와 재계산을 붙인다 */}
          {canManage && (
            <button type="button" onClick={() => { void runRoute({ refresh: true }) }} disabled={routeBusy !== ''}
              data-testid="form13-fetch-route"
              className="inline-flex items-center gap-1 h-form-8 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint disabled:opacity-50">
              {routeBusy === 'fetch' ? <Loader2 className="size-3 animate-spin" /> : '🚒'} 경로 다시 계산
            </button>
          )}
          {routeBusy === 'fetch' && (
            <span className="inline-flex items-center gap-1 h-form-8 text-form-xs text-ink-soft">경로 조회 중…</span>
          )}
        </div>
        {/* 조회 근거 — 거리·도착예상이 어디서 나온 값인지 바로 아래에 붙인다 */}
        {route && (
          <p className="text-form-xs text-ink-sub">
            <strong>{route.km}km · {route.min}분</strong>
            {/* stationName = 실제로 좌표를 쓴 출발지(센터 좌표가 있으면 센터명) — '(본서)' 하드코딩 금지 */}
            <span className="text-ink-meta"> ⓘ {route.stationName || '관할 소방서'}에서 일반 차량 기준</span>
            {route.mainRoad && <span className="text-ink-soft"> · 진입 도로: {route.mainRoad}</span>}
            {route.centerFallback && (
              <span className="text-amber-600"> · 선택한 119안전센터는 좌표가 없어 본서 기준입니다</span>
            )}
          </p>
        )}
        {/* A-2 — 이미 입력된 값이 있으면 덮어쓰지 않고 제안한다. A-5 — 다른 소방서 기준 값임을 표기 */}
        {pending && (
          <p data-testid="form13-route-suggest"
            className="text-form-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            ⚠ 현재 거리·도착예상({loc.distance || '—'}km · {loc.eta || '—'}분)은 <strong>{pending.station}</strong> 기준 조회 결과
            ({pending.km}km · {pending.min}분)와 다릅니다{centerNote(pending)} — 다른 소방서 기준의 값일 수 있습니다.
            {canManage && (
              <button type="button"
                onClick={() => {
                  patchLoc({ distance: pending.km, eta: pending.min })
                  setRouteMsg(`✅ ${pending.station} 기준으로 갱신했습니다.`)
                  setPending(null)
                }}
                className="ml-1.5 h-5 px-1.5 rounded-md border border-amber-400 bg-surface text-form-xs font-medium text-amber-700 hover:bg-amber-100">
                조회 값으로 적용
              </button>
            )}
          </p>
        )}
        {routeMsg && <p data-testid="form13-route-msg" className="text-form-xs text-ink-soft">{routeMsg}</p>}
        {/* D-3: 관할 소방서는 주소 저장 시 고객 정보에 자동 지정된다 — 여기서 또 쓰지 않아도 인쇄된다 */}
        {autoFireStation && !loc.fireStation.trim() && (
          <p className="text-form-xs text-ink-soft">
            비워두면 고객 정보의 관할 소방서(<strong>{autoFireStation}</strong>)가 인쇄됩니다 — 다르면 여기서 직접 고르세요.
          </p>
        )}
        {/* C-1: 마지막 폴백은 '시/군명+소방서' 규칙 추정이라 틀릴 수 있다.
            BLK-2(독립검증): 표시 조건을 `!loc.fireStation.trim()`으로 뒀더니, page.tsx가 1.3 미저장 고객의
            fireStation을 **고객 값으로 프리필**해서 조건이 항상 false → 배지가 한 번도 뜨지 않았다.
            그래서 '1.3 값이 비었거나, 채워진 값이 그 추정값 그대로일 때'로 바꾼다(사용자가 다른 값을 넣었으면 숨김). */}
        {fireStationEstimated && (!loc.fireStation.trim() || loc.fireStation.trim() === autoFireStation.trim()) && (
          <p className="text-form-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1"
            data-testid="form13-station-estimated">
            ⚠ <strong>{autoFireStation}</strong>은 주소에서 <strong>추정</strong>한 값입니다 — 관할이 맞는지 확인하고, 다르면 위 칸에서 고쳐주세요.
          </p>
        )}
      </div>

      {/* ② 건축물 위치·주변 현황 (2.1+2.2) */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-3">
        <p className="text-form-sm font-semibold text-ink-sub">건축물 위치·주변 현황</p>
        {/* 2026-08-08 사용자 확정: 트리의 [지도·사진] 노드를 폐지하고 슬롯 UI(표지·위치도·피난안내도)를 여기로 삽입했다.
            D-1이 여기를 '상태 표시 + 이동 버튼'으로 뒀던 이유(중복 입력 제거)는 그대로다 — 단일 원천이 1.3 안으로 들어왔을 뿐. */}
        {assetsSlot}
        {loc.mapImage && (
          <p className="text-form-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            이 서식에 저장된 옛 위치도가 있습니다 — {hasMapAsset
              ? '문서에는 위 [지도·사진]의 위치도만 인쇄됩니다(중복 방지).'
              : '위 [지도·사진]이 비어 있어 문서에는 이 이미지가 인쇄됩니다.'}
            {canManage && (
              <button type="button" onClick={removeLegacyMap} data-testid="form13-remove-legacy-map"
                className="ml-1 underline hover:text-red-600">삭제</button>
            )}
          </p>
        )}
        {/* D-2: 자동차 도로 기반 초안 — 도로명은 자동, 차로수·인접 건물은 사람이 채운다 */}
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <label className="text-form-xs font-medium text-ink-sub">주변 현황</label>
            <span className="text-form-xs text-ink-meta">소방차 진입·연소 확대 판단 근거</span>
            {canManage && (
              <>
                <span className="text-form-xs text-ink-meta ml-1">방위</span>
                {BEARINGS.map(b => (
                  <button key={b} type="button" onClick={() => setBearing(v => (v === b ? '' : b))}
                    className={`h-form-6 px-1.5 rounded-md border text-form-xs ${bearing === b
                      ? 'border-brand bg-brand text-white'
                      : 'border-brand-line text-brand hover:bg-brand-tint'}`}>{b}</button>
                ))}
                <button type="button" onClick={suggestSurroundings} disabled={suggesting} data-testid="form13-suggest-surroundings"
                  className="inline-flex items-center gap-1 h-form-6 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint disabled:opacity-50">
                  {suggesting ? <Loader2 className="size-3 animate-spin" /> : '✨'} 자동 문장 만들기
                </button>
              </>
            )}
          </div>
          <textarea value={loc.surroundings} data-testid="form13-surroundings"
            onChange={e => { patchLoc({ surroundings: e.target.value }); setSuggested(false) }} disabled={!canManage}
            rows={2} placeholder="예: 북측 마유산로에 접함(왕복 2차로). 동측 5층 근린생활시설, 서측 공지 인접."
            className={`${taCls} ${suggested ? 'ring-2 ring-violet-400' : ''}`} />
          {suggestMsg && <p className="text-form-xs text-ink-soft mt-0.5">{suggestMsg}</p>}
        </div>
        <div>
          <label className="text-form-xs font-medium text-ink-sub block mb-1">운영 개요</label>
          <textarea value={loc.operation} onChange={e => patchLoc({ operation: e.target.value })} disabled={!canManage}
            rows={2} placeholder="건물 운영 개요 (용도·운영시간 등)" className={taCls} />
        </div>
      </div>

      {/* ③ 소방차 진입 (2.3+2.4) */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-3">
        <p className="text-form-sm font-semibold text-ink-sub">소방차 세부진입 계획</p>
        {/* D-4′(§9) — 조회·거리·도착예상은 위 카드로 이관(C-1 중복 정리). 여기엔 이 카드의 필드를 채우는 초안 버튼만 둔다 */}
        {canManage && (
          <div className="flex items-center gap-1.5 flex-wrap rounded-lg border border-brand-tint bg-surface px-2.5 py-2">
            {route ? (
              <>
                <span className="text-form-xs text-ink-sub">{route.stationName || '관할 소방서'} 경로 {route.km}km · {route.min}분 —</span>
                {/* §9-6: 기존 값이 있으면 확인 후 교체 — 조용히 덮어쓰지 않는다(독립검증 지적) */}
                <button type="button"
                  onClick={() => {
                    if (fa.routeDesc.trim() && !window.confirm('이미 입력된 진입경로 서술을 초안으로 바꿀까요?')) return
                    patchFa({ routeDesc: route.desc }); setDraftMsg('진입경로 서술 초안을 넣었습니다 — 현장 표현으로 다듬어주세요.')
                  }}
                  className="h-form-6 px-2 rounded-md border border-brand-line text-form-xs text-brand hover:bg-brand-tint">서술 초안 넣기</button>
                <button type="button" onClick={applyRouteImage} disabled={routeBusy !== ''}
                  className="inline-flex items-center gap-1 h-form-6 px-2 rounded-md border border-brand-line text-form-xs text-brand hover:bg-brand-tint disabled:opacity-50">
                  {routeBusy === 'image' ? <Loader2 className="size-3 animate-spin" /> : null} 경로도 초안 만들기
                </button>
              </>
            ) : (
              <span className="text-form-xs text-ink-meta">
                맨 위 <strong>관할 소방서·출동 거리</strong>에서 소방서를 고르면 경로가 조회되고, 여기서 진입경로 서술·경로도 초안을 만들 수 있습니다.
              </span>
            )}
            {draftMsg && <span className="w-full text-form-xs text-ink-soft">{draftMsg}</span>}
          </div>
        )}
        <div>
          <label className="text-form-xs font-medium text-ink-sub block mb-1">진입경로 서술</label>
          <textarea value={fa.routeDesc} onChange={e => patchFa({ routeDesc: e.target.value })} disabled={!canManage}
            rows={2} placeholder="예: ○○로에서 정문 방면 진입 후 우측 주차장" className={taCls} />
        </div>
        <ImageSlot customerId={customerId} canManage={canManage} path={fa.routeImage} testId="form13-route-image"
          onChange={p => patchFa({ routeImage: p })} label="진입 경로도 (이미지)"
          annot={{
            basePath: fa.routeImageBase ?? null,
            annots: fa.routeAnnots ?? null,
            onChange: v => patchFa({ routeImageBase: v.basePath, routeAnnots: v.annots }),
          }} />
        <div>
          <label className="text-form-xs font-medium text-ink-sub block mb-1">진입 장소</label>
          <input value={fa.entryPoint} onChange={e => patchFa({ entryPoint: e.target.value })} disabled={!canManage}
            placeholder="예: 정문 앞 도로, 후문 주차장" className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="text-form-xs font-medium text-ink-sub block mb-1">주변 소방시설 현황</label>
          <textarea value={fa.nearbyFacilities} onChange={e => patchFa({ nearbyFacilities: e.target.value })} disabled={!canManage}
            rows={2} placeholder="예: 정문 앞 지상식 소화전 1개소" className={taCls} />
        </div>
      </div>

      {/* ④ 생성 문서 삽입 사진 (§8-1k — 종전 생성 모달의 사진 입력 이관) */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-3">
        <p className="text-form-sm font-semibold text-ink-sub">생성 문서 삽입 사진 <span className="font-normal text-ink-meta">(그 밖의 참고 사진 — PDF·HWP 생성 시 본문에 삽입)</span></p>
        <p className="text-form-xs text-ink-soft">
          표지 건물 사진·위치도·피난안내도는 여기가 아니라 위 <strong>[지도·사진]</strong> 칸에서 관리합니다 —
          같은 용도는 <strong>1장만 인쇄</strong>되며, 슬롯에 등록돼 있으면 여기 사진은 인쇄되지 않습니다.
        </p>
        {photos.map((p, i) => {
          const legacyKind = PHOTO_KIND_OPTIONS.find(o => o.value === p.kind && o.legacy)
          return (
          <div key={i} className="flex items-start gap-2 flex-wrap rounded-lg border border-brand-tint bg-surface p-2">
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
                onChange={path => patchPhoto(i, { path })} label={`사진 ${i + 1}`}
                annot={{
                  basePath: p.basePath ?? null,
                  annots: p.annots ?? null,
                  onChange: v => patchPhoto(i, { basePath: v.basePath, annots: v.annots }),
                }} />
            </div>
            {canManage && (
              <button onClick={() => { setPhotos(rows => rows.filter((_, j) => j !== i)); setDirty(true) }}
                data-testid="form13-photo-remove"
                className="text-ink-meta hover:text-red-500 text-form-sm px-1 mt-1">✕</button>
            )}
            {legacyKind && (
              <p className="w-full text-form-xs text-amber-700">
                ⚠ ‘{legacyKind.label}’은 [지도·사진]과 중복되는 구 종류입니다 — 슬롯에 등록돼 있으면 <strong>이 사진은 인쇄되지 않습니다</strong>. 계속 넣으려면 종류를 ‘기타’로 바꾸세요.
              </p>
            )}
          </div>
          )
        })}
        {canManage && (
          <button onClick={() => { setPhotos(rows => [...rows, { path: null, kind: 'etc', caption: '' }]); setDirty(true) }}
            className="text-form-xs text-brand hover:underline">+ 사진 추가</button>
        )}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg bg-brand text-white text-form-sm font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.3 저장
          </button>
          {msg && <span className="text-form-sm text-ink-sub">{msg}</span>}
        </div>
      )}
    </div>
  )
}
