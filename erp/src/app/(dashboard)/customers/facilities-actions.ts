'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

export type FacilityRow = { category: string; facility_code: string; installed: boolean; detail: string | null }
export type FloorRow = { floor_label: string; sort_order: number; counts: Record<string, number> }

/** 건물 소방시설 현황 저장 (P33-2) — 설비 체크리스트 + 층별 수량 (replace 방식, 멱등) */
export async function saveFacilitiesAction(
  buildingId: string,
  customerId: string,
  facilities: FacilityRow[],
  floors: FloorRow[],
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 설비: installed=true 또는 detail 있는 것만 저장 (나머지는 미설치로 간주)
  await admin.from('fire_facilities').delete().eq('building_id', buildingId)
  const facRows = facilities
    .filter(f => f.installed || (f.detail && f.detail.trim()))
    .map(f => ({
      building_id: buildingId, category: f.category, facility_code: f.facility_code,
      installed: f.installed, detail: f.detail?.trim() ? { note: f.detail.trim() } : null,
    }))
  if (facRows.length) {
    const { error } = await admin.from('fire_facilities').insert(facRows as Record<string, unknown>[])
    if (error) return { error: `설비 저장 실패: ${error.message}` }
  }

  // 층별 수량: 값 있는 층만
  await admin.from('fire_facility_floors').delete().eq('building_id', buildingId)
  const floorRows = floors
    .filter(fl => fl.floor_label.trim() && Object.values(fl.counts).some(v => v > 0))
    .map((fl, i) => ({ building_id: buildingId, floor_label: fl.floor_label.trim(), sort_order: i, counts: fl.counts }))
  if (floorRows.length) {
    const { error } = await admin.from('fire_facility_floors').insert(floorRows as Record<string, unknown>[])
    if (error) return { error: `층별 저장 실패: ${error.message}` }
  }

  // 확인일 갱신
  await admin.from('buildings').update({
    facilities_verified_at: new Date().toISOString().slice(0, 10),
    facilities_verified_by: profile.id,
  } as Record<string, unknown>).eq('id', buildingId)

  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** "변경 없음" 확인 — 확인일만 갱신 */
export async function verifyFacilitiesAction(
  buildingId: string, customerId: string
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { error } = await admin.from('buildings').update({
    facilities_verified_at: new Date().toISOString().slice(0, 10),
    facilities_verified_by: profile.id,
  } as Record<string, unknown>).eq('id', buildingId)
  if (error) return { error: '확인에 실패했습니다.' }
  revalidatePath(`/customers/${customerId}`)
  return {}
}
