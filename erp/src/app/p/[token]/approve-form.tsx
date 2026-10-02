'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveQuoteViaLinkAction } from './actions'

/** 관계인 승인 폼 — 이름 + 동의 체크. 전자서명이 아니라 「견적을 보고 진행에 동의했다」는 확인 기록이다. */
export function ApproveForm({ token }: { token: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">이 견적으로 보수 진행에 동의하시면 아래에 이름을 적고 승인해 주세요.</p>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="성함" maxLength={30}
        className="w-full rounded-lg border px-3 py-2 text-sm" disabled={pending} data-testid="share-approve-name" />
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} disabled={pending} className="mt-1" data-testid="share-approve-agree" />
        견적 내용을 확인했고 진행에 동의합니다. (전자서명이 아닌 확인 기록이며, 공사는 별도 계약으로 확정됩니다)
      </label>
      <button disabled={pending || !name.trim() || !agree} data-testid="share-approve-submit"
        onClick={() => start(async () => {
          setMsg(null)
          const r = await approveQuoteViaLinkAction({ token, name, agree })
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
