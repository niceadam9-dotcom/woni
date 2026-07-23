'use client'

import { useEffect, useState, useTransition } from 'react'
import { CalendarPlus, Loader2, CheckCircle2, RefreshCw } from 'lucide-react'
import { getAnnualTargetsAction, bulkAnnualIssueAction, type AnnualTargets } from '@/app/(dashboard)/fire-plans/generate/actions'

/** P-1 연차 일괄 발행 마법사 (소방계획서_5 §8 P-1) — 연초 전 고객 소방계획서 갱신을 1클릭으로.
 *  대상(활성·일반관리 제외) 중 해당 연도 미발행 건을 생성 큐에 일괄 등록. 워커가 순차 처리. */
export function AnnualIssueWizard({ defaultYear }: { defaultYear: number }) {
  const [year, setYear] = useState(defaultYear)
  const [targets, setTargets] = useState<AnnualTargets | null>(null)
  const [loading, startLoad] = useTransition()
  const [issuing, startIssue] = useTransition()
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  function refresh(y: number) {
    startLoad(async () => {
      const res = await getAnnualTargetsAction(y)
      if (res.targets) setTargets(res.targets)
    })
  }
  useEffect(() => { refresh(year) }, [year])

  function issue() {
    if (!targets || targets.remaining === 0) return
    if (!window.confirm(`${year}년 소방계획서 미발행 ${targets.remaining}건을 일괄 생성 요청합니다.\n워커가 순차 처리하며, 완료되면 각 고객 보관함·문서 현황에 등록됩니다. 진행할까요?`)) return
    setMsg(null)
    startIssue(async () => {
      const res = await bulkAnnualIssueAction(year)
      if (res.error) { setMsg({ text: `❌ ${res.error}`, ok: false }); return }
      setMsg({ text: `✅ ${res.requested ?? 0}건 생성 요청됨 — 워커가 처리합니다`, ok: true })
      refresh(year)
    })
  }

  const yearOptions = [defaultYear - 1, defaultYear, defaultYear + 1]

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <CalendarPlus className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">연차 일괄 발행</h2>
        <span className="text-[11px] text-[#b0acd6]">전 고객 소방계획서를 연초에 한 번에 갱신</span>
      </div>

      <div className="flex items-center gap-2 my-3">
        <span className="text-xs text-[#514b81]">발행 연도</span>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="h-8 rounded-lg border border-[#d0ccf5] bg-white px-2 text-sm outline-none focus:border-[#7b68ee]">
          {yearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
        <button onClick={() => refresh(year)} disabled={loading} className="text-[11px] text-[#7b68ee] hover:underline inline-flex items-center gap-1">
          {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} 새로고침
        </button>
      </div>

      {targets && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { label: '대상 고객', value: targets.total, tone: 'text-[#090c1d]' },
            { label: '발행 완료', value: targets.issued, tone: 'text-green-700' },
            { label: '대기·진행', value: targets.pending, tone: 'text-blue-600' },
            { label: '미발행', value: targets.remaining, tone: 'text-amber-600' },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-[#eceafd] p-2.5 text-center">
              <p className={`text-xl font-bold ${s.tone}`}>{s.value}</p>
              <p className="text-[10px] text-[#514b81] mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {msg && <p className={`text-[11px] mb-2 ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}

      <div className="flex items-center gap-2">
        <button onClick={issue} disabled={issuing || !targets || targets.remaining === 0}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-sm font-medium disabled:opacity-50">
          {issuing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {targets && targets.remaining > 0 ? `${year}년 미발행 ${targets.remaining}건 일괄 발행` : `${year}년 미발행 없음`}
        </button>
        <span className="text-[11px] text-[#b0acd6]">이미 발행·대기 중인 건은 자동 제외 (최대 500건/회)</span>
      </div>
    </div>
  )
}
