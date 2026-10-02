'use client'

import { useState, useTransition } from 'react'
import { Award, Loader2 } from 'lucide-react'
import { getCapabilityEvalAction } from '@/app/(dashboard)/customers/ledger/capability-actions'
import { defaultEvalYear } from '@/lib/capability-eval'
import { todayKst } from '@/lib/kst-date'

/** B5 — 점검능력평가 실적 묶음 내려받기(시트 셋: 점검 실적 · 기술인력 · 세금계산서).
 *  신청 기간(1/1~2/15)엔 작년이 기본이다. 매니저 이상(세금계산서 금액 포함)만 보인다. */
export function CapabilityEvalButton() {
  const thisYear = Number(todayKst().slice(0, 4))
  const [year, setYear] = useState(defaultEvalYear(todayKst()))
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  function run() {
    setMsg('')
    start(async () => {
      const res = await getCapabilityEvalAction(year)
      if ('error' in res) { setMsg(`❌ ${res.error}`); return }
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      // 빈 시트도 머리글은 남긴다 — 「0건」과 「안 만들어짐」을 구별하게
      const sheet = (rows: Record<string, string | number>[], head: string[]) =>
        rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([head])
      XLSX.utils.book_append_sheet(wb, sheet(res.inspections, ['번호', '상태', '대상물']), '점검 실적')
      XLSX.utils.book_append_sheet(wb, sheet(res.staff, ['이름', '자격 구분', '경력수첩번호']), '기술인력')
      XLSX.utils.book_append_sheet(wb, sheet(res.invoices, ['발행일', '승인번호', '고객']), '세금계산서')
      XLSX.writeFile(wb, `점검능력평가_실적_${res.year}.xlsx`)
      const done = res.inspections.filter(r => r['상태'] === '완료').length
      setMsg(`✅ ${res.year}년 점검 ${res.inspections.length}건(완료 ${done}) · 기술인력 ${res.staff.length}명 · 세금계산서 ${res.invoices.length}건${res.warnings.length ? ` — ⚠ ${res.warnings.join(' · ')}` : ''}`)
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="capability-eval">
      <select value={year} onChange={e => setYear(Number(e.target.value))} data-testid="capability-eval-year"
        className="h-9 rounded-lg border border-brand-line px-2 text-sm">
        {[thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}년</option>)}
      </select>
      <button onClick={run} disabled={pending} data-testid="capability-eval-export"
        title="점검능력평가 신청(매년 1/1~2/15) 서류 작성용 — 점검 실적·기술인력·세금계산서 3시트"
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-brand-line text-sm text-brand hover:bg-brand-tint transition-colors disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Award className="size-4" />} 능력평가 실적
      </button>
      {msg && <span className={`basis-full text-xs ${msg.startsWith('❌') ? 'text-red-600' : 'text-ink-sub'}`} data-testid="capability-eval-msg">{msg}</span>}
    </div>
  )
}
