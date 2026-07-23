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

/** 서식 섹션 일반 저장 (P4 — 1.2~1.7 + 1.10 inspection·multiUse·fireHistory + 1.11 training + 2장 brigadeGeneral·brigadeTeams) */
const FORM_SECTION_KEYS = new Set([
  'zones', 'hazards', 'location', 'fireAccess', 'evacFire', 'evacMaps', 'etcFacility', 'managers',
  'inspection', 'multiUse', 'fireHistory', 'training', 'brigadeGeneral', 'brigadeTeams',
  'evacDetail', 'evacHeadcount', 'evacPlan', 'vulnerable', 'vulnerableMethods', 'evacEquip',
  'photos', // 생성 문서 삽입 사진 (§8-1k 모달 폐지 — 1.3으로 이관)
])

export async function saveFirePlanSectionsAction(
  customerId: string,
  patch: Record<string, unknown>,
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const keys = Object.keys(patch)
  if (keys.length === 0 || keys.some(k => !FORM_SECTION_KEYS.has(k))) return { error: '저장할 수 없는 섹션입니다.' }
  const admin = createAdminClient()
  const { data: existing } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', customerId).maybeSingle()
  const sections = { ...((existing as { sections?: Record<string, unknown> } | null)?.sections ?? {}), ...patch }
  const { error } = await admin.from('fire_plan_forms').upsert({
    customer_id: customerId,
    sections,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  } as Record<string, unknown>)
  if (error) return { error: `저장 실패: ${error.message}` }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** §11-6: 다른 고객 섹션 단위 복사 — 같은 용도 고객의 서식 입력(1.5/1.6/1.11)을 가져오기 */
const COPYABLE_SECTION_KEYS = new Set(['evacFire', 'etcFacility', 'training'])

export type SectionCopyCandidate = { id: string; name: string; purpose: string | null; updatedAt: string | null }

export async function getSectionCopyCandidatesAction(
  customerId: string,
  sectionKey: string,
): Promise<{ candidates: SectionCopyCandidate[]; error?: string }> {
  await requirePermission('customer_manage')
  if (!COPYABLE_SECTION_KEYS.has(sectionKey)) return { candidates: [], error: '복사할 수 없는 섹션입니다.' }
  const admin = createAdminClient()

  // 같은 용도 고객 우선 (없으면 전체) — fire-plan-info-actions의 후보 로직과 동일 계열
  const { data: myBld } = await admin.from('buildings')
    .select('purpose').eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  const myPurpose = (myBld as { purpose: string | null } | null)?.purpose ?? null

  const { data: forms } = await admin.from('fire_plan_forms')
    .select('customer_id, sections, updated_at')
    .neq('customer_id', customerId)
    .order('updated_at', { ascending: false }).limit(200)
  const withSection = ((forms ?? []) as Array<{ customer_id: string; sections: Record<string, unknown>; updated_at: string | null }>)
    .filter(f => {
      const v = f.sections?.[sectionKey]
      return v != null && (typeof v !== 'object' || Object.keys(v as object).length > 0)
    })
  if (withSection.length === 0) return { candidates: [] }

  const ids = withSection.map(f => f.customer_id)
  const [{ data: custs }, { data: blds }] = await Promise.all([
    admin.from('customers').select('id, customer_name').in('id', ids).eq('is_active', true),
    admin.from('buildings').select('customer_id, purpose').in('customer_id', ids).eq('is_active', true),
  ])
  const nameById = new Map(((custs ?? []) as Array<{ id: string; customer_name: string }>).map(c => [c.id, c.customer_name]))
  const purposeById = new Map(((blds ?? []) as Array<{ customer_id: string; purpose: string | null }>).map(b => [b.customer_id, b.purpose]))

  const all = withSection
    .filter(f => nameById.has(f.customer_id))
    .map(f => ({
      id: f.customer_id, name: nameById.get(f.customer_id)!,
      purpose: purposeById.get(f.customer_id) ?? null, updatedAt: f.updated_at,
    }))
  // 같은 용도 우선 정렬
  const samePurpose = myPurpose ? all.filter(c => c.purpose === myPurpose) : []
  const rest = all.filter(c => !samePurpose.includes(c))
  return { candidates: [...samePurpose, ...rest].slice(0, 10) }
}

export async function copySectionFromCustomerAction(
  customerId: string,
  sourceCustomerId: string,
  sectionKey: string,
): Promise<{ value?: unknown; error?: string }> {
  const profile = await requirePermission('customer_manage')
  if (!COPYABLE_SECTION_KEYS.has(sectionKey)) return { error: '복사할 수 없는 섹션입니다.' }
  const admin = createAdminClient()

  const { data: src } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', sourceCustomerId).maybeSingle()
  const value = ((src as { sections?: Record<string, unknown> } | null)?.sections ?? {})[sectionKey]
  if (value == null) return { error: '원본 고객에 해당 섹션 입력이 없습니다.' }

  const res = await saveSection(customerId, sectionKey, value, profile.id)
  if (res.error) return { error: res.error }
  revalidatePath(`/customers/${customerId}`)
  return { value }
}

/** 자위소방대 편성 저장 (서식 2.2 — 1.1 계획서 정보 패널과 같은 fire_brigade_members, replace 방식) */
export type BrigadeRowInput = { team: string; name: string; duty: string; phone: string }

export async function saveBrigadeAction(
  customerId: string,
  rows: BrigadeRowInput[],
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  await admin.from('fire_brigade_members').delete().eq('customer_id', customerId)
  const inserts = rows
    .filter(m => m.name.trim())
    .map((m, i) => ({
      customer_id: customerId, team: m.team.trim() || '반원',
      name: m.name.trim(), duty: m.duty.trim() || null,
      phone: m.phone.trim() || null, sort_order: i,
    }))
  if (inserts.length > 0) {
    const { error } = await admin.from('fire_brigade_members').insert(inserts as Record<string, unknown>[])
    if (error) return { error: `편성 저장 실패: ${error.message}` }
  }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 서식 첨부 이미지(위치도·경로도 등) 업로드 — fire-plans 버킷 plan-assets 경로 (§3 서식 1.3) */
const PLAN_IMAGE_EXTS: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export async function uploadPlanAssetAction(
  customerId: string,
  formData: FormData,
): Promise<{ error?: string; path?: string }> {
  await requirePermission('customer_manage')
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: '이미지 파일을 선택해주세요.' }
  if (file.size > 10 * 1024 * 1024) return { error: '이미지는 10MB 이하여야 합니다.' }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const mime = PLAN_IMAGE_EXTS[ext]
  if (!mime) return { error: 'JPG/PNG/WEBP 이미지만 업로드할 수 있습니다.' }
  const admin = createAdminClient()
  const path = `${customerId}/plan-assets/${Date.now()}.${ext}`
  const { error } = await admin.storage.from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: false })
  if (error) return { error: `업로드 실패: ${error.message}` }
  return { path }
}

export async function deletePlanAssetAction(customerId: string, path: string): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  if (!path.startsWith(`${customerId}/plan-assets/`)) return { error: '잘못된 경로입니다.' }
  const admin = createAdminClient()
  await admin.storage.from(BUCKET).remove([path])
  return {}
}

export async function getPlanAssetUrlAction(customerId: string, path: string): Promise<{ url?: string; error?: string }> {
  await requirePermission('customer_manage')
  if (!path.startsWith(`${customerId}/plan-assets/`)) return { error: '잘못된 경로입니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data) return { error: 'URL 생성 실패' }
  return { url: data.signedUrl }
}

/** 전자우편 송달 동의 저장 (098, 별지 9호 1쪽 — 소방계획서_4.md §9-6①) */
export async function saveEmailConsentAction(
  customerId: string,
  input: { consent: boolean | null; email: string },
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const email = input.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: '이메일 형식을 확인해주세요.' }
  if (input.consent === true && !email) return { error: '동의 시 송달 이메일을 입력해주세요.' }
  const admin = createAdminClient()
  const { error } = await admin.from('customers').update({
    email_delivery_consent: input.consent,
    report_email: email || null,
  } as Record<string, unknown>).eq('id', customerId)
  if (error) return { error: `저장 실패: ${error.message}` }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 최초 진입 1회 임포트 (§7-3b) — 구 웹 생성분(.form.json)의 수기 편집값을 서식 저장소로 가져오기.
 *  조건: fire_plan_forms 입력이 아직 없는 고객(최초 1회). 매핑은 어댑터 §7-3a의 역방향. */
export async function importLegacyFormAction(customerId: string): Promise<{ imported?: string[]; error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: existing } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', customerId).maybeSingle()
  const cur = (existing as { sections?: Record<string, unknown> } | null)?.sections ?? {}
  if (Object.keys(cur).length > 0) return { error: '이미 서식 입력이 있어 가져오지 않았습니다 (최초 1회 전용).' }

  // 최신 웹 생성분의 .form.json 탐색 (generated_hwp_ 워커 생성분 제외)
  const { data: plans } = await admin.from('fire_plans')
    .select('pdf_path').eq('customer_id', customerId)
    .not('pdf_path', 'is', null)
    .like('pdf_path', '%generated\\_%')
    .order('created_at', { ascending: false }).limit(10)
  let saved: Partial<FirePlanGenData> | null = null
  for (const p of (plans ?? []) as Array<{ pdf_path: string }>) {
    if (p.pdf_path.includes('generated_hwp_')) continue
    const { data: file } = await admin.storage.from(BUCKET)
      .download(p.pdf_path.replace(/\.pdf$/, '.form.json'))
    if (!file) continue
    try { saved = JSON.parse(await file.text()) as Partial<FirePlanGenData>; break } catch { /* 손상 시 다음 후보 */ }
  }
  if (!saved) return { error: '가져올 이전 생성 데이터(.form.json)가 없습니다.' }

  // §7-3a 역방향 매핑 — 값이 있는 섹션만
  const sections: Record<string, unknown> = {}
  if ((saved.zones?.length ?? 0) > 0) {
    sections.zones = saved.zones!.map(z => ({
      zone: z.zone ?? '', name: z.name ?? '', area: z.area ?? '',
      workersWeekday: z.weekday ?? '', workersHoliday: z.holiday ?? '', company: z.managerCo ?? '', phone: z.contact ?? '',
    }))
  }
  if ((saved.hazards?.length ?? 0) > 0) {
    sections.hazards = saved.hazards!.map(h => ({ place: h.place ?? '', loc: h.location ?? '', risks: h.factors ?? [] }))
  }
  if ((saved.evacRoutes?.length ?? 0) > 0 || saved.assembly || saved.evacNote) {
    sections.evacPlan = {
      routes: saved.evacRoutes ?? [], assembly: saved.assembly ?? '', procedure: saved.evacNote ?? '',
    }
  }
  if (saved.revisionDate || saved.revisionNote) {
    sections.revision = { revisionDate: saved.revisionDate ?? '', revisionNote: saved.revisionNote ?? '' }
  }
  if (Object.keys(sections).length === 0) return { error: '이전 생성 데이터에 가져올 서식 값이 없습니다.' }

  const { error } = await admin.from('fire_plan_forms').upsert({
    customer_id: customerId, sections,
    updated_at: new Date().toISOString(), updated_by: profile.id,
  } as Record<string, unknown>)
  if (error) return { error: `가져오기 실패: ${error.message}` }
  revalidatePath(`/customers/${customerId}`)
  return { imported: Object.keys(sections) }
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
