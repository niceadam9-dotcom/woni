'use server'

/** 설비 자산 대장 — 서버 액션 (통합계획 C3 1단계, 2026-10-02)
 *
 *  ⚠ 이름: customer-assets·asset-actions(지도·사진 슬롯)와 별개다. 여기는 equipment_*.
 *  ⚠ 1.4 수량 격자(customer_facility_specs·fire_facilities)를 쓰지 않는다 — 대장은 「제안 값」만 보여 준다.
 *  권한: 읽기 inspection_register(전 직원 — 현장 점검자가 본다), 쓰기 customer_manage(전 직원 — 고객 정보 수정 축). */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { CATEGORIES, DEFAULT_RULE, normalizeYm, type EquipmentCategory, type LifespanRule } from '@/lib/equipment-lifespan'
import { lossOf, type GasMeasure } from '@/lib/gas-storage'

export type EquipmentRow = {
  id: string
  building_id: string | null
  category: EquipmentCategory
  sub_type: string | null
  location: string | null
  qty: number
  manufactured_on: string | null
  installed_on: string | null
  maker: string | null
  model: string | null
  lifespan_rule: LifespanRule
  extension_until: string | null
  warranty_until: string | null
  status: 'in_use' | 'replaced' | 'disposed' | 'lost'
  note: string | null
  updated_at: string
}

const COLS = 'id, building_id, category, sub_type, location, qty, manufactured_on, installed_on, maker, model, lifespan_rule, extension_until, warranty_until, status, note, updated_at'
const RULES = new Set<LifespanRule>(['legal10', 'rec10', 'rec15', 'none'])

export type EquipmentInput = {
  buildingId?: string | null
  category: EquipmentCategory
  subType?: string | null
  location?: string | null
  qty?: number
  manufacturedYm?: string | null
  maker?: string | null
  model?: string | null
  lifespanRule?: LifespanRule | null
  extensionUntil?: string | null
  warrantyUntil?: string | null
  note?: string | null
}

function revalidate(customerId: string) { revalidatePath(`/customers/${customerId}`) }

/** 입력 한 줄 → DB 행. 형식이 틀리면 오류 문자열 */
function toRow(customerId: string, i: EquipmentInput): Record<string, unknown> | string {
  if (!CATEGORIES.includes(i.category)) return `품목이 올바르지 않습니다: ${i.category}`
  const qty = Math.trunc(Number(i.qty ?? 1))
  if (!Number.isFinite(qty) || qty < 1 || qty > 9999) return '수량은 1~9999입니다.'
  let manufactured: string | null = null
  if (i.manufacturedYm && i.manufacturedYm.trim()) {
    manufactured = normalizeYm(i.manufacturedYm)
    if (!manufactured) return `제조연월 형식이 아닙니다: ${i.manufacturedYm} (예: 2015-03)`
  }
  const rule = i.lifespanRule && RULES.has(i.lifespanRule) ? i.lifespanRule : DEFAULT_RULE[i.category]
  const dateOrNull = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  return {
    customer_id: customerId, building_id: i.buildingId || null, category: i.category,
    sub_type: i.subType?.trim() || null, location: i.location?.trim() || null, qty,
    manufactured_on: manufactured, maker: i.maker?.trim() || null, model: i.model?.trim() || null,
    lifespan_rule: rule, extension_until: dateOrNull(i.extensionUntil), warranty_until: dateOrNull(i.warrantyUntil),
    note: i.note?.trim() || null,
  }
}

/** 고객의 대장 — 사용 중 행만(교체·폐기·분실은 includeClosed로) */
export async function listEquipmentAction(customerId: string, opts: { includeClosed?: boolean } = {}): Promise<{ error?: string; rows: EquipmentRow[] }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  let q = admin.from('equipment_assets').select(COLS).eq('customer_id', customerId)
  if (!opts.includeClosed) q = q.eq('status', 'in_use')
  const { data, error } = await q.order('category').order('location', { nullsFirst: false }).order('manufactured_on', { nullsFirst: false })
  if (error) { console.error('[equipment] 조회 실패:', error.message); return { error: '설비 대장을 불러오지 못했습니다.', rows: [] } }
  return { rows: (data ?? []) as unknown as EquipmentRow[] }
}

/** 여러 줄 한꺼번에(직접 입력·엑셀 가져오기 공용) — 한 줄이라도 형식이 틀리면 아무것도 넣지 않는다 */
export async function addEquipmentRowsAction(customerId: string, inputs: EquipmentInput[]): Promise<{ error?: string; added?: number }> {
  const profile = await requirePermission('customer_manage')
  if (!inputs.length) return { error: '추가할 줄이 없습니다.' }
  if (inputs.length > 500) return { error: '한 번에 500줄까지 넣을 수 있습니다.' }
  const admin = createAdminClient()
  // 건물이 이 고객의 것인지 — 다른 고객 건물 id가 섞이면 대장이 엉뚱한 대상물에 붙는다
  const bIds = [...new Set(inputs.map(i => i.buildingId).filter((v): v is string => !!v))]
  if (bIds.length) {
    const { data: bs } = await admin.from('buildings').select('id').eq('customer_id', customerId).in('id', bIds)
    const ok = new Set(((bs ?? []) as Array<{ id: string }>).map(b => b.id))
    if (bIds.some(b => !ok.has(b))) return { error: '이 고객의 건물이 아닌 항목이 있습니다.' }
  }
  const rows: Record<string, unknown>[] = []
  for (const [n, i] of inputs.entries()) {
    const r = toRow(customerId, i)
    if (typeof r === 'string') return { error: `${n + 1}번째 줄: ${r}` }
    rows.push({ ...r, created_by: profile.id })
  }
  const { error } = await admin.from('equipment_assets').insert(rows)
  if (error) { console.error('[equipment] 추가 실패:', error.message); return { error: '설비 대장에 추가하지 못했습니다.' } }
  revalidate(customerId)
  return { added: rows.length }
}

export async function updateEquipmentAction(customerId: string, id: string, input: EquipmentInput): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const r = toRow(customerId, input)
  if (typeof r === 'string') return { error: r }
  const admin = createAdminClient()
  const { data, error } = await admin.from('equipment_assets').update(r).eq('id', id).eq('customer_id', customerId).select('id')
  if (error || !data?.length) return { error: '수정하지 못했습니다.' }
  revalidate(customerId)
  return {}
}

/** 상태 변경 — 교체·폐기·분실. 행은 지우지 않는다(이력·불량 연결 보존). 이력 이벤트를 함께 남긴다 */
export async function closeEquipmentAction(customerId: string, id: string, status: 'replaced' | 'disposed' | 'lost', note?: string | null): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data, error } = await admin.from('equipment_assets').update({ status }).eq('id', id).eq('customer_id', customerId).eq('status', 'in_use').select('id')
  if (error || !data?.length) return { error: '상태를 바꾸지 못했습니다(이미 닫힌 행일 수 있습니다).' }
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const { error: evErr } = await admin.from('equipment_asset_events').insert({
    asset_id: id, event_type: status === 'replaced' ? 'replace' : 'dispose', event_date: today, values: { status, note: note ?? null }, actor_id: profile.id,
  })
  if (evErr) console.error('[equipment] 이력 기록 실패(상태는 바뀜):', evErr.message)
  revalidate(customerId)
  return {}
}

/** 묶음 행 쪼개기 — qty n 중 k대를 새 행으로(한 대 교체 등). 원 행은 n-k */
export async function splitEquipmentAction(customerId: string, id: string, k: number): Promise<{ error?: string; newId?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: src } = await admin.from('equipment_assets').select('*').eq('id', id).eq('customer_id', customerId).eq('status', 'in_use').maybeSingle()
  const row = src as (Record<string, unknown> & { qty: number }) | null
  if (!row) return { error: '행을 찾을 수 없습니다.' }
  if (!(k >= 1 && k < row.qty)) return { error: `1~${row.qty - 1}대를 떼어 낼 수 있습니다.` }
  const { error: e1 } = await admin.from('equipment_assets').update({ qty: row.qty - k }).eq('id', id)
  if (e1) return { error: '쪼개지 못했습니다.' }
  const { id: _omit, created_at: _c, updated_at: _u, tag_code: _t, tag_printed_at: _tp, ...rest } = row
  void _omit; void _c; void _u; void _t; void _tp
  const { data: ins, error: e2 } = await admin.from('equipment_assets').insert({ ...rest, qty: k, created_by: profile.id }).select('id').single()
  if (e2) { await admin.from('equipment_assets').update({ qty: row.qty }).eq('id', id); return { error: '쪼개지 못했습니다.' } }
  revalidate(customerId)
  return { newId: (ins as { id: string }).id }
}

/** 3-1 동별 수량(customer_facility_specs s31_extinguisher)과 대조할 합계 — 화면은 **제안 값**으로만 보인다(덮어쓰지 않음) */
export async function getS31TotalsAction(customerId: string): Promise<{ powder: number; autoDiffuse: number; other: number }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data } = await admin.from('customer_facility_specs').select('spec').eq('customer_id', customerId).eq('section_key', 's31_extinguisher')
  let powder = 0, autoDiffuse = 0, other = 0
  for (const r of (data ?? []) as Array<{ spec: { summary?: { dong_rows?: Array<Record<string, unknown>> } } | null }>) {
    for (const d of r.spec?.summary?.dong_rows ?? []) {
      powder += Number(d.qty_ext_powder) || 0
      autoDiffuse += Number(d.qty_auto_diffuse) || 0
      other += Number(d.qty_ext_other) || 0
    }
  }
  return { powder, autoDiffuse, other }
}

// ── 가스계 약제저장량 측정(1단계) — 회차 단위. measure 이벤트 한 행 = 서식의 한 줄 ──────────────────

export type GasCylinderSlot = { assetId: string; cylNo: number; location: string | null; subType: string | null }

/** 회차 고객의 가스용기(사용 중) — 묶음 행(qty n)은 용기 No.1..n으로 펼친다 + 이 회차의 기존 측정값 */
export async function getGasStorageAction(inspectionId: string): Promise<{ error?: string; slots: GasCylinderSlot[]; measures: GasMeasure[] }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).maybeSingle()
  if (!insp) return { error: '점검을 찾을 수 없습니다.', slots: [], measures: [] }
  const cid = (insp as { customer_id: string }).customer_id
  const { data: assets, error } = await admin.from('equipment_assets').select('id, qty, location, sub_type')
    .eq('customer_id', cid).eq('category', 'gas_cylinder').eq('status', 'in_use').order('location', { nullsFirst: false })
  if (error) return { error: '가스용기를 불러오지 못했습니다.', slots: [], measures: [] }
  const slots: GasCylinderSlot[] = []
  for (const a of (assets ?? []) as Array<{ id: string; qty: number; location: string | null; sub_type: string | null }>)
    for (let k = 1; k <= a.qty; k++) slots.push({ assetId: a.id, cylNo: k, location: a.location, subType: a.sub_type })
  const ids = slots.map(s => s.assetId)
  const { data: ev } = ids.length
    ? await admin.from('equipment_asset_events').select('asset_id, values').eq('inspection_id', inspectionId).eq('event_type', 'measure').in('asset_id', [...new Set(ids)])
    : { data: [] }
  const measures = ((ev ?? []) as Array<{ asset_id: string; values: Record<string, unknown> }>).map(e => ({
    assetId: e.asset_id, cylNo: Number(e.values.cyl_no) || 1, location: (e.values.location as string) ?? null,
    tempC: (e.values.temp_c as number) ?? null, heightCm: (e.values.height_cm as number) ?? null,
    chargeKg: (e.values.charge_kg as number) ?? null, nominalKg: (e.values.nominal_kg as number) ?? null,
  }))
  return { slots, measures }
}

/** 이 회차의 측정값을 통째로 바꾼다(재측정 허용 — 회차 단위로 덮어쓴다). 빈 줄은 저장하지 않는다 */
export async function saveGasStorageAction(inspectionId: string, rows: GasMeasure[]): Promise<{ error?: string; saved?: number }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id, inspection_end_date, inspection_start_date').eq('id', inspectionId).maybeSingle()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const i = insp as { customer_id: string; inspection_end_date: string | null; inspection_start_date: string | null }
  const filled = rows.filter(r => [r.tempC, r.heightCm, r.chargeKg, r.nominalKg].some(v => v != null))
  const ids = [...new Set(filled.map(r => r.assetId))]
  if (ids.length) {
    const { data: own } = await admin.from('equipment_assets').select('id').eq('customer_id', i.customer_id).eq('category', 'gas_cylinder').in('id', ids)
    if ((own ?? []).length !== ids.length) return { error: '이 고객의 가스용기가 아닌 줄이 있습니다.' }
  }
  const { data: allAssets } = await admin.from('equipment_assets').select('id').eq('customer_id', i.customer_id).eq('category', 'gas_cylinder')
  const allIds = ((allAssets ?? []) as Array<{ id: string }>).map(a => a.id)
  if (allIds.length) {
    const { error: delErr } = await admin.from('equipment_asset_events').delete().eq('inspection_id', inspectionId).eq('event_type', 'measure').in('asset_id', allIds)
    if (delErr) return { error: '기존 측정값을 지우지 못했습니다.' }
  }
  if (!filled.length) { revalidatePath(`/inspections/${inspectionId}`); return { saved: 0 } }
  const date = i.inspection_end_date ?? i.inspection_start_date ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const { error } = await admin.from('equipment_asset_events').insert(filled.map(r => {
    const l = lossOf(r)
    return {
      asset_id: r.assetId, inspection_id: inspectionId, event_type: 'measure', event_date: date, actor_id: profile.id,
      result: l.result === '불량' ? 'defect' : l.result === '양호' ? 'good' : null,
      values: { cyl_no: r.cylNo, location: r.location, temp_c: r.tempC, height_cm: r.heightCm, charge_kg: r.chargeKg, nominal_kg: r.nominalKg, loss_kg: l.lossKg, loss_rate: l.rate },
    }
  }))
  if (error) { console.error('[equipment] 측정 저장 실패:', error.message); return { error: '측정값을 저장하지 못했습니다.' } }
  revalidatePath(`/inspections/${inspectionId}`)
  return { saved: filled.length }
}
