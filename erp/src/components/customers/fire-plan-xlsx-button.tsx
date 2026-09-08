'use client'

import { useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'

/** 소방계획서 엑셀 받기 — **단일 원천** (소방계획서_47).
 *
 *  종전에는 이 로직이 `fire-plan-view.tsx`(계획서 탭) 안에만 있었다. 별지서식 탭에도 같은 버튼을
 *  달라는 요구가 와서, 복제하는 대신 여기로 뺐다 — 두 벌이 되면 한쪽만 고쳐지는 날이 온다.
 *
 *  ⚠ **`window.open`으로 받으면 안 된다.** 라우트가 `X-FirePlan-Missing` 헤더로 보내는 고지
 *    (자가치유·구역 넘침·미입력)를 새 탭으로 열면 그대로 사라진다. 그래서 `fetch`+`Blob`으로
 *    받아 고지를 화면에 띄운다. PDF 쪽은 고지 헤더가 없어 `window.open` 그대로다(회귀 금지).
 *
 *  고지·오류를 바깥에서 그리고 싶으면 `onNotice`/`onError`를 넘긴다(계획서 탭이 그렇게 쓴다).
 *  안 넘기면 버튼 아래에 스스로 그린다(별지서식 탭).
 */
export function FirePlanXlsxButton({
  customerId, label = '엑셀 받기', variant = 'primary', title, onNotice, onError,
}: {
  customerId: string
  label?: string
  variant?: 'primary' | 'outline'
  title?: string
  /** 넘기면 고지를 바깥이 그린다 — 넘기지 않으면 이 컴포넌트가 아래에 그린다 */
  onNotice?: (msg: string) => void
  onError?: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [selfNotice, setSelfNotice] = useState('')
  const [selfError, setSelfError] = useState('')
  const owns = !onNotice && !onError      // 고지를 내가 그리는가

  const say = { notice: onNotice ?? setSelfNotice, error: onError ?? setSelfError }

  async function download() {
    say.error(''); say.notice(''); setBusy(true)
    try {
      const res = await fetch(`/customers/${customerId}/fire-plan/xlsx`)
      if (!res.ok) {
        // 라우트는 앵커 불일치·미착지를 500으로 끊는다 — 조용한 오적용 대신 사유를 보여 준다
        const body = await res.json().catch(() => null) as { error?: string } | null
        say.error(body?.error ?? `엑셀 생성 실패 (HTTP ${res.status})`)
        return
      }
      const raw = res.headers.get('X-FirePlan-Missing') ?? ''
      if (raw) { try { say.notice(decodeURIComponent(raw)) } catch { say.notice(raw) } }

      const blob = await res.blob()
      // 파일명은 Content-Disposition의 RFC 5987 filename*에서 — 없으면 밋밋한 폴백
      const cd = res.headers.get('Content-Disposition') ?? ''
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
      const name = star ? decodeURIComponent(star[1]) : `소방계획서_${new Date().getFullYear()}.xlsx`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      say.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const cls = variant === 'primary'
    ? 'bg-brand hover:bg-brand-strong text-white'
    : 'border border-brand-line text-ink-sub hover:bg-brand-tint hover:text-brand'

  return (
    <>
      <button onClick={download} disabled={busy} data-testid="fire-plan-xlsx"
        title={title ?? '현재 입력값으로 즉석 생성한 엑셀을 내려받습니다 — 받은 뒤 직접 고쳐 쓰실 수 있습니다'}
        className={`inline-flex items-center gap-1 h-form-8 px-3 rounded-lg text-form-sm font-medium transition-colors disabled:opacity-50 ${cls}`}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileSpreadsheet className="size-3.5" />} {label}
      </button>
      {owns && selfError && (
        <p className="text-form-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-2 w-full">{selfError}</p>
      )}
      {owns && selfNotice && (
        <p className="text-form-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-2 w-full whitespace-pre-wrap break-words">
          엑셀 고지: {selfNotice}
        </p>
      )}
    </>
  )
}
