'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getSessionUser } from '@/lib/auth'

/** 건물 숫자 필드 유효성 (IMP-10) — 음수·비상식 값 차단 */
function validateBuildingNumbers(
  b: { total_area?: number; floors_above?: number; floors_below?: number; year_built?: number },
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
}

export async function createBuildingAction(
  input: CreateBuildingInput
): Promise<{ error?: string; buildingId?: string }> {
  const profile = await requirePermission('building_manage')
  const admin = createAdminClient()

  const vErr = validateBuildingNumbers(input)
  if (vErr) return { error: vErr }

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
}

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
