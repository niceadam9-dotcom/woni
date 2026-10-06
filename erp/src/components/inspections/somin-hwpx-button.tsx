'use client'

import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'

/** 소민터(소방민원센터) 업로드용 별지 9호 한글파일 받기 — 통합계획 B4 1단계(2026-10-03).
 *
 *  ④ 칸 「소방민원센터 열기」 옆에 둔다: 이 파일을 받아 → 소민터에 올리면 칸이 자동 입력된다.
 *  받는 방식은 보고서 엑셀 버튼(workbook-xlsx-button)과 같은 fetch+Blob — `<a href>`로 받으면
 *  받기 실패 사유(JSON error)를 잡을 수 없다. 라우트의 `X-Hwpx-Notice` 고지는 사용자 지시로
 *  화면에 띄우지 않는다(2026-10-06). */
export function SominHwpxButton({ inspectionId }: { inspectionId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function download() {
    setError(''); setBusy(true)
    try {
      const res = await fetch(`/inspections/${inspectionId}/hwpx`)
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? `한글파일 생성 실패 (HTTP ${res.status})`)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
      const name = star ? decodeURIComponent(star[1]) : `별지9호_소민터_${inspectionId.slice(0, 8)}.hwpx`
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
      <button onClick={download} disabled={busy} data-testid="somin-hwpx"
        title="소방민원센터 「한글파일 업로드」용 별지 9호(HWPX) — 올리면 칸이 자동 입력됩니다 (저장되지 않습니다)"
        className="inline-flex items-center gap-1 text-brand hover:underline disabled:opacity-50">
        {busy ? <Loader2 className="size-3 animate-spin" /> : <FileDown className="size-3" />} 소민터용 한글파일
      </button>
      {error && (
        <p className="w-full rounded-lg bg-red-50 px-2 py-1 text-form-2xs text-red-600" data-testid="somin-hwpx-error">{error}</p>
      )}
    </>
  )
}
