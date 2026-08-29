'use client'

import { useEffect } from 'react'

/** 글자 배율 쿠키 유실 보정 (소방계획서_35 S4-5) — 렌더 없음. ThemeSync의 형제다.
 *
 *  로그인·변경 경로가 쿠키를 채우지만, 세션은 살아 있는데 쿠키만 사라진 기기
 *  (쿠키 정리·만료)에서는 인라인 스크립트가 기본값(md)으로 그린다.
 *  여기서 DB 정본과 대조해 어긋나 있으면 속성과 쿠키를 정본 쪽으로 되돌린다.
 *  dbScale이 null(154 미적용·미설정)이면 아무것도 하지 않는다.
 *
 *  ⚠ ThemeSync에 합치지 않고 형제로 둔 것은 의도다 — 테마 경로는 이미 운영에 나가
 *  검증된 코드이고, 여기서 손대 회귀를 만들 이유가 없다. 마운트 하나가 더 붙는 비용은
 *  useEffect 한 번뿐이다. */
export function FontScaleSync({ dbScale }: { dbScale: 'md' | 'lg' | 'xl' | null }) {
  useEffect(() => {
    if (!dbScale) return
    const root = document.documentElement
    if (root.getAttribute('data-fs') !== dbScale) {
      root.setAttribute('data-fs', dbScale)
    }
    if (!document.cookie.split('; ').includes(`erp-fs=${dbScale}`)) {
      document.cookie = `erp-fs=${dbScale}; path=/; max-age=31536000; samesite=lax`
    }
  }, [dbScale])
  return null
}
