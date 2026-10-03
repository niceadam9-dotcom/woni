'use server'

/** 설비 자산 대장 — 서버 액션 (통합계획 C3 1단계, 2026-10-02)
 *
 *  ⚠ 이름: customer-assets·asset-actions(지도·사진 슬롯)와 별개다. 여기는 equipment_*.
 *  ⚠ 1.4 수량 격자(customer_facility_specs·fire_facilities)를 쓰지 않는다 — 대장은 「제안 값」만 보여 준다.
 *  권한: 읽기 inspection_register(전 직원 — 현장 점검자가 본다), 쓰기 customer_manage(전 직원 — 고객 정보 수정 축). */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile } from '@/lib/auth'
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_RULE, expiryState, normalizeYm, warrantyUntilOf, type EquipmentCategory, type LifespanRule } from '@/lib/equipment-lifespan'
import { newTagCode, LABELS_PER_REQUEST } from '@/lib/equipment-tag'
import { nextSalesDocNumber } from '@/lib/sales-numbers'
import { todayKst } from '@/lib/kst-date'
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
  tag_code: string | null
  tag_printed_at: string | null
}

const COLS = 'id, building_id, category, sub_type, location, qty, manufactured_on, installed_on, maker, model, lifespan_rule, extension_until, warranty_until, status, note, updated_at, tag_code, tag_printed_at'
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

/** 기한 기록(C3 2단계) — 성능확인 합격 → 연장 만료일, 공사 완공일 → 하자보수 만료일.
 *  · 연장: 만료일을 사람이 적는다(2022 개정 연장 연수는 조문 원문 미대조 — 상수로 계산하지 않는다). 합격일을 함께 주면 perf_check 이벤트를 남긴다.
 *  · 하자보수: 완공일을 주면 품목 연수(WARRANTY_YEARS)로 계산, 직접 만료일을 주면 그 값. 완공일은 installed_on에 둔다.
 *  · 빈 문자열 = 지움(null). undefined = 그 칸은 건드리지 않는다. */
export async function setEquipmentTermsAction(customerId: string, id: string, t: {
  perfCheckedOn?: string; extensionUntil?: string; completedOn?: string; warrantyUntil?: string
}): Promise<{ error?: string; warrantyUntil?: string | null }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: cur } = await admin.from('equipment_assets').select('category').eq('id', id).eq('customer_id', customerId).maybeSingle()
  if (!cur) return { error: '행을 찾을 수 없습니다.' }
  const cat = (cur as { category: EquipmentCategory }).category
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  for (const [k, v] of Object.entries(t)) if (v && !isDate(v)) return { error: `날짜 형식이 아닙니다(${k}): ${v} (예: 2026-10-03)` }
  if (t.perfCheckedOn && !t.extensionUntil) return { error: '성능확인 합격일을 적으면 연장 만료일도 적어 주세요.' }
  const patch: Record<string, unknown> = {}
  if (t.extensionUntil !== undefined) patch.extension_until = t.extensionUntil || null
  if (t.completedOn !== undefined) patch.installed_on = t.completedOn || null
  let warranty: string | null | undefined
  if (t.warrantyUntil !== undefined && t.warrantyUntil !== '') warranty = t.warrantyUntil
  else if (t.completedOn) {
    warranty = warrantyUntilOf(cat, t.completedOn)
    if (!warranty) return { error: '이 품목은 하자보수 연수가 정해져 있지 않습니다 — 하자보수 만료일을 직접 적어 주세요.' }
  } else if (t.warrantyUntil === '') warranty = null
  if (warranty !== undefined) patch.warranty_until = warranty
  if (!Object.keys(patch).length) return { error: '바꿀 값이 없습니다.' }
  const { data, error } = await admin.from('equipment_assets').update(patch).eq('id', id).eq('customer_id', customerId).select('id')
  if (error || !data?.length) return { error: '기한을 저장하지 못했습니다.' }
  if (t.perfCheckedOn) {
    const { error: evErr } = await admin.from('equipment_asset_events').insert({
      asset_id: id, event_type: 'perf_check', event_date: t.perfCheckedOn, result: 'good',
      values: { extension_until: t.extensionUntil }, actor_id: profile.id,
    })
    if (evErr) console.error('[equipment] 성능확인 이력 기록 실패(기한은 저장됨):', evErr.message)
  }
  revalidate(customerId)
  return { warrantyUntil: warranty }
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

// ── 3단계(설비 QR 절 1단계) — 태그 발급 · 개체로 나누기 · 만료 예정 → 견적 초안 ──────────────────

/** QR 코드 발급 — 사용 중·qty=1·코드 없는 행에(ids를 주면 그 행만). 이미 있는 코드는 재발급하지 않는다(이력 연속성) */
export async function issueEquipmentTagsAction(customerId: string, ids?: string[]): Promise<{ error?: string; issued?: number }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  let q = admin.from('equipment_assets').select('id').eq('customer_id', customerId).eq('status', 'in_use').eq('qty', 1).is('tag_code', null)
  if (ids?.length) q = q.in('id', ids)
  const { data, error } = await q
  if (error) return { error: '대상 행을 읽지 못했습니다.' }
  const targets = ((data ?? []) as Array<{ id: string }>).map(r => r.id)
  if (targets.length > LABELS_PER_REQUEST) return { error: `한 번에 ${LABELS_PER_REQUEST}대까지 발급합니다.` }
  let issued = 0
  for (const id of targets) {
    // UNIQUE 충돌(32^8 공간이라 사실상 없음)은 새 코드로 몇 번 다시 — 조건 tag_code IS NULL로 동시 발급의 덮어쓰기를 막는다
    for (let k = 0; k < 4; k++) {
      const { data: up, error: e } = await admin.from('equipment_assets').update({ tag_code: newTagCode() }).eq('id', id).is('tag_code', null).select('id')
      if (!e) { if (up?.length) issued++; break }
      if (!/duplicate|unique/i.test(e.message)) { console.error('[equipment] 태그 발급 실패:', e.message); return { error: '코드를 발급하지 못했습니다.', issued } }
    }
  }
  revalidate(customerId)
  return { issued }
}

/** 묶음 행을 개체(qty 1) n행으로 — QR은 개체에만 붙는다. 원 행은 qty 1로 남고 n-1행이 복제된다 */
export async function explodeEquipmentBundleAction(customerId: string, id: string): Promise<{ error?: string; created?: number }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: src } = await admin.from('equipment_assets').select('*').eq('id', id).eq('customer_id', customerId).eq('status', 'in_use').maybeSingle()
  const row = src as (Record<string, unknown> & { qty: number }) | null
  if (!row) return { error: '행을 찾을 수 없습니다.' }
  if (row.qty < 2) return { error: '이미 개체 한 대입니다.' }
  if (row.qty > LABELS_PER_REQUEST) return { error: `${LABELS_PER_REQUEST}대 넘는 묶음은 먼저 쪼개 주세요.` }
  const { id: _omit, created_at: _c, updated_at: _u, tag_code: _t, tag_printed_at: _tp, ...rest } = row
  void _omit; void _c; void _u; void _t; void _tp
  const copies = Array.from({ length: row.qty - 1 }, () => ({ ...rest, qty: 1, created_by: profile.id }))
  const { error: e1 } = await admin.from('equipment_assets').update({ qty: 1 }).eq('id', id).eq('qty', row.qty)
  if (e1) return { error: '나누지 못했습니다.' }
  const { error: e2 } = await admin.from('equipment_assets').insert(copies)
  if (e2) { await admin.from('equipment_assets').update({ qty: row.qty }).eq('id', id); return { error: '나누지 못했습니다.' } }
  revalidate(customerId)
  return { created: copies.length }
}

/** 만료 예정 개체 → 견적 초안 1건(quotes.source='asset', 작성중). 비교진단 대장 절 「매출은 견적 초안으로」.
 *  · 대상: 사용 중·연수 판정 있는 행 중 경과 또는 soonDays 안 만료. 하자보수 기간 중(warranty_until ≥ 오늘)은 「시공사 무상」이라 뺀다.
 *  · 줄: 품목+규격별 한 줄(수량 합) · detail에 위치(제조연월) · asset_ids. 단가는 이 고객 최근 견적의 같은 품목명 단가, 없으면 0(사람이 채운다). */
export async function createEquipmentQuoteDraftAction(customerId: string, soonDays = 90): Promise<{ error?: string; quoteNumber?: string; lines?: number; skippedWarranty?: number }> {
  await requirePermission('quote_create')
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()
  const today = todayKst()
  const { data, error } = await admin.from('equipment_assets').select(COLS).eq('customer_id', customerId).eq('status', 'in_use')
  if (error) return { error: '설비 대장을 읽지 못했습니다.' }
  const rows = (data ?? []) as unknown as EquipmentRow[]
  const due = rows.filter(r => { const s = expiryState(r, today, soonDays); return s === 'expired' || s === 'soon' })
  const free = (r: EquipmentRow) => !!r.warranty_until && r.warranty_until >= today
  const inWarranty = due.filter(free)
  const freeQty = inWarranty.reduce((s, r) => s + r.qty, 0)
  const target = due.filter(r => !free(r))
  if (!target.length) return { error: freeQty ? `만료 예정 ${freeQty}대가 모두 하자보수 기간 중(시공사 무상)입니다.` : `만료됐거나 ${soonDays}일 안에 만료되는 설비가 없습니다.` }

  const groups = new Map<string, { description: string; qty: number; parts: string[]; ids: string[] }>()
  for (const r of target) {
    const description = `${CATEGORY_LABEL[r.category]} 교체${r.sub_type ? ` (${r.sub_type})` : ''}`
    const g = groups.get(description) ?? { description, qty: 0, parts: [], ids: [] }
    g.qty += r.qty
    g.parts.push(`${r.location?.trim() || '위치 미기재'} ${r.qty}대${r.manufactured_on ? `(${r.manufactured_on.slice(0, 7)})` : ''}`)
    g.ids.push(r.id)
    groups.set(description, g)
  }
  // 단가 재사용 — 이 고객의 최근 견적 20건에서 같은 품목명 줄의 단가
  const { data: prev } = await admin.from('quotes').select('items').eq('customer_id', customerId).order('quote_date', { ascending: false }).limit(20)
  const lastPrice = new Map<string, number>()
  for (const q of (prev ?? []) as Array<{ items: Array<{ description?: string; unit_price?: number }> | null }>)
    for (const it of q.items ?? []) if (it.description && typeof it.unit_price === 'number' && !lastPrice.has(it.description)) lastPrice.set(it.description, it.unit_price)

  const items = [...groups.values()].map(g => {
    const unit = lastPrice.get(g.description) ?? 0
    return { description: g.description, detail: g.parts.join(', '), quantity: g.qty, unit_price: unit, amount: unit * g.qty, asset_ids: g.ids }
  })
  const subtotal = items.reduce((s, i) => s + i.amount, 0)
  const tax = Math.round(subtotal * 0.1)
  const quoteNumber = await nextSalesDocNumber(admin, 'quotes', today)
  const { error: insErr } = await admin.from('quotes').insert({
    customer_id: customerId, source: 'asset', quote_number: quoteNumber, quote_date: today, valid_until: null,
    items, subtotal, tax_amount: tax, total_amount: subtotal + tax,
    notes: freeQty ? `하자보수 기간 중 ${freeQty}대는 시공사 무상이라 제외했습니다.` : null,
    created_by: profile.id,
  })
  if (insErr) { console.error('[equipment] 견적 초안 실패:', insErr.message); return { error: '견적 초안을 만들지 못했습니다.' } }
  revalidatePath('/quotes')
  revalidate(customerId)
  return { quoteNumber, lines: items.length, skippedWarranty: freeQty }
}
