'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Clock, X } from 'lucide-react'
import { readRecentCustomers, pushRecentCustomer, type RecentCustomer } from '@/lib/recent-customers'

/** 고객 상세를 열면 '최근 본 고객'에 기록한다 (기록 전용 — 아무것도 그리지 않음). */
export function RecordRecentCustomer({ userId, customerId, customerName }: {
  userId: string
  customerId: string
  customerName: string
}) {
  useEffect(() => {
    pushRecentCustomer(userId, { id: customerId, name: customerName })
  }, [userId, customerId, customerName])
  return null
}

/** 최근 본 고객 스트립 — 목록 위 칩.
 *
 *  링크 대상은 화면마다 다르다: 고객관리는 고객 상세로, 점검업무는 그 고객으로 목록을 거른다
 *  (?q=고객명 — 점검업무의 조회 구조를 건드리지 않고 고객명 검색을 재사용).
 *  대상은 함수가 아니라 문자열 모드로 받는다 — 서버 컴포넌트는 클라이언트로 함수를 넘길 수 없다.
 *
 *  localStorage는 서버에 없으므로 첫 렌더에선 아무것도 그리지 않는다(하이드레이션 불일치 방지). */
export function RecentCustomersStrip({ userId, linkMode, activeName }: {
  userId: string
  /** 'detail' = 고객 상세로 이동 · 'inspection-filter' = 점검 목록을 그 고객으로 필터 */
  linkMode: 'detail' | 'inspection-filter'
  /** 지금 보고 있는 필터값 — 해당 칩을 눌린 상태로 표시 (점검업무) */
  activeName?: string
}) {
  const [items, setItems] = useState<RecentCustomer[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setItems(readRecentCustomers(userId))
    setReady(true)
  }, [userId])

  if (!ready || items.length === 0) return null

  // 고객명은 아래 표에도 링크로 나온다 — 스트립 범위를 특정할 수 있게 표식을 남긴다(E2E 셀렉터)
  return (
    <div data-recent-strip className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#b0acd6] shrink-0">
        <Clock className="size-3" /> 최근 본 고객
      </span>
      {items.map(c => {
        const active = !!activeName && activeName === c.name
        const href = linkMode === 'detail'
          ? `/customers/${c.id}`
          // 이미 그 고객으로 걸러진 상태면 다시 눌러 해제 — 칩이 토글처럼 동작한다
          : active ? '/inspections' : `/inspections?q=${encodeURIComponent(c.name)}`
        return (
          <Link
            key={c.id}
            href={href}
            className={`inline-flex items-center h-7 px-2.5 rounded-full border text-xs transition-colors max-w-[12rem] truncate ${
              active
                ? 'border-[#7b68ee] bg-[#f5f4ff] text-[#7b68ee] font-medium'
                : 'border-[#d0ccf5] bg-white text-[#514b81] hover:bg-[#f5f4ff] hover:text-[#7b68ee]'
            }`}
          >
            {c.name}
          </Link>
        )
      })}
      <button
        type="button"
        onClick={() => {
          try { window.localStorage.removeItem(`recentCustomers:${userId}`) } catch { /* 무시 */ }
          setItems([])
        }}
        aria-label="최근 본 고객 지우기"
        className="p-1 rounded text-[#b0acd6] hover:text-[#514b81] transition-colors shrink-0"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
