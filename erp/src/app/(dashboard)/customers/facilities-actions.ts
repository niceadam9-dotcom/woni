'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { todayKst } from '@/lib/kst-date'
import { ETC_CATEGORY, ETC_CODES } from '@/lib/facility-codes'

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
  /** 소방계획서_40 S4 — 점검 귀속 화면(/inspections/[id]/facilities)에서 저장하면 점검표 화면의
   *  설치 축도 함께 갱신돼야 한다. 저장 규칙은 그대로고 revalidate 대상만 늘린다(분기 없음).
   *
   *  scope (2026-09-20 기타 7종 UI 분할) — 'standard'는 delete·insert를 **기타(ETC_CODES) 밖**으로
   *  좁힌다. 고객 상세 [소방시설] 탭은 기타 입력구가 없으므로 'all'로 저장하면 보고서 탭·1.6이
   *  방금 저장한 기타 행을 **페이지 로드 시점의 낡은 값으로 되살린다**(delete 전체 → 스테일 insert).
   *  점검 귀속 화면(/inspections/[id]/facilities)은 기타 7종을 그대로 들고 있어 'all'(기본) 유지. */
  opts?: { alsoRevalidate?: string[]; scope?: 'all' | 'standard' },
): Promise<{ error?: string; verifiedAt?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const verifiedAt = todayKst()
  const scope = opts?.scope ?? 'all'

  // 설비: installed=true 또는 detail 있는 것만 저장 (나머지는 미설치로 간주)
  // scope 'standard'는 서버에서도 기타 코드를 걸러낸다 — 클라이언트 payload를 신뢰하지 않는다
  const facRows = facilities
    .filter(f => f.installed || (f.detail && f.detail.trim()))
    .filter(f => scope === 'all' || !ETC_CODES.includes(f.facility_code))
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
      // scope 'standard' — 기타 행은 다른 화면(보고서 탭·1.6)의 소유라 지우지 않는다
      let del = admin.from('fire_facilities').delete().eq('building_id', buildingId)
      if (scope === 'standard') del = del.not('facility_code', 'in', `(${ETC_CODES.map(c => `"${c}"`).join(',')})`)
      const { error: delErr } = await del
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
  // 'use server' 공개 엔드포인트라 인자를 신뢰하지 않는다 — 내부 경로만 (sheet/page.tsx from 검증과 같은 규칙)
  for (const p of opts?.alsoRevalidate ?? []) {
    if (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//')) revalidatePath(p)
  }
  return { verifiedAt }
}

/** 기타 7종(ETC_CODES) **부분 저장** — 기타 UI가 1.4에서 갈라져 나간 자리(보고서 탭 3종 · 1.6 4종)가 쓴다
 *  (2026-09-20 사용자 확정). delete→insert를 **전달된 코드로만** 좁혀, 42종 본문·다른 카드의 기타 행은
 *  건드리지 않는다. `facilities_verified_at`은 갱신하지 않는다 — 확인일은 1.4 전체 확인 축(verifyFacilitiesAction). */
export async function saveEtcFacilitiesAction(
  buildingId: string, customerId: string,
  entries: Array<{ code: string; installed: boolean; note?: string | null }>,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  // 'use server' 공개 엔드포인트 — 기타 코드 밖(42종 등)이 섞이면 통째로 거절한다
  if (entries.some(e => !ETC_CODES.includes(e.code))) return { error: '기타 항목이 아닌 코드가 있습니다.' }
  if (entries.length === 0) return {}
  const { error: delErr } = await admin.from('fire_facilities').delete()
    .eq('building_id', buildingId).in('facility_code', entries.map(e => e.code))
  if (delErr) return { error: `기타 저장 실패: ${delErr.message}` }
  const rows = entries
    .filter(e => e.installed || (e.note && e.note.trim()))
    .map(e => ({
      building_id: buildingId, category: ETC_CATEGORY, facility_code: e.code,
      installed: e.installed, detail: e.note?.trim() ? { note: e.note.trim() } : null,
    }))
  if (rows.length > 0) {
    const { error } = await admin.from('fire_facilities').insert(rows as Record<string, unknown>[])
    if (error) return { error: `기타 저장 실패: ${error.message}` }
  }
  revalidatePath(`/customers/${customerId}`)
  return {}
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
