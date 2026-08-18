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

/** 최근 본 고객 스트립 — 목록 위 칩. **그 화면의 표와 같은 곳으로 간다**(2026-08-18 사용자 확정).
 *
 *  경위: 처음엔 화면마다 제각각이었고(고객관리=상세 / 점검업무=?q 목록 필터), 이를 '어디서든
 *  고객 상세'로 단일화했다가, 점검업무에서는 **표의 고객명이 점검 상세로 간다**는 점 때문에
 *  칩만 고객 상세로 빠지는 화면 내 불일치가 남았다. 그래서 기준을 '전 화면 동일'이 아니라
 *  **'그 화면의 표와 동일'**로 잡는다 — 같은 화면에서 같은 이름을 누르면 같은 데로 가야 한다.
 *
 *  target='inspection'은 고객→점검을 서버에서 푸는 징검다리 라우트로 보낸다
 *  (localStorage 목록이라 링크를 미리 만들 수 없다 — by-customer/[customerId] 주석 참조).
 *
 *  localStorage는 서버에 없으므로 첫 렌더에선 아무것도 그리지 않는다(하이드레이션 불일치 방지). */
export function RecentCustomersStrip({ userId, target = 'customer' }: {
  userId: string
  /** 'customer'=고객 상세(고객관리) · 'inspection'=그 고객의 최근 점검 상세(점검업무, 없으면 고객 상세로 폴백) */
  target?: 'customer' | 'inspection'
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
      {items.map(c => (
        <Link
          key={c.id}
          href={target === 'inspection' ? `/inspections/by-customer/${c.id}` : `/customers/${c.id}`}
          title={target === 'inspection' ? `${c.name} 최근 점검 상세로 이동` : `${c.name} 상세 조회로 이동`}
          className="inline-flex items-center h-7 px-2.5 rounded-full border text-xs transition-colors max-w-[12rem] truncate border-[#d0ccf5] bg-white text-[#514b81] hover:bg-[#f5f4ff] hover:text-[#7b68ee]"
        >
          {c.name}
        </Link>
      ))}
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
