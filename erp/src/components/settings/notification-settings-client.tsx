'use client'

import { useState, useTransition } from 'react'
import { Loader2, Check, Lock } from 'lucide-react'
import { updateNotificationPrefsAction } from '@/app/(dashboard)/settings/actions'

// 필수 알림(설정 불가) 안내 행 + 선택 카테고리 토글 4종 (제안.md 2단계)
const REQUIRED_ROWS = [
  { label: '결재 요청 도착', desc: '내 차례의 결재 요청 — 업무 필수 알림' },
  { label: '휴가 신청 도착', desc: '승인이 필요한 휴가 신청 — 업무 필수 알림' },
]
const OPTIONAL_ROWS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'approval_result', label: '결재 결과', desc: '내가 올린 기안서의 승인·반려' },
  { key: 'leave_result',    label: '휴가 결과', desc: '내 휴가 신청의 승인·반려' },
  { key: 'assignment',      label: '담당 배정', desc: '고객·점검 담당 배정, 인수인계' },
  { key: 'deadline',        label: '점검 마감 임박', desc: '점검 단계 마감 임박 (매일 자동 발송)' },
]

export function NotificationSettingsClient({ initialPrefs }: { initialPrefs: Record<string, boolean> }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const { key } of OPTIONAL_ROWS) init[key] = initialPrefs[key] !== false // 미설정 = 수신
    return init
  })
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  function toggle(key: string) {
    setDone(false)
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function handleSave() {
    setError('')
    setDone(false)
    startTransition(async () => {
      const res = await updateNotificationPrefsAction(prefs)
      if (res.error) { setError(res.error); return }
      setDone(true)
    })
  }

  const rowCls = 'flex items-center gap-3 py-2.5'

  return (
    <div>
      <div className="divide-y divide-[#f0eefa]">
        {REQUIRED_ROWS.map(({ label, desc }) => (
          <div key={label} className={rowCls}>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#090c1d] font-medium">{label}</p>
              <p className="text-[11px] text-[#b0acd6]">{desc}</p>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#8b87b8] bg-[#f5f4ff] px-2 py-1 rounded-full shrink-0">
              <Lock className="size-3" /> 항상 수신
            </span>
          </div>
        ))}
        {OPTIONAL_ROWS.map(({ key, label, desc }) => (
          <div key={key} className={rowCls}>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#090c1d] font-medium">{label}</p>
              <p className="text-[11px] text-[#b0acd6]">{desc}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[key]}
              aria-label={label}
              onClick={() => toggle(key)}
              className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0 ${
                prefs[key] ? 'bg-[#7b68ee]' : 'bg-[#d0ccf5]'
              }`}
            >
              <span className={`absolute top-0.5 size-4.5 rounded-full bg-white shadow transition-all ${
                prefs[key] ? 'left-[calc(100%-1.25rem)]' : 'left-0.5'
              }`} />
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-2">{error}</p>}
      {done && (
        <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 mt-2 flex items-center gap-1.5">
          <Check className="size-3.5" /> 알림 설정이 저장되었습니다.
        </p>
      )}
      <button
        onClick={handleSave}
        disabled={isPending}
        className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors disabled:opacity-50"
      >
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        저장
      </button>
    </div>
  )
}
