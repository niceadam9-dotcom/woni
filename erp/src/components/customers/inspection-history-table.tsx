'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { inspectionNatureBadge } from '@/lib/inspection-nature'
import { getCustomerStepProgressAction } from '@/app/(dashboard)/customers/history-actions'
import type { StepProgress } from '@/lib/customer-step-progress'
import type { InspectionStatus, InspectionType, PlanType } from '@/types'

/** [이력] 탭 점검 이력 표 — 행은 서버가 내려주고, **진행바만** 마운트 뒤 액션으로 받는다.
 *  속도 개선 3단계(2026-10-01): 이력 탭은 lazy 마운트라 이 조회는 탭을 처음 열 때 한 번 돈다.
 *  (종전엔 페이지 서버 렌더가 매 방문 돌렸다 — 단계·불량·✕ fetchAllRows 3회) */

export type HistoryInspectionRow = {
  id: string; year: number; sequence_num: number
  inspection_type: InspectionType; plan_type: PlanType | string | null
  inspection_start_date: string | null; status: string
  employeeName: string | null
}

const STATUS_LABELS: Record<InspectionStatus, string> = {
  scheduled: '예정',
  in_progress: '진행중',
  completed: '완료',
  overdue: '기한초과',
}

const STATUS_COLORS: Record<InspectionStatus, string> = {
  scheduled: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-brand-tint text-brand',
  completed: 'bg-green-50 text-green-700',
  overdue: 'bg-red-50 text-red-600',
}

export function InspectionHistoryTable({ customerId, rows }: { customerId: string; rows: HistoryInspectionRow[] }) {
  // null = 아직 안 받음(「…」), {} = 받았는데 단계 없음(「—」)
  const [progress, setProgress] = useState<StepProgress | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (rows.length === 0) return
    let alive = true
    getCustomerStepProgressAction(customerId)
      .then(r => { if (!alive) return; if (r.progress) setProgress(r.progress); else setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [customerId, rows.length])

  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-form-base">
        <thead>
          <tr className="border-b border-brand-line-soft">
            <th className="text-left text-form-sm font-medium text-ink-sub pb-2 pr-4">연도/차수</th>
            <th className="text-left text-form-sm font-medium text-ink-sub pb-2 pr-4">유형</th>
            <th className="text-left text-form-sm font-medium text-ink-sub pb-2 pr-4">시작일</th>
            <th className="text-left text-form-sm font-medium text-ink-sub pb-2 pr-4">담당자</th>
            <th className="text-left text-form-sm font-medium text-ink-sub pb-2 pr-4">진행</th>
            <th className="text-left text-form-sm font-medium text-ink-sub pb-2">상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(insp => {
            const steps = progress?.[insp.id] ?? { total: 0, completed: 0 }
            const nb = inspectionNatureBadge(insp.inspection_type, insp.plan_type as PlanType | null)
            return (
              <tr key={insp.id} className="border-b border-paper last:border-0 hover:bg-paper transition-colors">
                <td className="py-3 pr-4">
                  <Link href={`/inspections/${insp.id}`} className="font-medium text-ink hover:text-brand">
                    {insp.year}년 {insp.sequence_num}차
                  </Link>
                </td>
                <td className="py-3 pr-4">
                  <span className={`text-form-sm font-medium px-2 py-0.5 rounded-full ${nb.className}`}>{nb.label}</span>
                </td>
                <td className="py-3 pr-4 text-ink-sub">{insp.inspection_start_date}</td>
                <td className="py-3 pr-4 text-ink-sub">
                  {insp.employeeName ?? <span className="text-ink-faint">미배정</span>}
                </td>
                <td className="py-3 pr-4" data-testid="history-progress">
                  {steps.total > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-brand-line-soft rounded-full overflow-hidden">
                        <div className="h-full bg-brand rounded-full" style={{ width: `${(steps.completed / steps.total) * 100}%` }} />
                      </div>
                      <span className="text-form-sm text-ink-sub">{steps.completed}/{steps.total}</span>
                    </div>
                  ) : progress === null && !failed ? (
                    <span className="text-form-sm text-ink-faint" aria-busy="true">…</span>
                  ) : (
                    <span className="text-form-sm text-ink-faint" title={failed ? '진행 단계를 불러오지 못했습니다' : undefined}>—</span>
                  )}
                </td>
                <td className="py-3">
                  <span className={`text-form-sm font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[insp.status as InspectionStatus]}`}>
                    {STATUS_LABELS[insp.status as InspectionStatus]}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
