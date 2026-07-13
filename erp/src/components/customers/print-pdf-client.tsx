'use client'

import { useEffect, useRef, useState } from 'react'
import { Printer, Download, Loader2 } from 'lucide-react'

/** PDF 자동 인쇄 뷰어 — 서명 URL의 PDF를 blob으로 받아 같은 출처 iframe에 띄우고
 *  로드 완료 시 인쇄 대화상자를 자동으로 연다. (교차 출처 iframe은 print() 호출이 막히므로 blob 경유가 필수) */
export function PrintPdfClient({ url, title, fileName }: { url: string; title: string; fileName: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const printedRef = useRef(false)

  useEffect(() => {
    let revoke: string | null = null
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then(b => {
        revoke = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }))
        setBlobUrl(revoke)
      })
      .catch(e => setError(`PDF를 불러오지 못했습니다: ${e.message}`))
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [url])

  function doPrint() {
    iframeRef.current?.contentWindow?.print()
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-3 pb-3">
        <h1 className="text-sm font-semibold text-[#090c1d] truncate">{title}</h1>
        <span className="text-xs text-[#b0acd6] truncate">{fileName}</span>
        <div className="ml-auto flex gap-2 shrink-0">
          <button
            onClick={doPrint}
            disabled={!blobUrl}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Printer className="size-3.5" /> 인쇄
          </button>
          {blobUrl && (
            <a
              href={blobUrl}
              download={fileName}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
            >
              <Download className="size-3.5" /> PDF 저장
            </a>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      ) : !blobUrl ? (
        <div className="flex-1 flex items-center justify-center text-[#514b81] text-sm gap-2">
          <Loader2 className="size-4 animate-spin" /> PDF 불러오는 중…
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={blobUrl}
          title={title}
          className="flex-1 w-full rounded-xl border border-[#c8c4d0] bg-white"
          onLoad={() => {
            // 자동 인쇄는 1회만 — 이후엔 상단 [인쇄] 버튼으로
            if (printedRef.current) return
            printedRef.current = true
            setTimeout(() => iframeRef.current?.contentWindow?.print(), 400)
          }}
        />
      )}
    </div>
  )
}
