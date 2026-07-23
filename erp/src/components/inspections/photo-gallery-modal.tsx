'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { X, ChevronLeft, ChevronRight, Camera, Upload } from 'lucide-react'
import { uploadDefectPhotoAction } from '@/app/(dashboard)/inspections/defect-actions'

/** 전/후 사진 갤러리 모달 (소방계획서_5 R6) — 새 페이지 없이 모달.
 *  불량별 전/후 페어 그리드 + 조치 상태 뱃지 + 빈 슬롯 즉시 업로드(앰버 점선) + 확대·←→/스와이프·ESC.
 *  "사진은 불량내역에서 올리고, 갤러리에서 모아 보고, 비어 있으면 그 자리에서 채운다." */

export type GalleryDefect = {
  id: string
  defect_name: string
  photo_url: string | null
  after_photo_url: string | null
  action_completed_at: string | null
  action_plan?: string | null
  action_start?: string | null
}

type Shot = { url: string; label: string; defect: string }

export function PhotoGalleryModal({ inspectionId, defects, canEdit, onClose, onChanged }: {
  inspectionId: string
  defects: GalleryDefect[]
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<{ defectId: string; field: 'before' | 'after' } | null>(null)

  // 확대용 평면 목록 (존재하는 사진만)
  const shots: Shot[] = []
  for (const d of defects) {
    if (d.photo_url) shots.push({ url: d.photo_url, label: '전(불량)', defect: d.defect_name })
    if (d.after_photo_url) shots.push({ url: d.after_photo_url, label: '후(조치)', defect: d.defect_name })
  }
  const pairCount = defects.length
  const doneCount = defects.filter(d => d.photo_url && d.after_photo_url).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (lightbox !== null) setLightbox(null); else onClose() }
      else if (lightbox !== null && e.key === 'ArrowLeft') setLightbox(i => (i === null ? i : (i + shots.length - 1) % shots.length))
      else if (lightbox !== null && e.key === 'ArrowRight') setLightbox(i => (i === null ? i : (i + 1) % shots.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, shots.length, onClose])

  function pickUpload(defectId: string, field: 'before' | 'after') {
    targetRef.current = { defectId, field }
    uploadRef.current?.click()
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const t = targetRef.current
    e.target.value = ''
    if (!file || !t) return
    setBusy(`${t.defectId}:${t.field}`)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('defectId', t.defectId); fd.append('inspectionId', inspectionId)
      fd.append('file', file); fd.append('field', t.field)
      await uploadDefectPhotoAction(fd)
      setBusy(null)
      onChanged()
    })
  }

  function Slot({ d, field }: { d: GalleryDefect; field: 'before' | 'after' }) {
    const url = field === 'before' ? d.photo_url : d.after_photo_url
    const label = field === 'before' ? '전(불량)' : '후(조치)'
    const key = `${d.id}:${field}`
    if (url) {
      const idx = shots.findIndex(s => s.url === url)
      return (
        <button onClick={() => setLightbox(idx)} className="relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className="w-full aspect-square object-cover rounded-lg border border-[#eceafd]" />
          <span className="absolute bottom-1 left-1 text-[9px] px-1 py-0.5 rounded bg-black/50 text-white">{label}</span>
        </button>
      )
    }
    return canEdit ? (
      <button onClick={() => pickUpload(d.id, field)} disabled={pending}
        className="w-full aspect-square rounded-lg border-2 border-dashed border-amber-300 hover:border-amber-500 flex flex-col items-center justify-center gap-1 text-amber-500 disabled:opacity-50">
        {busy === key ? <Upload size={16} className="animate-pulse" /> : <Camera size={16} />}
        <span className="text-[10px]">{label} 추가</span>
      </button>
    ) : (
      <div className="w-full aspect-square rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-[10px] text-gray-300">{label} 없음</div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onMouseDown={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#eceafd] sticky top-0 bg-white">
          <h2 className="text-sm font-semibold text-[#090c1d]">전/후 사진 ({doneCount}/{pairCount}쌍)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        {defects.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[#b0acd6]">불량내역이 없습니다 — 사진은 불량 등록 후 첨부합니다</p>
        ) : (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {defects.map(d => {
              const done = !!d.action_completed_at
              const planned = !!(d.action_plan || d.action_start)
              return (
                <div key={d.id} className="rounded-xl border border-[#eceafd] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-[#090c1d] truncate">{d.defect_name}</span>
                    {done ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">조치완료</span>
                      : planned ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">계획</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">미조치</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Slot d={d} field="before" />
                    <Slot d={d} field="after" />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <input ref={uploadRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPicked} />

      {/* 확대 라이트박스 */}
      {lightbox !== null && shots[lightbox] && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85" onMouseDown={() => setLightbox(null)}>
          <button onClick={e => { e.stopPropagation(); setLightbox((lightbox + shots.length - 1) % shots.length) }}
            className="absolute left-3 text-white/80 hover:text-white p-2"><ChevronLeft size={28} /></button>
          <div className="max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-2" onMouseDown={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shots[lightbox].url} alt="확대" className="max-w-[90vw] max-h-[78vh] object-contain rounded" />
            <p className="text-xs text-white/90">{shots[lightbox].defect} · {shots[lightbox].label} ({lightbox + 1}/{shots.length})</p>
          </div>
          <button onClick={e => { e.stopPropagation(); setLightbox((lightbox + 1) % shots.length) }}
            className="absolute right-3 text-white/80 hover:text-white p-2"><ChevronRight size={28} /></button>
          <button onClick={e => { e.stopPropagation(); setLightbox(null) }} className="absolute top-4 right-4 text-white/80 hover:text-white"><X size={24} /></button>
        </div>
      )}
    </div>
  )
}
