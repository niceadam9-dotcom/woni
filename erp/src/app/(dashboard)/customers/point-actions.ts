'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { newTagCode } from '@/lib/equipment-tag'
import { getSheets } from '@/lib/sheet-catalog'

/** 설비 지점(책갈피 QR) 관리 (통합 실행계획 C4 — QR 절 3단계, 2026-10-03 · 마이그 178)
 *
 *  지점 = 수신기·펌프실처럼 **회차마다 가는 자리**. 행마다 코드가 곧 라벨이라 **만들 때 바로 발급**한다
 *  (개체의 「발급 버튼」과 다른 이유: 개체는 qty=1로 나눈 뒤에만 코드를 받지만 지점은 태생이 QR이다).
 *  코드 재발급은 없다 — 라벨이 떨어지면 같은 코드로 1장 재인쇄(equipment-point-labels?ids=).
 *  쓰기 권한은 대장과 같은 customer_manage(전 직원). RLS는 service role만 쓰기(131 거울). */

const UUID = /^[0-9a-f-]{36}$/i

export type PointInput = {
  label: string
  buildingId?: string | null
  floor?: string | null
  room?: string | null
  sheetCodes?: string[]
  note?: string | null
}

export type PointRow = {
  id: string; building_id: string | null; label: string; floor: string | null; room: string | null
  sheet_codes: string[]; tag_code: string | null; sort_order: number; note: string | null; updated_at: string
}
const COLS = 'id, building_id, label, floor, room, sheet_codes, tag_code, sort_order, note, updated_at'

/** 입력 정리 — 시트 코드는 카탈로그에 실재하는 것만(오타가 조용한 빈 책갈피가 되지 않게) */
async function toRow(customerId: string, i: PointInput): Promise<Record<string, unknown> | string> {
  const label = i.label?.trim()
  if (!label) return '지점 이름을 적어 주세요. (예: 수신기(방재실))'
  if (label.length > 60) return '지점 이름은 60자 이내입니다.'
  const valid = new Set((await getSheets()).map(s => s.sheet_code))
  const codes = [...new Set((i.sheetCodes ?? []).map(c => c.trim()).filter(Boolean))]
  const bad = codes.filter(c => !valid.has(c))
  if (bad.length) return `점검표 시트 코드가 아닙니다: ${bad.join(', ')}`
  return {
    customer_id: customerId, building_id: i.buildingId || null, label,
    floor: i.floor?.trim() || null, room: i.room?.trim() || null,
    sheet_codes: codes, note: i.note?.trim() || null,
  }
}

export async function listPointsAction(customerId: string): Promise<{ error?: string; rows: PointRow[] }> {
  await requirePermission('inspection_register')
  if (!UUID.test(customerId)) return { error: '잘못된 고객 ID입니다.', rows: [] }
  const { data, error } = await createAdminClient().from('equipment_points').select(COLS)
    .eq('customer_id', customerId).order('sort_order').order('label')
  if (error) return { error: '지점 목록을 읽지 못했습니다.', rows: [] }
  return { rows: (data ?? []) as PointRow[] }
}

export async function addPointAction(customerId: string, input: PointInput): Promise<{ error?: string; id?: string }> {
  const profile = await requirePermission('customer_manage')
  if (!UUID.test(customerId)) return { error: '잘못된 고객 ID입니다.' }
  const admin = createAdminClient()
  const row = await toRow(customerId, input)
  if (typeof row === 'string') return { error: row }
  if (row.building_id) {
    const { data: b } = await admin.from('buildings').select('id').eq('customer_id', customerId).eq('id', row.building_id).maybeSingle()
    if (!b) return { error: '이 고객의 건물이 아닙니다.' }
  }
  // 코드는 만들 때 발급 — UNIQUE 충돌(32^8 공간)은 새 코드로 재시도
  for (let i = 0; i < 3; i++) {
    const { data, error } = await admin.from('equipment_points')
      .insert({ ...row, tag_code: newTagCode(), created_by: profile.id }).select('id').single()
    if (!error) { revalidatePath(`/customers/${customerId}`); return { id: (data as { id: string }).id } }
    if (error.code !== '23505') return { error: '지점을 추가하지 못했습니다.' }
  }
  return { error: '코드 발급이 겹쳤습니다 — 다시 시도해 주세요.' }
}

export async function updatePointAction(customerId: string, id: string, input: PointInput): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  if (!UUID.test(customerId) || !UUID.test(id)) return { error: '잘못된 요청입니다.' }
  const admin = createAdminClient()
  const row = await toRow(customerId, input)
  if (typeof row === 'string') return { error: row }
  const { customer_id: _c, ...patch } = row
  const { data, error } = await admin.from('equipment_points').update(patch)
    .eq('id', id).eq('customer_id', customerId).select('id')
  if (error || !data?.length) return { error: '지점을 고치지 못했습니다.' }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 삭제 — 지점은 이력이 묶이지 않아(이벤트 표는 개체 전용) 실삭제. 라벨은 버린다 */
export async function deletePointAction(customerId: string, id: string): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  if (!UUID.test(customerId) || !UUID.test(id)) return { error: '잘못된 요청입니다.' }
  const { data, error } = await createAdminClient().from('equipment_points').delete()
    .eq('id', id).eq('customer_id', customerId).select('id')
  if (error || !data?.length) return { error: '지점을 지우지 못했습니다.' }
  revalidatePath(`/customers/${customerId}`)
  return {}
}
