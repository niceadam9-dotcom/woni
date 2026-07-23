'use server'

import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** §10-R3 — 서식 개정 재심기 반영 완료: seed_date를 최신 공포일자로 갱신('새 개정판' 뱃지 해제).
 *  재심기(새 HWP 수신 + seed-*-placeholders.py 재실행)를 마친 뒤에만 눌러야 한다 — 관리자 전용 */
export async function ackLawRevisionAction(formData: FormData): Promise<void> {
  const profile = await getProfile()
  if (!profile || !['admin', 'manager'].includes(profile.role)) return
  const key = String(formData.get('key') ?? '')
  if (!key) return
  const admin = createAdminClient()
  const { data } = await admin.from('law_form_baselines').select('announce_date').eq('key', key).maybeSingle()
  const announce = (data as { announce_date: string } | null)?.announce_date
  if (!announce) return
  await admin.from('law_form_baselines')
    .update({ seed_date: announce, updated_at: new Date().toISOString() }).eq('key', key)
  revalidatePath('/reports')
}
