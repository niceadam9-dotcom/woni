'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

/** 행 전체 클릭 = 상세 이동 (설계 §6-B-B1) — 인라인 편집·링크·버튼 클릭은 내비게이션 제외 */
export function ClickableRow({ href, className, children }: {
  href: string
  className?: string
  children: ReactNode
}) {
  const router = useRouter()
  return (
    <tr
      className={className}
      onClick={e => {
        const t = e.target as HTMLElement
        if (t.closest('a,button,input,select,textarea,[data-rowstop]')) return
        router.push(href)
      }}
    >
      {children}
    </tr>
  )
}
