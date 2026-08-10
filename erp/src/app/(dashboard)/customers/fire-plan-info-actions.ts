'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { fetchBuildingLedgerAction, geocodeAddressToBcodeAction } from './actions'

/** bcode·지번 확보 — 저장값 우선, 없으면 저장된 주소로 Juso 지오코딩 후 buildings에 백필(B안, 2026-08-05).
 *  반환 null = 확보 실패(주소 없음·키 미설정·매칭 실패 → 호출부는 needAddress로 처리). */
async function resolveBcodeJibun(
  admin: ReturnType<typeof createAdminClient>,
  bld: Record<string, unknown>,
): Promise<{ bcode: string; jibun: string } | null> {
  const bcode = (bld.bcode as string | null) || ''
  const jibun = (bld.address_jibun as string | null) || ''
  if (bcode && jibun) return { bcode, jibun }

  const addr = (bld.address as string | null) || (bld.address_jibun as string | null) || ''
  if (!addr) return null
  const geo = await geocodeAddressToBcodeAction(addr)
  if (geo.unavailable || !geo.bcode || !geo.jibunAddress) return null

  // 백필 — 다음부터 지오코딩 없이 원클릭 (092 미적용 DB는 컬럼 없음 → 조용히 무시)
  try {
    await admin.from('buildings')
      .update({ bcode: geo.bcode, address_jibun: geo.jibunAddress })
      .eq('id', bld.id as string)
  } catch { /* best-effort: 092 미적용 등 */ }
  return { bcode: geo.bcode, jibun: geo.jibunAddress }
}

/** 소방계획서 정보(5+6차 필드) 저장 — 고객 상세 계획서 정보 패널 (설계: 소방계획서-필드확장-설계.md §4) */

export type BrigadeMemberInput = { team: string; name: string; duty: string; phone: string }

export type FirePlanInfoInput = {
  // 건물 개요 (buildings — 첫 활성 건물)
  receiverLocation: string
  structure: string
  roof: string
  // 시설현황 신규 (104, §3-1.1 — 별지 9호 연계)
  stairsCount: string         // 계단(개소) | ''
  rampCount: string           // 경사로(개소) | ''
  evacElevatorCount: string   // 피난용승강기(대) | ''
  // customers
  managerSelectedAt: string   // YYYY-MM-DD | ''
  grade: string               // 특급/1급/2급/3급 | ''
  // 운영현황 신규 (104, §3-1.1 — 별지 9호 2쪽 연계)
  repRole: string             // 대표자 구분: 소유자/관리자/점유자 | ''
  managerLicenseGrade: string // 소방안전관리자 자격구분: 특급/1급/2급/3급 | ''
  managerEduDate: string      // 최근 교육이수일 YYYY-MM-DD | ''
  insuranceJoined: boolean | null
  insuranceCompany: string
  insurancePeriod: string
  insuranceAmountPerson: string
  insuranceAmountProperty: string
  opHoursWeekday: string
  opHoursHoliday: string
  headcountWorker: string     // 숫자 문자열 | ''
  headcountResident: string
  headcountMax: string
  brigade: BrigadeMemberInput[]
  // ④ 자체점검 보고서 전자우편 송달 동의 (098, 별지 9호 1쪽) — 저장 버튼 통합(2026-08-06)으로 1.1 폼에 흡수
  emailConsent: boolean | null
  reportEmail: string
}

const toInt = (s: string): number | null => {
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

export async function saveFirePlanInfoAction(
  customerId: string,
  input: FirePlanInfoInput,
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  if (input.repRole && !['소유자', '관리자', '점유자'].includes(input.repRole)) return { error: '대표자 구분 값을 확인해주세요.' }
  if (input.managerLicenseGrade && !['특급', '1급', '2급', '3급'].includes(input.managerLicenseGrade)) return { error: '자격구분 값을 확인해주세요.' }
  // 송달 동의 검증 — 구 saveEmailConsentAction의 규칙을 그대로 승계(저장 통합, 2026-08-06)
  const reportEmail = input.reportEmail.trim()
  if (reportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail)) return { error: '이메일 형식을 확인해주세요.' }
  if (input.emailConsent === true && !reportEmail) return { error: '송달 동의 시 이메일을 입력해주세요.' }

  // customers 갱신
  const { error: cErr } = await admin.from('customers').update({
    manager_selected_at: input.managerSelectedAt || null,
    building_grade: input.grade || null,
    rep_role: input.repRole || null,
    manager_license_grade: input.managerLicenseGrade || null,
    manager_edu_date: input.managerEduDate || null,
    insurance_joined: input.insuranceJoined,
    insurance_company: input.insuranceCompany.trim() || null,
    insurance_period: input.insurancePeriod.trim() || null,
    insurance_amount_person: input.insuranceAmountPerson.trim() || null,
    insurance_amount_property: input.insuranceAmountProperty.trim() || null,
    op_hours_weekday: input.opHoursWeekday || null,
    op_hours_holiday: input.opHoursHoliday || null,
    headcount_worker: toInt(input.headcountWorker),
    headcount_resident: toInt(input.headcountResident),
    headcount_max: toInt(input.headcountMax),
    email_delivery_consent: input.emailConsent,
    report_email: reportEmail || null,
  } as Record<string, unknown>).eq('id', customerId)
  if (cErr) return { error: `고객 정보 저장 실패: ${cErr.message}` }

  // 첫 활성 건물 갱신 (있을 때만)
  const { data: bld } = await admin.from('buildings')
    .select('id').eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (bld) {
    const { error: bErr } = await admin.from('buildings').update({
      receiver_location: input.receiverLocation.trim() || null,
      main_structure: input.structure.trim() || null,
      roof_structure: input.roof.trim() || null,
      stairs_count: toInt(input.stairsCount),
      ramp_count: toInt(input.rampCount),
      evac_elevator_count: toInt(input.evacElevatorCount),
    } as Record<string, unknown>).eq('id', (bld as { id: string }).id)
    if (bErr) return { error: `건물 정보 저장 실패: ${bErr.message}` }
  }

  // 자위소방대 편성 전체 교체 (upsert 단순화)
  await admin.from('fire_brigade_members').delete().eq('customer_id', customerId)
  const rows = input.brigade
    .filter(m => m.name.trim())
    .map((m, i) => ({
      customer_id: customerId, team: m.team.trim() || '반원',
      name: m.name.trim(), duty: m.duty.trim() || null,
      phone: m.phone.trim() || null, sort_order: i,
    }))
  if (rows.length > 0) {
    const { error: mErr } = await admin.from('fire_brigade_members').insert(rows as Record<string, unknown>[])
    if (mErr) return { error: `자위소방대 저장 실패: ${mErr.message}` }
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'fire_plan_info_updated',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: { grade: input.grade || null, brigade_count: rows.length },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** [건축물대장에서 다시 가져오기] — 기존 고객의 구조·지붕·높이 등 대장값 갱신 (설계 §3 note)
 *  §5-A-3(탭개편): 건물에 저장된 bcode·지번(092) 우선 사용 → 주소창 없이 원클릭.
 *  저장값이 없으면 needAddress를 반환 — 클라이언트가 Daum 주소창으로 1회 확보해 재호출하면 백필 저장. */
export async function refreshLedgerAction(
  customerId: string,
  bcode?: string,
  jibunAddress?: string,
): Promise<{ structure?: string; roof?: string; height?: string; needAddress?: boolean; error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: bld } = await admin.from('buildings')
    .select('*').eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!bld) return { error: '등록된 건물이 없습니다 — 건물·시설 탭에서 먼저 등록해주세요.' }
  const stored = bld as Record<string, unknown>

  let useBcode = bcode || (stored.bcode as string | null) || ''
  let useJibun = jibunAddress || (stored.address_jibun as string | null) || ''
  if (!useBcode || !useJibun) {
    // B안: Daum 주소창 인자도 없고 저장값도 없으면 주소로 지오코딩·백필(resolveBcodeJibun) 후 진행
    const resolved = await resolveBcodeJibun(admin, stored)
    if (!resolved) return { needAddress: true }
    useBcode = resolved.bcode; useJibun = resolved.jibun
  }

  const res = await fetchBuildingLedgerAction(useBcode, useJibun)
  if (res.unavailable) return { error: '건축물대장 API 키가 설정되지 않았습니다.' }
  if (res.error || !res.info) return { error: res.error ?? '건축물대장을 조회할 수 없습니다.' }
  const L = res.info

  // 대장에 값이 있는 항목만 갱신 (없는 항목은 기존 수동 입력 유지)
  const patch: Record<string, unknown> = { ledger_synced_at: new Date().toISOString() }
  // 주소창으로 새로 받은 bcode·지번은 백필 저장 → 다음부터 원클릭 (092 미적용 시 아래 폴백에서 제외)
  if (bcode) { patch.bcode = bcode; patch.address_jibun = jibunAddress || null }
  if (L.main_structure != null) patch.main_structure = L.main_structure
  if (L.roof_structure != null) patch.roof_structure = L.roof_structure
  if (L.height != null) patch.height = L.height
  if (L.elevator_count != null) patch.elevator_count = L.elevator_count
  if (L.emergency_elevator_count != null) patch.emergency_elevator_count = L.emergency_elevator_count
  if (L.households != null) patch.households = L.households
  if (L.ho_count != null) patch.ho_count = L.ho_count
  if (L.attached_building_count != null) patch.attached_building_count = L.attached_building_count
  if (L.seismic_design != null) patch.seismic_design = L.seismic_design
  // 098 확장 (P2 §11-1) — 건축허가일·건축면적·동수·주차장
  if (L.permit_date != null) patch.permit_date = L.permit_date
  if (L.building_area != null) patch.building_area = L.building_area
  if (L.building_count != null) patch.building_count = L.building_count
  if (L.parking_summary != null) patch.parking_summary = L.parking_summary

  // 092 미적용 DB 폴백: bcode·address_jibun 제외 후 재시도
  const { bcode: _b, address_jibun: _j, ...without092 } = patch
  void _b; void _j
  let bErr: { code?: string; message?: string } | null = null
  for (const payload of [patch, without092]) {
    const res2 = await admin.from('buildings').update(payload).eq('id', (bld as { id: string }).id)
    bErr = res2.error
    if (!bErr) break
    if (bErr.code !== '42703' && !bErr.message?.includes('column')) break
  }
  if (bErr) return { error: `건물 정보 갱신 실패: ${bErr.message}` }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'building_ledger_refreshed',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: { structure: L.main_structure, roof: L.roof_structure, height: L.height },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  return {
    structure: L.main_structure ?? undefined,
    roof: L.roof_structure ?? undefined,
    height: L.height != null ? String(L.height) : undefined,
  }
}

/** ── 11-1c: 대장값 미리보기 → 앰버 확인 → 확정 저장 (빠른 입력 화면) ── */

const LEDGER_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'permit_date', label: '건축허가일' },
  { key: 'building_area', label: '건축면적(㎡)' },
  { key: 'building_count', label: '건물동수' },
  { key: 'parking_summary', label: '주차장' },
  { key: 'main_structure', label: '구조' },
  { key: 'roof_structure', label: '지붕' },
  { key: 'height', label: '높이(m)' },
  { key: 'elevator_count', label: '승용승강기(대)' },
  { key: 'emergency_elevator_count', label: '비상용승강기(대)' },
  { key: 'households', label: '세대수' },
  { key: 'ho_count', label: '호수' },
  { key: 'attached_building_count', label: '부속건축물(동)' },
  { key: 'seismic_design', label: '내진설계' },
]

export type LedgerPreviewField = { key: string; label: string; current: string; next: string; changed: boolean }

/** 대장 조회만 (저장 없음) — 현재값과 비교한 필드 목록 반환. 확정은 applyLedgerValuesAction */
export async function previewLedgerAction(customerId: string): Promise<{
  fields?: LedgerPreviewField[]; needAddress?: boolean; error?: string
}> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: bld } = await admin.from('buildings')
    .select('*').eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!bld) return { error: '등록된 건물이 없습니다 — 건물·시설 탭에서 먼저 등록해주세요.' }
  const stored = bld as Record<string, unknown>

  // B안: 저장 bcode 없으면 주소로 지오코딩·백필 후 진행 (주소창 1회 확인 불필요)
  const resolved = await resolveBcodeJibun(admin, stored)
  if (!resolved) return { needAddress: true }
  const { bcode: useBcode, jibun: useJibun } = resolved

  const res = await fetchBuildingLedgerAction(useBcode, useJibun)
  if (res.unavailable) return { error: '건축물대장 API 키가 설정되지 않았습니다.' }
  if (res.error || !res.info) return { error: res.error ?? '건축물대장을 조회할 수 없습니다.' }
  const L = res.info as unknown as Record<string, unknown>

  const fields: LedgerPreviewField[] = []
  for (const { key, label } of LEDGER_FIELDS) {
    if (L[key] == null) continue // 대장에 없는 항목은 기존 수동 입력 유지
    const current = stored[key] == null ? '' : String(stored[key])
    const next = String(L[key])
    fields.push({ key, label, current, next, changed: current !== next })
  }
  return { fields }
}

/** 미리보기에서 확인한 값 확정 저장 — LEDGER_FIELDS 화이트리스트만 허용 */
export async function applyLedgerValuesAction(
  customerId: string,
  values: Record<string, string>,
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: bld } = await admin.from('buildings')
    .select('id').eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!bld) return { error: '등록된 건물이 없습니다.' }

  const allowed = new Set(LEDGER_FIELDS.map(f => f.key))
  const patch: Record<string, unknown> = { ledger_synced_at: new Date().toISOString() }
  for (const [k, v] of Object.entries(values)) {
    if (allowed.has(k)) patch[k] = v === '' ? null : v
  }
  if (Object.keys(patch).length === 1) return { error: '저장할 값이 없습니다.' }

  const { error } = await admin.from('buildings').update(patch).eq('id', (bld as { id: string }).id)
  if (error) return { error: `건물 정보 갱신 실패: ${error.message}` }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'building_ledger_refreshed',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: { applied: Object.keys(patch).filter(k => k !== 'ledger_synced_at'), confirmed: true },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 자동 반영 — 주소 확정·소방계획서 진입 시 호출. LEDGER_FIELDS 중 '빈 칸만' 대장 값으로 채움(수동값 미덮어씀).
 *  best-effort: 권한·주소·키 미비 시 조용히 skip(리다이렉트하지 않음). 재실행 방지용 ledger_synced_at 항상 기록. */
export async function autoApplyLedgerEmptyAction(
  customerId: string,
  opts?: { mode?: 'empty' | 'all' },
): Promise<{
  filled?: number; skipped?: 'noPermission' | 'noBuilding' | 'needAddress' | 'unavailable'; error?: string
}> {
  // mode='empty'(기본) = 빈 칸만 — 기존 수기 값 보존. 탭 진입 자동 등 상시 경로.
  // mode='all' = 전 필드 덮어쓰기 — '주소가 새로 확정된 시점'(건물 저장 직후)에만 사용.
  //   주소가 바뀌면 이전 값은 다른 건물 데이터이므로 대장이 정답 (2026-08-06 사용자 확정).
  const mode = opts?.mode ?? 'empty'
  const profile = await getProfile()
  if (!profile || !can(profile.role as UserRole, 'customer_manage')) return { skipped: 'noPermission' }
  const admin = createAdminClient()

  const { data: bld } = await admin.from('buildings')
    .select('*').eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!bld) return { skipped: 'noBuilding' }
  const stored = bld as Record<string, unknown>

  // B안: 저장 bcode 없으면 주소로 지오코딩·백필 후 진행 (구 고객도 주소창 없이 자동)
  const resolved = await resolveBcodeJibun(admin, stored)
  if (!resolved) return { skipped: 'needAddress' }
  const { bcode: useBcode, jibun: useJibun } = resolved

  const res = await fetchBuildingLedgerAction(useBcode, useJibun)
  if (res.unavailable) return { skipped: 'unavailable' }
  if (res.error || !res.info) return { error: res.error ?? '건축물대장을 조회할 수 없습니다.' }
  const L = res.info as unknown as Record<string, unknown>

  const isEmpty = (v: unknown) => v == null || v === ''
  const patch: Record<string, unknown> = {}
  for (const { key } of LEDGER_FIELDS) {
    if (L[key] == null) continue                            // 대장에 값 없음 → 스킵
    if (mode === 'empty' && !isEmpty(stored[key])) continue  // 빈 칸만 모드: 기존 값 미덮어씀
    const next = String(L[key])
    if (String(stored[key] ?? '') === next) continue         // 동일값은 제외 — filled 카운트·안내 정확도
    patch[key] = next
  }
  const filled = Object.keys(patch).length
  patch.ledger_synced_at = new Date().toISOString()   // 채운 게 없어도 재조회 방지용으로 기록

  const { error } = await admin.from('buildings').update(patch).eq('id', (bld as { id: string }).id)
  if (error) return { error: `건물 정보 갱신 실패: ${error.message}` }

  if (filled > 0) {
    await admin.from('activity_logs').insert({
      actor_id: profile.id,
      action: 'building_ledger_refreshed',
      entity_type: 'customer',
      entity_id: customerId,
      metadata: { applied: Object.keys(patch).filter(k => k !== 'ledger_synced_at'), auto: true, emptyOnly: mode === 'empty' },
    } as Record<string, unknown>)
  }

  revalidatePath(`/customers/${customerId}`)
  return { filled }
}
