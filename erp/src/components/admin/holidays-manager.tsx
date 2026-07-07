'use client'

import { useState, useTransition } from 'react'
import { RefreshCw, Plus, Trash2, Loader2 } from 'lucide-react'
import {
  syncNationalHolidaysAction,
  addCustomHolidayAction,
  deleteHolidayAction,
} from '@/app/(dashboard)/admin/holidays/actions'
import type { Holiday } from '@/types'

interface Props {
  initialHolidays: Holiday[]
  initialYear: number
}

export function HolidaysManager({ initialHolidays, initialYear }: Props) {
  const [year, setYear] = useState(initialYear)
  const [holidays, setHolidays] = useState(initialHolidays)
  const [syncMsg, setSyncMsg] = useState('')
  const [addDate, setAddDate] = useState('')
  const [addName, setAddName] = useState('')
  const [addErr, setAddErr] = useState('')
  const [isPending, startTransition] = useTransition()

  const yearHolidays = holidays
    .filter(h => new Date(h.date).getFullYear() === year)
    .sort((a, b) => a.date.localeCompare(b.date))

  function handleSync() {
    setSyncMsg('')
    startTransition(async () => {
      const res = await syncNationalHolidaysAction(year)
      if (res.error) {
        setSyncMsg(`오류: ${res.error}`)
      } else {
        setSyncMsg(`${year}년 국가공휴일 ${res.count}건 동기화 완료`)
        // 서버 revalidate 후 reload
        window.location.reload()
      }
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddErr('')
    startTransition(async () => {
      const res = await addCustomHolidayAction(addDate, addName)
      if (res.error) {
        setAddErr(res.error)
      } else {
        setAddDate('')
        setAddName('')
        window.location.reload()
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteHolidayAction(id)
      setHolidays(prev => prev.filter(h => h.id !== id))
    })
  }

  const currentYear = new Date().getFullYear()
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1]

  return (
    <div className="space-y-6">
      {/* 연도 선택 + 국가공휴일 자동 동기화 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] p-5 shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px]">
        <h2 className="text-sm font-semibold text-[#090c1d] mb-4">국가공휴일 자동 동기화</h2>
        <p className="text-xs text-[#514b81] mb-4">
          대한민국 공휴일을 자동으로 불러옵니다. 이미 등록된 날짜는 이름이 갱신되며 중복 추가되지 않습니다.
        </p>
        <p className="text-xs text-[#b0acd6] mb-4">
          자동 동기화: 매년 <strong className="text-[#514b81]">1월 1일</strong> · <strong className="text-[#514b81]">12월 1일</strong> 에 올해·내년 공휴일이 자동 갱신됩니다.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="h-9 rounded-lg border border-[#c8c4d0] px-3 text-sm text-[#090c1d] focus:outline-none focus:ring-2 focus:ring-[#7b68ee]/30"
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <button
            onClick={handleSync}
            disabled={isPending}
            className="flex items-center gap-2 h-9 px-4 rounded-lg bg-[#7b68ee] text-white text-sm font-medium hover:bg-[#6647f0] disabled:opacity-60 transition-colors"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {year}년 공휴일 동기화
          </button>
        </div>
        {syncMsg && (
          <p className={`mt-3 text-xs font-medium ${syncMsg.startsWith('오류') ? 'text-red-600' : 'text-green-600'}`}>
            {syncMsg}
          </p>
        )}
      </div>

      {/* 회사 자체 휴무일 추가 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] p-5 shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px]">
        <h2 className="text-sm font-semibold text-[#090c1d] mb-4">회사 자체 휴무일 추가</h2>
        <form onSubmit={handleAdd} className="flex items-start gap-3">
          <input
            type="date"
            value={addDate}
            onChange={e => setAddDate(e.target.value)}
            required
            className="h-9 rounded-lg border border-[#c8c4d0] px-3 text-sm text-[#090c1d] focus:outline-none focus:ring-2 focus:ring-[#7b68ee]/30"
          />
          <input
            type="text"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            placeholder="휴무일 이름 (예: 창립기념일)"
            required
            className="flex-1 h-9 rounded-lg border border-[#c8c4d0] px-3 text-sm text-[#090c1d] placeholder:text-[#b0acd6] focus:outline-none focus:ring-2 focus:ring-[#7b68ee]/30"
          />
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] text-white text-sm font-medium hover:bg-[#090c1d] disabled:opacity-60 transition-colors shrink-0"
          >
            <Plus className="size-4" />
            추가
          </button>
        </form>
        {addErr && <p className="mt-2 text-xs text-red-600">{addErr}</p>}
      </div>

      {/* 공휴일 목록 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
          <h2 className="text-sm font-semibold text-[#090c1d]">{year}년 등록 공휴일</h2>
          <span className="text-xs text-[#514b81]">{yearHolidays.length}건</span>
        </div>
        {yearHolidays.length === 0 ? (
          <p className="text-sm text-[#514b81] text-center py-10">
            등록된 공휴일이 없습니다. 위에서 동기화하거나 직접 추가하세요.
          </p>
        ) : (
          <ul className="divide-y divide-[#c8c4d0]">
            {yearHolidays.map(h => {
              const d = new Date(h.date)
              const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
              return (
                <li key={h.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-[#090c1d]">
                      {h.date}
                    </span>
                    <span className="text-xs text-[#514b81]">({dow})</span>
                    <span className="text-sm text-[#090c1d]">{h.name}</span>
                    {h.is_national ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#7b68ee]/10 text-[#7b68ee]">
                        국가공휴일
                      </span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                        자체휴무
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(h.id)}
                    disabled={isPending}
                    className="p-1.5 rounded-lg text-[#b0acd6] hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
                    title="삭제"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
