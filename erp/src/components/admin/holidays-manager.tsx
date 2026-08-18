'use client'

import { useState, useTransition } from 'react'
import { RefreshCw, Plus, Trash2, Loader2 } from 'lucide-react'
import {
  syncNationalHolidaysAction,
  addCustomHolidayAction,
  deleteHolidayAction,
} from '@/app/(dashboard)/admin/holidays/actions'
import { DateInput } from '@/components/ui/date-input'
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
        // 무엇이 보존·정리됐는지 숨기지 않는다 — 특히 폴백(note)은 값이 달라지는 이유다
        const origin = res.source === 'api' ? '공공API 확정본' : '라이브러리 산출본'
        const bits = [`${year}년 ${res.count}건 동기화 (${origin})`]
        if (res.skipped) bits.push(`수동 등록 ${res.skipped}건 보존`)
        if (res.removed) bits.push(`옛 자동 생성분 ${res.removed}건 정리`)
        setSyncMsg(bits.join(' · ') + (res.note ? `\n⚠ ${res.note}` : ''))
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
          대한민국 공휴일(대체공휴일 포함)을 공공데이터포털에서 불러옵니다.
          <strong className="text-[#514b81]"> 아래에서 직접 추가한 날짜는 덮어쓰지 않고 그대로 둡니다.</strong>{' '}
          임시공휴일·선거일처럼 자동으로 받아오지 못하는 날은 직접 추가해 주세요.
          직접 추가한 날을 다시 자동 관리로 되돌리려면 <strong className="text-[#514b81]">삭제 후 동기화</strong>하시면 됩니다.
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
          <DateInput
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
                    {/* 출처 배지 — 사용자에게 중요한 건 '이 값이 어디서 왔고 동기화에 지워지는가'다.
                        수동 등록분만 자동 동기화에서 보존된다(마이그레이션 139) */}
                    {h.source === 'manual' ? (
                      <span title="직접 등록 — 자동 동기화가 덮어쓰지 않습니다"
                        className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                        수동 등록
                      </span>
                    ) : h.source === 'api' ? (
                      <span title="공공데이터포털 특일 정보 — 대체공휴일까지 확정된 값"
                        className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#7b68ee]/10 text-[#7b68ee]">
                        확정(공공API)
                      </span>
                    ) : (
                      <span title="공공API를 쓰지 못해 라이브러리로 산출한 값 — 임시공휴일·선거일은 빠져 있습니다"
                        className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        자동(라이브러리)
                      </span>
                    )}
                    {!h.is_national && (
                      <span className="text-xs text-[#b0acd6]">자체휴무</span>
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
