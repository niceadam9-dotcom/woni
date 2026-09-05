'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'

/** 별지 9호 2쪽 "건축물 정보" 항목 — 건축물대장 자동 채움 대상이자 수기 입력 대상 (소방계획서_9 B안).
 *  대장 API가 값을 주지 않는 건물도 서식을 완성할 수 있도록 건물 폼에서 직접 입력한다.
 *  컬럼은 대장 연동이 쓰는 것과 동일(height/households/… — 레거시 height_m·unit_count와 다름) */
export type LedgerEditableInput = {
  permit_date?: string | null          // 건축허가일 YYYY-MM-DD
  building_area?: number               // 건축면적(㎡)
  building_count?: number              // 건물 동수
  parking_summary?: string | null      // 주차장 (옥내/옥외·기계식/자주식 요약)
  height?: number                      // 높이(m)
  households?: number                  // 세대수
  elevator_count?: number              // 승용 승강기(대)
  emergency_elevator_count?: number    // 비상용 승강기(대)
  // 별지 9호 2쪽 잔여 항목(2026-09-05) — 소방계획서 1.1 일반현황 패널과 같은 컬럼(fire-plan-info-actions)
  main_structure?: string | null       // 건축물구조 — 체크 판정은 report9-assemble 키워드(콘크리트/철골/조적/목)
  roof_structure?: string | null       // 지붕구조 — 슬래브(슬라브)/기와/슬레이트/기타
  stairs_count?: number                // 직통(또는 피난)계단 개소
  ramp_count?: number                  // 경사로 개소
  evac_elevator_count?: number         // 피난용 승강기(대)
}

/** 대장 항목을 update/insert 페이로드로 — undefined(폼 미전송)는 건드리지 않고, 빈 값은 null로 지운다 */
function ledgerFields(b: LedgerEditableInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (b.permit_date !== undefined) out.permit_date = b.permit_date || null
  if (b.building_area !== undefined) out.building_area = b.building_area ?? null
  if (b.building_count !== undefined) out.building_count = b.building_count ?? null
  if (b.parking_summary !== undefined) out.parking_summary = b.parking_summary || null
  if (b.height !== undefined) out.height = b.height ?? null
  if (b.households !== undefined) out.households = b.households ?? null
  if (b.elevator_count !== undefined) out.elevator_count = b.elevator_count ?? null
  if (b.emergency_elevator_count !== undefined) out.emergency_elevator_count = b.emergency_elevator_count ?? null
  if (b.main_structure !== undefined) out.main_structure = b.main_structure || null
  if (b.roof_structure !== undefined) out.roof_structure = b.roof_structure || null
  if (b.stairs_count !== undefined) out.stairs_count = b.stairs_count ?? null
  if (b.ramp_count !== undefined) out.ramp_count = b.ramp_count ?? null
  if (b.evac_elevator_count !== undefined) out.evac_elevator_count = b.evac_elevator_count ?? null
  return out
}

/** 건물 숫자 필드 유효성 (IMP-10) — 음수·비상식 값 차단 */
function validateBuildingNumbers(
  b: {
    total_area?: number; floors_above?: number; floors_below?: number; year_built?: number
  } & LedgerEditableInput,
): string | null {
  const y = new Date().getFullYear()
  if (b.total_area != null && (isNaN(b.total_area) || b.total_area < 0))
    return '연면적은 0 이상의 숫자여야 합니다.'
  if (b.floors_above != null && (isNaN(b.floors_above) || b.floors_above < 0 || b.floors_above > 200))
    return '지상층수는 0~200 사이여야 합니다.'
  if (b.floors_below != null && (isNaN(b.floors_below) || b.floors_below < 0 || b.floors_below > 20))
    return '지하층수는 0~20 사이여야 합니다.'
  if (b.year_built != null && (isNaN(b.year_built) || b.year_built < 1900 || b.year_built > y))
    return `준공연도는 1900~${y} 사이여야 합니다.`
  // 별지 9호 항목 (소방계획서_9 B안) — 0 이상만, 상한은 대장 값 그대로 받도록 두지 않음
  const nonNeg: Array<[number | undefined, string]> = [
    [b.building_area, '건축면적'], [b.building_count, '건물 동수'], [b.height, '높이'],
    [b.households, '세대수'], [b.elevator_count, '승용 승강기'], [b.emergency_elevator_count, '비상용 승강기'],
    [b.stairs_count, '계단'], [b.ramp_count, '경사로'], [b.evac_elevator_count, '피난용 승강기'],
  ]
  for (const [v, label] of nonNeg) {
    if (v != null && (isNaN(v) || v < 0)) return `${label}은(는) 0 이상의 숫자여야 합니다.`
  }
  if (b.permit_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.permit_date))
    return '건축허가일은 YYYY-MM-DD 형식이어야 합니다.'
  return null
}

export type CreateBuildingInput = {
  customer_id: string
  building_name: string
  zipcode?: string
  address?: string
  address_jibun?: string   // 092: 지번주소 (건축물대장 번지 파싱)
  bcode?: string           // 092: 법정동코드 10자리
  total_area?: number
  floors_above?: number
  floors_below?: number
  purpose?: string
  year_built?: number
  notes?: string
} & LedgerEditableInput

export async function createBuildingAction(
  input: CreateBuildingInput
): Promise<{ error?: string; buildingId?: string }> {
  const profile = await requirePermission('building_manage')
  const admin = createAdminClient()

  const vErr = validateBuildingNumbers(input)
  if (vErr) return { error: vErr }
  // 건축허가일 필수(2026-09-05) — 공란이면 갑지 엑셀·별지 9호 2쪽이 공란으로 인쇄된다.
  // 이 액션의 호출부는 건물 폼뿐이라 고객 등록 시 자동 생성(customers/actions.ts 직접 insert)은 막지 않는다.
  if (!input.permit_date) return { error: '건축허가일을 입력해주세요.' }

  const baseFields = {
    customer_id: input.customer_id,
    building_name: input.building_name,
    address: input.address || null,
    total_area: input.total_area ?? null,
    floors_above: input.floors_above ?? null,
    floors_below: input.floors_below ?? null,
    purpose: input.purpose || null,
    year_built: input.year_built ?? null,
    notes: input.notes || null,
    created_by: profile.id,
    ...ledgerFields(input),   // 별지 9호 2쪽 항목 (소방계획서_9 B안)
  }

  // 단계적 폴백: 092(bcode·지번)+zipcode → zipcode만(092 미적용) → 기본(022 미적용)
  const attempts: Record<string, unknown>[] = [
    { ...baseFields, zipcode: input.zipcode || null, bcode: input.bcode || null, address_jibun: input.address_jibun || null },
    { ...baseFields, zipcode: input.zipcode || null },
    baseFields,
  ]
  let data: { id: string } | null = null
  let error: { code?: string; message?: string } | null = null
  for (const payload of attempts) {
    const res = await admin.from('buildings').insert(payload).select('id').single()
    data = res.data as { id: string } | null
    error = res.error
    if (!error) break
    if (error.code !== '42703' && !error.message?.includes('column') && !error.message?.includes('zipcode')) break
  }

  if (error) return { error: error.message ?? '건물 등록 실패' }

  revalidatePath('/buildings')
  revalidatePath(`/customers/${input.customer_id}`)
  return { buildingId: (data as { id: string }).id }
}

export type UpdateBuildingInput = {
  id: string
  building_name: string
  zipcode?: string
  address?: string
  address_jibun?: string   // 092
  bcode?: string           // 092
  total_area?: number
  building_area?: number
  floors_above?: number
  floors_below?: number
  height_m?: number
  unit_count?: number
  structure?: string
  roof?: string
  purpose?: string
  year_built?: number
  notes?: string
  is_active: boolean
} & LedgerEditableInput

export async function updateBuildingAction(
  input: UpdateBuildingInput
): Promise<{ error?: string }> {
  await requirePermission('building_manage')
  const admin = createAdminClient()

  const vErr = validateBuildingNumbers(input)
  if (vErr) return { error: vErr }

  const updateFields: Record<string, unknown> = {
    building_name: input.building_name,
    zipcode: input.zipcode || null,
    address: input.address || null,
    total_area: input.total_area ?? null,
    building_area: input.building_area ?? null,
    floors_above: input.floors_above ?? null,
    floors_below: input.floors_below ?? null,
    height_m: input.height_m ?? null,
    unit_count: input.unit_count ?? null,
    structure: input.structure || null,
    roof: input.roof || null,
    purpose: input.purpose || null,
    year_built: input.year_built ?? null,
    notes: input.notes || null,
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
    ...ledgerFields(input),   // 별지 9호 2쪽 항목 (소방계획서_9 B안)
  }

  // 092 필드는 값이 있을 때만 포함 (주소 검색을 안 했으면 기존 값 유지)
  const with092: Record<string, unknown> = { ...updateFields }
  if (input.bcode) with092.bcode = input.bcode
  if (input.address_jibun) with092.address_jibun = input.address_jibun

  // 단계적 폴백: 092 포함 → 092 제외(미적용) → zipcode 제외(022 미적용)
  const { zipcode: _z, ...withoutZipcode } = updateFields
  void _z
  const attempts: Record<string, unknown>[] = [with092, updateFields, withoutZipcode]
  let error: { code?: string; message?: string } | null = null
  for (const payload of attempts) {
    const res = await admin.from('buildings').update(payload).eq('id', input.id)
    error = res.error
    if (!error) break
    if (error.code !== '42703' && !error.message?.includes('column') && !error.message?.includes('zipcode')) break
  }

  if (error) return { error: error.message ?? '건물 수정 실패' }

  revalidatePath('/buildings')
  revalidatePath(`/buildings/${input.id}`)
  return {}
}

export async function deleteBuildingAction(id: string): Promise<{ error?: string }> {
  await requirePermission('building_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('buildings')
    .update({ is_active: false, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/buildings')
  return {}
}
