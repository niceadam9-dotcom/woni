'use client'

import { useState, useMemo, useTransition } from 'react'
import { Search, X, ChevronDown, ChevronRight, Printer } from 'lucide-react'
import { updateActionPlanAction, updateCompleteReportAction, upsertActionPlanStatusAction } from '@/app/(dashboard)/action-plans/status/actions'
import { inspectionTypeLabel } from '@/types'

// ── helpers ────────────────────────────────────────────────────────────────
function fmt(d: string | null | undefined) {
  if (!d) return ''
  return d.slice(0, 10)
}
function isOverdue(deadline: string | null | undefined, submitted: string | null | undefined) {
  if (submitted) return false
  if (!deadline) return false
  return new Date(deadline) < new Date()
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── types ──────────────────────────────────────────────────────────────────
type InspectionRef = {
  id: string
  inspection_type: string
  sequence_num: number
  customers: { customer_name: string; customer_code: string } | null
  profiles: { name: string } | null
  inspection_report_status: { inspection_completed_at: string | null } | null
}

type ActionPlanRow = {
  id: string
  inspection_id: string
  completion_target_date: string | null
  submitted_at: string | null
  sent_at: string | null
  inspections: InspectionRef | null
  action_plan_status: {
    sent_at: string | null
    fire_station_submitted_at: string | null
    defect_certificate_count: number
  } | null
  action_complete_reports: {
    id: string
    completed_at: string | null
    submitted_at: string | null
  } | null
}

type PendingPlan = {
  id: string
  inspection_type: string
  sequence_num: number
  customers: { customer_name: string; customer_code: string } | null
  profiles: { name: string } | null
  inspection_report_status: { inspection_completed_at: string | null } | null
  inspection_defects: unknown[]
}

// ── 시간내용증명 모달 ──────────────────────────────────────────────────────
function CertificateModal({
  row,
  onClose,
}: {
  row: ActionPlanRow
  onClose: () => void
}) {
  const cname  = row.inspections?.customers?.customer_name ?? '—'
  const ccode  = row.inspections?.customers?.customer_code ?? '—'
  const inType = row.inspections?.inspection_type ?? '—'
  const seqNum = row.inspections?.sequence_num ?? 1
  const aps    = row.action_plan_status
  const completedAt = row.inspections?.inspection_report_status?.inspection_completed_at
  const deadline    = completedAt ? addDays(completedAt, 30) : null
  const today  = new Date().toISOString().slice(0, 10)

  function handlePrint() {
    window.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-semibold">시간내용증명</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#7b68ee] text-white rounded hover:bg-[#6a58d6] transition-colors"
            >
              <Printer size={14} /> 인쇄
            </button>
            <button onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* 인쇄 영역 */}
        <div className="p-8 overflow-y-auto space-y-6 print:p-0">
          <div className="text-center border-b-2 border-black pb-4">
            <h1 className="text-2xl font-bold tracking-widest">내 용 증 명</h1>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex gap-4">
              <span className="w-20 font-semibold text-gray-600 shrink-0">발 신 인</span>
              <span>승진소방방재 (주)</span>
            </div>
            <div className="flex gap-4">
              <span className="w-20 font-semibold text-gray-600 shrink-0">수 신 인</span>
              <span>{cname} 관계인 귀중 (고객코드: {ccode})</span>
            </div>
            <div className="flex gap-4">
              <span className="w-20 font-semibold text-gray-600 shrink-0">발 신 일</span>
              <span>{today}</span>
            </div>
          </div>

          <div className="border border-gray-300 rounded p-5 space-y-3 text-sm leading-relaxed">
            <h2 className="font-bold text-base mb-3">소방시설 자체점검 이행계획서 제출 촉구</h2>
            <p>
              귀하의 사업장({cname})에 대하여 소방시설법 제25조에 의거 실시한{' '}
              <strong>{inType} 점검 ({seqNum}차)</strong>에서 불량사항이 발견되었습니다.
            </p>
            <p>
              점검완료일 <strong>{completedAt ?? '—'}</strong>로부터 30일 이내
              (<strong>{deadline ?? '—'}</strong>)까지 이행계획서를 관할 소방서에 제출하셔야 합니다.
            </p>
            {aps?.fire_station_submitted_at ? (
              <p>
                ※ 이행계획서 소방서 제출일: <strong>{fmt(aps.fire_station_submitted_at)}</strong>
              </p>
            ) : (
              <p className="text-red-600 font-medium">
                ※ 현재까지 이행계획서가 소방서에 제출되지 않았습니다. 즉시 제출하여 주시기 바랍니다.
              </p>
            )}
            <p>
              본 내용증명은 「내용증명 우편」으로 발송되며, 미이행 시 소방시설법 제48조에 따라
              행정처분 및 과태료 부과 대상이 될 수 있음을 알려드립니다.
            </p>
          </div>

          <div className="text-right space-y-1 text-sm mt-6">
            <p>{today}</p>
            <p className="font-bold">승진소방방재 (주)</p>
            <p className="text-gray-500">대표이사 (인)</p>
          </div>

          {aps && (
            <div className="border-t pt-4 mt-4 text-xs text-gray-500 space-y-1">
              <p>송부일: {fmt(aps.sent_at) || '미기록'} | 소방서 제출일: {fmt(aps.fire_station_submitted_at) || '미기록'} | 증명서 수: {aps.defect_certificate_count ?? 0}건</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 입력 모달 (이행계획 날짜) ──────────────────────────────────────────────
function ActionPlanModal({
  row,
  onClose,
  canManage,
}: {
  row: ActionPlanRow
  onClose: () => void
  canManage: boolean
}) {
  const aps = row.action_plan_status
  const acr = row.action_complete_reports
  const [targetDate,      setTargetDate]      = useState(fmt(row.completion_target_date))
  const [planSubmitted,   setPlanSubmitted]   = useState(fmt(row.submitted_at))
  const [sentAt,          setSentAt]          = useState(fmt(aps?.sent_at))
  const [fireSubmitted,   setFireSubmitted]   = useState(fmt(aps?.fire_station_submitted_at))
  const [certCount,       setCertCount]       = useState(aps?.defect_certificate_count ?? 0)
  const [completeAt,      setCompleteAt]      = useState(fmt(acr?.completed_at))
  const [completeSubmit,  setCompleteSubmit]  = useState(fmt(acr?.submitted_at))
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  function save() {
    startTransition(async () => {
      const [r1, r2, r3] = await Promise.all([
        updateActionPlanAction({
          id:                    row.id,
          completionTargetDate:  targetDate   || null,
          submittedAt:           planSubmitted || null,
          sentAt:                sentAt        || null,
        }),
        upsertActionPlanStatusAction({
          actionPlanId:              row.id,
          sentAt:                    sentAt        || null,
          fireStationSubmittedAt:    fireSubmitted  || null,
          defectCertificateCount:    certCount,
        }),
        acr ? updateCompleteReportAction({
          id:          acr.id,
          completedAt: completeAt    || null,
          submittedAt: completeSubmit || null,
        }) : Promise.resolve({}),
      ])
      const anyErr = (r1 as {error?:string}).error || (r2 as {error?:string}).error || (r3 as {error?:string}).error
      if (anyErr) { setErr(anyErr); return }
      onClose()
    })
  }

  const cname = row.inspections?.customers?.customer_name ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <span className="font-semibold">이행계획 입력</span>
            <span className="ml-2 text-xs text-gray-400">{cname} ({inspectionTypeLabel(row.inspections?.inspection_type)} {row.inspections?.sequence_num}차)</span>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">이행계획서</div>
          {[
            { label: '완료목표일',   value: targetDate,     set: setTargetDate },
            { label: '이행계획제출일', value: planSubmitted, set: setPlanSubmitted },
            { label: '관계인 송부일', value: sentAt,         set: setSentAt },
            { label: '소방서 제출일', value: fireSubmitted,  set: setFireSubmitted },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-3">
              <label className="w-28 text-xs text-gray-600 shrink-0">{f.label}</label>
              <input
                type="date"
                value={f.value}
                onChange={e => f.set(e.target.value)}
                disabled={!canManage}
                className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-gray-50"
              />
            </div>
          ))}
          <div className="flex items-center gap-3">
            <label className="w-28 text-xs text-gray-600 shrink-0">증명서 수량</label>
            <input
              type="number"
              min={0}
              value={certCount}
              onChange={e => setCertCount(Number(e.target.value))}
              disabled={!canManage}
              className="w-20 border rounded px-2 py-1.5 text-sm disabled:bg-gray-50"
            />
          </div>

          {acr && (
            <>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">이행완료보고서</div>
              {[
                { label: '조치 완료일',       value: completeAt,    set: setCompleteAt },
                { label: '이행완료보고제출일', value: completeSubmit, set: setCompleteSubmit },
              ].map(f => (
                <div key={f.label} className="flex items-center gap-3">
                  <label className="w-28 text-xs text-gray-600 shrink-0">{f.label}</label>
                  <input
                    type="date"
                    value={f.value}
                    onChange={e => f.set(e.target.value)}
                    disabled={!canManage}
                    className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-gray-50"
                  />
                </div>
              ))}
            </>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded">취소</button>
          {canManage && (
            <button
              onClick={save}
              disabled={pending}
              className="px-4 py-1.5 text-sm bg-[#7b68ee] text-white rounded disabled:opacity-50"
            >
              {pending ? '저장 중…' : '저장'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 상태 배지 ──────────────────────────────────────────────────────────────
function PlanStatusBadge({ row }: { row: ActionPlanRow }) {
  if (row.submitted_at) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-medium">제출완료</span>
  }
  if (row.id) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 font-medium">제출대기</span>
  }
  return <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-100 text-yellow-700 font-medium">작성대기</span>
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export function ActionPlanStatusClient({
  actionPlans,
  pendingPlans,
  canManage,
}: {
  actionPlans: Record<string, unknown>[]
  pendingPlans: Record<string, unknown>[]
  canManage: boolean
}) {
  const plans = actionPlans as unknown as ActionPlanRow[]
  const pending = pendingPlans as unknown as PendingPlan[]

  const [nameFilter1,  setNameFilter1]  = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [nameFilter2,  setNameFilter2]  = useState('')
  const [statusFilter2, setStatusFilter2] = useState('all')
  const [modalRow, setModalRow] = useState<ActionPlanRow | null>(null)
  const [certRow, setCertRow] = useState<ActionPlanRow | null>(null)
  const [showPending, setShowPending] = useState(true)

  // 상단 테이블 필터 (이행계획)
  const filteredPlans = useMemo(() => {
    return plans.filter(r => {
      if (nameFilter1) {
        const nm = (r.inspections?.customers?.customer_name ?? '').toLowerCase()
        if (!nm.includes(nameFilter1.toLowerCase())) return false
      }
      if (statusFilter === 'submitted'   && !r.submitted_at) return false
      if (statusFilter === 'unsubmitted' &&  r.submitted_at) return false
      return true
    })
  }, [plans, nameFilter1, statusFilter])

  // 하단 테이블 필터 (이행완료보고서) — action_plan이 있고 submitted된 것만
  const completePlans = useMemo(() => {
    return plans.filter(r => {
      if (!r.submitted_at) return false  // 이행계획 미제출이면 하단 미표시
      if (nameFilter2) {
        const nm = (r.inspections?.customers?.customer_name ?? '').toLowerCase()
        if (!nm.includes(nameFilter2.toLowerCase())) return false
      }
      if (statusFilter2 === 'submitted'   && !r.action_complete_reports?.submitted_at) return false
      if (statusFilter2 === 'unsubmitted' &&  r.action_complete_reports?.submitted_at) return false
      return true
    })
  }, [plans, nameFilter2, statusFilter2])

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* ── 상단: 이행계획 제출현황 ──────────────────────────────── */}
      <div className="px-6 py-4 border-b bg-white">
        <h1 className="text-xl font-bold">이행계획 제출현황 모니터링</h1>
        <p className="text-xs text-gray-400 mt-0.5">불량내역 1건 이상인 점검건의 이행계획 제출 현황</p>
      </div>

      {/* 작성대기 (action_plan 미생성) 섹션 */}
      {pending.length > 0 && (
        <div className="px-6 py-2 bg-yellow-50 border-b">
          <button
            onClick={() => setShowPending(v => !v)}
            className="flex items-center gap-1 text-sm font-medium text-yellow-700"
          >
            {showPending ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            작성대기 ({pending.length}건) — 이행계획 미생성
          </button>
          {showPending && (
            <div className="mt-2 overflow-x-auto">
              <table className="text-xs border-collapse w-full min-w-[600px]">
                <thead>
                  <tr className="bg-yellow-100">
                    <th className="border px-2 py-1.5">건물명</th>
                    <th className="border px-2 py-1.5">구분</th>
                    <th className="border px-2 py-1.5">점검완료일</th>
                    <th className="border px-2 py-1.5">불량건수</th>
                    <th className="border px-2 py-1.5">계출기한</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(p => {
                    const completedAt = p.inspection_report_status?.inspection_completed_at
                    const deadline = completedAt ? addDays(completedAt, 30) : null
                    return (
                      <tr key={p.id} className="bg-yellow-50">
                        <td className="border px-2 py-1.5 font-medium">{p.customers?.customer_name}</td>
                        <td className="border px-2 py-1.5 text-center">{inspectionTypeLabel(p.inspection_type)} {p.sequence_num}차</td>
                        <td className="border px-2 py-1.5 text-center">{fmt(completedAt)}</td>
                        <td className="border px-2 py-1.5 text-center">{p.inspection_defects.length}</td>
                        <td className={`border px-2 py-1.5 text-center ${isOverdue(deadline, null) ? 'bg-red-100 text-red-700 font-medium' : ''}`}>
                          {deadline ?? '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 상단 필터 */}
      <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b flex-wrap">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="all">전체</option>
          <option value="unsubmitted">제출대기</option>
          <option value="submitted">제출완료</option>
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={nameFilter1}
            onChange={e => setNameFilter1(e.target.value)}
            placeholder="건물명 검색"
            className="border rounded pl-7 pr-3 py-1.5 text-sm w-40"
          />
        </div>
        <span className="ml-auto text-xs text-gray-400">{filteredPlans.length}건</span>
      </div>

      {/* 상단 테이블 */}
      <div className="overflow-x-auto border-b">
        <table className="w-full text-xs border-collapse min-w-[1000px]">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              <th className="border px-2 py-2 w-8">No</th>
              <th className="border px-2 py-2 min-w-[120px]">건물명</th>
              <th className="border px-2 py-2">구분</th>
              <th className="border px-2 py-2">점검완료일</th>
              <th className="border px-2 py-2">계출기한</th>
              <th className="border px-2 py-2">송부일</th>
              <th className="border px-2 py-2">소방서제출일</th>
              <th className="border px-2 py-2">증명서수</th>
              <th className="border px-2 py-2">이행계획제출일</th>
              <th className="border px-2 py-2">이행완료보고제출일</th>
              <th className="border px-2 py-2">상태</th>
              <th className="border px-2 py-2">시간내용증명</th>
              <th className="border px-2 py-2">입력</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlans.length === 0 && (
              <tr><td colSpan={13} className="text-center py-8 text-gray-400">데이터가 없습니다.</td></tr>
            )}
            {filteredPlans.map((row, idx) => {
              const completedAt = row.inspections?.inspection_report_status?.inspection_completed_at
              const deadline = completedAt ? addDays(completedAt, 30) : null
              const aps = row.action_plan_status
              const acr = row.action_complete_reports
              const overdueRow = isOverdue(deadline, row.submitted_at)

              return (
                <tr key={row.id} className={`hover:bg-gray-50 ${!row.submitted_at ? 'bg-orange-50' : ''}`}>
                  <td className="border px-2 py-1.5 text-center text-gray-500">{idx + 1}</td>
                  <td className="border px-2 py-1.5 font-medium">{row.inspections?.customers?.customer_name}</td>
                  <td className="border px-2 py-1.5 text-center">
                    {inspectionTypeLabel(row.inspections?.inspection_type)} {row.inspections?.sequence_num}차
                  </td>
                  <td className="border px-2 py-1.5 text-center">{fmt(completedAt)}</td>
                  <td className={`border px-2 py-1.5 text-center font-medium ${overdueRow ? 'bg-red-100 text-red-700' : ''}`}>
                    {deadline ?? '-'}
                  </td>
                  <td className="border px-2 py-1.5 text-center">{fmt(aps?.sent_at) || '-'}</td>
                  <td className="border px-2 py-1.5 text-center">{fmt(aps?.fire_station_submitted_at) || '-'}</td>
                  <td className="border px-2 py-1.5 text-center">{aps?.defect_certificate_count ?? 0}</td>
                  <td className="border px-2 py-1.5 text-center">{fmt(row.submitted_at) || '-'}</td>
                  <td className="border px-2 py-1.5 text-center">{fmt(acr?.submitted_at) || '-'}</td>
                  <td className="border px-2 py-1.5 text-center">
                    <PlanStatusBadge row={row} />
                  </td>
                  <td className="border px-2 py-1.5 text-center">
                    {!row.submitted_at && (
                      <button
                        onClick={() => setCertRow(row)}
                        className="text-rose-600 hover:underline text-[11px] font-medium whitespace-nowrap"
                      >
                        [시간내용증명]
                      </button>
                    )}
                  </td>
                  <td className="border px-2 py-1.5 text-center">
                    {canManage && (
                      <button
                        onClick={() => setModalRow(row)}
                        className="text-[#7b68ee] hover:underline text-[11px] font-medium"
                      >
                        [입력]
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── 하단: 이행완료보고서 제출현황 ─────────────────────────── */}
      <div className="px-6 py-4 border-b bg-white mt-4">
        <h2 className="text-lg font-bold">이행완료보고서 제출현황 모니터링</h2>
        <p className="text-xs text-gray-400 mt-0.5">이행계획 제출 완료 건의 이행완료보고서 제출 현황</p>
      </div>

      <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b flex-wrap">
        <select
          value={statusFilter2}
          onChange={e => setStatusFilter2(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="all">전체</option>
          <option value="unsubmitted">제출대기</option>
          <option value="submitted">제출완료</option>
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={nameFilter2}
            onChange={e => setNameFilter2(e.target.value)}
            placeholder="건물명 검색"
            className="border rounded pl-7 pr-3 py-1.5 text-sm w-40"
          />
        </div>
        <span className="ml-auto text-xs text-gray-400">{completePlans.length}건</span>
      </div>

      <div className="overflow-x-auto pb-8">
        <table className="w-full text-xs border-collapse min-w-[700px]">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              <th className="border px-2 py-2 w-8">No</th>
              <th className="border px-2 py-2 min-w-[120px]">건물명</th>
              <th className="border px-2 py-2">구분</th>
              <th className="border px-2 py-2">점검완료일</th>
              <th className="border px-2 py-2">이행완료계획기간</th>
              <th className="border px-2 py-2">이행계획제출일</th>
              <th className="border px-2 py-2">이행완료보고제출일</th>
            </tr>
          </thead>
          <tbody>
            {completePlans.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">데이터가 없습니다.</td></tr>
            )}
            {completePlans.map((row, idx) => {
              const completedAt = row.inspections?.inspection_report_status?.inspection_completed_at
              const acr = row.action_complete_reports
              const overdueTarget = isOverdue(row.completion_target_date, acr?.submitted_at)

              return (
                <tr key={row.id} className={`hover:bg-gray-50 ${!acr?.submitted_at ? 'bg-orange-50' : ''}`}>
                  <td className="border px-2 py-1.5 text-center text-gray-500">{idx + 1}</td>
                  <td className="border px-2 py-1.5 font-medium">{row.inspections?.customers?.customer_name}</td>
                  <td className="border px-2 py-1.5 text-center">
                    {inspectionTypeLabel(row.inspections?.inspection_type)} {row.inspections?.sequence_num}차
                  </td>
                  <td className="border px-2 py-1.5 text-center">{fmt(completedAt)}</td>
                  <td className={`border px-2 py-1.5 text-center ${overdueTarget ? 'bg-red-100 text-red-700 font-medium' : ''}`}>
                    {fmt(row.completion_target_date) || '-'}
                  </td>
                  <td className="border px-2 py-1.5 text-center">{fmt(row.submitted_at)}</td>
                  <td className="border px-2 py-1.5 text-center">{fmt(acr?.submitted_at) || '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 이행계획 입력 모달 */}
      {modalRow && (
        <ActionPlanModal
          row={modalRow}
          onClose={() => setModalRow(null)}
          canManage={canManage}
        />
      )}

      {/* 시간내용증명 모달 */}
      {certRow && (
        <CertificateModal
          row={certRow}
          onClose={() => setCertRow(null)}
        />
      )}
    </div>
  )
}
