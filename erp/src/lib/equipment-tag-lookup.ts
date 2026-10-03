/** 설비 QR 코드 조회 — `/t/[code]` 카드와 `/t?q=` 수기 조회 공용 (통합계획 C3 3단계, 2026-10-03)
 *  1단계는 개체(C)만. 지점(B)은 3단계(178)에서 더했다 — 건물(A) 표는 QR 절 4단계에서 같은 자리에. */
import type { createAdminClient } from '@/lib/supabase/admin'
import { MANUAL_PREFIX_LEN, TAG_LEN } from '@/lib/equipment-tag'
import type { EquipmentCategory, LifespanRule } from '@/lib/equipment-lifespan'

type Admin = ReturnType<typeof createAdminClient>

export type TagAsset = {
  id: string; tag_code: string; customer_id: string; building_id: string | null; category: EquipmentCategory
  sub_type: string | null; location: string | null; qty: number; manufactured_on: string | null; lifespan_rule: LifespanRule
  extension_until: string | null; warranty_until: string | null; status: string; tag_printed_at: string | null
  customer: { customer_name: string } | null; building: { building_name: string } | null
}
const SEL = 'id, tag_code, customer_id, building_id, category, sub_type, location, qty, manufactured_on, lifespan_rule, extension_until, warranty_until, status, tag_printed_at, customer:customers(customer_name), building:buildings(building_name)'

export async function findAssetByTag(admin: Admin, code: string): Promise<TagAsset | null> {
  if (code.length !== TAG_LEN) return null
  const { data } = await admin.from('equipment_assets').select(SEL).eq('tag_code', code).maybeSingle()
  return (data as unknown as TagAsset | null) ?? null
}

/** 앞 MANUAL_PREFIX_LEN자 이상으로 찾기 — 최대 20건(같은 앞자리가 겹치면 목록으로 고르게) */
export async function searchAssetsByTagPrefix(admin: Admin, prefix: string): Promise<TagAsset[]> {
  if (prefix.length < MANUAL_PREFIX_LEN) return []
  const { data } = await admin.from('equipment_assets').select(SEL).like('tag_code', `${prefix}%`).order('tag_code').limit(20)
  return (data ?? []) as unknown as TagAsset[]
}

/** 지점(책갈피 QR, 178) — 찍으면 sheet_codes의 점검표 시트로 */
export type TagPoint = {
  id: string; tag_code: string | null; customer_id: string; building_id: string | null
  label: string; floor: string | null; room: string | null; sheet_codes: string[]; sort_order: number; note: string | null
  customer: { customer_name: string } | null; building: { building_name: string } | null
}
const POINT_SEL = 'id, tag_code, customer_id, building_id, label, floor, room, sheet_codes, sort_order, note, customer:customers(customer_name), building:buildings(building_name)'

export async function findPointByTag(admin: Admin, code: string): Promise<TagPoint | null> {
  if (code.length !== TAG_LEN) return null
  const { data } = await admin.from('equipment_points').select(POINT_SEL).eq('tag_code', code).maybeSingle()
  return (data as unknown as TagPoint | null) ?? null
}

/** 앞자리로 지점 찾기 — /t?q= 가 개체와 함께 보여 준다 */
export async function searchPointsByTagPrefix(admin: Admin, prefix: string): Promise<TagPoint[]> {
  if (prefix.length < MANUAL_PREFIX_LEN) return []
  const { data } = await admin.from('equipment_points').select(POINT_SEL).like('tag_code', `${prefix}%`).order('tag_code').limit(20)
  return (data ?? []) as unknown as TagPoint[]
}

/** 이 고객의 진행 중 회차 — 가장 최근 시작분. 상태값은 in_progress·completed 둘(2026-10-03 실측).
 *  지점 카드의 점검표 딥링크와 /t 카드 액션(tag-actions)이 같은 축을 쓴다. */
export async function openInspectionIdForCustomer(admin: Admin, customerId: string): Promise<string | null> {
  const { data } = await admin.from('inspections').select('id')
    .eq('customer_id', customerId).eq('status', 'in_progress')
    .order('inspection_start_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function recentAssetEvents(admin: Admin, assetId: string, n = 3): Promise<Array<{ event_type: string; event_date: string; result: string | null; values: Record<string, unknown> }>> {
  const { data } = await admin.from('equipment_asset_events').select('event_type, event_date, result, values').eq('asset_id', assetId)
    .order('event_date', { ascending: false }).order('created_at', { ascending: false }).limit(n)
  return (data ?? []) as Array<{ event_type: string; event_date: string; result: string | null; values: Record<string, unknown> }>
}
