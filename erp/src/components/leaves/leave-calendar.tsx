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
    // 팔레트 var — light는 종전 hex(#dc2626/#2563eb) 그대로, 다크는 .dark 재정의로 헤더 요일 색과 일치
    const color = holiday || dow === 0 ? 'var(--color-red-600)' : dow === 6 ? 'var(--color-blue-600)' : undefined
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
    <div className="bg-surface rounded-xl border border-line p-5 shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]">
      {/* rbc 스킨은 globals.css 공용 1곳(소방계획서_29 S3-4) — 여기서 다시 쓰면 규칙이 두 벌이 되고
          다크 대응이 화면마다 갈린다. 이 화면 고유 규칙이 생기면 그때만 <style>을 되살릴 것. */}
      <Calendar
        localizer={localizer}
        events={events}
        view={view}
        onView={setView}
        date={date}
        onNavigate={setDate}
        popup // "+N개 더 보기" 클릭 시 해당 날짜 전체 일정 오버레이 표시 (day 뷰가 없어 popup 필수)
        style={{ height: 600 }}
        views={[Views.MONTH, Views.WEEK, Views.AGENDA]}
        components={{ month: { dateHeader: MonthDateHeader } }}
        dayPropGetter={(d: Date) => {
          const iso = format(d, 'yyyy-MM-dd')
          // 점검 달력과 같은 규약(소방계획서_29 S3-1) — 인라인 리터럴은 다크에서 흰 판이 된다
          return holidayMap.has(iso) ? { style: { backgroundColor: 'var(--color-red-50)' } } : {}
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
