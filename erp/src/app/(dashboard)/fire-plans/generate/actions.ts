'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import {
  PRESET_TYPES, PRESET_FILE_KEYS, defaultPreset,
  type FirePlanPreset, type PresetType,
} from '@/lib/fire-plan-presets'
import { computeFirePlanReadiness, type FirePlanReadiness } from '@/lib/fire-plan-readiness'

/** 소방계획서 HWP 생성 요청 큐 (doc02 §8 확장, 2026-07-15)
 *  큐 = fire-plans 버킷 _queue/*.json — Windows 워커(scripts/fireplan-worker.py)가 폴링·처리.
 *  마이그레이션 없이 스토리지로 상태 관리. 하트비트로 워커 온라인 표시.
 *  7차: 공통 수기 프리셋(_presets/{유형}.json) — 요청에 presetType 포함, 다중 선택 일괄 요청. */

const BUCKET = 'fire-plans'
const PRESET_PREFIX = '_presets'

export async function searchCustomersForPlanAction(q: string): Promise<{
  customers: Array<{ id: string; name: string; type: string; purpose: string | null }>
}> {
  await requirePermission('customer_manage')
  if (!q.trim()) return { customers: [] }
  const admin = createAdminClient()
  const { data } = await admin.from('customers')
    .select('id, customer_name, inspection_type, buildings(purpose, is_active)')
    .eq('is_active', true)
    .ilike('customer_name', `%${q.trim()}%`)
    .order('customer_name')
    .limit(10)
  return {
    customers: ((data ?? []) as Array<{
      id: string; customer_name: string; inspection_type: string
      buildings: Array<{ purpose: string | null; is_active: boolean }> | null
    }>).map(c => ({
      id: c.id,
      name: c.customer_name,
      type: c.inspection_type,
      purpose: (c.buildings ?? []).find(b => b.is_active)?.purpose ?? null,
    })),
  }
}

/** 생성 페이지 사전 체크 — 선택 고객별 계획서 준비율·누락 항목 (설계 §5-2)
 *  누락이 있어도 생성은 허용(fail-soft) — '이대로 생성' 또는 고객 상세에서 '입력 후 생성' 선택 */
export async function getFirePlanReadinessAction(customerIds: string[]): Promise<{
  readiness: Array<{ id: string } & FirePlanReadiness>
}> {
  await requirePermission('customer_manage')
  const ids = [...new Set(customerIds)].filter(Boolean).slice(0, 30)
  if (ids.length === 0) return { readiness: [] }
  const admin = createAdminClient()

  const [{ data: custs }, { data: blds }, { data: brigade }] = await Promise.all([
    admin.from('customers')
      .select('id, manager_selected_at, building_grade, insurance_joined, op_hours_weekday, headcount_worker, headcount_resident, headcount_max')
      .in('id', ids),
    admin.from('buildings')
      .select('customer_id, receiver_location, main_structure, roof_structure, created_at')
      .in('customer_id', ids).eq('is_active', true).order('created_at', { ascending: true }),
    admin.from('fire_brigade_members').select('customer_id').in('customer_id', ids),
  ])

  const firstBld = new Map<string, { receiver_location: string | null; main_structure: string | null; roof_structure: string | null }>()
  for (const b of (blds ?? []) as Array<{ customer_id: string; receiver_location: string | null; main_structure: string | null; roof_structure: string | null }>) {
    if (!firstBld.has(b.customer_id)) firstBld.set(b.customer_id, b)
  }
  const brigadeIds = new Set(((brigade ?? []) as Array<{ customer_id: string }>).map(m => m.customer_id))

  return {
    readiness: ((custs ?? []) as Array<{
      id: string; manager_selected_at: string | null; building_grade: string | null
      insurance_joined: boolean | null; op_hours_weekday: string | null
      headcount_worker: number | null; headcount_resident: number | null; headcount_max: number | null
    }>).map(c => {
      const b = firstBld.get(c.id)
      return {
        id: c.id,
        ...computeFirePlanReadiness({
          receiverLocation: b?.receiver_location ?? '',
          structure: b?.main_structure ?? '',
          roof: b?.roof_structure ?? '',
          managerSelectedAt: c.manager_selected_at ?? '',
          grade: c.building_grade ?? '',
          insuranceJoined: c.insurance_joined,
          opHoursWeekday: c.op_hours_weekday ?? '',
          hasHeadcount: c.headcount_worker != null || c.headcount_resident != null || c.headcount_max != null,
          hasBrigade: brigadeIds.has(c.id),
        }),
      }
    }),
  }
}

/** 프리셋 유형이 지정된 요청 전, 워커가 읽을 _presets/{유형}.json이 없으면 기본값으로 시딩 */
async function ensurePresetFile(admin: ReturnType<typeof createAdminClient>, type: PresetType): Promise<void> {
  const { data } = await admin.storage.from(BUCKET).download(`${PRESET_PREFIX}/${PRESET_FILE_KEYS[type]}.json`)
  if (data) return
  await admin.storage.from(BUCKET).upload(
    `${PRESET_PREFIX}/${PRESET_FILE_KEYS[type]}.json`,
    Buffer.from(JSON.stringify(defaultPreset(type), null, 2), 'utf8'),
    { contentType: 'application/json', upsert: true })
}

/** 생성 요청 등록 — 다중 고객 일괄 지원 (프리셋 공유 고객 순차 처리, 7차) */
export async function requestFirePlanHwpAction(
  customerIds: string[], year: number, presetType?: PresetType | '',
): Promise<{ requested?: number; error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const ids = [...new Set(customerIds)].filter(Boolean)
  if (ids.length === 0) return { error: '고객을 선택해주세요.' }
  if (ids.length > 30) return { error: '일괄 요청은 최대 30건까지 가능합니다.' }
  if (!year || year < 2000 || year > 2100) return { error: '연도를 확인해주세요.' }
  const preset = presetType && (PRESET_TYPES as readonly string[]).includes(presetType) ? presetType : ''

  const { data: custs } = await admin.from('customers')
    .select('id, customer_name').in('id', ids)
  const nameById = new Map(((custs ?? []) as Array<{ id: string; customer_name: string }>)
    .map(c => [c.id, c.customer_name]))
  if (nameById.size !== ids.length) return { error: '고객을 찾을 수 없습니다.' }

  if (preset) await ensurePresetFile(admin, preset as PresetType)

  const base = Date.now()
  for (let i = 0; i < ids.length; i++) {
    const payload = {
      customerId: ids[i],
      customerName: nameById.get(ids[i]),
      year,
      presetType: preset || undefined,
      requestedBy: profile.id,
      requestedByName: profile.name,
      requestedAt: new Date().toISOString(),
    }
    const { error } = await admin.storage.from(BUCKET).upload(
      `_queue/${base + i}_${ids[i]}.json`,
      Buffer.from(JSON.stringify(payload), 'utf8'),
      { contentType: 'application/json', upsert: false })
    if (error) return { requested: i, error: `요청 등록 실패(${i + 1}/${ids.length}번째): ${error.message}` }
  }
  return { requested: ids.length }
}

// ── 7차: 프리셋 조회·저장 ─────────────────────────────────────

export async function getFirePlanPresetsAction(): Promise<{ presets: FirePlanPreset[] }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const presets: FirePlanPreset[] = []
  for (const type of PRESET_TYPES) {
    const { data } = await admin.storage.from(BUCKET).download(`${PRESET_PREFIX}/${PRESET_FILE_KEYS[type]}.json`)
    if (data) {
      try {
        const p = JSON.parse(await data.text()) as FirePlanPreset
        if (p && Array.isArray(p.entries)) { presets.push({ ...p, type }); continue }
      } catch { /* 손상 시 기본값 폴백 */ }
    }
    presets.push(defaultPreset(type))
  }
  return { presets }
}

export async function saveFirePlanPresetAction(preset: FirePlanPreset): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  if (!(PRESET_TYPES as readonly string[]).includes(preset?.type)) return { error: '프리셋 유형이 올바르지 않습니다.' }
  if (!Array.isArray(preset.entries) || preset.entries.length > 50) return { error: '프리셋 항목을 확인해주세요.' }
  for (const e of preset.entries) {
    if (typeof e.find !== 'string' || typeof e.value !== 'string') return { error: '프리셋 항목 형식이 올바르지 않습니다.' }
    if (!e.find.trim()) return { error: '찾을 문구(양식 기본값)가 비어 있는 항목이 있습니다.' }
    if (e.find.length > 300 || e.value.length > 300) return { error: '문구는 300자 이내로 입력해주세요.' }
  }
  const body: FirePlanPreset = {
    type: preset.type,
    description: (preset.description ?? '').slice(0, 200),
    entries: preset.entries.map(e => ({
      section: (e.section ?? '').slice(0, 100),
      title: (e.title ?? '').slice(0, 100),
      find: e.find,
      value: e.value,
    })),
    updatedAt: new Date().toISOString(),
    updatedBy: profile.name,
  }
  const admin = createAdminClient()
  const { error } = await admin.storage.from(BUCKET).upload(
    `${PRESET_PREFIX}/${PRESET_FILE_KEYS[preset.type]}.json`,
    Buffer.from(JSON.stringify(body, null, 2), 'utf8'),
    { contentType: 'application/json', upsert: true })
  if (error) return { error: `프리셋 저장 실패: ${error.message}` }
  return {}
}

export type GenStatus = {
  workerOnline: boolean
  pending: Array<{ name: string; customerName: string; year: number; presetType?: string; requestedByName: string; requestedAt: string }>
  results: Array<{ name: string; ok: boolean; error?: string; customerName?: string; year?: number; preset?: string; customerId?: string; finishedAt?: string; missing?: string[] }>
}

export async function getFirePlanGenStatusAction(): Promise<GenStatus> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 하트비트 (30초 내 = 온라인)
  let workerOnline = false
  const { data: hb } = await admin.storage.from(BUCKET).download('_queue/_heartbeat.json')
  if (hb) {
    try {
      const { at } = JSON.parse(await hb.text()) as { at: string }
      workerOnline = Date.now() - new Date(at).getTime() < 30_000
    } catch { /* 무시 */ }
  }

  // 대기 중 요청
  const pending: GenStatus['pending'] = []
  const { data: queue } = await admin.storage.from(BUCKET)
    .list('_queue', { limit: 50, sortBy: { column: 'name', order: 'asc' } })
  for (const item of (queue ?? []) as Array<{ name: string }>) {
    if (!item.name.endsWith('.json') || item.name === '_heartbeat.json') continue
    const { data: file } = await admin.storage.from(BUCKET).download(`_queue/${item.name}`)
    if (!file) continue
    try {
      const p = JSON.parse(await file.text()) as { customerName: string; year: number; presetType?: string; requestedByName: string; requestedAt: string }
      pending.push({ name: item.name, ...p })
    } catch { /* 무시 */ }
  }

  // 최근 결과 (최신 10)
  const results: GenStatus['results'] = []
  const { data: done } = await admin.storage.from(BUCKET)
    .list('_results', { limit: 10, sortBy: { column: 'name', order: 'desc' } })
  for (const item of (done ?? []) as Array<{ name: string }>) {
    if (!item.name.endsWith('.json')) continue
    const { data: file } = await admin.storage.from(BUCKET).download(`_results/${item.name}`)
    if (!file) continue
    try {
      const r = JSON.parse(await file.text()) as { ok: boolean; error?: string; customerName?: string; year?: number; preset?: string; finishedAt?: string; missing?: string[] }
      // 요청 파일명 규약 {ts}_{customerId}.json → 고객 상세 링크용
      const customerId = item.name.replace(/^\d+_/, '').replace(/\.json$/, '')
      results.push({ name: item.name, customerId, ...r })
    } catch { /* 무시 */ }
  }

  return { workerOnline, pending, results }
}
