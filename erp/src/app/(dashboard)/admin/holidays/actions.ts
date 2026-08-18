'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { syncHolidaysForYear } from '@/lib/holiday-sync'

/** 반영 규칙은 lib/holiday-sync.ts 하나가 갖는다(크론과 동일 코드).
 *  여기서는 권한과 화면 갱신만 책임진다 — 종전엔 크론과 같은 upsert를 복붙해 갖고 있었다. */
export async function syncNationalHolidaysAction(
  year: number
): Promise<{ count?: number; skipped?: number; removed?: number; source?: string; note?: string; error?: string }> {
  await requirePermission('holiday_manage')
  const admin = createAdminClient()

  const res = await syncHolidaysForYear(admin, year)
  if (res.error) return { error: res.error }

  revalidatePath('/admin/holidays')
  return {
    count: res.upserted,
    skipped: res.skippedManual.length,
    removed: res.removedStale.length,
    source: res.source,
    note: res.note,
  }
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
    // source='manual' 명시 — 컬럼 DEFAULT도 manual이지만, 이 값이 자동 동기화로부터
    // 이 행을 지켜 주는 유일한 표식이라 기본값에 기대지 않는다 (마이그레이션 139)
    .insert({ date, name: name.trim(), is_national: false, source: 'manual' } as Record<string, unknown>)

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
