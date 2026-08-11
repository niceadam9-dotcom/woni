'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { PLAN_TEXT_SECTIONS, PLAN_TEXT_SECTION_KEYS, planTextPreview, planTextBodyEquals } from '@/lib/plan-text-sections'

/** 공통 서술 라이브러리 액션 (소방계획서_15_별도라이브러리.md §5)
 *  저장소 = plan_text_library(119, 항목) + plan_text_applied(출처 스탬프·자동주입 1회 가드).
 *  섹션 취사선택(pick/merge/injectEmpty)은 전부 lib/plan-text-sections.ts 단일 원천을 쓴다. */

export type PlanTextItem = { id: string; title: string; updatedAt: string; isDefault: boolean; preview: string }

/** 섹션의 활성 항목 목록 — ⭐기본 → 최근 수정 → 이름순, 미리보기 40자 포함 (§4-1) */
export async function listPlanTextsAction(sectionKey: string): Promise<{ items?: PlanTextItem[]; error?: string }> {
  await requirePermission('customer_manage')
  if (!PLAN_TEXT_SECTION_KEYS.has(sectionKey)) return { error: '지원하지 않는 섹션입니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('plan_text_library')
    .select('id, title, body, is_default, updated_at')
    .eq('section_key', sectionKey).eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error) return { error: `목록 조회 실패: ${error.message}` }
  return {
    items: (data ?? []).map(r => ({
      id: r.id as string,
      title: r.title as string,
      updatedAt: (r.updated_at as string).slice(0, 10),
      isDefault: !!r.is_default,
      preview: planTextPreview(sectionKey, r.body),
    })),
  }
}

/** 항목 본문 로드 — 가져오기 적용 시점 (버전은 저장 성공 시 스탬프에 쓴다 §3-2) */
export async function getPlanTextAction(id: string): Promise<{ body?: unknown; version?: number; title?: string; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data, error } = await admin.from('plan_text_library')
    .select('body, version, title').eq('id', id).eq('is_active', true).maybeSingle()
  if (error) return { error: `조회 실패: ${error.message}` }
  if (!data) return { error: '항목이 없거나 삭제되었습니다.' }
  return { body: data.body, version: data.version as number, title: data.title as string }
}

/** 등록/덮어쓰기 — body가 실제로 바뀔 때만 version+1 (이름 그대로 재저장에 개정 배지가 뜨면 안 된다) */
export async function savePlanTextAction(
  sectionKey: string, title: string, formValue: unknown, overwriteId?: string,
): Promise<{ id?: string; error?: string }> {
  const profile = await requirePermission('customer_manage')
  const def = PLAN_TEXT_SECTIONS[sectionKey]
  if (!def) return { error: '지원하지 않는 섹션입니다.' }
  const name = title.trim()
  if (!name) return { error: '항목 이름을 입력해주세요.' }
  if (name.length > 60) return { error: '항목 이름은 60자 이내로 입력해주세요.' }
  // 서술 필드만 추출 — 고객 고유 값(일자·인원·집결지 등)이 라이브러리에 실리지 않게 서버에서도 pick을 태운다
  const body = def.pick(formValue)
  const admin = createAdminClient()
  if (overwriteId) {
    const { data: cur, error: curErr } = await admin.from('plan_text_library')
      .select('body, version, section_key').eq('id', overwriteId).eq('is_active', true).maybeSingle()
    if (curErr) return { error: `조회 실패: ${curErr.message}` }
    if (!cur || cur.section_key !== sectionKey) return { error: '덮어쓸 항목이 없습니다.' }
    // B-7(소방계획서_19 K-8): jsonb 키 순서 정규화 때문에 stringify 직접 비교는 항상 '다름'(version 오증가) — 정렬 비교
    const changed = !planTextBodyEquals(cur.body, body)
    const { error } = await admin.from('plan_text_library').update({
      title: name, body,
      ...(changed ? { version: (cur.version as number) + 1 } : {}),
      updated_at: new Date().toISOString(), updated_by: profile.id,
    }).eq('id', overwriteId)
    if (error) return { error: `저장 실패: ${error.message}` }
    return { id: overwriteId }
  }
  const { data, error } = await admin.from('plan_text_library')
    .insert({ section_key: sectionKey, title: name, body, updated_by: profile.id })
    .select('id').single()
  if (error) return { error: `저장 실패: ${error.message}` }
  return { id: data.id as string }
}

/** 기본항목 지정/해제 — 섹션당 1개(부분 유니크 인덱스). 지정 시 같은 섹션 기존 기본을 먼저 해제 */
export async function setPlanTextDefaultAction(id: string, isDefault: boolean): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: cur, error: curErr } = await admin.from('plan_text_library')
    .select('section_key').eq('id', id).eq('is_active', true).maybeSingle()
  if (curErr) return { error: `조회 실패: ${curErr.message}` }
  if (!cur) return { error: '항목이 없거나 삭제되었습니다.' }
  if (isDefault) {
    const { error: clearErr } = await admin.from('plan_text_library')
      .update({ is_default: false, updated_by: profile.id })
      .eq('section_key', cur.section_key).eq('is_default', true)
    if (clearErr) return { error: `기존 기본 해제 실패: ${clearErr.message}` }
  }
  const { error } = await admin.from('plan_text_library')
    .update({ is_default: isDefault, updated_by: profile.id }).eq('id', id)
  if (error) return { error: `저장 실패: ${error.message}` }
  return {}
}

/** 이름변경 — version 미증가 (문구가 그대로인데 개정 배지가 뜨면 안 된다 §3-1) */
export async function renamePlanTextAction(id: string, title: string): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const name = title.trim()
  if (!name) return { error: '항목 이름을 입력해주세요.' }
  if (name.length > 60) return { error: '항목 이름은 60자 이내로 입력해주세요.' }
  const admin = createAdminClient()
  const { error } = await admin.from('plan_text_library')
    .update({ title: name, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq('id', id).eq('is_active', true)
  if (error) return { error: `저장 실패: ${error.message}` }
  return {}
}

/** 소프트 삭제 — 가져간 고객 데이터에는 영향 없음(pull 시점 복사). 기본항목이면 지정도 함께 해제 */
export async function deletePlanTextAction(id: string): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { error } = await admin.from('plan_text_library')
    .update({ is_active: false, is_default: false, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq('id', id)
  if (error) return { error: `삭제 실패: ${error.message}` }
  return {}
}

/** 출처 스탬프 (§3-2, source='pull') — 서식 [저장] 성공 후에만 호출한다.
 *  가져오기 적용 시점에 찍으면 저장하지 않고 떠난 경우 거짓 출처가 남는다. */
export async function stampPlanTextAppliedAction(
  customerId: string, sectionKey: string, libraryId: string, libraryVersion: number,
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  if (!PLAN_TEXT_SECTION_KEYS.has(sectionKey)) return { error: '지원하지 않는 섹션입니다.' }
  const admin = createAdminClient()
  const { error } = await admin.from('plan_text_applied').upsert({
    customer_id: customerId, section_key: sectionKey,
    library_id: libraryId, library_version: libraryVersion,
    source: 'pull', applied_at: new Date().toISOString(), applied_by: profile.id,
  })
  if (error) return { error: `기록 실패: ${error.message}` }
  return {}
}

/** 기본항목 자동주입 (§4-0) — 소방계획서 탭 진입 시 1회.
 *  스탬프 없는 섹션만 · 빈 칸만 · 서버에서 저장까지 수행하고 source='default' 스탬프를 남긴다.
 *  서버 저장인 이유: DB에 없으면 생성 문서에 실리지 않아 3.6 미인쇄 결함(§2-1)을 못 고친다.
 *  1.1 건축물대장 자동반영(autoApplyLedgerEmptyAction — 빈 칸만·1회 가드)과 같은 규약. */
export async function applyPlanTextDefaultsAction(
  customerId: string,
): Promise<{ filled?: Array<{ sectionKey: string; title: string }>; error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: defaults, error: defErr } = await admin.from('plan_text_library')
    .select('id, section_key, title, body, version')
    .eq('is_default', true).eq('is_active', true)
  if (defErr) return { error: `기본항목 조회 실패: ${defErr.message}` }
  if (!defaults || defaults.length === 0) return { filled: [] }

  const { data: stamps } = await admin.from('plan_text_applied')
    .select('section_key').eq('customer_id', customerId)
  const stamped = new Set((stamps ?? []).map(r => r.section_key as string))

  const { data: formRow } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', customerId).maybeSingle()
  const sections = { ...((formRow as { sections?: Record<string, unknown> } | null)?.sections ?? {}) }

  const filled: Array<{ sectionKey: string; title: string }> = []
  const stampRows: Array<Record<string, unknown>> = []
  for (const d of defaults) {
    const key = d.section_key as string
    const def = PLAN_TEXT_SECTIONS[key]
    if (!def || stamped.has(key)) continue   // 스탬프 = 이미 주입했거나 사용자가 지운 것 — 재주입 금지 (§4-0)
    const { next, changed } = def.injectEmpty(sections[key], d.body)
    if (!changed) continue
    sections[key] = next
    filled.push({ sectionKey: key, title: d.title as string })
    stampRows.push({
      customer_id: customerId, section_key: key,
      library_id: d.id, library_version: d.version,
      source: 'default', applied_at: new Date().toISOString(), applied_by: profile.id,
    })
  }
  if (filled.length === 0) return { filled: [] }

  const { error: saveErr } = await admin.from('fire_plan_forms').upsert({
    customer_id: customerId, sections,
    updated_at: new Date().toISOString(), updated_by: profile.id,
  } as Record<string, unknown>)
  if (saveErr) return { error: `저장 실패: ${saveErr.message}` }
  const { error: stampErr } = await admin.from('plan_text_applied').upsert(stampRows)
  if (stampErr) return { error: `기록 실패: ${stampErr.message}` }
  revalidatePath(`/customers/${customerId}`)
  return { filled }
}
