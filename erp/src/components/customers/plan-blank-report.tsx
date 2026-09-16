'use client'

/** 빈칸 보고 패널 — 각 서식 화면 아래에 붙어 「이 절이 엑셀에서 어디가 비나」를 알린다.
 *
 *  🚨 **두 가지 빈칸을 색과 말로 갈라 보인다.**
 *    · 회색 「ERP 미배선」 — 우리 할 일이다. 사용자가 채울 수 없다. 엑셀에서 직접 적어야 한다.
 *    · 노랑 「미입력」     — 사용자 할 일이다. 이 화면에서 채우면 엑셀에 들어간다.
 *    섞어 보이면 사용자가 **채울 수 없는 칸을 채우려 든다**. 그래서 미배선을 **먼저** 보인다
 *    (목록 정렬은 `lib/fire-plan-blanks`가 이미 그렇게 준다 — 화면이 다시 정하지 않는다).
 *
 *  ⭐ 요약(「시트 N장 · ERP 미배선 M칸」)은 **고객 축이 없어** 서버에서 미리 계산해 내려온다.
 *    상세 목록만 누를 때 조회한다 — 조립이 7쿼리 + 스토리지라 늘 돌릴 것이 아니다.
 */
import { useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { firePlanBlanksAction } from '@/app/(dashboard)/customers/fire-plan-blank-actions'
import type { SheetBlankReport, FormBlankSummary } from '@/lib/fire-plan-blanks'

export function PlanBlankReport({ customerId, sheetNames, summary, canManage }: {
  customerId: string
  sheetNames: string[]
  summary: FormBlankSummary
  canManage: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reports, setReports] = useState<SheetBlankReport[] | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const unwired = summary.slots - summary.wired + summary.boxes - summary.wiredBoxes
  const total = summary.slots + summary.boxes

  function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (reports) return                       // 한 번 받은 것은 다시 묻지 않는다
    setError('')
    startTransition(async () => {
      const res = await firePlanBlanksAction(customerId, sheetNames)
      if (res.error) { setError(res.error); return }
      setReports(res.reports ?? [])
    })
  }

  if (summary.sheets === 0) return null       // 담당 시트가 없는 노드(보고서 커버)

  return (
    <div data-testid="plan-blank-report" className="mt-4 rounded-xl border border-brand-line-soft bg-surface">
      <button onClick={toggle} data-testid="plan-blank-toggle"
        className="w-full flex items-center gap-2 px-3 py-2 text-form-xs text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="font-medium text-ink-sub">엑셀 빈칸</span>
        <span className="text-ink-meta">
          이 절이 담당하는 서식 {summary.sheets}장 · 칸 {total}개
        </span>
        {unwired > 0 && (
          <span data-testid="plan-blank-unwired-badge"
            className="ml-auto shrink-0 rounded-md bg-ink-meta/10 px-1.5 py-0.5 text-form-2xs text-ink-meta">
            ERP 미배선 {unwired}
          </span>
        )}
        {unwired === 0 && (
          <span className="ml-auto shrink-0 text-form-2xs text-green-600">ERP가 전 칸을 채웁니다</span>
        )}
      </button>

      {open && (
        <div className="border-t border-brand-line-soft px-3 py-2 space-y-2">
          {isPending && (
            <p className="flex items-center gap-1.5 text-form-xs text-ink-meta">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 지금 내용으로 계산 중…
            </p>
          )}
          {error && <p className="text-form-xs text-red-600">❌ {error}</p>}

          {reports?.map(r => (
            <div key={r.sheet} className="text-form-xs">
              <p className="font-medium text-ink-sub">
                {r.sheet}
                <span className="ml-2 font-normal text-ink-meta">
                  칸 {r.slots + r.boxes} · ERP가 채움 {r.wired + r.wiredBoxes}
                </span>
              </p>
              {r.blanks.length === 0
                ? <p className="pl-2 text-green-600">빈칸 없음</p>
                : (
                  <ul className="pl-2 space-y-0.5">
                    {r.blanks.slice(0, 20).map(b => (
                      <li key={b.ref} className="flex items-center gap-1.5">
                        <span className={`shrink-0 rounded px-1 text-form-2xs ${
                          b.kind === 'unwired' ? 'bg-ink-meta/10 text-ink-meta' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {b.kind === 'unwired' ? 'ERP 미배선' : '미입력'}
                        </span>
                        <span className="text-ink-meta">{b.near || b.ref}</span>
                      </li>
                    ))}
                    {r.blanks.length > 20 && (
                      // 🚨 자른 사실을 **드러낸다**. 조용한 절단은 조용한 누락이다.
                      <li className="text-ink-meta">…외 {r.blanks.length - 20}칸</li>
                    )}
                  </ul>
                )}
            </div>
          ))}

          {reports && (
            <p className="border-t border-brand-line-soft pt-2 text-form-2xs text-ink-meta">
              <span className="rounded bg-amber-100 px-1 text-amber-700">미입력</span>
              {' '}은 이 화면에서 채우면 엑셀에 들어갑니다.{' '}
              <span className="rounded bg-ink-meta/10 px-1">ERP 미배선</span>
              {' '}은 아직 ERP가 못 채우는 칸이라 받은 엑셀에서 직접 적으셔야 합니다
              {canManage ? '' : ' (읽기 전용 권한)'}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
