'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Circle, Clock3 } from 'lucide-react'
import type { SubmissionRow, SubmissionSummary } from '@/app/(dashboard)/reports/docs-actions'

/** §7-A 제출 현황판 (소방계획서_5 R14-a·R14-b) — 타임라인 필드 단일 소스, 수기 입력 없음.
 *  숫자 요약 스트립(숫자=필터 버튼) + 위험순 표. 앰버·빨강만 훑으면 감시 끝(모니터링 2층). */

type FilterKey = 'all' | 'r9NotSubmitted' | 'overdue' | 'certMissing' | 'completed'

const cell = 'px-2 py-2 text-xs'

function Mark({ ok, na, warn, label }: { ok?: boolean; na?: boolean; warn?: boolean; label: string }) {
  if (na) return <span className="inline-flex items-center gap-1 text-[#b0acd6]"><Circle className="size-3" /> {label}</span>
  if (ok) return <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="size-3" /> {label}</span>
  return <span className={`inline-flex items-center gap-1 ${warn ? 'text-amber-600' : 'text-[#b0acd6]'}`}><AlertTriangle className="size-3" /> {label}</span>
}

export function SubmissionBoard({ rows, summary }: { rows: SubmissionRow[]; summary: SubmissionSummary }) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const filtered = rows.filter(r => {
    if (filter === 'all') return true
    if (filter === 'r9NotSubmitted') return !r.report9SubmittedAt && r.status === 'completed'
    if (filter === 'overdue') return r.due9Dday !== null && r.due9Dday < 0
    if (filter === 'certMissing') return r.status === 'completed' && !r.certUploaded
    if (filter === 'completed') return r.status === 'completed'
    return true
  })

  const strip: Array<{ key: FilterKey; label: string; value: number; tone: string }> = [
    { key: 'completed', label: '이번 달 자체점검', value: summary.monthSelf, tone: 'text-[#514b81]' },
    { key: 'completed', label: '완료', value: summary.completed, tone: 'text-green-700' },
    { key: 'r9NotSubmitted', label: '9호 미제출', value: summary.r9NotSubmitted, tone: 'text-amber-600' },
    { key: 'overdue', label: '기한 초과', value: summary.overdue, tone: 'text-red-600' },
    { key: 'certMissing', label: '배치확인서 누락', value: summary.certMissing, tone: 'text-amber-600' },
  ]

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-semibold text-[#090c1d]">제출 현황</h2>
        <span className="text-[11px] text-[#b0acd6]">타임라인에서 일하면 저절로 채워집니다 · 최근 90일</span>
      </div>

      {/* 숫자 요약 스트립 — 각 숫자 클릭 = 그 조건으로 필터 (R14-b) */}
      <div className="flex flex-wrap gap-2 my-3">
        {strip.map((s, idx) => {
          const active = filter === s.key && (s.key !== 'completed' || s.label === '완료')
          return (
            <button key={idx} onClick={() => setFilter(f => (f === s.key ? 'all' : s.key))}
              className={`px-3 py-1.5 rounded-lg border text-left ${active ? 'border-[#7b68ee] bg-[#f5f4ff]' : 'border-[#e0ddf5] hover:border-[#7b68ee]'}`}>
              <span className={`text-lg font-bold ${s.tone}`}>{s.value}</span>
              <span className="text-[10px] text-[#514b81] ml-1.5">{s.label}</span>
            </button>
          )
        })}
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')} className="text-[11px] text-[#7b68ee] hover:underline self-center">전체 보기</button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[#b0acd6] py-6 text-center">최근 90일 자체점검 건이 없습니다</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="text-[10px] text-[#b0acd6] border-b border-[#eceafd]">
                <th className={`${cell} text-left`}>고객 · 차수</th>
                <th className={`${cell} text-left`}>9호 생성</th>
                <th className={`${cell} text-left`}>발송</th>
                <th className={`${cell} text-left`}>제출 (D-day)</th>
                <th className={`${cell} text-left`}>배치확인서</th>
                <th className={`${cell} text-left`}>10호</th>
                <th className={`${cell} text-left`}>11호</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const submitted = r.report9SubmittedAt
                const overdue = r.due9Dday !== null && r.due9Dday < 0
                return (
                  <tr key={r.inspectionId} className="border-b border-[#f8f9fa] hover:bg-[#fafaff]">
                    <td className={cell}>
                      <Link href={`/reports?form=docs&cust=${r.customerId}`} className="font-medium text-[#090c1d] hover:text-[#7b68ee]">{r.customerName}</Link>
                      <span className="text-[#b0acd6] ml-1">{r.year}-{r.sequenceNum}차</span>
                      {r.status !== 'completed' && <span className="ml-1 text-[10px] text-blue-500">진행중</span>}
                    </td>
                    <td className={cell}><Mark ok={r.report9Gen} warn={!r.report9Gen} label={r.report9Gen ? '생성' : '미생성'} /></td>
                    <td className={cell}><Mark ok={r.report9Sent} warn={r.report9Gen && !r.report9Sent} label={r.report9Sent ? '발송' : '미발송'} /></td>
                    <td className={cell}>
                      {submitted
                        ? <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="size-3" /> {submitted}</span>
                        : <span className={`inline-flex items-center gap-1 font-semibold ${overdue ? 'text-red-600' : (r.due9Dday ?? 99) <= 7 ? 'text-amber-700' : 'text-[#b0acd6]'}`}>
                            <Clock3 className="size-3" /> {r.due9Dday === null ? '기한 미정' : overdue ? `초과 ${-r.due9Dday!}일` : `D-${r.due9Dday}`}
                          </span>}
                    </td>
                    <td className={cell}><Mark ok={r.certUploaded} warn={r.status === 'completed' && !r.certUploaded} label={r.certUploaded ? '보유' : '누락'} /></td>
                    <td className={cell}>{r.defectsTotal === 0 ? <Mark na label="해당없음" /> : <Mark ok={r.report10Gen} warn={!r.report10Gen} label={r.report10Gen ? '생성' : '미생성'} />}</td>
                    <td className={cell}>{r.defectsTotal === 0 ? <Mark na label="해당없음" /> : <Mark ok={!!r.report11SubmittedAt || r.report11Gen} warn={!r.report11Gen} label={r.report11SubmittedAt ? '제출' : r.report11Gen ? '생성' : '미생성'} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-xs text-[#b0acd6] py-4 text-center">해당 조건의 건이 없습니다</p>}
        </div>
      )}
    </div>
  )
}
