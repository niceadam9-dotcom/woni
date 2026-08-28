'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Upload, Trash2, Loader2, Plus, ImageIcon, ClipboardPaste, MapPin, PencilRuler, X } from 'lucide-react'
import {
  uploadCustomerAssetAction, deleteCustomerAssetAction, generateLocationMapAction, listCustomerAssetsAction,
} from '@/app/(dashboard)/customers/asset-actions'
import { EvacMapBuilder } from './evac-map-builder'
import type { AssetSlot, CustomerAsset } from '@/lib/customer-assets'

/** 지도·사진 카드 (소방계획서_7 §5·§5-1 — H-10) — 2026-08-08부터 서식 1.3 안에 삽입되어 렌더된다.
 *  슬롯 3종: 표지 건물 사진(1장)·위치도/약도(1장)·피난안내도/평면도(복수).
 *  업로드·교체·삭제 + 썸네일, 드래그&드롭(R0-6 드롭존 패턴), 미등록이어도 문서 생성은 막지 않음(자리표시).
 *  H-11: 업로드 전 클라이언트에서 EXIF 회전 보정 + 장변 1600px 리사이즈(JPEG q0.85) — 서버 sharp 의존 없음.
 *  업로드는 [서식 1.3 저장]과 무관하게 즉시 스토리지에 확정된다(서식 JSON에 담기지 않음). */

const MAX_EDGE = 1600

const SLOTS: Array<{ slot: 'cover' | 'map_location'; label: string; hint: string }> = [
  { slot: 'cover', label: '표지 건물 사진', hint: '소방계획서 표지에 들어갑니다 (1장)' },
  { slot: 'map_location', label: '위치도·약도', hint: '위치도 페이지에 들어갑니다 (1장)' },
]

/** EXIF 회전 보정 + 장변 제한 리사이즈 — 작은 png/webp는 원본 유지, jpeg는 회전 반영 위해 재인코딩 */
async function prepareFile(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const long = Math.max(bmp.width, bmp.height)
    const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)
    if (long <= MAX_EDGE && !isJpeg) { bmp.close(); return file }
    const scale = Math.min(1, MAX_EDGE / long)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) { bmp.close(); return file }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85))
    if (!blob) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file   // 디코드 실패(손상 파일 등) — 서버 확장자·크기 검증에 맡김
  }
}

export function CustomerAssetsClient({ customerId, canManage, initialAssets = [], embedded = false }: {
  customerId: string
  canManage: boolean
  /** 서버 선조회분 — 페이지 초기 로드는 서명 왕복 절약을 위해 생략하고 마운트 조회에 맡긴다 (2026-08-11) */
  initialAssets?: CustomerAsset[]
  embedded?: boolean   // 서식 1.3 안에 삽입될 때 — 바깥 카드와 겹치지 않게 흰 하위 박스로 렌더
}) {
  const [assets, setAssets] = useState<CustomerAsset[]>(initialAssets)
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState<AssetSlot | null>(null)
  const [msg, setMsg] = useState<{ key: AssetSlot; text: string; ok: boolean } | null>(null)
  const [dragOver, setDragOver] = useState<AssetSlot | null>(null)
  // 개략 피난안내도 생성기 (B안, 2026-08-05) — PNG 결과는 기존 evac 업로드 파이프라인으로
  const [builderOpen, setBuilderOpen] = useState(false)
  // 썸네일 클릭 → 원본 크게 보기 라이트박스 (2026-08-05)
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const mapRef = useRef<HTMLInputElement>(null)
  const evacRef = useRef<HTMLInputElement>(null)
  const inputRef = (slot: AssetSlot) => (slot === 'cover' ? coverRef : slot === 'map_location' ? mapRef : evacRef)

  function upload(slot: AssetSlot, raw: File) {
    setMsg(null)
    setBusy(slot)
    startTransition(async () => {
      const file = await prepareFile(raw)
      const fd = new FormData()
      fd.append('file', file)
      const res = await uploadCustomerAssetAction(customerId, slot, fd)
      setBusy(null)
      if (res.error || !res.asset) { setMsg({ key: slot, text: `❌ ${res.error ?? '업로드 실패'}`, ok: false }); return }
      const asset = res.asset
      setAssets(prev => (slot === 'evac' ? [...prev, asset] : [...prev.filter(a => a.slot !== slot), asset]))
      setMsg({ key: slot, text: '✅ 등록됨 — 문서 생성 시 자동 삽입됩니다', ok: true })
    })
  }

  function remove(slot: AssetSlot, path: string) {
    if (!window.confirm('이 이미지를 삭제할까요?')) return
    setMsg(null)
    setBusy(slot)
    startTransition(async () => {
      const res = await deleteCustomerAssetAction(customerId, path)
      setBusy(null)
      if (res.error) { setMsg({ key: slot, text: `❌ ${res.error}`, ok: false }); return }
      setAssets(prev => prev.filter(a => a.path !== path))
      setMsg({ key: slot, text: '✅ 삭제됨', ok: true })
    })
  }

  // 클립보드 이미지 읽기 — 지도 캡처(Win+Shift+S) 후 [붙여넣기] 버튼용 (2026-08-05 사용자 확정)
  async function readClipboardImage(): Promise<File | null> {
    try {
      if (!navigator.clipboard?.read) return null
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
          return new File([blob], `clipboard.${ext}`, { type })
        }
      }
      return null
    } catch {
      return null   // 권한 거부·미지원 브라우저 — 호출부에서 안내
    }
  }

  // 위치도(일반 지도+마커)·표지(위성 항공뷰) 자동 생성 — 고객 주소 → 네이버 정적 지도 (2026-08-05)
  function generateMap(slot: 'map_location' | 'cover') {
    setMsg(null)
    setBusy(slot)
    startTransition(async () => {
      const res = await generateLocationMapAction(customerId, slot)
      setBusy(null)
      if (res.unavailable) {
        setMsg({ key: slot, text: '❌ 네이버 지도 API 키가 설정되지 않았습니다 — NCP_MAPS_CLIENT_ID/SECRET 환경변수를 추가해주세요.', ok: false })
        return
      }
      if (res.error || !res.asset) { setMsg({ key: slot, text: `❌ ${res.error ?? '생성 실패'}`, ok: false }); return }
      const asset = res.asset
      setAssets(prev => [...prev.filter(a => a.slot !== slot), asset])
      setMsg({
        key: slot,
        text: slot === 'cover'
          ? '✅ 위성 항공사진을 생성했습니다 — 정면 사진이 필요하면 현장 촬영본으로 교체하세요'
          : '✅ 주소 기반 위치도를 생성했습니다 — 문서 생성 시 자동 삽입됩니다',
        ok: true,
      })
    })
  }

  // 마운트 시 ① 서명 URL 재발급 ② 빈 슬롯 자동 생성 — 순서가 중요하다(신선한 목록으로 빈 슬롯을 판정).
  const mountRan = useRef(false)
  useEffect(() => {
    if (mountRan.current) return
    mountRan.current = true
    startTransition(async () => {
      // ① 자산 목록·서명 URL은 마운트 시 조회 — 페이지 초기 로드는 존재 여부만 알고 URL을 만들지 않는다(2026-08-11 성능).
      //    (종전에도 서버 발급 URL은 화면을 여는 순간 이미 만료됐을 수 있어 여기서 갈아끼웠다.)
      let current: CustomerAsset[] | null = null
      try {
        const listed = await listCustomerAssetsAction(customerId)
        if (listed.assets) { current = listed.assets; setAssets(current) }
      } catch { /* 네트워크 실패 — 아래 자동 생성도 건너뛴다 */ }
      // 목록 조회 실패 시 자동 생성 금지 — 빈 목록으로 오판해 기존 등록본(수동 촬영 표지 등)을 덮어쓸 수 있다
      if (!canManage || current === null) return
      // ② 빈 슬롯 자동 생성·저장 (2026-08-05 사용자 확정) — 표지 위성·위치도가 비어 있으면 버튼 없이 자동 생성.
      //    키 미설정·주소 없음 등 실패는 조용히 넘어감(수동 버튼 경로에서 사유 안내) — 자동 경로에서 에러 팝업 반복 방지
      const missing = (['cover', 'map_location'] as const).filter(s => !current.some(a => a.slot === s))
      for (const slot of missing) {
        const res = await generateLocationMapAction(customerId, slot)
        if (res.unavailable) return
        if (!res.asset) continue
        const asset = res.asset
        setAssets(prev => [...prev.filter(a => a.slot !== slot), asset])
        setMsg({
          key: slot,
          text: slot === 'cover'
            ? '✅ 위성 항공사진이 자동 생성됐습니다 — 정면 사진이 필요하면 현장 촬영본으로 교체하세요'
            : '✅ 주소 기반 위치도가 자동 생성됐습니다',
          ok: true,
        })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 라이트박스 Esc 닫기
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  function pasteTo(slot: AssetSlot) {
    setMsg(null)
    void (async () => {
      const f = await readClipboardImage()
      if (!f) {
        setMsg({ key: slot, text: '❌ 클립보드에 이미지가 없습니다 — 지도 화면을 캡처(Win+Shift+S)한 뒤 다시 눌러주세요.', ok: false })
        return
      }
      upload(slot, f)
    })()
  }

  // R0-6: 슬롯 카드 = 드롭존 + 붙여넣기 대상 (카드 클릭 후 Ctrl+V)
  const dropProps = (slot: AssetSlot) => canManage ? {
    tabIndex: 0,
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(slot) },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDragOver(null)
      const f = e.dataTransfer.files?.[0]
      if (f) upload(slot, f)
    },
    onPaste: (e: React.ClipboardEvent) => {
      const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
      const f = item?.getAsFile()
      if (f) { e.preventDefault(); upload(slot, f) }
    },
  } : {}

  const feedback = (slot: AssetSlot) => msg?.key === slot && (
    <p className={`text-[11px] ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
  )
  const spinning = (slot: AssetSlot) => busy === slot && isPending

  const evacAssets = assets.filter(a => a.slot === 'evac')

  return (
    <div data-testid="customer-assets"
      className={embedded
        ? 'rounded-lg border border-brand-tint bg-surface p-2.5'
        : 'rounded-xl border border-brand-line-soft bg-brand-tint p-4'}>
      <p className={`font-semibold text-ink-sub ${embedded ? 'text-[11px] mb-1.5' : 'text-xs mb-2'}`}>
        지도·사진 <span className="font-normal text-ink-faint">(소방계획서 재료 — 미등록이어도 생성은 가능하며 자리표시로 대체됩니다)</span>
      </p>
      {embedded && (
        <p className="text-[11px] text-ink-soft mb-2">
          여기서 등록·교체·삭제한 이미지는 <strong>즉시 저장</strong>됩니다 — [서식 1.3 저장]을 누르지 않아도 됩니다.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {/* 1장 슬롯: 표지 건물 사진 · 위치도(약도) */}
        {SLOTS.map(({ slot, label, hint }) => {
          const asset = assets.find(a => a.slot === slot)
          return (
            <div key={slot} {...dropProps(slot)}
              className={`rounded-lg border bg-surface p-3 space-y-2 ${dragOver === slot ? 'border-dashed border-brand bg-brand-tint' : 'border-brand-line-soft'}`}>
              <p className="text-[11px] font-medium text-ink-sub">{label} <span className="font-normal text-ink-faint">— {hint}</span></p>
              {asset ? (
                <button type="button" onClick={() => setPreview({ url: asset.url, label })}
                  title="클릭하면 크게 봅니다" className="block w-full">
                  <img src={asset.url} alt={label} data-testid={`asset-thumb-${slot}`}
                    className="h-28 w-full rounded-lg border border-brand-tint object-cover cursor-zoom-in hover:opacity-90 transition-opacity" />
                </button>
              ) : (
                <div className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-brand-line text-ink-faint">
                  <ImageIcon className="size-5" />
                  <span className="text-[10px]">미등록 — 끌어다 놓기·캡처 후 붙여넣기(Ctrl+V) 가능</span>
                </div>
              )}
              {canManage && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input ref={inputRef(slot)} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
                    data-testid={`asset-input-${slot}`}
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(slot, f); e.target.value = '' }} />
                  <button onClick={() => inputRef(slot).current?.click()} disabled={isPending}
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint transition-colors disabled:opacity-50">
                    {spinning(slot) ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} {asset ? '교체' : '업로드'}
                  </button>
                  <button onClick={() => pasteTo(slot)} disabled={isPending} data-testid={`asset-paste-${slot}`}
                    title="지도·화면을 캡처(Win+Shift+S)한 뒤 클릭하면 클립보드 이미지가 등록됩니다"
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint transition-colors disabled:opacity-50">
                    <ClipboardPaste className="size-3" /> 붙여넣기
                  </button>
                  {slot === 'map_location' && (
                    <button onClick={() => generateMap('map_location')} disabled={isPending} data-testid="asset-generate-map"
                      title="고객 주소로 네이버 지도에서 위치도를 자동 생성합니다"
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint transition-colors disabled:opacity-50">
                      <MapPin className="size-3" /> 자동 생성
                    </button>
                  )}
                  {slot === 'cover' && (
                    <button onClick={() => generateMap('cover')} disabled={isPending} data-testid="asset-generate-cover"
                      title="고객 주소의 위성 항공사진을 자동 생성합니다 (거리 정면 사진은 API 미제공 — 현장 촬영본으로 교체 가능)"
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint transition-colors disabled:opacity-50">
                      <MapPin className="size-3" /> 위성사진
                    </button>
                  )}
                  {asset && (
                    <button onClick={() => remove(slot, asset.path)} disabled={isPending} data-testid={`asset-delete-${slot}`}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-red-200 text-[11px] text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                      <Trash2 className="size-3" /> 삭제
                    </button>
                  )}
                </div>
              )}
              {feedback(slot)}
            </div>
          )
        })}

        {/* 복수 슬롯: 피난안내도·평면도 (evac_1..n 추가형) */}
        <div {...dropProps('evac')}
          className={`rounded-lg border bg-surface p-3 space-y-2 ${dragOver === 'evac' ? 'border-dashed border-brand bg-brand-tint' : 'border-brand-line-soft'}`}>
          <p className="text-[11px] font-medium text-ink-sub">피난안내도·평면도 <span className="font-normal text-ink-faint">— 피난 관련 장에 들어갑니다 (층별 복수)</span></p>
          {evacAssets.length === 0 && !canManage && (
            <div className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-brand-line text-ink-faint">
              <ImageIcon className="size-5" />
              <span className="text-[10px]">미등록</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {evacAssets.map((a, idx) => (
              <div key={a.path} className="relative">
                <img src={a.url} alt="피난안내도" data-testid="asset-thumb-evac"
                  onClick={() => setPreview({ url: a.url, label: `피난안내도·평면도 ${idx + 1}` })}
                  title="클릭하면 크게 봅니다"
                  className="h-[54px] w-full rounded-lg border border-brand-tint object-cover cursor-zoom-in hover:opacity-90 transition-opacity" />
                {canManage && (
                  <button onClick={() => remove('evac', a.path)} disabled={isPending} title="삭제" data-testid="asset-delete-evac"
                    className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded bg-surface/90 text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
            ))}
            {canManage && (
              <button onClick={() => evacRef.current?.click()} disabled={isPending}
                className="flex h-[54px] w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-brand-line text-ink-faint hover:border-brand hover:text-brand transition-colors disabled:opacity-50">
                {spinning('evac') ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                <span className="text-[10px]">{evacAssets.length === 0 ? '미등록 — 추가' : '추가'}</span>
              </button>
            )}
          </div>
          {canManage && (
            <>
              <input ref={evacRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
                data-testid="asset-input-evac"
                onChange={e => { const f = e.target.files?.[0]; if (f) upload('evac', f); e.target.value = '' }} />
              <button onClick={() => pasteTo('evac')} disabled={isPending} data-testid="asset-paste-evac"
                title="지도·화면을 캡처(Win+Shift+S)한 뒤 클릭하면 클립보드 이미지가 추가됩니다"
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint transition-colors disabled:opacity-50">
                <ClipboardPaste className="size-3" /> 붙여넣기
              </button>
              <button onClick={() => setBuilderOpen(true)} disabled={isPending} data-testid="asset-builder-evac"
                title="표준 아이콘으로 개략 피난안내도를 직접 그려 등록합니다"
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint transition-colors disabled:opacity-50">
                <PencilRuler className="size-3" /> 안내도 그리기
              </button>
            </>
          )}
          {feedback('evac')}
        </div>
      </div>

      {/* 썸네일 클릭 라이트박스 — 원본 크게 보기 (배경·✕·Esc로 닫기) */}
      {preview && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/80 p-4"
          onClick={() => setPreview(null)} role="dialog" aria-modal="true" aria-label={`${preview.label} 미리보기`}>
          <div className="flex w-full max-w-4xl items-center justify-between px-1 pb-2">
            <span className="text-sm font-medium text-white">{preview.label}</span>
            <button onClick={() => setPreview(null)} aria-label="닫기"
              className="inline-flex size-8 items-center justify-center rounded-lg text-white/80 hover:bg-surface/10 hover:text-white">
              <X className="size-5" />
            </button>
          </div>
          <img src={preview.url} alt={preview.label} onClick={e => e.stopPropagation()}
            className="max-h-[85vh] max-w-4xl rounded-lg object-contain shadow-2xl" />
          <p className="mt-2 text-[11px] text-white/60">빈 곳·✕·Esc 로 닫기</p>
        </div>
      )}

      {/* 개략 피난안내도 생성기 모달 — PNG 결과를 evac 슬롯으로 업로드, 그리던 내용은 고객별 초안 자동 저장 */}
      {builderOpen && (
        <EvacMapBuilder
          customerId={customerId}
          saving={busy === 'evac' && isPending}
          onClose={() => setBuilderOpen(false)}
          onSave={file => { upload('evac', file); setBuilderOpen(false) }}
        />
      )}
    </div>
  )
}
