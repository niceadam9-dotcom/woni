'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Circle, Clock3, Loader2, Download, User } from 'lucide-react'
import type { SubmissionRow, SubmissionSummary } from '@/app/(dashboard)/reports/docs-actions'

/** §7-A 제출 현황판 (소방계획서_5 R14-a·R14-b) — 타임라인 필드 단일 소스, 수기 입력 없음.
 *  숫자 요약 스트립(숫자=필터 버튼) + 위험순 표. 앰버·빨강만 훑으면 감시 끝(모니터링 2층). */

type FilterKey = 'all' | 'r9NotSubmitted' | 'overdue' | 'certMissing' | 'completed'

const cell = 'px-2 py-2 text-xs'

function Mark({ ok, na, warn, label }: { ok?: boolean; na?: boolean; warn?: boolean; label: string }) {
  if (na) return <span className="inline-flex items-center gap-1 text-ink-faint"><Circle className="size-3" /> {label}</span>
  if (ok) return <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="size-3" /> {label}</span>
  return <span className={`inline-flex items-center gap-1 ${warn ? 'text-amber-600' : 'text-ink-faint'}`}><AlertTriangle className="size-3" /> {label}</span>
}

/** R10-c: 배치신고 셀 — ✅완료 / ⚠미완료 + 작업대 ② 직행.
 *  ⚠ 2026-09-07 — 그 자리 [업로드]를 걷어냈다. 대표가 협회에 직접 신고하므로 ERP가 받을 파일이 없고,
 *  완료 표시는 작업대 ②가 단일 창구다. 여기서도 완료로 만들 수 있으면 경로가 둘이 되어 다시 갈라진다.
 *  `archived`는 이제 '종이 보관 + 신고 완료 표시'를 함께 덮는다(findArchivedCertInspections). */
function CertCell({ inspectionId, uploaded, archived, warn }: { inspectionId: string; uploaded: boolean; archived?: boolean; warn: boolean }) {
  const ok = uploaded || !!archived
  return (
    <div className="flex items-center gap-1.5">
      {/* 종이 보관 정리분은 ERP에 파일이 없다 — '보유'로 뭉뚱그리면 제출 때 첨부가 비어 버린다 */}
      <Mark ok={ok} warn={warn} label={archived ? '완료' : uploaded ? '보유' : '미완료'} />
      {!ok && (
        <Link href={`/inspections/${inspectionId}?step=2`} data-testid="cert-cell-link"
          title="작업대 ②에서 배치신고 완료를 표시합니다"
          className="text-form-2xs text-brand hover:underline shrink-0">표시 →</Link>
      )}
    </div>
  )
}

/** 소방계획서_45 — 10·11호가 '해당없음'인가 = **점검표 모두 합격**(✕ 0 AND 등록 불량 0).
 *  표와 엑셀 내보내기가 **같은 함수**를 쓴다. 종전에는 `defectsTotal === 0`이 네 군데에 흩어져 있어
 *  축을 넓힐 때 일부만 고쳐지면 화면과 엑셀이 다른 말을 하게 돼 있었다. */
const allPassRow = (r: SubmissionRow) => !r.allPassUnknown && r.defectsTotal === 0 && r.sheetX === 0

/** P-5·R14-f: 현재 화면(필터 반영) 행을 엑셀로 내보내기 — xlsx 동적 로드로 번들 최소화 */
async function exportRows(rows: SubmissionRow[]) {
  const XLSX = await import('xlsx')
  const ddayText = (r: SubmissionRow) =>
    r.report9SubmittedAt ? `제출 ${r.report9SubmittedAt}`
      : r.due9Dday === null ? '기한 미정'
        : r.due9Dday < 0 ? `초과 ${-r.due9Dday}일` : `D-${r.due9Dday}`
  const naText = (gen: boolean, sent = false) => sent ? '제출' : gen ? '생성' : '미생성'
  const sheet = rows.map(r => ({
    '고객': r.customerName,
    '차수': `${r.year}-${r.sequenceNum}차`,
    '담당자': r.assigneeName ?? '미배정',
    '상태': r.status === 'completed' ? '완료' : '진행중',
    '9호 생성': r.report9Gen ? '생성' : '미생성',
    '발송': r.report9Sent ? '발송' : '미발송',
    '제출(D-day)': ddayText(r),
    '배치신고': r.certArchived ? '완료' : r.certUploaded ? '보유' : '미완료',
    '10호': allPassRow(r) ? '해당없음' : (r.report10Gen ? '생성' : '미생성'),
    '11호': allPassRow(r) ? '해당없음' : naText(r.report11Gen, !!r.report11SubmittedAt),
  }))
  const ws = XLSX.utils.json_to_sheet(sheet)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '제출현황')
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  XLSX.writeFile(wb, `제출현황_${today}.xlsx`)
}

export function SubmissionBoard({ rows, summary, myId, defaultMine }: {
  rows: SubmissionRow[]; summary: SubmissionSummary; myId: string; defaultMine: boolean
}) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [mine, setMine] = useState(defaultMine)   // P-4: '내 담당만' — 직원 기본 ON
  const [exporting, startExport] = useTransition()

  const hasAssignments = rows.some(r => r.assigneeId === myId)

  const filtered = rows.filter(r => {
    if (mine && r.assigneeId !== myId) return false
    if (filter === 'all') return true
    if (filter === 'r9NotSubmitted') return !r.report9SubmittedAt && r.status === 'completed'
    if (filter === 'overdue') return r.due9Dday !== null && r.due9Dday < 0
    if (filter === 'certMissing') return r.status === 'completed' && !r.certUploaded
    if (filter === 'completed') return r.status === 'completed'
    return true
  })

  // P-4: '내 담당만' ON이면 요약 스트립도 내 배정 건 기준으로 재계산 — 표 행수와 숫자 일치
  const scoped = mine ? rows.filter(r => r.assigneeId === myId) : rows
  const effSummary: SubmissionSummary = mine ? {
    monthSelf: scoped.filter(r => r.thisMonth).length,
    completed: scoped.filter(r => r.status === 'completed').length,
    r9NotSubmitted: scoped.filter(r => !r.report9SubmittedAt && r.status === 'completed').length,
    overdue: scoped.filter(r => r.due9Dday !== null && r.due9Dday < 0).length,
    certMissing: scoped.filter(r => r.status === 'completed' && !r.certUploaded).length,
  } : summary

  const strip: Array<{ key: FilterKey; label: string; value: number; tone: string }> = [
    { key: 'completed', label: '이번 달 자체점검', value: effSummary.monthSelf, tone: 'text-ink-sub' },
    { key: 'completed', label: '완료', value: effSummary.completed, tone: 'text-green-700' },
    { key: 'r9NotSubmitted', label: '9호 미제출', value: effSummary.r9NotSubmitted, tone: 'text-amber-600' },
    { key: 'overdue', label: '기한 초과', value: effSummary.overdue, tone: 'text-red-600' },
    { key: 'certMissing', label: '배치신고 미완료', value: effSummary.certMissing, tone: 'text-amber-600' },
  ]

  return (
    <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-semibold text-ink">제출 현황</h2>
        <span className="text-form-xs text-ink-faint">타임라인에서 일하면 저절로 채워집니다 · 최근 90일</span>
        <div className="ml-auto flex items-center gap-2">
          {/* P-4: '내 담당만' 개인화 필터 — 직원 기본 ON */}
          <button onClick={() => setMine(v => !v)} title="내가 배정된 점검 건만 봅니다"
            className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border text-form-xs font-medium ${
              mine ? 'border-brand bg-brand-tint text-brand' : 'border-brand-line text-ink-sub hover:border-brand'}`}>
            <User className="size-3" /> 내 담당만
          </button>
          {/* P-5·R14-f: 엑셀 내보내기 — 현재 화면(필터 반영) 기준 */}
          <button onClick={() => startExport(() => { void exportRows(filtered) })} disabled={exporting || filtered.length === 0}
            title="현재 표시 중인 목록을 엑셀로 내보냅니다"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-brand-line text-form-xs font-medium text-ink-sub hover:border-brand hover:text-brand disabled:opacity-50">
            {exporting ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} 엑셀
          </button>
        </div>
      </div>
      {mine && !hasAssignments && (
        <p className="text-form-xs text-amber-600 mb-1">내게 배정된 최근 90일 자체점검 건이 없습니다 — 전체를 보려면 &lsquo;내 담당만&rsquo;을 끄세요</p>
      )}

      {/* 숫자 요약 스트립 — 각 숫자 클릭 = 그 조건으로 필터 (R14-b) */}
      <div className="flex flex-wrap gap-2 my-3">
        {strip.map((s, idx) => {
          const active = filter === s.key && (s.key !== 'completed' || s.label === '완료')
          return (
            <button key={idx} onClick={() => setFilter(f => (f === s.key ? 'all' : s.key))}
              className={`px-3 py-1.5 rounded-lg border text-left ${active ? 'border-brand bg-brand-tint' : 'border-brand-line-soft hover:border-brand'}`}>
              <span className={`text-lg font-bold ${s.tone}`}>{s.value}</span>
              <span className="text-form-2xs text-ink-sub ml-1.5">{s.label}</span>
            </button>
          )
        })}
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')} className="text-form-xs text-brand hover:underline self-center">전체 보기</button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-faint py-6 text-center">최근 90일 자체점검 건이 없습니다</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="text-form-2xs text-ink-faint border-b border-brand-tint">
                <th className={`${cell} text-left`}>고객 · 차수</th>
                <th className={`${cell} text-left`}>담당자</th>
                <th className={`${cell} text-left`}>9호 생성</th>
                <th className={`${cell} text-left`}>발송</th>
                <th className={`${cell} text-left`}>제출 (D-day)</th>
                <th className={`${cell} text-left`}>배치신고</th>
                <th className={`${cell} text-left`}>10호</th>
                <th className={`${cell} text-left`}>11호</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const submitted = r.report9SubmittedAt
                const overdue = r.due9Dday !== null && r.due9Dday < 0
                return (
                  <tr key={r.inspectionId} className="border-b border-paper hover:bg-brand-tint">
                    <td className={cell}>
                      <Link href={`/customers/${r.customerId}?tab=annex`} className="font-medium text-ink hover:text-brand">{r.customerName}</Link>
                      <span className="text-ink-faint ml-1">{r.year}-{r.sequenceNum}차</span>
                      {r.status !== 'completed' && <span className="ml-1 text-form-2xs text-blue-500">진행중</span>}
                    </td>
                    <td className={cell}>
                      {r.assigneeName
                        ? <span className={`text-ink-sub ${r.assigneeId === myId ? 'font-semibold text-brand' : ''}`}>{r.assigneeName}</span>
                        : <span className="text-ink-faint">미배정</span>}
                    </td>
                    <td className={cell}><Mark ok={r.report9Gen} warn={!r.report9Gen} label={r.report9Gen ? '생성' : '미생성'} /></td>
                    <td className={cell}><Mark ok={r.report9Sent} warn={r.report9Gen && !r.report9Sent} label={r.report9Sent ? '발송' : '미발송'} /></td>
                    <td className={cell}>
                      {submitted
                        ? <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="size-3" /> {submitted}</span>
                        : <span className={`inline-flex items-center gap-1 font-semibold ${overdue ? 'text-red-600' : (r.due9Dday ?? 99) <= 7 ? 'text-amber-700' : 'text-ink-faint'}`}>
                            <Clock3 className="size-3" /> {r.due9Dday === null ? '기한 미정' : overdue ? `초과 ${-r.due9Dday!}일` : `D-${r.due9Dday}`}
                          </span>}
                    </td>
                    <td className={cell}><CertCell inspectionId={r.inspectionId} uploaded={r.certUploaded} archived={r.certArchived} warn={r.status === 'completed' && !r.certUploaded} /></td>
                    <td className={cell}>{allPassRow(r) ? <Mark na label="해당없음" /> : <Mark ok={r.report10Gen} warn={!r.report10Gen} label={r.report10Gen ? '생성' : '미생성'} />}</td>
                    <td className={cell}>{allPassRow(r) ? <Mark na label="해당없음" /> : <Mark ok={!!r.report11SubmittedAt || r.report11Gen} warn={!r.report11Gen} label={r.report11SubmittedAt ? '제출' : r.report11Gen ? '생성' : '미생성'} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-xs text-ink-faint py-4 text-center">해당 조건의 건이 없습니다</p>}
        </div>
      )}
    </div>
  )
}
