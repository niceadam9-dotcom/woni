'use client'

import { useState, useMemo, useTransition, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Search, X, Check } from 'lucide-react'
import { upsertReportStatusAction } from '@/app/(dashboard)/inspection-reports/status/actions'
import { TableScroll } from '@/components/ui/table-scroll'
import { inspectionTypeLabel } from '@/types'

// ── helpers ────────────────────────────────────────────────────────────────
function fmt(d: string | null | undefined) {
  if (!d) return ''
  return d.slice(0, 10)
}

// 제출기한 초과 여부 (deadline이 있고 미제출이면 빨간색)
function deadlineClass(deadline: string | null | undefined, submitted: boolean) {
  if (submitted) return ''
  if (!deadline) return ''
  return new Date(deadline) < new Date() ? 'bg-red-50 text-red-600' : ''
}

// ── types ──────────────────────────────────────────────────────────────────
type ReportStatusRow = {
  id: string
  inspection_type: string
  sequence_num: number
  scheduled_date: string | null
  assigned_employee_id: string | null
  status: string
  customers: { customer_name: string; customer_code: string; address: string | null } | null
  profiles: { name: string } | null
  inspection_plans: { year: number; month: number } | null
  inspection_report_status: {
    inspection_completed_at: string | null
    notification_date: string | null
    notification_due_date: string | null
    submission_deadline: string | null
    sent_at: string | null
    received_at: string | null
    returned_at: string | null
    fire_station_submitted: boolean
    fee_billed: boolean
  } | null
}

// ── [입력] 모달 ───────────────────────────────────────────────────────────
function InputModal({
  item,
  onClose,
  canManage,
}: {
  item: ReportStatusRow
  onClose: () => void
  canManage: boolean
}) {
  const rs = item.inspection_report_status
  const [completedAt,       setCompletedAt]       = useState(fmt(rs?.inspection_completed_at))
  const [notificationDate,  setNotificationDate]  = useState(fmt(rs?.notification_date))
  const [sentAt,            setSentAt]            = useState(fmt(rs?.sent_at))
  const [receivedAt,        setReceivedAt]        = useState(fmt(rs?.received_at))
  const [returnedAt,        setReturnedAt]        = useState(fmt(rs?.returned_at))
  const [fireSubmitted,     setFireSubmitted]     = useState(rs?.fire_station_submitted ?? false)
  const [feeBilled,         setFeeBilled]         = useState(rs?.fee_billed ?? false)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  function save() {
    startTransition(async () => {
      const res = await upsertReportStatusAction({
        planItemId:            item.id,
        inspectionCompletedAt: completedAt       || null,
        notificationDate:      notificationDate  || null,
        sentAt:                sentAt            || null,
        receivedAt:            receivedAt        || null,
        returnedAt:            returnedAt        || null,
        fireStationSubmitted:  fireSubmitted,
        feeBilled:             feeBilled,
      })
      if (res.error) { setErr(res.error); return }
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[460px] flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <span className="font-semibold">보고서 제출현황 입력</span>
            <span className="ml-2 text-xs text-gray-400">
              {item.customers?.customer_name} ({inspectionTypeLabel(item.inspection_type)} {item.sequence_num}차)
            </span>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-3">
          {[
            { label: '점검완료일',   value: completedAt,      set: setCompletedAt,      type: 'date' },
            { label: '통보일',       value: notificationDate, set: setNotificationDate, type: 'date' },
            { label: '송부일',       value: sentAt,           set: setSentAt,           type: 'date' },
            { label: '접수일',       value: receivedAt,       set: setReceivedAt,       type: 'date' },
            { label: '반송일',       value: returnedAt,       set: setReturnedAt,       type: 'date' },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-3">
              <label className="w-24 text-xs text-gray-600 shrink-0">{f.label}</label>
              <input
                type={f.type}
                value={f.value}
                onChange={e => f.set(e.target.value)}
                disabled={!canManage}
                className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-gray-50"
              />
            </div>
          ))}
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={fireSubmitted}
                onChange={e => setFireSubmitted(e.target.checked)}
                disabled={!canManage}
                className="rounded"
              />
              소방서 제출
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={feeBilled}
                onChange={e => setFeeBilled(e.target.checked)}
                disabled={!canManage}
                className="rounded"
              />
              수수료 청구
            </label>
          </div>
          {rs?.notification_due_date && (
            <div className="text-xs text-gray-400">
              배치신고예정일: {fmt(rs.notification_due_date)} &nbsp;|&nbsp;
              제출기한: {fmt(rs.submission_deadline)}
              <span className="ml-1 text-gray-300">(자동계산)</span>
            </div>
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

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export function ReportStatusClient({
  initialItems,
  employees,
  canManage,
  defaultYear,
  defaultMonth,
}: {
  initialItems: Record<string, unknown>[]
  employees: Array<{ id: string; name: string; position: string | null }>
  canManage: boolean
  defaultYear: number
  defaultMonth: number
}) {
  const rows = initialItems as unknown as ReportStatusRow[]

  const [yearMonth,     setYearMonth]     = useState(`${defaultYear}-${String(defaultMonth).padStart(2, '0')}`)
  const [empFilter,     setEmpFilter]     = useState('')
  const [nameFilter,    setNameFilter]    = useState('')
  const [submitFilter,  setSubmitFilter]  = useState('all')
  const [modalItem,     setModalItem]     = useState<ReportStatusRow | null>(null)

  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [pickerYear,      setPickerYear]      = useState(defaultYear)
  const monthPickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showMonthPicker) return
    function onDown(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node))
        setShowMonthPicker(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showMonthPicker])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (empFilter && r.assigned_employee_id !== empFilter) return false
      if (nameFilter) {
        const nm = (r.customers?.customer_name ?? '').toLowerCase()
        if (!nm.includes(nameFilter.toLowerCase())) return false
      }
      if (submitFilter === 'submitted'   && !r.inspection_report_status?.fire_station_submitted) return false
      if (submitFilter === 'unsubmitted' &&  r.inspection_report_status?.fire_station_submitted) return false
      if (yearMonth) {
        const [y, m] = yearMonth.split('-').map(Number)
        if (r.inspection_plans?.year !== y || r.inspection_plans?.month !== m) return false
      }
      return true
    })
  }, [rows, empFilter, nameFilter, submitFilter, yearMonth])

  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split('-').map(Number)
    let nm = m + delta; let ny = y
    if (nm < 1) { nm = 12; ny-- }
    if (nm > 12) { nm = 1; ny++ }
    setYearMonth(`${ny}-${String(nm).padStart(2, '0')}`)
  }

  const [y, m] = yearMonth.split('-').map(Number)

  // 요약 카운터
  const totalCount     = filtered.length
  const submittedCount = filtered.filter(r => r.inspection_report_status?.fire_station_submitted).length
  const overdueCount   = filtered.filter(r => {
    const rs = r.inspection_report_status
    return rs?.submission_deadline && !rs.fire_station_submitted &&
      new Date(rs.submission_deadline) < new Date()
  }).length

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <h1 className="text-xl font-bold">점검보고서 제출현황 모니터링</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-500">전체 <strong className="text-gray-800">{totalCount}</strong></span>
          <span className="text-green-600">제출완료 <strong>{submittedCount}</strong></span>
          <span className="text-red-500">기한초과 <strong>{overdueCount}</strong></span>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b flex-wrap">
        <div className="relative flex items-center gap-1 border rounded bg-white" ref={monthPickerRef}>
          <button onClick={() => changeMonth(-1)} className="p-1.5 hover:bg-gray-100 rounded-l" title="이전 달">
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => { setPickerYear(y); setShowMonthPicker(o => !o) }}
            className="px-3 text-sm font-medium hover:bg-gray-100 py-1 rounded transition-colors"
            title="연/월 바로가기"
          >
            {y}년 {m}월
          </button>
          <button onClick={() => changeMonth(1)} className="p-1.5 hover:bg-gray-100 rounded-r" title="다음 달">
            <ChevronRight size={14} />
          </button>
          {showMonthPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[#d0ccf5] rounded-xl shadow-xl p-3 w-52">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setPickerYear(y => y - 1)} className="p-1 hover:bg-gray-100 rounded">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm font-semibold">{pickerYear}년</span>
                <button onClick={() => setPickerYear(y => y + 1)} className="p-1 hover:bg-gray-100 rounded">
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(mo => {
                  const isActive = mo === m && pickerYear === y
                  return (
                    <button
                      key={mo}
                      onClick={() => {
                        setYearMonth(`${pickerYear}-${String(mo).padStart(2, '0')}`)
                        setShowMonthPicker(false)
                      }}
                      className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${isActive ? 'bg-[#7b68ee] text-white' : 'hover:bg-[#f5f4ff] text-gray-800'}`}
                    >
                      {mo}월
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <select
          value={empFilter}
          onChange={e => setEmpFilter(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="">전체 담당자</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>

        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            placeholder="건물명 검색"
            className="border rounded pl-7 pr-3 py-1.5 text-sm w-40"
          />
        </div>

        <select
          value={submitFilter}
          onChange={e => setSubmitFilter(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="all">전체</option>
          <option value="submitted">제출완료</option>
          <option value="unsubmitted">미제출</option>
        </select>

        <span className="ml-auto text-xs text-gray-400">{filtered.length}건</span>
      </div>

      {/* 테이블 — 헤더 고정 + 레코드 스크롤 */}
      <TableScroll offset={280}>
        <table className="w-full text-xs border-collapse min-w-[1100px]">
          <thead className="bg-gray-100 sticky top-0 z-10 shadow-[0_1px_0_0_#c8c4d0]">
            <tr>
              <th className="border px-2 py-2 text-center w-8">No</th>
              <th className="border px-2 py-2 text-center">점검월</th>
              <th className="border px-2 py-2 text-center">구분</th>
              <th className="border px-2 py-2 text-center min-w-[120px]">건물명</th>
              <th className="border px-2 py-2 text-center">담당자</th>
              <th className="border px-2 py-2 text-center">점검완료일</th>
              <th className="border px-2 py-2 text-center">통보일</th>
              <th className="border px-2 py-2 text-center bg-yellow-50">배치신고예정일</th>
              <th className="border px-2 py-2 text-center bg-yellow-50">제출기한</th>
              <th className="border px-2 py-2 text-center">송부일</th>
              <th className="border px-2 py-2 text-center">접수일</th>
              <th className="border px-2 py-2 text-center">반송일</th>
              <th className="border px-2 py-2 text-center">소방서제출</th>
              <th className="border px-2 py-2 text-center">수수료청구</th>
              <th className="border px-2 py-2 text-center">입력</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={15} className="text-center py-10 text-gray-400">
                  데이터가 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((row, idx) => {
              const rs = row.inspection_report_status
              const fireSubmitted = rs?.fire_station_submitted ?? false

              return (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="border px-2 py-1.5 text-center text-gray-500">{idx + 1}</td>
                  <td className="border px-2 py-1.5 text-center text-gray-500">
                    {row.inspection_plans ? `${row.inspection_plans.year}.${String(row.inspection_plans.month).padStart(2, '0')}` : ''}
                  </td>
                  <td className="border px-2 py-1.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium
                      ${row.inspection_type === '종합' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {inspectionTypeLabel(row.inspection_type)}
                    </span>
                    <span className="ml-1 text-gray-400">{row.sequence_num}차</span>
                  </td>
                  <td className="border px-2 py-1.5">
                    <div className="font-medium">{row.customers?.customer_name}</div>
                  </td>
                  <td className="border px-2 py-1.5 text-center">{row.profiles?.name ?? '-'}</td>
                  {/* 점검완료일 */}
                  <td className={`border px-2 py-1.5 text-center ${!rs?.inspection_completed_at ? 'bg-red-50 text-red-500' : ''}`}>
                    {fmt(rs?.inspection_completed_at) || '미입력'}
                  </td>
                  {/* 통보일 */}
                  <td className={`border px-2 py-1.5 text-center ${rs?.inspection_completed_at && !rs?.notification_date ? 'bg-red-50 text-red-500' : ''}`}>
                    {fmt(rs?.notification_date) || '-'}
                  </td>
                  {/* 배치신고예정일 (GENERATED) */}
                  <td className="border px-2 py-1.5 text-center bg-yellow-50 text-gray-600">
                    {fmt(rs?.notification_due_date) || '-'}
                  </td>
                  {/* 제출기한 (GENERATED) */}
                  <td className={`border px-2 py-1.5 text-center bg-yellow-50 font-medium ${deadlineClass(rs?.submission_deadline, fireSubmitted)}`}>
                    {fmt(rs?.submission_deadline) || '-'}
                  </td>
                  {/* 송부일 */}
                  <td className={`border px-2 py-1.5 text-center ${rs?.notification_due_date && !rs?.sent_at ? 'bg-red-50 text-red-500' : ''}`}>
                    {fmt(rs?.sent_at) || '-'}
                  </td>
                  {/* 접수일 */}
                  <td className="border px-2 py-1.5 text-center text-gray-500">
                    {fmt(rs?.received_at) || '-'}
                  </td>
                  {/* 반송일 */}
                  <td className={`border px-2 py-1.5 text-center ${rs?.returned_at ? 'text-orange-600 font-medium' : 'text-gray-300'}`}>
                    {fmt(rs?.returned_at) || '-'}
                  </td>
                  {/* 소방서 제출 */}
                  <td className={`border px-2 py-1.5 text-center ${fireSubmitted ? 'bg-green-50' : deadlineClass(rs?.submission_deadline, false)}`}>
                    {fireSubmitted
                      ? <span className="inline-flex items-center gap-0.5 text-green-600 font-medium"><Check size={12} /> 완료</span>
                      : <span className="text-gray-300">미제출</span>
                    }
                  </td>
                  {/* 수수료 청구 */}
                  <td className={`border px-2 py-1.5 text-center ${rs?.fee_billed ? 'bg-blue-50' : ''}`}>
                    {rs?.fee_billed
                      ? <span className="text-blue-600 font-medium"><Check size={12} className="inline" /> 청구</span>
                      : <span className="text-gray-300">-</span>
                    }
                  </td>
                  {/* 입력 버튼 */}
                  <td className="border px-2 py-1.5 text-center">
                    <button
                      onClick={() => setModalItem(row)}
                      className="text-[#7b68ee] hover:underline text-[11px] font-medium"
                    >
                      [입력]
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScroll>

      {/* 입력 모달 */}
      {modalItem && (
        <InputModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          canManage={canManage}
        />
      )}
    </div>
  )
}
