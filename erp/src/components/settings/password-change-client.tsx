'use client'

import { useState, useTransition } from 'react'
import { KeyRound, Loader2, Check } from 'lucide-react'
import { changePasswordAction } from '@/app/(dashboard)/settings/actions'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

export function PasswordChangeClient() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setDone(false)
    if (!current || !next || !confirm) { setError('모든 항목을 입력해주세요.'); return }
    if (next !== confirm) { setError('새 비밀번호가 서로 일치하지 않습니다.'); return }
    startTransition(async () => {
      const res = await changePasswordAction(current, next)
      if (res.error) { setError(res.error); return }
      setDone(true)
      setCurrent(''); setNext(''); setConfirm('')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-[#514b81] mb-1 block">현재 비밀번호</label>
        <input type="password" autoComplete="current-password" value={current}
          onChange={e => setCurrent(e.target.value)} className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-[#514b81] mb-1 block">새 비밀번호 (6자 이상)</label>
          <input type="password" autoComplete="new-password" value={next}
            onChange={e => setNext(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-[#514b81] mb-1 block">새 비밀번호 확인</label>
          <input type="password" autoComplete="new-password" value={confirm}
            onChange={e => setConfirm(e.target.value)} className={inputCls} />
        </div>
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      {done && (
        <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <Check className="size-3.5" /> 비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.
        </p>
      )}
      <button type="submit" disabled={isPending}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors disabled:opacity-50">
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        비밀번호 변경
      </button>
    </form>
  )
}
