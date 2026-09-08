'use client'

import { useEffect, useRef, useState } from 'react'
import { Printer, Download, Loader2 } from 'lucide-react'

/** PDF 자동 인쇄 뷰어 — 서명 URL의 PDF를 blob으로 받아 같은 출처 iframe에 띄우고
 *  로드 완료 시 인쇄 대화상자를 자동으로 연다. (교차 출처 iframe은 print() 호출이 막히므로 blob 경유가 필수)
 *
 *  인쇄 뒤 **탭을 닫아 버튼을 눌렀던 화면으로 복귀**한다(47 Q-10, 2026-09-08 사용자 요구).
 *  종전에는 대화상자가 닫혀도 이 뷰어 탭이 남아, 원래 화면(별지서식 탭·점검작업)으로
 *  돌아가려면 손으로 탭을 닫아야 했다.
 *  - `afterprint`는 인쇄를 했든 취소했든 대화상자가 닫히면 발화한다 — 둘 다 「볼일 끝」이므로 닫는다.
 *  - 인쇄가 iframe에서 시작되므로 이벤트도 **iframe의 window**에 단다(바깥 window에는 안 온다).
 *  - `window.close()`는 스크립트가 연 창에서만 듣는다 — 주소 직접 진입이면 opener가 없어
 *    조용히 무시되고, 그 경우 탭이 남는 것이 맞다(돌아갈 「원래 탭」 자체가 없다).
 *  - PDF 저장까지 하고 싶으면 대화상자에서 「PDF로 저장」을 고르거나, 자동 인쇄를 취소하지 말고
 *    상단 [PDF 저장]을 먼저 누르면 된다(자동 인쇄는 로드 후 1회뿐이라 경합하지 않는다). */
export function PrintPdfClient({ url, title, fileName }: { url: string; title: string; fileName: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const printedRef = useRef(false)

  // 인쇄 대화상자가 닫히면 탭을 닫아 원래 화면으로 복귀 — 47 Q-10. 두 창에 나눠 건다:
  // 자동 인쇄·[인쇄] 버튼은 iframe 창에서 발화하고(아래 onLoad), 사용자가 이 탭에서
  // Ctrl+P를 누르면 **바깥 창**에서 발화한다. 어느 쪽이든 규칙은 같다.
  useEffect(() => {
    const done = () => { if (window.opener) window.close() }
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [])

  useEffect(() => {
    let revoke: string | null = null
    fetch(url)
      .then(async r => {
        // 서버가 담아 보낸 안내(예: "이 회차에 생성된 별지 PDF가 없습니다")를 버리지 않는다 —
        // 상태 코드만 남기면 사용자는 무엇을 해야 할지 알 수 없다.
        if (!r.ok) {
          const msg = await r.json().then(j => j?.error as string | undefined).catch(() => undefined)
          throw new Error(msg ?? `HTTP ${r.status}`)
        }
        return r.blob()
      })
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
        <h1 className="text-sm font-semibold text-ink truncate">{title}</h1>
        <span className="text-xs text-ink-meta truncate">{fileName}</span>
        <div className="ml-auto flex gap-2 shrink-0">
          <button
            onClick={doPrint}
            disabled={!blobUrl}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Printer className="size-3.5" /> 인쇄
          </button>
          {blobUrl && (
            <a
              href={blobUrl}
              download={fileName}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-brand-line text-xs text-brand hover:bg-brand-tint transition-colors"
            >
              <Download className="size-3.5" /> PDF 저장
            </a>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      ) : !blobUrl ? (
        <div className="flex-1 flex items-center justify-center text-ink-sub text-sm gap-2">
          <Loader2 className="size-4 animate-spin" /> PDF 불러오는 중…
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={blobUrl}
          title={title}
          className="flex-1 w-full rounded-xl border border-line bg-surface"
          onLoad={() => {
            // 인쇄 대화상자가 닫히면(인쇄·취소 불문) 탭을 닫아 원래 화면으로 복귀 — 47 Q-10.
            // 수동 [인쇄] 버튼의 재인쇄에도 같은 규칙이 걸리도록 로드 시 한 번만 단다.
            iframeRef.current?.contentWindow?.addEventListener('afterprint', () => {
              if (window.opener) window.close()
            })
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
