'use client'

import { useEffect } from 'react'

/** 테마 쿠키 유실 보정 (소방계획서_29 S1-5) — 렌더 없음.
 *
 *  로그인·변경 경로가 쿠키를 채우지만, 세션은 살아 있는데 쿠키만 사라진 기기
 *  (쿠키 정리·만료)에서는 인라인 스크립트가 기본값(light)으로 그린다.
 *  여기서 DB 정본과 대조해 어긋나 있으면 클래스와 쿠키를 정본 쪽으로 되돌린다.
 *  dbTheme가 null(151 미적용·미설정)이면 아무것도 하지 않는다. */
export function ThemeSync({ dbTheme }: { dbTheme: 'light' | 'dark' | null }) {
  useEffect(() => {
    if (!dbTheme) return
    const want = dbTheme === 'dark'
    const root = document.documentElement
    if (root.classList.contains('dark') !== want) {
      root.classList.toggle('dark', want)
    }
    if (!document.cookie.split('; ').includes(`erp-theme=${dbTheme}`)) {
      document.cookie = `erp-theme=${dbTheme}; path=/; max-age=31536000; samesite=lax`
    }
  }, [dbTheme])
  return null
}
