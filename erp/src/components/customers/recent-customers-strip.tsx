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

/** 최근 본 고객 스트립 — 목록 위 칩. 어느 화면에서든 **고객 상세로 간다**.
 *
 *  종전엔 화면마다 대상이 달랐다(고객관리=상세 / 점검업무=?q로 목록 필터). 사용자 확정으로
 *  단일화한다(2026-08-18) — '최근 본 고객'은 방금 보던 고객으로 돌아가려는 동선인데,
 *  점검업무에서만 목록이 걸러지면 같은 칩이 화면에 따라 다르게 동작해 예측이 어긋난다.
 *  점검업무의 고객명 필터는 바로 아래 검색창이 그대로 담당한다.
 *
 *  localStorage는 서버에 없으므로 첫 렌더에선 아무것도 그리지 않는다(하이드레이션 불일치 방지). */
export function RecentCustomersStrip({ userId }: {
  userId: string
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
          href={`/customers/${c.id}`}
          title={`${c.name} 상세 조회로 이동`}
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
