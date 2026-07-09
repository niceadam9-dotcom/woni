'use client'

import { useCallback, useMemo, useState } from 'react'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ko } from 'date-fns/locale/ko'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }), // 일요일 시작 (일·월·화…)
  getDay,
  locales: { ko },
})

const COLORS = [
  '#7b68ee', '#0091ff', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
  '#6647f0', '#14b8a6',
]

function getColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash |= 0
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

const LEAVE_LABELS: Record<string, string> = {
  annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)',
  sick: '병가', special: '특별휴가',
}

export type CalendarLeave = {
  id: string
  employee_id: string
  employee_name: string
  leave_type: string
  start_date: string
  end_date: string
  days_count: number
}

interface LeaveCalendarProps {
  leaves: CalendarLeave[]
  /** 주말·공휴일 표시용 (관리자>공휴일 관리) */
  holidays?: Array<{ date: string; name: string }>
}

export function LeaveCalendar({ leaves, holidays = [] }: LeaveCalendarProps) {
  const [view, setView] = useState<(typeof Views)[keyof typeof Views]>(Views.MONTH)
  const [date, setDate] = useState(new Date())
  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])

  // 월 뷰 날짜 헤더 — 토(파랑)/일·공휴일(빨강) + 공휴일명 (숫자 클릭은 기존 동작 유지)
  const MonthDateHeader = useCallback(({ date: d, label, onDrillDown }: {
    date: Date; label: string; onDrillDown?: React.MouseEventHandler
  }) => {
    const iso = format(d, 'yyyy-MM-dd')
    const holiday = holidayMap.get(iso)
    const dow = d.getDay()
    const color = holiday || dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : undefined
    return (
      <div className="flex items-center justify-between gap-1 min-w-0" title={holiday ? `${holiday} (공휴일)` : undefined}>
        {holiday ? <span className="text-[10px] text-red-500 truncate leading-tight">{holiday}</span> : <span />}
        <button type="button" onClick={onDrillDown} className="rbc-button-link" style={{ color }}>
          {label}
        </button>
      </div>
    )
  }, [holidayMap])

  const events = useMemo(() =>
    leaves.map(l => {
      const end = new Date(l.end_date)
      end.setDate(end.getDate() + 1)
      return {
        id: l.id,
        title: `${l.employee_name} (${LEAVE_LABELS[l.leave_type] ?? l.leave_type})`,
        start: new Date(l.start_date),
        end,
        resource: { color: getColor(l.employee_id), employee_name: l.employee_name },
      }
    }),
  [leaves])

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] p-5 shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]">
      <style>{`
        .rbc-calendar { font-family: inherit; }
        .rbc-header { background: #f8f9fa; border-color: #c8c4d0; padding: 8px 4px; font-size: 12px; font-weight: 600; color: #514b81; }
        .rbc-header:nth-child(1) { color: #dc2626; } /* 일 — 일요일 시작 */
        .rbc-header:nth-child(7) { color: #2563eb; } /* 토 */
        .rbc-day-bg { border-color: #c8c4d0; }
        .rbc-month-view, .rbc-time-view, .rbc-agenda-view { border-color: #c8c4d0; }
        .rbc-today { background: #f5f4ff; }
        .rbc-off-range-bg { background: #fafafa; }
        .rbc-event { border-radius: 6px; border: none; padding: 2px 6px; font-size: 11px; }
        .rbc-event:focus { outline: none; }
        .rbc-show-more { color: #7b68ee; font-size: 11px; }
        .rbc-toolbar button { color: #514b81; border-color: #c8c4d0; border-radius: 8px; font-size: 13px; }
        .rbc-toolbar button:hover { background: #f5f4ff; color: #7b68ee; }
        .rbc-toolbar button.rbc-active { background: #7b68ee; color: white; border-color: #7b68ee; }
        .rbc-toolbar button.rbc-active:hover { background: #6647f0; }
        .rbc-date-cell { padding: 4px 6px; font-size: 12px; color: #292d34; }
        .rbc-date-cell.rbc-now { font-weight: 700; color: #7b68ee; }
      `}</style>
      <Calendar
        localizer={localizer}
        events={events}
        view={view}
        onView={setView}
        date={date}
        onNavigate={setDate}
        style={{ height: 600 }}
        views={[Views.MONTH, Views.WEEK, Views.AGENDA]}
        components={{ month: { dateHeader: MonthDateHeader } }}
        dayPropGetter={(d: Date) => {
          const iso = format(d, 'yyyy-MM-dd')
          return holidayMap.has(iso) ? { style: { backgroundColor: '#fef2f2' } } : {}
        }}
        messages={{
          month: '월', week: '주', day: '일', agenda: '목록',
          today: '오늘', previous: '‹', next: '›',
          date: '날짜', time: '시간', event: '일정',
          noEventsInRange: '이 기간에 휴가가 없습니다.',
          showMore: (total) => `+${total}개 더 보기`,
        }}
        eventPropGetter={event => ({
          style: {
            backgroundColor: event.resource?.color ?? '#7b68ee',
            color: 'white',
          },
        })}
        formats={{
          weekdayFormat: (date) => ['일', '월', '화', '수', '목', '금', '토'][date.getDay()],
          dayFormat: (date) => format(date, 'M/d (EEE)', { locale: ko }),
          monthHeaderFormat: (date) => format(date, 'yyyy년 M월', { locale: ko }),
          dayRangeHeaderFormat: ({ start, end }) =>
            `${format(start, 'M월 d일', { locale: ko })} – ${format(end, 'M월 d일', { locale: ko })}`,
          dayHeaderFormat: (date) => format(date, 'M월 d일(EEE)', { locale: ko }),
          agendaDateFormat: (date) => format(date, 'M월 d일(EEE)', { locale: ko }),
        }}
      />
    </div>
  )
}
