'use client'

import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'

/** 문서 받기 고지·오류 토스트 — **목록 표 안의 아이콘 버튼 전용** 창구.
 *
 *  왜 따로 있나: 문서 라우트는 `X-FirePlan-Missing`·`X-Workbook-Missing` 헤더로 고지를 보낸다
 *  (자가치유·구역 넘침·미입력·점검표 착지 집계 등). 이 고지는 `fetch`로만 잡히고, 상세 화면에서는
 *  버튼 아래에 `<p>`로 그리면 됐다. 그런데 목록 표의 행 안에서 같은 짓을 하면 **행 높이가 튀어
 *  표가 무너진다**. 그렇다고 고지를 버리면 `window.open` 시절로 되돌아가는 것이다 —
 *  워크북 쪽은 그래서 고지가 **한 번도 사용자에게 닿은 적이 없었다**(workbook-xlsx-button 주석).
 *
 *  그래서 목록에서는 body 포털 토스트로 띄운다. 포털인 이유는 ClickableRow(행 전체 클릭) 안에서
 *  그리면 토스트 클릭이 행까지 올라가 상세로 튕기기 때문이다(delete-customer-client와 같은 이유). */
export function DocNoticeToast({ notice, error, onClose }: {
  notice?: string
  error?: string
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  if (!notice && !error) return null

  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-[10000] max-w-md"
      // 행 클릭 = 상세 이동이라 토스트 안 클릭이 올라가면 화면이 튄다
      onClick={e => e.stopPropagation()}
      data-testid="doc-notice-toast"
    >
      <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 shadow-lg ${error
        ? 'bg-red-50 border border-red-200'
        : 'bg-amber-50 border border-amber-200'}`}>
        <AlertTriangle className={`size-4 shrink-0 mt-0.5 ${error ? 'text-red-500' : 'text-amber-500'}`} />
        <p className={`text-form-xs whitespace-pre-wrap break-words ${error ? 'text-red-700' : 'text-amber-800'}`}>
          {error ? error : <><span className="font-medium">문서 고지: </span>{notice}</>}
        </p>
        <button onClick={onClose} title="닫기"
          className={`shrink-0 rounded p-0.5 ${error ? 'text-red-400 hover:bg-red-100' : 'text-amber-500 hover:bg-amber-100'}`}>
          <X className="size-3.5" />
        </button>
      </div>
    </div>,
    document.body
  )
}
