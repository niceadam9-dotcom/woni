'use server'

import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadStepProgress, type StepProgress } from '@/lib/customer-step-progress'

/** [이력] 탭 진행바 — 탭을 처음 열 때 클라이언트(inspection-history-table)가 부른다.
 *  속도 개선 3단계(2026-10-01): 종전엔 고객 페이지 서버 렌더가 탭과 무관하게 매번 돌리던 조회다.
 *  권한은 고객 상세 열람과 같다(로그인). 판정식은 lib/customer-step-progress 한 벌. */
export async function getCustomerStepProgressAction(
  customerId: string,
): Promise<{ progress?: StepProgress; error?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: '로그인이 필요합니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('inspections').select('id, plan_type').eq('customer_id', customerId)
  if (error) return { error: error.message }
  return { progress: await loadStepProgress(admin, (data ?? []) as Array<{ id: string; plan_type: string | null }>) }
}
