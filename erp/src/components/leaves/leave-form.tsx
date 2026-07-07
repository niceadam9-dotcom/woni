'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, CalendarDays } from 'lucide-react'
import { applyLeaveAction } from '@/app/(dashboard)/leaves/actions'

const LEAVE_TYPES = [
  { value: 'annual',   label: '연차' },
  { value: 'half_am',  label: '반차(오전)' },
  { value: 'half_pm',  label: '반차(오후)' },
  { value: 'sick',     label: '병가' },
  { value: 'special',  label: '특별휴가' },
] as const

const schema = z
  .object({
    leave_type: z.enum(['annual', 'half_am', 'half_pm', 'sick', 'special']),
    start_date: z.string().min(1, '시작일을 입력해주세요'),
    end_date: z.string().min(1, '종료일을 입력해주세요'),
    reason: z.string().optional(),
  })
  .refine(
    data => {
      if (data.leave_type === 'half_am' || data.leave_type === 'half_pm') {
        return data.start_date === data.end_date
      }
      return !data.start_date || !data.end_date || data.end_date >= data.start_date
    },
    { message: '종료일이 시작일보다 빠를 수 없습니다', path: ['end_date'] }
  )

type FormValues = z.infer<typeof schema>

interface LeaveFormProps {
  remaining: number
  totalDays: number
}

export function LeaveForm({ remaining, totalDays }: LeaveFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { leave_type: 'annual', start_date: '', end_date: '', reason: '' },
  })

  const leaveType = watch('leave_type')
  const startDate = watch('start_date')
  const endDate = watch('end_date')
  const isHalf = leaveType === 'half_am' || leaveType === 'half_pm'

  // 반차 선택 시 종료일을 시작일로 자동 설정
  useEffect(() => {
    if (isHalf && startDate) setValue('end_date', startDate)
  }, [isHalf, startDate, setValue])

  const daysCount =
    isHalf
      ? 0.5
      : startDate && endDate && endDate >= startDate
      ? Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1
      : 0

  const onSubmit = handleSubmit(values => {
    setError('')
    startTransition(async () => {
      const result = await applyLeaveAction(values)
      if (result.error) setError(result.error)
      else router.push('/leaves')
    })
  })

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 잔여 연차 표시 */}
      <div className="flex items-center justify-between bg-[#f5f4ff] border border-[#c8c4d0] rounded-xl px-5 py-4">
        <div>
          <p className="text-xs text-[#514b81]">잔여 연차</p>
          <p className="text-2xl font-bold text-[#7b68ee] mt-0.5">
            {remaining}
            <span className="text-sm font-normal ml-1">일</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#514b81]">총 연차</p>
          <p className="text-sm font-semibold text-[#090c1d]">{totalDays}일</p>
        </div>
      </div>

      {/* 휴가 종류 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[#292d34]">휴가 종류 *</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {LEAVE_TYPES.map(t => (
            <label key={t.value} className="cursor-pointer">
              <input type="radio" {...register('leave_type')} value={t.value} className="sr-only peer" />
              <div className="text-center px-2 py-2.5 rounded-lg border border-[#d0ccf5] text-xs font-medium text-[#514b81] peer-checked:border-[#7b68ee] peer-checked:bg-[#f5f4ff] peer-checked:text-[#7b68ee] hover:bg-[#f8f9fa] transition-all">
                {t.label}
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* 날짜 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[#292d34]">시작일 *</label>
          <input
            type="date"
            {...register('start_date')}
            className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20 transition"
          />
          {errors.start_date && <p className="text-xs text-red-500">{errors.start_date.message}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[#292d34]">종료일 *</label>
          <input
            type="date"
            {...register('end_date')}
            disabled={isHalf}
            min={startDate || undefined}
            className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20 transition disabled:opacity-60 disabled:cursor-not-allowed"
          />
          {errors.end_date && <p className="text-xs text-red-500">{errors.end_date.message}</p>}
        </div>
      </div>

      {/* 신청 일수 미리보기 */}
      {daysCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#f8f9fa] rounded-lg">
          <CalendarDays className="size-4 text-[#7b68ee]" />
          <span className="text-sm text-[#514b81]">신청 일수:</span>
          <span className="text-sm font-semibold text-[#090c1d]">{daysCount}일</span>
          {['annual', 'half_am', 'half_pm'].includes(leaveType) && (
            <span className="text-xs text-[#514b81] ml-auto">
              차감 후 잔여: {remaining - daysCount}일
            </span>
          )}
        </div>
      )}

      {/* 사유 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[#292d34]">사유</label>
        <textarea
          {...register('reason')}
          rows={3}
          placeholder="사유를 입력해주세요 (선택)"
          className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] placeholder:text-[#b0acd6] outline-none focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20 transition resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isPending && <Loader2 className="size-4 animate-spin" />}
        휴가 신청
      </button>
    </form>
  )
}
