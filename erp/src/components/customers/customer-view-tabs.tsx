'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, TableProperties } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 고객 관리 상단 뷰 탭 — 같은 원천(customers)을 다른 열 구성으로 본다 (소방계획서_21 R8-3).
 *  점검 대장은 종전 /inspection-ledger 단독 메뉴였으나 customers를 통째로 읽는 뷰라 여기로 흡수했다.
 *  구 경로는 /customers/ledger로 리다이렉트한다. */
const TABS = [
  { href: '/customers', label: '고객 목록', icon: Users },
  { href: '/customers/ledger', label: '점검 대장', icon: TableProperties },
]

export function CustomerViewTabs() {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1 border-b border-line">
      {TABS.map(t => {
        const isActive = pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              isActive
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-sub hover:text-brand hover:border-brand-line'
            )}
          >
            <t.icon className="size-4 shrink-0" />
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
