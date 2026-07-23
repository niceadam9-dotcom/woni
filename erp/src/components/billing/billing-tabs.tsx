'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** 정산현황 탭 (소방계획서_5 §7-B R15-b) — '안전관리 대장'(월별 수금 현황)을 정산현황의 탭으로 흡수.
 *  청구·수금 현황(/billing/status) ↔ 월별 대장(/billing/annual)을 한 화면의 두 탭처럼. */
const TABS = [
  { href: '/billing/status', label: '청구·수금 현황' },
  { href: '/billing/annual', label: '월별 대장' },
]

export function BillingTabs() {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-[#e0ddf5] mb-4">
      {TABS.map(t => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link key={t.href} href={t.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active
              ? 'border-[#7b68ee] text-[#7b68ee]' : 'border-transparent text-[#514b81] hover:text-[#7b68ee]'}`}>
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
