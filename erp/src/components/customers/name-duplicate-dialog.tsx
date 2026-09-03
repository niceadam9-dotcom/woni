'use client'

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { inspectionTypeLabel } from '@/types'
import type { NameDuplicateCustomer } from '@/app/(dashboard)/customers/actions'

/** 고객명 중복 **차단** 안내 — 주소 축(`AddressDuplicateDialog`)과 달리 [계속 등록]이 없다.
 *
 *  두 축의 정책이 다른 이유: 같은 **주소**에 별도 계약이 실제로 존재하지만(한 건물에 여러 임차인),
 *  같은 **이름**의 고객이 둘인 것은 목록·검색·보고서에서 서로를 구분할 방법이 없어진다.
 *  그래서 주소는 경고, 이름은 차단이다. */
export function NameDuplicateDialog({ customer, onClose }: {
  customer: NameDuplicateCustomer
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 bg-black/25 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl border border-brand-line shadow-xl w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="size-4 text-red-500" />
          <h3 className="text-sm font-bold text-ink">이미 등록된 고객입니다</h3>
        </div>

        <div className="rounded-lg bg-paper border border-brand-line-soft p-3 space-y-1 text-sm">
          <p className="text-[11px] font-medium text-brand">기존 고객</p>
          <p className="font-medium text-ink">{customer.customer_name}</p>
          <p className="text-xs text-ink-sub">
            고객코드 {customer.customer_code} · 점검유형 {inspectionTypeLabel(customer.inspection_type)} · 담당 {customer.employee_name ?? '미배정'}
          </p>
          {customer.address && (
            <p className="text-xs text-ink-meta">{customer.address}</p>
          )}
        </div>

        <p className="text-xs text-ink-sub mt-3">
          같은 이름으로는 새로 등록할 수 없습니다. 기존 고객을 확인하시거나,
          별개 건물이라면 구분되는 이름(예: 동/호수 표기)으로 바꿔 등록해주세요.
        </p>

        <div className="flex gap-2 mt-4">
          <Link
            href={`/customers/${customer.id}`}
            className="flex-1 h-9 rounded-lg bg-brand hover:bg-brand-strong text-white text-sm font-medium transition-colors flex items-center justify-center"
          >
            기존 고객 보기
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-9 rounded-lg border border-brand-line text-sm text-ink-sub hover:bg-paper transition-colors"
          >
            이름 수정하기
          </button>
        </div>
      </div>
    </div>
  )
}
