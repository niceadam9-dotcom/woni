'use client'

import { useEffect, useState, useTransition } from 'react'
import { Sun, Moon } from 'lucide-react'
import { updateThemeAction } from '@/app/(dashboard)/settings/actions'

/** 헤더 테마 빠른 토글 (소방계획서_29 S1-7) — 설정 카드와 같은 액션을 재사용한다.
 *  롤아웃 전까지 관리자에게만 노출(header.tsx, D-6).
 *  현재값은 <html> 클래스에서 읽는다(인라인 스크립트·ThemeSync가 이미 정본과 맞춰 둔 상태). */
export function ThemeToggle() {
  const [dark, setDark] = useState(false)
  const [isPending, startTransition] = useTransition()
  // SSR은 클래스를 모른다 — 마운트 후 실제 DOM에서 읽어 하이드레이션 불일치를 피한다
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')) }, [])

  function toggle() {
    if (isPending) return
    const next = dark ? 'light' : 'dark'
    setDark(!dark)
    document.documentElement.classList.toggle('dark', next === 'dark')
    startTransition(async () => {
      const res = await updateThemeAction(next)
      if (res.error) {
        setDark(dark)
        document.documentElement.classList.toggle('dark', dark)
      }
    })
  }

  return (
    <button type="button" onClick={toggle} disabled={isPending} data-testid="header-theme-toggle"
      aria-label={dark ? '화이트 모드로 전환' : '다크 모드로 전환'}
      className="size-9 flex items-center justify-center rounded-lg text-ink-sub hover:bg-brand-tint hover:text-brand transition-colors disabled:opacity-60">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}
