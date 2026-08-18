'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { PLAN_TEXT_SECTIONS, PLAN_TEXT_SECTION_KEYS, planTextPreview, planTextBodyEquals, planTextBodyIsEmpty } from '@/lib/plan-text-sections'

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

/* ── 소방계획서_21 R1: 전역 관리 화면(/fire-plans/library)용 액션 ──────────────────────────
 *  기존 액션은 '서식 팝오버에서 한 섹션'을 전제로 만들어져 8섹션을 그리려면 8왕복·권한검사 8회가 든다.
 *  관리 화면은 8섹션을 한 장에 펼치므로 전체를 1회에 읽는 액션이 필요하다. */

export type PlanTextLibraryEntry = {
  id: string
  sectionKey: string
  title: string
  body: unknown
  version: number
  isDefault: boolean
  updatedAt: string
  preview: string
  /** 이 항목을 가져다 쓴 고객 수 (삭제·기본변경 전에 영향 범위를 보여준다 — D1-2) */
  usageCount: number
  /** 가져간 version이 현재보다 낮은 고객 수 = '개정됨' 배지 대상 */
  staleCount: number
}

export type PlanTextLibrarySnapshot = {
  entries: PlanTextLibraryEntry[]
  /** 기본문구가 없는 섹션 키 — 자동주입이 조용히 아무 일도 하지 않는 섹션(R1-3의 ○ 표시) */
  sectionsWithoutDefault: string[]
}

/** 전체 라이브러리 1회 조회 + 사용 수 집계 (R1-11) */
export async function listPlanTextLibraryAction(): Promise<{ data?: PlanTextLibrarySnapshot; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const [{ data: rows, error }, { data: stamps }] = await Promise.all([
    admin.from('plan_text_library')
      .select('id, section_key, title, body, version, is_default, updated_at')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false }),
    admin.from('plan_text_applied').select('library_id, library_version'),
  ])
  if (error) return { error: `목록 조회 실패: ${error.message}` }

  const used = new Map<string, { total: number; stale: number; versions: number[] }>()
  for (const st of (stamps ?? []) as Array<{ library_id: string | null; library_version: number }>) {
    if (!st.library_id) continue
    const u = used.get(st.library_id) ?? { total: 0, stale: 0, versions: [] }
    u.total += 1
    u.versions.push(st.library_version)
    used.set(st.library_id, u)
  }

  const entries: PlanTextLibraryEntry[] = ((rows ?? []) as Array<Record<string, unknown>>).map(r => {
    const id = r.id as string
    const version = r.version as number
    const u = used.get(id)
    return {
      id,
      sectionKey: r.section_key as string,
      title: r.title as string,
      body: r.body,
      version,
      isDefault: !!r.is_default,
      updatedAt: (r.updated_at as string).slice(0, 10),
      preview: planTextPreview(r.section_key as string, r.body),
      usageCount: u?.total ?? 0,
      staleCount: u ? u.versions.filter(v => v < version).length : 0,
    }
  })

  const withDefault = new Set(entries.filter(e => e.isDefault).map(e => e.sectionKey))
  return {
    data: {
      entries,
      sectionsWithoutDefault: [...PLAN_TEXT_SECTION_KEYS].filter(k => !withDefault.has(k)),
    },
  }
}

export type PlanTextUsageRow = {
  customerId: string
  customerName: string
  source: 'pull' | 'default'
  version: number
  appliedAt: string
  /** 가져간 version < 현재 version — 앰버 '개정됨' 배지 */
  stale: boolean
}

/** 사용처 역조회 (R1-7) — 조회 전용. 일괄 반영 버튼은 만들지 않는다(D1-4) */
export async function getPlanTextUsageAction(libraryId: string): Promise<{ rows?: PlanTextUsageRow[]; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const [{ data: cur }, { data: stamps, error }] = await Promise.all([
    admin.from('plan_text_library').select('version').eq('id', libraryId).maybeSingle(),
    admin.from('plan_text_applied')
      .select('customer_id, library_version, source, applied_at')
      .eq('library_id', libraryId).order('applied_at', { ascending: false }),
  ])
  if (error) return { error: `사용처 조회 실패: ${error.message}` }
  const list = (stamps ?? []) as Array<{ customer_id: string; library_version: number; source: string; applied_at: string }>
  if (list.length === 0) return { rows: [] }

  const { data: custs } = await admin.from('customers')
    .select('id, customer_name').in('id', [...new Set(list.map(s => s.customer_id))])
  const nameById = new Map(((custs ?? []) as Array<{ id: string; customer_name: string }>).map(c => [c.id, c.customer_name]))
  const version = (cur?.version as number | undefined) ?? 0

  return {
    rows: list.map(s => ({
      customerId: s.customer_id,
      customerName: nameById.get(s.customer_id) ?? '(삭제된 고객)',
      source: s.source === 'default' ? 'default' : 'pull',
      version: s.library_version,
      appliedAt: s.applied_at.slice(0, 10),
      stale: s.library_version < version,
    })),
  }
}

export type PlanTextImportPreviewRow = {
  sectionKey: string
  label: string
  body: unknown
  preview: string
  /** 이 고객에 서술이 없어 가져올 것이 없는 섹션 */
  empty: boolean
}

/** [고객에서 불러오기] 미리보기 (R1-8) — 고객 서식 1회 조회 후 8섹션 pick.
 *  pick을 서버에서 태우므로 고객 고유 필드(일시·장소·인원)는 이 시점에 이미 제거된다. */
export async function previewPlanTextsFromCustomerAction(
  customerId: string,
): Promise<{ rows?: PlanTextImportPreviewRow[]; customerName?: string; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const [{ data: cust }, { data: formRow }] = await Promise.all([
    admin.from('customers').select('customer_name').eq('id', customerId).maybeSingle(),
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle(),
  ])
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }
  const sections = ((formRow as { sections?: Record<string, unknown> } | null)?.sections ?? {})

  return {
    customerName: cust.customer_name as string,
    rows: Object.values(PLAN_TEXT_SECTIONS).map(def => {
      const body = def.pick(sections[def.key])
      return {
        sectionKey: def.key,
        label: def.label,
        body,
        preview: planTextPreview(def.key, body),
        empty: planTextBodyIsEmpty(def.key, body),
      }
    }),
  }
}

/** [고객에서 불러오기] 실행 (R1-8) — 체크한 섹션만 이름 붙여 등록. 8왕복·권한검사 8회를 하나로.
 *  makeDefault=true면 등록 후 기본으로 승격한다(섹션당 1개 규약은 기존 기본 해제로 지킨다). */
export async function importPlanTextsFromCustomerAction(
  customerId: string,
  picks: Array<{ sectionKey: string; title: string; makeDefault?: boolean }>,
): Promise<{ created?: Array<{ sectionKey: string; title: string }>; error?: string }> {
  const profile = await requirePermission('customer_manage')
  if (picks.length === 0) return { error: '가져올 섹션을 선택해주세요.' }
  const admin = createAdminClient()

  const { data: formRow } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', customerId).maybeSingle()
  const sections = ((formRow as { sections?: Record<string, unknown> } | null)?.sections ?? {})

  const created: Array<{ sectionKey: string; title: string }> = []
  const toDefault: string[] = []
  for (const p of picks) {
    const def = PLAN_TEXT_SECTIONS[p.sectionKey]
    if (!def) continue
    const name = p.title.trim()
    if (!name) return { error: `${def.label} 항목 이름을 입력해주세요.` }
    if (name.length > 60) return { error: `${def.label} 항목 이름은 60자 이내로 입력해주세요.` }
    const body = def.pick(sections[def.key])
    // 빈 섹션을 등록하면 자동주입이 빈 값을 채우는 셈이라 아무 의미가 없다 — 조용히 건너뛰지 않고 막는다
    if (planTextBodyIsEmpty(def.key, body)) return { error: `${def.label}은 이 고객에 서술이 없어 가져올 수 없습니다.` }
    const { data, error } = await admin.from('plan_text_library')
      .insert({ section_key: def.key, title: name, body, updated_by: profile.id })
      .select('id').single()
    if (error) return { error: `${def.label} 등록 실패: ${error.message}` }
    created.push({ sectionKey: def.key, title: name })
    if (p.makeDefault) toDefault.push(data.id as string)
  }

  for (const id of toDefault) {
    const r = await setPlanTextDefaultAction(id, true)
    if (r.error) return { error: r.error }
  }
  revalidatePath('/fire-plans/library')
  return { created }
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
