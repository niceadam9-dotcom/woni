'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Plus, X, Pencil, Trash2, Flame } from 'lucide-react'
import {
  createScheduleAction,
  updateScheduleAction,
  deleteScheduleAction,
} from '@/app/(dashboard)/my/schedules/actions'
import { DateInput } from '@/components/ui/date-input'

type Schedule = {
  id: string
  title: string
  description: string | null
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  schedule_type: string
  all_day: boolean
}

export type InspectionDeadline = {
  stepId: string
  inspectionId: string
  customerName: string
  stepNum: number
  stepName: string
  dueDate: string
  dDays: number
}

const TYPE_COLORS: Record<string, string> = {
  개인:    'bg-blue-100 text-blue-700 border-blue-200',
  업무:    'bg-purple-100 text-purple-700 border-purple-200',
  점검:    'bg-orange-100 text-orange-700 border-orange-200',
  유지보수: 'bg-green-100 text-green-700 border-green-200',
  회의:    'bg-yellow-100 text-yellow-700 border-yellow-200',
  기타:    'bg-gray-100 text-gray-600 border-gray-200',
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const TYPES = ['개인', '업무', '점검', '유지보수', '회의', '기타']

function ScheduleModal({
  initial,
  onClose,
  onDone,
}: {
  initial?: Schedule
  onClose: () => void
  onDone: () => void
}) {
  const [title,    setTitle]    = useState(initial?.title ?? '')
  const [desc,     setDesc]     = useState(initial?.description ?? '')
  const [startDate, setStartDate] = useState(initial?.start_date ?? '')
  const [endDate,   setEndDate]   = useState(initial?.end_date ?? '')
  const [startTime, setStartTime] = useState(initial?.start_time ?? '')
  const [endTime,   setEndTime]   = useState(initial?.end_time ?? '')
  const [type,     setType]     = useState(initial?.schedule_type ?? '개인')
  const [allDay,   setAllDay]   = useState(initial?.all_day ?? true)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    if (!title.trim()) { setErr('제목을 입력하세요.'); return }
    if (!startDate) { setErr('시작일을 입력하세요.'); return }
    if (!endDate)   { setErr('종료일을 입력하세요.'); return }
    if (endDate < startDate) { setErr('종료일이 시작일보다 앞설 수 없습니다.'); return }

    start(async () => {
      const payload = {
        title,
        description:   desc || null,
        startDate,
        endDate,
        startTime:     allDay ? null : (startTime || null),
        endTime:       allDay ? null : (endTime || null),
        scheduleType:  type,
        allDay,
      }
      const res = initial
        ? await updateScheduleAction({ id: initial.id, ...payload })
        : await createScheduleAction(payload)
      if (res.error) { setErr(res.error); return }
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#090c1d]">{initial ? '일정 수정' : '일정 등록'}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">제목<span className="text-red-500 ml-0.5">*</span></label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="일정 제목"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">구분</label>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    type === t ? TYPE_COLORS[t] : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">시작일<span className="text-red-500 ml-0.5">*</span></label>
              <DateInput value={startDate} onChange={e => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value) }}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">종료일<span className="text-red-500 ml-0.5">*</span></label>
              <DateInput value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="allDay" checked={allDay} onChange={e => setAllDay(e.target.checked)}
              className="rounded" />
            <label htmlFor="allDay" className="text-sm text-gray-600">하루 종일</label>
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">시작 시간</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">종료 시간</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">메모</label>
            <textarea
              value={desc} onChange={e => setDesc(e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="내용 (선택)"
            />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            취소
          </button>
          <button
            onClick={submit} disabled={pending}
            className="flex-1 bg-[#7b68ee] text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {pending ? '저장 중…' : initial ? '수정' : '등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SchedulesClient({
  initialSchedules,
  today,
  inspectionDeadlines = [],
  holidays = [],
}: {
  initialSchedules: Record<string, unknown>[]
  today: string
  inspectionDeadlines?: InspectionDeadline[]
  /** 공휴일 표시용 (관리자>공휴일 관리) */
  holidays?: Array<{ date: string; name: string }>
}) {
  const schedules = initialSchedules as unknown as Schedule[]
  const holidayMap = new Map(holidays.map(h => [h.date, h.name]))

  const todayDate = new Date(today)
  const [year,  setYear]  = useState(todayDate.getFullYear())
  const [month, setMonth] = useState(todayDate.getMonth()) // 0-indexed
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Schedule | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [deletePending, startDelete] = useTransition()

  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [pickerYear,      setPickerYear]      = useState(todayDate.getFullYear())
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

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function dateStr(d: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  function schedulesForDate(ds: string) {
    return schedules.filter(s => s.start_date <= ds && s.end_date >= ds)
  }

  function deadlinesForDate(ds: string) {
    return inspectionDeadlines.filter(d => d.dueDate === ds)
  }

  function deadlineUrgencyCls(dDays: number) {
    if (dDays < 0)   return 'bg-gray-100 text-gray-400 border-gray-200'
    if (dDays === 0) return 'bg-red-100 text-red-700 border-red-200'
    if (dDays <= 2)  return 'bg-orange-100 text-orange-700 border-orange-200'
    if (dDays <= 6)  return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    return 'bg-green-100 text-green-700 border-green-200'
  }

  function deadlineDLabel(dDays: number) {
    if (dDays < 0)   return `D+${Math.abs(dDays)}`
    if (dDays === 0) return 'D-Day'
    return `D-${dDays}`
  }

  const selectedSchedules = selectedDate ? schedulesForDate(selectedDate) : []
  const selectedDeadlines = selectedDate ? deadlinesForDate(selectedDate) : []

  function handleDelete(id: string) {
    if (!confirm('일정을 삭제하시겠습니까?')) return
    startDelete(async () => {
      await deleteScheduleAction(id)
      setSelectedDate(null)
    })
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 캘린더 */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-lg" title="이전 달">
              <ChevronLeft size={18} />
            </button>
            <div className="relative" ref={monthPickerRef}>
              <button
                onClick={() => { setPickerYear(year); setShowMonthPicker(o => !o) }}
                className="font-bold text-lg hover:bg-gray-100 px-2 py-0.5 rounded-lg transition-colors"
                title="연/월 바로가기"
              >
                {year}년 {month + 1}월
              </button>
              {showMonthPicker && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-white border border-[#d0ccf5] rounded-xl shadow-xl p-3 w-52">
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
                    {Array.from({ length: 12 }, (_, i) => i).map(mo => {
                      const isActive = mo === month && pickerYear === year
                      return (
                        <button
                          key={mo}
                          onClick={() => {
                            setYear(pickerYear)
                            setMonth(mo)
                            setShowMonthPicker(false)
                          }}
                          className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${isActive ? 'bg-[#7b68ee] text-white' : 'hover:bg-[#f5f4ff] text-gray-800'}`}
                        >
                          {mo + 1}월
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-lg" title="다음 달">
              <ChevronRight size={18} />
            </button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d, i) => (
              <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 셀 */}
          <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden">
            {cells.map((d, idx) => {
              if (d === null) return <div key={idx} className="bg-white min-h-[72px]" />
              const ds = dateStr(d)
              const daySchedules = schedulesForDate(ds)
              const dayDeadlines = deadlinesForDate(ds)
              const showDl = dayDeadlines.slice(0, 2)
              const showSch = daySchedules.slice(0, Math.max(0, 2 - showDl.length))
              const hiddenCount = dayDeadlines.length + daySchedules.length - showDl.length - showSch.length
              const isToday = ds === today
              const isSelected = ds === selectedDate
              const dow = idx % 7
              const holiday = holidayMap.get(ds)

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedDate(ds === selectedDate ? null : ds)}
                  className={`bg-white min-h-[72px] p-1 cursor-pointer transition-colors hover:bg-[#f5f4ff] ${isSelected ? 'bg-[#f0eeff]' : ''}`}
                  title={holiday ? `${holiday} (공휴일)` : undefined}
                >
                  <div className="flex items-center gap-1 mb-0.5 min-w-0">
                    <div className={`text-xs font-medium w-6 h-6 shrink-0 flex items-center justify-center rounded-full
                      ${isToday ? 'bg-[#7b68ee] text-white' : holiday || dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'}`}>
                      {d}
                    </div>
                    {holiday && <span className="text-[9px] text-red-500 truncate">{holiday}</span>}
                  </div>
                  <div className="space-y-0.5">
                    {showDl.map(dl => (
                      <div key={dl.stepId} className={`text-[10px] px-1 py-0.5 rounded truncate border ${deadlineUrgencyCls(dl.dDays)}`}>
                        <Flame className="inline size-2.5 mr-0.5 -mt-px" />{dl.stepNum}단계 {dl.customerName}
                      </div>
                    ))}
                    {showSch.map(s => (
                      <div key={s.id} className={`text-[10px] px-1 py-0.5 rounded truncate border ${TYPE_COLORS[s.schedule_type] ?? TYPE_COLORS['기타']}`}>
                        {s.title}
                      </div>
                    ))}
                    {hiddenCount > 0 && (
                      <div className="text-[10px] text-gray-400 px-1">+{hiddenCount}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap gap-2 mt-3">
            {TYPES.map(t => (
              <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full border ${TYPE_COLORS[t]}`}>{t}</span>
            ))}
            {inspectionDeadlines.length > 0 && (
              <>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-green-200 bg-green-100 text-green-700 flex items-center gap-0.5">
                  <Flame className="size-2.5" />점검(7일+)
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-yellow-200 bg-yellow-100 text-yellow-700 flex items-center gap-0.5">
                  <Flame className="size-2.5" />점검(임박)
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-200 bg-red-100 text-red-700 flex items-center gap-0.5">
                  <Flame className="size-2.5" />점검(D-Day)
                </span>
              </>
            )}
          </div>
        </div>

        {/* 사이드 패널 */}
        <div className="space-y-3">
          <button
            onClick={() => { setEditTarget(null); setShowModal(true) }}
            className="w-full flex items-center justify-center gap-2 bg-[#7b68ee] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#6a5acd]"
          >
            <Plus size={16} /> 일정 등록
          </button>

          {selectedDate ? (
            <div className="bg-white rounded-xl border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm">{selectedDate}</span>
                <span className="text-xs text-gray-400">{selectedSchedules.length + selectedDeadlines.length}건</span>
              </div>

              {/* 점검 마감 오버레이 */}
              {selectedDeadlines.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                    <Flame className="size-3 text-orange-400" />점검 마감
                  </p>
                  <div className="space-y-1.5">
                    {selectedDeadlines.map(dl => (
                      <Link
                        key={dl.stepId}
                        href={`/inspections/${dl.inspectionId}`}
                        className={`block rounded-lg border p-2.5 hover:opacity-80 transition-opacity ${deadlineUrgencyCls(dl.dDays)}`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-xs truncate">{dl.customerName}</p>
                          <span className="text-[10px] font-bold shrink-0 ml-1">{deadlineDLabel(dl.dDays)}</span>
                        </div>
                        <p className="text-[10px] mt-0.5 opacity-80">{dl.stepNum}단계 · {dl.stepName}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* 개인 일정 */}
              {selectedSchedules.length > 0 && (
                <div>
                  {selectedDeadlines.length > 0 && (
                    <p className="text-[10px] font-medium text-gray-400 mb-1.5">개인 일정</p>
                  )}
                  <div className="space-y-2">
                    {selectedSchedules.map(s => (
                      <div key={s.id} className={`rounded-lg border p-3 ${TYPE_COLORS[s.schedule_type] ?? TYPE_COLORS['기타']}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{s.title}</p>
                            {!s.all_day && s.start_time && (
                              <p className="text-xs mt-0.5">{s.start_time.slice(0, 5)}{s.end_time ? ` ~ ${s.end_time.slice(0, 5)}` : ''}</p>
                            )}
                            {s.description && <p className="text-xs mt-1 opacity-80">{s.description}</p>}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => { setEditTarget(s); setShowModal(true) }}
                              className="p-1 hover:bg-white/50 rounded"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => handleDelete(s.id)}
                              disabled={deletePending}
                              className="p-1 hover:bg-white/50 rounded"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedSchedules.length === 0 && selectedDeadlines.length === 0 && (
                <p className="text-xs text-gray-400 py-4 text-center">일정이 없습니다.</p>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs text-gray-400 text-center py-6">날짜를 클릭하면<br/>해당 일정을 확인합니다.</p>
            </div>
          )}

          {/* 이번 달 일정 요약 */}
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">{month + 1}월 일정 목록</p>
            {(() => {
              const ms = `${year}-${String(month + 1).padStart(2, '0')}`
              const monthSchedules = schedules.filter(s =>
                s.start_date.startsWith(ms) || s.end_date.startsWith(ms) ||
                (s.start_date < ms + '-01' && s.end_date > ms + '-31')
              )
              if (monthSchedules.length === 0) {
                return <p className="text-xs text-gray-400 text-center py-2">이번 달 일정이 없습니다.</p>
              }
              return (
                <div className="space-y-1.5">
                  {monthSchedules.map(s => (
                    <div key={s.id} className="flex items-center gap-2 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        s.schedule_type === '개인' ? 'bg-blue-400' :
                        s.schedule_type === '업무' ? 'bg-purple-400' :
                        s.schedule_type === '점검' ? 'bg-orange-400' :
                        s.schedule_type === '유지보수' ? 'bg-green-400' :
                        s.schedule_type === '회의' ? 'bg-yellow-400' : 'bg-gray-400'
                      }`} />
                      <span className="text-gray-400 shrink-0">{s.start_date.slice(5)}</span>
                      <span className="truncate text-gray-700">{s.title}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {showModal && (
        <ScheduleModal
          initial={editTarget ?? undefined}
          onClose={() => { setShowModal(false); setEditTarget(null) }}
          onDone={() => { setShowModal(false); setEditTarget(null); setSelectedDate(null) }}
        />
      )}
    </>
  )
}
