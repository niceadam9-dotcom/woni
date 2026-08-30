'use client'

import { useState, useTransition } from 'react'
import { Sun, Moon, Check, Loader2 } from 'lucide-react'
import { updateThemeAction } from '@/app/(dashboard)/settings/actions'

/** 화면 테마 2택 (소방계획서_29 S1-6) — 「화이트(현재) / 다크」, 클릭 즉시 적용(저장 버튼 없음).
 *
 *  낙관 적용: 클릭 즉시 <html> 클래스를 바꿔 체감을 살리고, 서버 액션(DB+쿠키) 실패 시 되돌린다.
 *  ⚠ 토큰 치환(S2) 전에는 다크가 미완성으로 보인다 — 그래서 이 카드는 롤아웃 전까지
 *  관리자에게만 노출된다(settings/page.tsx, D-6). */

const OPTIONS = [
  { value: 'light' as const, label: '화이트', desc: '현재 기본 화면', Icon: Sun },
  { value: 'dark' as const, label: '다크', desc: '어두운 화면 — 준비 중(단계 도입)', Icon: Moon },
]

function applyDom(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function ThemeSettingsClient({ initialTheme }: { initialTheme: 'light' | 'dark' }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function choose(next: 'light' | 'dark') {
    if (next === theme || isPending) return
    setError('')
    setSaved(false)
    const prev = theme
    setTheme(next)
    applyDom(next)
    startTransition(async () => {
      const res = await updateThemeAction(next)
      if (res.error) {
        setTheme(prev)
        applyDom(prev)
        setError(res.error)
        return
      }
      setSaved(true)
    })
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="화면 테마">
        {OPTIONS.map(({ value, label, desc, Icon }) => {
          const active = theme === value
          return (
            <button key={value} type="button" role="radio" aria-checked={active}
              onClick={() => choose(value)} disabled={isPending}
              data-testid={`theme-option-${value}`}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                active ? 'border-brand bg-brand-tint' : 'border-line hover:bg-paper'}`}>
              <Icon className={`size-4 shrink-0 ${active ? 'text-brand' : 'text-ink-sub'}`} />
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-medium ${active ? 'text-brand' : 'text-ink'}`}>{label}</span>
                {/* S7-1 — 옵션 설명은 무엇을 고르는지 알려주는 정보다 */}
                <span className="block text-[11px] text-ink-meta">{desc}</span>
              </span>
              {active && !isPending && <Check className="size-4 text-brand shrink-0" data-testid="theme-active-check" />}
              {active && isPending && <Loader2 className="size-4 text-brand shrink-0 animate-spin" />}
            </button>
          )
        })}
      </div>
      {saved && <p className="mt-2 text-[11px] text-green-600" data-testid="theme-saved">✓ 저장됨 — 다른 기기에도 로그인하면 적용됩니다</p>}
      {error && <p className="mt-2 text-[11px] text-red-600" data-testid="theme-error">{error}</p>}
    </div>
  )
}
