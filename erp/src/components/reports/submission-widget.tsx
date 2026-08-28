'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, TableProperties } from 'lucide-react'
import { getSubmissionBoardAction, type SubmissionRow, type SubmissionSummary } from '@/app/(dashboard)/reports/docs-actions'
import { SubmissionBoard } from '@/components/reports/submission-board'

/** 대시보드 제출 현황 위젯 (소방계획서_8 H-6b·D-16) — 보고서 센터 제출 현황판의 이전지.
 *  요약 스트립(항상) + 펼침 시 기존 SubmissionBoard 테이블 그대로. 데이터는 클라이언트 1회 조회
 *  (getSubmissionBoardAction, 90일 창) — 대시보드 SSR 무부담. */

const cardShadow = 'shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]'

export function SubmissionWidget({ myId, defaultMine }: { myId: string; defaultMine: boolean }) {
  const [board, setBoard] = useState<{ rows: SubmissionRow[]; summary: SubmissionSummary } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    getSubmissionBoardAction()
      .then(res => { if (alive) setBoard(res) })
      .catch(() => { if (alive) setErr('제출 현황을 불러오지 못했습니다 — 잠시 후 다시 시도해주세요.') })
    return () => { alive = false }
  }, [])

  const s = board?.summary
  return (
    <div id="submissions" className={`bg-surface rounded-xl border border-line ${cardShadow} scroll-mt-4`}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-5 py-4 text-left">
        {open ? <ChevronDown className="size-3.5 text-ink-faint shrink-0" /> : <ChevronRight className="size-3.5 text-ink-faint shrink-0" />}
        <TableProperties className="size-4 text-brand" />
        <h2 className="text-sm font-semibold text-ink">제출 현황</h2>
        <span className="text-[10px] text-ink-faint">최근 90일 · 9호·배치확인서·10·11호</span>
        {/* 요약 스트립 — 펼치지 않아도 위험 신호가 보이게 */}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] shrink-0">
          {!board && !err && <Loader2 className="size-3.5 animate-spin text-ink-faint" />}
          {err && <span className="text-red-600">{err}</span>}
          {s && (
            <>
              <span className={`px-2 py-0.5 rounded-full ${s.overdue > 0 ? 'bg-red-50 text-red-600 font-semibold' : 'bg-green-50 text-green-700'}`}>
                기한초과 {s.overdue}
              </span>
              <span className={`px-2 py-0.5 rounded-full ${s.r9NotSubmitted > 0 ? 'bg-amber-50 text-amber-700' : 'bg-brand-line-soft text-ink-sub'}`}>
                9호 미제출 {s.r9NotSubmitted}
              </span>
              <span className={`px-2 py-0.5 rounded-full ${s.certMissing > 0 ? 'bg-amber-50 text-amber-700' : 'bg-brand-line-soft text-ink-sub'}`}>
                배치확인서 누락 {s.certMissing}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700">완료 {s.completed}</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-[#f0eefa] dark:border-line px-5 pb-4 pt-3">
          {board
            ? <SubmissionBoard rows={board.rows} summary={board.summary} myId={myId} defaultMine={defaultMine} />
            : <p className="text-xs text-ink-faint py-4 inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> 불러오는 중…</p>}
        </div>
      )}
    </div>
  )
}
