'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { getKoreanHolidays } from '@/lib/holidays'

export async function syncNationalHolidaysAction(
  year: number
): Promise<{ count?: number; error?: string }> {
  await requirePermission('holiday_manage')
  const admin = createAdminClient()

  const holidays = await getKoreanHolidays(year)
  if (holidays.length === 0) return { error: '공휴일 데이터를 가져올 수 없습니다.' }

  const rows = holidays.map(h => ({
    date: h.date,
    name: h.name,
    is_national: true,
  }))

  const { error } = await admin
    .from('holidays')
    .upsert(rows as unknown as Record<string, unknown>[], { onConflict: 'date' })

  if (error) return { error: '동기화에 실패했습니다: ' + error.message }

  revalidatePath('/admin/holidays')
  return { count: rows.length }
}

export async function addCustomHolidayAction(
  date: string,
  name: string
): Promise<{ error?: string }> {
  await requirePermission('holiday_manage')
  if (!date || !name.trim()) return { error: '날짜와 이름을 입력해주세요.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('holidays')
    .insert({ date, name: name.trim(), is_national: false } as Record<string, unknown>)

  if (error) {
    if (error.code === '23505') return { error: '이미 등록된 날짜입니다.' }
    return { error: '등록에 실패했습니다.' }
  }

  revalidatePath('/admin/holidays')
  return {}
}

export async function deleteHolidayAction(id: string): Promise<{ error?: string }> {
  await requirePermission('holiday_manage')
  const admin = createAdminClient()

  const { error } = await admin.from('holidays').delete().eq('id', id)
  if (error) return { error: '삭제에 실패했습니다.' }

  revalidatePath('/admin/holidays')
  return {}
}
