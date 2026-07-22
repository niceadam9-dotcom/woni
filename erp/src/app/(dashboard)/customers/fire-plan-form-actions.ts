'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import type { FirePlanGenData } from '@/lib/fire-plan-template'
import { getFirePlanGenDefaultsAction, generateFirePlanAction } from './fire-plan-actions'
import { requestFirePlanHwpAction } from '@/app/(dashboard)/fire-plans/generate/actions'
import type { PresetType } from '@/lib/fire-plan-presets'

/** 소방계획서 탭(4-1 골격) 전용 액션 — 소방계획서_4.md §2·§7
 *  서식 입력 저장소 = fire_plan_forms(096, 고객당 1행·섹션 JSONB). */

const BUCKET = 'fire-plans'

/** 섹션 저장 (부분 갱신) — 4-1은 revision(개정이력 작성일·개정내용)만 사용, 이후 단계에서 섹션 확장 */
async function saveSection(customerId: string, key: string, value: unknown, profileId: string): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { data: existing } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', customerId).maybeSingle()
  const sections = { ...((existing as { sections?: Record<string, unknown> } | null)?.sections ?? {}), [key]: value }
  const { error } = await admin.from('fire_plan_forms').upsert({
    customer_id: customerId,
    sections,
    updated_at: new Date().toISOString(),
    updated_by: profileId,
  } as Record<string, unknown>)
  if (error) return { error: `저장 실패: ${error.message}` }
  return {}
}

/** 개정이력 입력 저장 — 다음 생성 시 개정이력 표의 작성일·개정내용으로 병합 (요구 0·1·2) */
export async function saveFirePlanRevisionAction(
  customerId: string,
  input: { revisionDate: string; revisionNote: string },
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  if (input.revisionNote.length > 200) return { error: '개정 내용은 200자 이내로 입력해주세요.' }
  const res = await saveSection(customerId, 'revision', {
    revisionDate: input.revisionDate.slice(0, 10),
    revisionNote: input.revisionNote.trim(),
  }, profile.id)
  if (!res.error) revalidatePath(`/customers/${customerId}`)
  return res
}

/** PDF 즉시 생성 (생성 바 직결 — 모달 없이 저장된 데이터로)
 *  기준 데이터: 최신 웹 생성분의 .form.json(있으면) > 자동 기본값. 개정이력 입력은 항상 최우선 반영. */
export async function generateFirePlanPdfNowAction(customerId: string): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  const def = await getFirePlanGenDefaultsAction(customerId)
  if (def.error || !def.data) return { error: def.error ?? '기본값을 불러오지 못했습니다.' }

  // 최신 웹 생성분(.form.json 보유 — 워커 생성분 generated_hwp_는 제외)의 저장 양식을 기준으로 사용
  let data: FirePlanGenData = def.data
  const { data: plans } = await admin.from('fire_plans')
    .select('pdf_path').eq('customer_id', customerId)
    .not('pdf_path', 'is', null)
    .like('pdf_path', '%generated\\_%')
    .order('created_at', { ascending: false }).limit(10)
  for (const p of (plans ?? []) as Array<{ pdf_path: string }>) {
    if (p.pdf_path.includes('generated_hwp_')) continue
    const { data: file } = await admin.storage.from(BUCKET)
      .download(p.pdf_path.replace(/\.pdf$/, '.form.json'))
    if (!file) continue
    try {
      const saved = JSON.parse(await file.text()) as Partial<FirePlanGenData>
      data = {
        ...def.data,
        ...saved,
        // 개정이력 입력·연도는 현재 값 우선 (요구 1·2 — 탭의 작성일·개정내용이 항상 반영)
        year: def.data.year,
        revisionDate: def.data.revisionDate,
        revisionNote: def.data.revisionNote,
      } as FirePlanGenData
      break
    } catch { /* 손상 시 다음 후보 */ }
  }

  return generateFirePlanAction(customerId, data)
}

/** HWP 생성 요청 (생성 바 직결 — 큐 등록, 워커가 처리) */
export async function requestFirePlanHwpFromTabAction(
  customerId: string, year: number, presetType?: PresetType | '',
): Promise<{ requested?: number; error?: string }> {
  return requestFirePlanHwpAction([customerId], year, presetType)
}
