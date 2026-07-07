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

  let { data, error } = await admin
    .from('buildings')
    .insert({ ...baseFields, zipcode: input.zipcode || null } as Record<string, unknown>)
    .select('id')
    .single()

  // zipcode 컬럼 미적용 시 재시도
  if (error?.message?.includes('zipcode')) {
    const retry = await admin
      .from('buildings')
      .insert(baseFields as Record<string, unknown>)
      .select('id')
      .single()
    data = retry.data
    error = retry.error
  }

  if (error) return { error: error.message }

  revalidatePath('/buildings')
  return { buildingId: (data as { id: string }).id }
}

export type UpdateBuildingInput = {
  id: string
  building_name: string
  zipcode?: string
  address?: string
  total_area?: number
  floors_above?: number
  floors_below?: number
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
    floors_above: input.floors_above ?? null,
    floors_below: input.floors_below ?? null,
    purpose: input.purpose || null,
    year_built: input.year_built ?? null,
    notes: input.notes || null,
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  }

  let { error } = await admin
    .from('buildings')
    .update(updateFields)
    .eq('id', input.id)

  // zipcode 컬럼 미적용 시 재시도
  if (error?.message?.includes('zipcode')) {
    const { zipcode: _z, ...withoutZipcode } = updateFields
    void _z
    const retry = await admin.from('buildings').update(withoutZipcode).eq('id', input.id)
    error = retry.error
  }

  if (error) return { error: error.message }

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
