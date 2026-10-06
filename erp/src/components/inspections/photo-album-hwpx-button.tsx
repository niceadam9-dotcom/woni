'use client'

import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'

/** 공사 완료 사진첩 한글파일 받기 (2026-10-06) — ⑥ 칸, 「11호 PDF 생성」·「사진첩 PDF 생성」 옆.
 *  받는 방식은 소민터용 한글파일 버튼(somin-hwpx-button)과 같은 fetch+Blob — `<a href>`로 받으면
 *  실패 사유(JSON error)를 잡을 수 없다. 저장하지 않는 즉석 생성물이라 생성물 목록에는 쌓이지 않는다. */
export function PhotoAlbumHwpxButton({ inspectionId, className }: { inspectionId: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function download() {
    setError(''); setBusy(true)
    try {
      const res = await fetch(`/inspections/${inspectionId}/photo-album-hwpx`)
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? `사진첩 한글파일 생성 실패 (HTTP ${res.status})`)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
      const name = star ? decodeURIComponent(star[1]) : `공사완료사진첩_${inspectionId.slice(0, 8)}.hwpx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={download} disabled={busy} data-testid="photo-album-hwpx"
        title="공사 완료 사진첩 한글파일(HWPX) — 불량 건별 공사 전·후 사진 (저장되지 않습니다)"
        className={className}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : <FileDown className="size-3" />} 사진첩 한글파일
      </button>
      {error && (
        <p className="w-full rounded-lg bg-red-50 px-2 py-1 text-form-2xs text-red-600" data-testid="photo-album-hwpx-error">{error}</p>
      )}
    </>
  )
}
