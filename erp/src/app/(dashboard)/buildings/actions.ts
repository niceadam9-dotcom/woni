'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'
import { resolvePrimaryRepair, type BuildingLike } from '@/lib/primary-building'

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

/** 대표동 지정 — 「어느 동이 문서에 인쇄되는가」를 사용자가 고른다 (마이그레이션 160).
 *
 *  종전 규칙은 `created_at` 최고참이라 **바꿀 방법이 없었다**(등록 순서를 되돌릴 수 없다).
 *  판정 규칙 자체는 `lib/primary-building`이 단일 원천이고, 여기는 그 규칙이 읽는 값을 쓴다.
 *
 *  🚨 160 미적용 DB에서는 컬럼이 없어 실패한다 — **조용히 삼키지 않는다**. 성공한 척하면
 *    사용자는 '눌렀는데 안 바뀐다'만 보게 되고 원인을 찾을 단서가 없다. */
export async function setPrimaryBuildingAction(
  customerId: string,
  buildingId: string,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 남의 고객 건물을 대표로 세우지 못하게 — id만 믿지 않는다
  const { data: target } = await admin.from('buildings')
    .select('id, customer_id, is_active').eq('id', buildingId).maybeSingle()
  const t = target as { customer_id: string; is_active: boolean } | null
  if (!t || t.customer_id !== customerId) return { error: '이 고객의 건물이 아닙니다.' }
  if (!t.is_active) return { error: '비활성 건물은 대표동으로 지정할 수 없습니다.' }

  // ⚠ 유니크 인덱스(고객당 대표 1개)가 있으므로 **먼저 내리고 나서 올린다**.
  //   순서를 바꾸면 잠깐 둘이 되어 인덱스가 거부한다.
  const down = await admin.from('buildings')
    .update({ is_primary: false } as Record<string, unknown>)
    .eq('customer_id', customerId).neq('id', buildingId)
  if (down.error) {
    return {
      error: down.error.code === '42703' || down.error.message?.includes('column')
        ? '대표동 기능은 데이터베이스 준비 후 사용할 수 있습니다 (마이그레이션 160 미적용).'
        : `대표동 지정 실패: ${down.error.message}`,
    }
  }
  const up = await admin.from('buildings')
    .update({ is_primary: true } as Record<string, unknown>).eq('id', buildingId)
  if (up.error) return { error: `대표동 지정 실패: ${up.error.message}` }

  revalidatePath(`/customers/${customerId}`)
  return {}
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

  // 🎯 재활성화 낙진 정리 — 이 수리 **이전에** 비활성화된 행은 `is_primary=true`를 켠 채 남아 있다.
  //   그 행을 다시 활성화하면 대표가 둘이 되어 다음 저장부터 유니크 인덱스가 거부한다(23505).
  //   여기서 한 번 고르면 그 낡은 데이터도 조용히 치유된다(신규 결함 예방이 아니라 **기존 데이터 수리**).
  const { data: owner } = await admin.from('buildings')
    .select('customer_id').eq('id', input.id).maybeSingle()
  const ownerId = (owner as { customer_id?: string } | null)?.customer_id ?? null
  if (ownerId) {
    await repairPrimary(admin, ownerId)
    revalidatePath(`/customers/${ownerId}`)
  }
  revalidatePath('/buildings')
  revalidatePath(`/buildings/${input.id}`)
  return {}
}

/** 한 고객의 대표동 표식을 **정확히 하나로** 맞춘다 — 비활성화·재활성화 뒤의 자가 치유.
 *
 *  규칙 판단은 `resolvePrimaryRepair`(순수 함수)가 하고, 여기서는 그 답을 DB에 쓰기만 한다.
 *  ⚠ 유니크 인덱스(`WHERE is_primary AND is_active`) 때문에 **먼저 전부 내리고 하나만 올린다** —
 *    순서를 바꾸면 잠깐 둘이 되어 인덱스가 거부한다(`setPrimaryBuildingAction`과 같은 규약).
 *  ⚠ 마이그레이션 160 미적용 DB에서는 컬럼이 없어 42703이 난다. 그때는 **조용히 넘어간다** —
 *    이 함수는 보조 정리이지 본 작업이 아니고, 폴백(created_at 최고참)이 이미 옳은 답을 준다.
 *    본 작업(비활성화 자체)까지 실패시키면 컬럼 없는 DB에서 건물을 못 지운다.
 */
async function repairPrimary(admin: ReturnType<typeof createAdminClient>, customerId: string): Promise<void> {
  const { data, error } = await admin.from('buildings')
    .select('id, is_active, is_primary, created_at').eq('customer_id', customerId)
  if (error || !data) return
  const { targetId, needsRepair } = resolvePrimaryRepair(data as BuildingLike[])
  if (!needsRepair || !targetId) return
  const down = await admin.from('buildings')
    .update({ is_primary: false } as Record<string, unknown>)
    .eq('customer_id', customerId).neq('id', targetId)
  if (down.error) return
  await admin.from('buildings')
    .update({ is_primary: true } as Record<string, unknown>).eq('id', targetId)
}

export async function deleteBuildingAction(id: string): Promise<{ error?: string }> {
  await requirePermission('building_manage')
  const admin = createAdminClient()

  // 어느 고객의 동인지 먼저 알아야 승계를 돌릴 수 있다(비활성화 뒤에는 같은 질의로 못 찾는 게 아니지만,
  // 한 번만 읽고 쓰는 편이 경합에 강하다)
  const { data: row } = await admin.from('buildings')
    .select('customer_id').eq('id', id).maybeSingle()
  const customerId = (row as { customer_id?: string } | null)?.customer_id ?? null

  // 🎯 비활성화하면서 **대표 표식도 함께 내린다.** 켜 둔 채 두면 나중에 이 동을 다시 활성화할 때
  //   대표가 둘이 되어 유니크 인덱스가 저장을 거부한다(2026-09-11 사용자 요청의 핵심).
  let { error } = await admin
    .from('buildings')
    .update({ is_active: false, is_primary: false, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', id)
  // 160 미적용 DB 호환 — 컬럼이 없으면 is_primary를 빼고 다시 시도한다(지우는 것 자체는 되어야 한다)
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    ({ error } = await admin
      .from('buildings')
      .update({ is_active: false, updated_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', id))
  }
  if (error) return { error: error.message }

  // 🎯 남은 동에게 대표를 넘긴다 — 이것이 "2동을 지우면 1동이 대표가 되어 별지에 실린다"이다.
  if (customerId) {
    await repairPrimary(admin, customerId)
    revalidatePath(`/customers/${customerId}`)
  }
  revalidatePath('/buildings')
  return {}
}
