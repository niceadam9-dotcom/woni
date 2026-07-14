'use client'

import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { NAV_GROUPS } from './sidebar'

/** 글로벌 바 좌측 브레드크럼 — 현재 경로를 사이드바 메뉴 정의와 최장 접두사 매칭 */
export function HeaderTitle() {
  const pathname = usePathname()

  let best: { group: string; label: string; icon: React.ElementType; len: number } | null = null
  for (const g of NAV_GROUPS) {
    for (const item of g.items) {
      if ((pathname === item.href || pathname.startsWith(item.href + '/')) && (!best || item.href.length > best.len)) {
        best = { group: g.label, label: item.label, icon: item.icon, len: item.href.length }
      }
    }
  }
  const isDashboard = !best && pathname === '/'

  if (!best && !isDashboard) return <div />
  const Icon = best?.icon

  return (
    <div className="flex items-center gap-1.5 min-w-0 text-sm">
      {best ? (
        <>
          <span className="text-[#b0acd6] shrink-0">{best.group}</span>
          <ChevronRight className="size-3.5 text-[#d5d2ea] shrink-0" />
          {Icon && <Icon className="size-4 text-[#7b68ee] shrink-0" />}
          <span className="font-semibold text-[#090c1d] truncate">{best.label}</span>
        </>
      ) : (
        <span className="font-semibold text-[#090c1d]">대시보드</span>
      )}
    </div>
  )
}
