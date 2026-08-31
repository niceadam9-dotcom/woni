'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { inspectionTypeLabel } from '@/types'
import type { AddressDuplicateCustomer, AddressDuplicateBuilding } from '@/app/(dashboard)/customers/actions'

/** ADD-2: 주소 중복 등록 안내 팝업 — 고객 신규 등록·고객 주소 변경·건물 등록에서 공용.
 *  차단이 아니라 **안내**다. 같은 건물에 별도 계약이 실제로 존재하므로 확인 후 계속 진행할 수 있게 둔다. */
export function AddressDuplicateDialog({ customer, building, address, onClose, onContinue, continueLabel = '계속 등록' }: {
  customer?: AddressDuplicateCustomer | null
  building?: AddressDuplicateBuilding | null
  /** 지금 입력한 주소 — 유사일치일 때 저장된 주소와 나란히 보여준다 */
  address: string
  onClose: () => void
  onContinue: () => void
  continueLabel?: string
}) {
  if (!customer && !building) return null

  // 하나라도 글자까지 같으면 '이미 등록된 주소', 전부 상세주소만 다르면 '같은 건물로 보임'
  const exact = !!customer?.exact || !!building?.exact
  const title = exact ? '이미 등록된 주소입니다' : '같은 건물이 이미 등록되어 있습니다'

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
          <AlertTriangle className="size-4 text-amber-500" />
          <h3 className="text-sm font-bold text-ink">{title}</h3>
        </div>

        <div className="space-y-2">
          {customer && (
            <div className="rounded-lg bg-paper border border-brand-line-soft p-3 space-y-1 text-sm">
              <p className="text-[11px] font-medium text-brand">기존 고객</p>
              <p className="font-medium text-ink">{customer.customer_name}</p>
              <p className="text-xs text-ink-sub">
                점검유형: {inspectionTypeLabel(customer.inspection_type)} · 담당: {customer.employee_name ?? '미배정'}
              </p>
              {!customer.exact && customer.address && (
                <p className="text-xs text-ink-meta">등록된 주소: {customer.address}</p>
              )}
            </div>
          )}

          {building && (
            <div className="rounded-lg bg-paper border border-brand-line-soft p-3 space-y-1 text-sm">
              <p className="text-[11px] font-medium text-brand">기존 건물</p>
              <p className="font-medium text-ink">{building.building_name || '(건물명 없음)'}</p>
              <p className="text-xs text-ink-sub">고객: {building.customer_name ?? '-'}</p>
              {!building.exact && building.address && (
                <p className="text-xs text-ink-meta">등록된 주소: {building.address}</p>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-ink-sub mt-3">
          {exact
            ? '같은 주소가 이미 있습니다. 기존 정보를 확인하거나, 별도 건이 맞으면 계속 진행할 수 있습니다.'
            : `입력한 주소(${address})는 위와 동/호수만 다른 같은 건물로 보입니다. 별도 건이 맞으면 계속 진행할 수 있습니다.`}
        </p>

        <div className="flex gap-2 mt-4">
          <Link
            href={customer ? `/customers/${customer.id}` : `/customers/${building!.customer_id}`}
            className="flex-1 h-9 rounded-lg bg-brand hover:bg-brand-strong text-white text-sm font-medium transition-colors flex items-center justify-center"
          >
            기존 고객 보기
          </Link>
          <button
            type="button"
            onClick={onContinue}
            className="flex-1 h-9 rounded-lg border border-brand-line text-sm text-ink-sub hover:bg-paper transition-colors"
          >
            {continueLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
