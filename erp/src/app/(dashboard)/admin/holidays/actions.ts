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

/** 등록된 공휴일의 날짜·이름 수정 (소방계획서_25 R-4).
 *
 *  종전엔 추가·삭제뿐이라 오타 하나를 고치려면 **삭제 후 재등록**해야 했다.
 *
 *  ⚠ 자동 생성분(api·library)을 고칠 때는 **source를 manual로 함께 올린다**. 안 그러면
 *    다음 동기화의 upsert가 이름을 원래대로 되돌려, 사용자에겐 "고쳤는데 얼마 뒤 원래대로
 *    돌아가 있다"로 보인다 — 이 코드베이스가 반복해서 만난 '조용히 되돌아가는 값' 유형이다.
 *    139 트리거는 manual→자동만 막고 자동→manual은 통과시키므로 이 승격은 허용된 방향이다.
 *    승격 사실은 반환값 `promoted`로 화면에 그대로 알린다(숨기면 그것대로 놀란다).
 */
export async function updateHolidayAction(
  id: string, date: string, name: string
): Promise<{ error?: string; promoted?: boolean }> {
  await requirePermission('holiday_manage')
  if (!date || !name.trim()) return { error: '날짜와 이름을 입력해주세요.' }

  const admin = createAdminClient()

  // source를 알아야 승격 여부를 정한다 — 모르고 쓰면 자동분 수정이 조용히 되돌아간다
  const { data: cur, error: readErr } = await admin
    .from('holidays').select('source').eq('id', id).single()
  if (readErr || !cur) return { error: '대상을 찾지 못했습니다.' }

  const promoted = (cur as { source: string }).source !== 'manual'
  const { error } = await admin
    .from('holidays')
    .update({ date, name: name.trim(), ...(promoted ? { source: 'manual' } : {}) } as Record<string, unknown>)
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: '그 날짜에 이미 다른 공휴일이 등록돼 있습니다.' }
    return { error: '수정에 실패했습니다.' }
  }

  revalidatePath('/admin/holidays')
  return { promoted }
}

export async function deleteHolidayAction(id: string): Promise<{ error?: string }> {
  await requirePermission('holiday_manage')
  const admin = createAdminClient()

  const { error } = await admin.from('holidays').delete().eq('id', id)
  if (error) return { error: '삭제에 실패했습니다.' }

  revalidatePath('/admin/holidays')
  return {}
}
