'use client'

import { useRef, useState, useTransition } from 'react'
import { Upload, Trash2, Loader2, Plus, ImageIcon, ClipboardPaste, MapPin } from 'lucide-react'
import { uploadCustomerAssetAction, deleteCustomerAssetAction, generateLocationMapAction } from '@/app/(dashboard)/customers/asset-actions'
import type { AssetSlot, CustomerAsset } from '@/lib/customer-assets'

/** 지도·사진 카드 (소방계획서_7 §5·§5-1 — H-10) — 소방계획서 탭 빠른 입력 화면 통합.
 *  슬롯 3종: 표지 건물 사진(1장)·위치도/약도(1장)·피난안내도/평면도(복수).
 *  업로드·교체·삭제 + 썸네일, 드래그&드롭(R0-6 드롭존 패턴), 미등록이어도 문서 생성은 막지 않음(자리표시).
 *  H-11: 업로드 전 클라이언트에서 EXIF 회전 보정 + 장변 1600px 리사이즈(JPEG q0.85) — 서버 sharp 의존 없음. */

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

export function CustomerAssetsClient({ customerId, canManage, initialAssets }: {
  customerId: string
  canManage: boolean
  initialAssets: CustomerAsset[]
}) {
  const [assets, setAssets] = useState<CustomerAsset[]>(initialAssets)
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState<AssetSlot | null>(null)
  const [msg, setMsg] = useState<{ key: AssetSlot; text: string; ok: boolean } | null>(null)
  const [dragOver, setDragOver] = useState<AssetSlot | null>(null)
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

  // 위치도 자동 생성 — 고객 주소 → 네이버 정적 지도 (2026-08-05)
  function generateMap() {
    setMsg(null)
    setBusy('map_location')
    startTransition(async () => {
      const res = await generateLocationMapAction(customerId)
      setBusy(null)
      if (res.unavailable) {
        setMsg({ key: 'map_location', text: '❌ 네이버 지도 API 키가 설정되지 않았습니다 — NCP_MAPS_CLIENT_ID/SECRET 환경변수를 추가해주세요.', ok: false })
        return
      }
      if (res.error || !res.asset) { setMsg({ key: 'map_location', text: `❌ ${res.error ?? '생성 실패'}`, ok: false }); return }
      const asset = res.asset
      setAssets(prev => [...prev.filter(a => a.slot !== 'map_location'), asset])
      setMsg({ key: 'map_location', text: '✅ 주소 기반 위치도를 생성했습니다 — 문서 생성 시 자동 삽입됩니다', ok: true })
    })
  }

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
    <div data-testid="customer-assets" className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
      <p className="text-xs font-semibold text-[#514b81] mb-2">
        지도·사진 <span className="font-normal text-[#b0acd6]">(소방계획서 재료 — 미등록이어도 생성은 가능하며 자리표시로 대체됩니다)</span>
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {/* 1장 슬롯: 표지 건물 사진 · 위치도(약도) */}
        {SLOTS.map(({ slot, label, hint }) => {
          const asset = assets.find(a => a.slot === slot)
          return (
            <div key={slot} {...dropProps(slot)}
              className={`rounded-lg border bg-white p-3 space-y-2 ${dragOver === slot ? 'border-dashed border-[#7b68ee] bg-[#f5f4ff]' : 'border-[#e0ddf5]'}`}>
              <p className="text-[11px] font-medium text-[#514b81]">{label} <span className="font-normal text-[#b0acd6]">— {hint}</span></p>
              {asset ? (
                <img src={asset.url} alt={label} data-testid={`asset-thumb-${slot}`}
                  className="h-28 w-full rounded-lg border border-[#eceafd] object-cover" />
              ) : (
                <div className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#d0ccf5] text-[#b0acd6]">
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
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
                    {spinning(slot) ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} {asset ? '교체' : '업로드'}
                  </button>
                  <button onClick={() => pasteTo(slot)} disabled={isPending} data-testid={`asset-paste-${slot}`}
                    title="지도·화면을 캡처(Win+Shift+S)한 뒤 클릭하면 클립보드 이미지가 등록됩니다"
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
                    <ClipboardPaste className="size-3" /> 붙여넣기
                  </button>
                  {slot === 'map_location' && (
                    <button onClick={generateMap} disabled={isPending} data-testid="asset-generate-map"
                      title="고객 주소로 네이버 지도에서 위치도를 자동 생성합니다"
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
                      <MapPin className="size-3" /> 자동 생성
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
          className={`rounded-lg border bg-white p-3 space-y-2 ${dragOver === 'evac' ? 'border-dashed border-[#7b68ee] bg-[#f5f4ff]' : 'border-[#e0ddf5]'}`}>
          <p className="text-[11px] font-medium text-[#514b81]">피난안내도·평면도 <span className="font-normal text-[#b0acd6]">— 피난 관련 장에 들어갑니다 (층별 복수)</span></p>
          {evacAssets.length === 0 && !canManage && (
            <div className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#d0ccf5] text-[#b0acd6]">
              <ImageIcon className="size-5" />
              <span className="text-[10px]">미등록</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {evacAssets.map(a => (
              <div key={a.path} className="relative">
                <img src={a.url} alt="피난안내도" data-testid="asset-thumb-evac"
                  className="h-[54px] w-full rounded-lg border border-[#eceafd] object-cover" />
                {canManage && (
                  <button onClick={() => remove('evac', a.path)} disabled={isPending} title="삭제" data-testid="asset-delete-evac"
                    className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded bg-white/90 text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
            ))}
            {canManage && (
              <button onClick={() => evacRef.current?.click()} disabled={isPending}
                className="flex h-[54px] w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-[#d0ccf5] text-[#b0acd6] hover:border-[#7b68ee] hover:text-[#7b68ee] transition-colors disabled:opacity-50">
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
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
                <ClipboardPaste className="size-3" /> 붙여넣기
              </button>
            </>
          )}
          {feedback('evac')}
        </div>
      </div>
    </div>
  )
}
