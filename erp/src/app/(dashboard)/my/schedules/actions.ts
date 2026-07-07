'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createScheduleAction(input: {
  title: string
  description?: string | null
  startDate: string
  endDate: string
  startTime?: string | null
  endTime?: string | null
  scheduleType: string
  allDay: boolean
}): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase.from('schedules').insert({
    employee_id:   user.id,
    title:         input.title,
    description:   input.description ?? null,
    start_date:    input.startDate,
    end_date:      input.endDate,
    start_time:    input.startTime ?? null,
    end_time:      input.endTime ?? null,
    schedule_type: input.scheduleType,
    all_day:       input.allDay,
  })

  if (error) return { error: '일정 등록에 실패했습니다.' }
  revalidatePath('/my/schedules')
  return {}
}

export async function updateScheduleAction(input: {
  id: string
  title: string
  description?: string | null
  startDate: string
  endDate: string
  startTime?: string | null
  endTime?: string | null
  scheduleType: string
  allDay: boolean
}): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase
    .from('schedules')
    .update({
      title:         input.title,
      description:   input.description ?? null,
      start_date:    input.startDate,
      end_date:      input.endDate,
      start_time:    input.startTime ?? null,
      end_time:      input.endTime ?? null,
      schedule_type: input.scheduleType,
      all_day:       input.allDay,
    })
    .eq('id', input.id)
    .eq('employee_id', user.id)

  if (error) return { error: '일정 수정에 실패했습니다.' }
  revalidatePath('/my/schedules')
  return {}
}

export async function deleteScheduleAction(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', id)
    .eq('employee_id', user.id)

  if (error) return { error: '삭제에 실패했습니다.' }
  revalidatePath('/my/schedules')
  return {}
}
