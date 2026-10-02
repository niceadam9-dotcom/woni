'use client'

/** 3단계 「관계인 보고」 칸의 보수 견적 한 줄 (불량 → 매출 해결방안 절 「③ 칸 불량 한 줄」, 2026-10-02)
 *
 *  관계인에게 점검 결과를 보고하는 자리에서 「불량이 몇 건이고, 보수 견적은 보냈는가」를 같이 보여 준다.
 *  종전 3단계 칸은 수신 정보·발송 방식만 있어서, 보고와 보수 제안이 서로 다른 화면에 흩어져 있었다.
 *  칸이 열릴 때 한 번 액션으로 읽는다(lazy). 견적 작성은 보수 견적 페이지가 정본이라 여기는 현황과 링크만. */
import { useEffect, useState } from 'react'
import NextLink from 'next/link'
import { getRepairSalesAction } from '@/app/(dashboard)/inspections/repair-sales-actions'

const DEAD = new Set(['취소', '만료'])

export function OwnerReportQuoteLine({ inspectionId, defectTotal }: { inspectionId: string; defectTotal: number }) {
  const [state, setState] = useState<{ quoted: number; latest: { number: string; status: string } | null } | null>(null)
  useEffect(() => {
    let alive = true
    getRepairSalesAction(inspectionId).then(r => {
      if (!alive || r.error) return
      const live = r.quotes.filter(q => !DEAD.has(q.status))
      const ids = new Set<string>()
      for (const q of live) for (const it of q.items ?? []) for (const d of it.defect_ids ?? []) ids.add(d)
      setState({ quoted: ids.size, latest: live[0] ? { number: live[0].quote_number, status: live[0].status } : null })
    })
    return () => { alive = false }
  }, [inspectionId])

  if (defectTotal === 0) return null
  const href = `/inspections/${inspectionId}/repair?from=${encodeURIComponent(`/inspections/${inspectionId}?step=3`)}`
  return (
    <div className="mx-1 mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-brand-line-soft px-2 py-1.5 text-form-xs" data-testid="owner-report-quote-line">
      <span className="font-semibold text-ink-sub">보수 견적</span>
      <span>불량 {defectTotal}건</span>
      {!state ? <span className="text-ink-meta">확인 중…</span>
        : state.latest ? (
          <span data-testid="owner-quote-latest">
            · 견적 {state.latest.number} <b>{state.latest.status}</b>
            {state.quoted < defectTotal && <span className="text-amber-700"> · 견적 없는 불량 {defectTotal - state.quoted}건</span>}
          </span>
        ) : <span className="text-amber-700" data-testid="owner-quote-none">· 견적 미작성</span>}
      <NextLink href={href} className="ml-auto underline text-brand" data-testid="owner-quote-open">보수 견적 페이지</NextLink>
    </div>
  )
}
