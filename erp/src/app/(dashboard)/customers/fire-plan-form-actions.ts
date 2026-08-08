'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import type { FirePlanGenData } from '@/lib/fire-plan-template'
import { requestFirePlanHwpAction } from '@/app/(dashboard)/fire-plans/generate/actions'
import type { PresetType } from '@/lib/fire-plan-presets'
import { extractRoadName, type RoadTier } from '@/lib/address-parser'
import { buildSurroundingsDraft } from '@/lib/fire-plan-suggest'

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
  'dutyLog', // 1.10.2 업무수행 기록 (§12-1 결정: ERP 입력 관리)
  'fireworkLog', 'constructionLog', 'promoLog', 'recoveryLog', // 1.12~1.15 (§12-3 결정: v1 포함)
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

  // D-2(소방계획서_13) — 1.3에서 관할 소방서를 확정했으면 고객 정보에도 반영한다.
  // 종전엔 customers.fire_station(자동 지정)과 sections.location.fireStation(1.3 입력)이 이원화돼,
  // 1.3에서 고친 값이 별지·보고서 계열에는 반영되지 않아 문서마다 다른 소방서가 찍힐 수 있었다.
  // 사람이 고른 값이므로 source를 'manual'로 올려 '추정' 배지도 함께 걷는다.
  //
  // ⚠ **값이 실제로 달라졌을 때만** 쓴다. page.tsx:609가 1.3 미저장 고객의 fireStation을 고객 값으로
  //   프리필하므로, 같은 값에도 쓰면 주변현황만 고쳐 저장해도 source가 'manual'로 올라가
  //   '추정' 경고 배지가 확인 없이 사라진다(안전 신호 소실).
  const station = ((patch.location as { fireStation?: string } | undefined)?.fireStation ?? '').trim()
  if (station) {
    const { data: cur } = await admin.from('customers')
      .select('fire_station').eq('id', customerId).maybeSingle()
    const prev = ((cur as { fire_station: string | null } | null)?.fire_station ?? '').trim()
    if (prev !== station) {
      // 실패해도 1.3 저장 자체는 성공이다 — 부가 동기화이므로 에러를 표면화하지 않는다
      await admin.from('customers')
        .update({ fire_station: station, fire_station_source: 'manual' } as Record<string, unknown>)
        .eq('id', customerId)
    }
  }

  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 서식 1.3 주변 현황 자동 초안 (소방계획서_11.md §8 D-2 — "자동차 도로 기반으로 작성")
 *
 *  단계: L1 저장된 도로명주소 파싱(비용 0) → 실패 시 L2 NCP 지오코딩의 정규화 주소 재파싱.
 *  좌표를 얻어도 저장하지 않는다(현행 generateLocationMapAction과 동일 — 좌표 저장은 §9 B-1 과제).
 *
 *  ⚠ 결과는 **초안**이다. 이 액션은 아무것도 저장하지 않으며, 화면이 textarea에 채워주고
 *     사람이 빈칸(차로수·인접 건물)을 메운 뒤 기존 [서식 1.3 저장]으로 확정한다. */
export async function suggestSurroundingsAction(
  customerId: string,
  bearing?: string,
): Promise<{
  road?: string; mainRoad?: string | null; tier?: RoadTier
  draft?: string; source?: 'address' | 'geocode'; error?: string
}> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: cust } = await admin.from('customers').select('address').eq('id', customerId).maybeSingle()
  const { data: bld } = await admin.from('buildings')
    .select('address').eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  const candidates = [
    (cust as { address: string | null } | null)?.address,
    (bld as { address: string | null } | null)?.address,
  ].filter((a): a is string => !!a && !!a.trim())

  // L1 — 저장된 도로명주소에서 직접 (지번주소만 있으면 도로명이 없어 여기서 실패한다)
  for (const addr of candidates) {
    const r = extractRoadName(addr)
    if (r) {
      return {
        road: r.road, mainRoad: r.mainRoad, tier: r.tier, source: 'address',
        draft: buildSurroundingsDraft({ road: r.road, mainRoad: r.mainRoad, tier: r.tier, bearing }),
      }
    }
  }

  // L2 — 지오코딩으로 정규화된 도로명주소를 받아 재파싱 (키 없으면 여기서 종료)
  const clientId = process.env.NCP_MAPS_CLIENT_ID
  const clientSecret = process.env.NCP_MAPS_CLIENT_SECRET
  if (candidates.length > 0 && clientId && clientSecret) {
    try {
      const url = new URL('https://maps.apigw.ntruss.com/map-geocode/v2/geocode')
      url.searchParams.set('query', candidates[0])
      const res = await fetch(url.toString(), {
        headers: { 'x-ncp-apigw-api-key-id': clientId, 'x-ncp-apigw-api-key': clientSecret },
        cache: 'no-store',
      })
      if (res.ok) {
        const geo = await res.json() as { addresses?: Array<{ roadAddress?: string }> }
        const roadAddr = geo.addresses?.[0]?.roadAddress
        const r = roadAddr ? extractRoadName(roadAddr) : null
        if (r) {
          return {
            road: r.road, mainRoad: r.mainRoad, tier: r.tier, source: 'geocode',
            draft: buildSurroundingsDraft({ road: r.road, mainRoad: r.mainRoad, tier: r.tier, bearing }),
          }
        }
      }
    } catch { /* best-effort — 아래 안내로 떨어진다 */ }
  }

  if (candidates.length === 0) return { error: '고객·건물 주소가 없습니다 — 기본정보에 주소를 먼저 입력해주세요.' }
  return { error: '주소에서 도로명을 찾지 못했습니다 (지번주소만 저장된 경우) — 직접 입력해주세요.' }
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

// 전자우편 송달 동의 저장(구 saveEmailConsentAction)은 saveFirePlanInfoAction으로 흡수 —
// 1.1 화면에 저장 버튼이 둘이 되어 하나로 통합(2026-08-06). 검증 규칙은 그대로 승계됨.

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

// 소방계획서_7 H-13(2026-08-04): 생성 경로 서버 동기 전환 — 워커·SDK 미경유.
// requestFirePlanHwpAction이 서버에서 즉시 생성(HTML 템플릿 → Gotenberg PDF → 보관함 등록)한다.

/** 계획서 생성 (생성 바 직결 — 서버 동기 생성, 완료 시 보관함 즉시 등록) */
export async function requestFirePlanHwpFromTabAction(
  customerId: string, year: number, presetType?: PresetType | '',
): Promise<{ requested?: number; error?: string }> {
  return requestFirePlanHwpAction([customerId], year, presetType)
}
