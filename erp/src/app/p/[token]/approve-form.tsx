'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveQuoteViaLinkAction } from './actions'

/** 관계인 승인 폼 — 이름 + 동의 체크 + 손글씨 서명(선택, 3단계).
 *  전자서명이 아니라 「견적을 보고 진행에 동의했다」는 확인 기록이다. 서명은 견적 PDF 승인란에 찍힌다.
 *  캔버스는 포인터 이벤트 하나로 마우스·터치·펜을 받는다(touch-action:none으로 스크롤과 분리). */
export function ApproveForm({ token }: { token: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [signed, setSigned] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget, r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d'); if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = pos(e)
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = e.currentTarget.getContext('2d'); if (!ctx) return
    const p = pos(e)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    if (!signed) setSigned(true)
  }
  const up = () => { drawing.current = false }
  const clear = () => {
    const c = canvasRef.current; const ctx = c?.getContext('2d')
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height)
    setSigned(false)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">이 견적으로 보수 진행에 동의하시면 아래에 이름을 적고 승인해 주세요.</p>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="성함" maxLength={30}
        className="w-full rounded-lg border px-3 py-2 text-sm" disabled={pending} data-testid="share-approve-name" />
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
          <span>서명(선택) — 손가락이나 마우스로</span>
          <button type="button" onClick={clear} disabled={pending} className="underline" data-testid="share-sign-clear">지우기</button>
        </div>
        <canvas ref={canvasRef} width={600} height={180} data-testid="share-sign-canvas"
          className="h-[120px] w-full touch-none rounded-lg border bg-white"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} />
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} disabled={pending} className="mt-1" data-testid="share-approve-agree" />
        견적 내용을 확인했고 진행에 동의합니다. (전자서명이 아닌 확인 기록이며, 공사는 별도 계약으로 확정됩니다)
      </label>
      <button disabled={pending || !name.trim() || !agree} data-testid="share-approve-submit"
        onClick={() => start(async () => {
          setMsg(null)
          const signature = signed ? canvasRef.current?.toDataURL('image/png') ?? null : null
          const r = await approveQuoteViaLinkAction({ token, name, agree, signature })
          if (r.error) { setMsg(r.error); return }
          router.refresh()
        })}
        className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
        {pending ? '처리 중…' : '견적 승인'}
      </button>
      {msg && <p className="text-sm text-red-600" role="alert" data-testid="share-approve-error">{msg}</p>}
    </div>
  )
}
