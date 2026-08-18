'use client'

import { useState } from 'react'
import { Printer, Loader2 } from 'lucide-react'
import { getAnnexPreviewHtmlAction } from '@/app/(dashboard)/inspections/report9-actions'

/** 별지 1건 인쇄 — 생성 여부에 따라 두 경로로 갈린다.
 *
 *  ① PDF가 있으면 **서버 PDF**(/print-bundle?types=…)를 인쇄한다. 제출용은 언제나 이 경로다.
 *  ② 아직 생성 전이면 **초안 인쇄**(브라우저 렌더). 서버 PDF와 글꼴이 달라(서버=Gotenberg 내장
 *     Noto Serif CJK KR / 브라우저=시스템 명조 폴백) 표 줄바꿈과 쪽 나눔이 어긋날 수 있고,
 *     브라우저 머리글·바닥글·배율은 사용자 설정을 타므로 **제출용으로 쓰면 안 된다**.
 *     확인 후에만 진행하고, 하이라이트를 뺀 HTML(highlight:false)로 다시 렌더해서 인쇄한다 —
 *     화면 미리보기 HTML에는 미입력 노란 배경이 있고 BASE_CSS가 print-color-adjust:exact라
 *     그대로 인쇄하면 종이에 노란 칠이 찍힌다. */
export function AnnexPrintButton({ inspectionId, type, label, hasPdf, className }: {
  inspectionId: string
  type: 'report4' | 'report9' | 'report10' | 'report11' | 'exterior' | 'cover' | 'official' | 'delegation'
  label: string
  /** 이 문서의 생성 PDF가 있는가 — 제출용 경로 가능 여부 */
  hasPdf: boolean
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function printFinal() {
    window.open(`/inspections/${inspectionId}/print-bundle?types=${type}`, '_blank')
  }

  async function printDraft() {
    const ok = window.confirm(
      `${label}는 아직 생성되지 않아 초안으로 인쇄합니다.\n\n`
      + '초안은 화면 글꼴로 그려서 실제 생성본과 쪽 나눔이 다를 수 있습니다 — 제출용으로 쓰지 마세요.\n'
      + '제출용은 [생성]으로 문서를 만든 뒤 인쇄하시면 됩니다.\n\n초안을 인쇄할까요?',
    )
    if (!ok) return
    // 팝업 차단 회피 — 창은 클릭 시점에 동기로 열고, 내용은 렌더가 끝난 뒤 채운다
    const w = window.open('', '_blank')
    if (!w) { setErr('팝업이 차단되었습니다 — 이 사이트의 팝업을 허용해주세요.'); return }
    w.document.write('<!doctype html><meta charset="utf-8"><title>초안 인쇄</title><p style="font:14px sans-serif">초안 준비 중…</p>')
    setBusy(true); setErr('')
    try {
      const res = await getAnnexPreviewHtmlAction(inspectionId, type, { highlight: false })
      if (res.error || !res.html) {
        w.document.body.innerHTML = `<p style="font:14px sans-serif;color:#b00">${res.error ?? '초안을 만들지 못했습니다.'}</p>`
        return
      }
      w.document.open(); w.document.write(res.html); w.document.close()
      // document.write 직후엔 load가 이미 지나갔을 수 있어 타이머로 인쇄 (print-pdf-client와 같은 방식)
      setTimeout(() => { w.focus(); w.print() }, 400)
    } catch (e) {
      w.document.body.innerHTML = `<p style="font:14px sans-serif;color:#b00">${e instanceof Error ? e.message : String(e)}</p>`
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => (hasPdf ? printFinal() : void printDraft())}
        disabled={busy}
        title={hasPdf ? `${label} 인쇄 — 생성된 PDF(제출용)` : `${label} 초안 인쇄 — 생성 전이라 제출용이 아닙니다`}
        className={className ?? `inline-flex items-center gap-1 h-6 px-2 rounded border text-[11px] transition-colors disabled:opacity-50 ${
          hasPdf ? 'border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff]' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Printer className="size-3" />}
        {hasPdf ? '인쇄' : '초안 인쇄'}
      </button>
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </>
  )
}
