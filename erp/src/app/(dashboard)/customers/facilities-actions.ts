'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { todayKst } from '@/lib/kst-date'

export type FacilityRow = { category: string; facility_code: string; installed: boolean; detail: string | null }
export type FloorRow = { floor_label: string; sort_order: number; counts: Record<string, number> }

/** 건물 소방시설 현황 저장 (P33-2) — 설비 체크리스트 + 층별 수량 (replace 방식, 멱등).
 *  성공 시 verifiedAt(확인일)을 돌려줘 클라이언트가 router.refresh() 없이 로컬 반영한다 (소방계획서_12 S1).
 *  설비/층별/확인일 세 갈래는 서로 독립 — 병렬 실행, delete→insert 순서는 갈래 안에서만 유지 (S2).
 *  ⚠ K-5: delete→insert가 트랜잭션이 아니라 'delete 성공 후 insert 실패' 시 기존 데이터가 소실된다 — S3(RPC) 채택 전까지 잔존 리스크 */
export async function saveFacilitiesAction(
  buildingId: string,
  customerId: string,
  facilities: FacilityRow[],
  floors: FloorRow[],
): Promise<{ error?: string; verifiedAt?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const verifiedAt = todayKst()

  // 설비: installed=true 또는 detail 있는 것만 저장 (나머지는 미설치로 간주)
  const facRows = facilities
    .filter(f => f.installed || (f.detail && f.detail.trim()))
    .map(f => ({
      building_id: buildingId, category: f.category, facility_code: f.facility_code,
      installed: f.installed, detail: f.detail?.trim() ? { note: f.detail.trim() } : null,
    }))
  // 층별 수량: 값 있는 층만
  const floorRows = floors
    .filter(fl => fl.floor_label.trim() && Object.values(fl.counts).some(v => v > 0))
    .map((fl, i) => ({ building_id: buildingId, floor_label: fl.floor_label.trim(), sort_order: i, counts: fl.counts }))

  const [facErr, floorErr, verifyErr] = await Promise.all([
    (async (): Promise<string | null> => {
      const { error: delErr } = await admin.from('fire_facilities').delete().eq('building_id', buildingId)
      if (delErr) return `설비 저장 실패: ${delErr.message}`
      if (facRows.length) {
        const { error } = await admin.from('fire_facilities').insert(facRows as Record<string, unknown>[])
        if (error) return `설비 저장 실패: ${error.message}`
      }
      return null
    })(),
    (async (): Promise<string | null> => {
      const { error: delErr } = await admin.from('fire_facility_floors').delete().eq('building_id', buildingId)
      if (delErr) return `층별 저장 실패: ${delErr.message}`
      if (floorRows.length) {
        const { error } = await admin.from('fire_facility_floors').insert(floorRows as Record<string, unknown>[])
        if (error) return `층별 저장 실패: ${error.message}`
      }
      return null
    })(),
    (async (): Promise<string | null> => {
      const { error } = await admin.from('buildings').update({
        facilities_verified_at: verifiedAt,
        facilities_verified_by: profile.id,
      } as Record<string, unknown>).eq('id', buildingId)
      if (error) return `확인일 갱신 실패: ${error.message}`
      return null
    })(),
  ])
  const firstErr = facErr ?? floorErr ?? verifyErr
  if (firstErr) return { error: firstErr }

  revalidatePath(`/customers/${customerId}`)
  return { verifiedAt }
}

/** "변경 없음" 확인 — 확인일만 갱신. verifiedAt 반환은 saveFacilitiesAction과 동일 규약 (소방계획서_12 S1·K-6) */
export async function verifyFacilitiesAction(
  buildingId: string, customerId: string
): Promise<{ error?: string; verifiedAt?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const verifiedAt = todayKst()
  const { error } = await admin.from('buildings').update({
    facilities_verified_at: verifiedAt,
    facilities_verified_by: profile.id,
  } as Record<string, unknown>).eq('id', buildingId)
  if (error) return { error: '확인에 실패했습니다.' }
  revalidatePath(`/customers/${customerId}`)
  return { verifiedAt }
}
