'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { todayKst } from '@/lib/kst-date'
import { normalizeTagInput, TAG_LEN } from '@/lib/equipment-tag'
import { findAssetByTag } from '@/lib/equipment-tag-lookup'
import { addDefectAction, type DefectSeverity } from '@/app/(dashboard)/inspections/defect-actions'
import { addEquipmentRowsAction, closeEquipmentAction, type EquipmentInput } from '@/app/(dashboard)/customers/equipment-actions'

/** QR 카드(/t/{code})에서 하는 일 (통합 실행계획 C4 2단계 웹 = 설비 QR 절 2단계, 2026-10-03)
 *
 *  폰 기본 카메라 → /t/{code} → 카드의 버튼 넷 [이상 없음] [불량 등록] [교체] + 미등록 코드 = 첫 등록.
 *  (모바일 앱 스캐너는 운영 실사용 0이라 뒤로 미룸 — 사용자 결정. 같은 일을 웹에서 먼저 한다.)
 *  쓰기 규칙은 기존 액션을 그대로 탄다 — 불량은 addDefectAction(단계 동기화 포함), 교체는 closeEquipmentAction,
 *  등록은 addEquipmentRowsAction. 여기서 더하는 것은 「어느 개체의 일인가」(asset_id·이벤트)뿐이다. */

const UUID = /^[0-9a-f-]{36}$/i

async function assetById(id: string) {
  if (!UUID.test(id)) return null
  const { data } = await createAdminClient().from('equipment_assets')
    .select('id, customer_id, tag_code, status, category, location').eq('id', id).maybeSingle()
  return data as { id: string; customer_id: string; tag_code: string | null; status: string; category: string; location: string | null } | null
}

/** 이 고객의 진행 중 회차 — 가장 최근 시작분. 운영·스테이징 상태값은 in_progress·completed 둘(2026-10-03 실측) */
async function openInspection(customerId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('inspections').select('id')
    .eq('customer_id', customerId).eq('status', 'in_progress')
    .order('inspection_start_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** 카드를 연 사실 — 같은 개체·같은 날 1행(176). 이력 열람용이라 실패해도 카드는 그대로 */
export async function recordTagScanAction(assetId: string): Promise<{ recorded: boolean }> {
  const profile = await requirePermission('inspection_register')
  const a = await assetById(assetId)
  if (!a || a.status !== 'in_use') return { recorded: false }
  const admin = createAdminClient()
  const today = todayKst()
  const { data: had } = await admin.from('equipment_asset_events').select('id')
    .eq('asset_id', a.id).eq('event_type', 'scan').eq('event_date', today).limit(1)
  if (had?.length) return { recorded: false }
  const { error } = await admin.from('equipment_asset_events').insert({
    asset_id: a.id, event_type: 'scan', event_date: today, actor_id: profile.id, values: {},
  })
  if (error) { console.error('[tag] scan 기록 실패:', error.message); return { recorded: false } }
  return { recorded: true }
}

/** [이상 없음] — inspect·good. 진행 중 회차가 있으면 그 회차에 묶는다 */
export async function markTagGoodAction(assetId: string): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  const a = await assetById(assetId)
  if (!a || a.status !== 'in_use') return { error: '사용 중인 설비가 아닙니다.' }
  const { error } = await createAdminClient().from('equipment_asset_events').insert({
    asset_id: a.id, event_type: 'inspect', event_date: todayKst(), result: 'good',
    inspection_id: await openInspection(a.customer_id), actor_id: profile.id, values: { via: 'qr' },
  })
  if (error) return { error: '기록하지 못했습니다.' }
  revalidatePath(`/t/${a.tag_code}`)
  return {}
}

/** [불량 등록] — 이 고객의 진행 중 회차에 불량 1건 + asset_id + inspect·defect 이벤트.
 *  회차가 없으면 만들지 않고 알린다(회차 생성은 달력의 일 — 증거 축이 갈라지지 않게). */
export async function registerTagDefectAction(input: {
  assetId: string; defectName: string; defectDetail?: string | null; severity: DefectSeverity
}): Promise<{ error?: string; inspectionId?: string }> {
  const profile = await requirePermission('inspection_register')
  const a = await assetById(input.assetId)
  if (!a || a.status !== 'in_use') return { error: '사용 중인 설비가 아닙니다.' }
  const name = input.defectName.trim()
  if (!name) return { error: '불량 내용을 적어 주세요.' }
  const inspectionId = await openInspection(a.customer_id)
  if (!inspectionId) return { error: '이 고객의 진행 중 점검 회차가 없습니다 — 점검 달력에서 회차를 먼저 시작하세요.' }
  const detail = [a.location ? `위치: ${a.location}` : null, input.defectDetail?.trim() || null].filter(Boolean).join(' / ') || null
  const r = await addDefectAction({ inspectionId, defectName: name, defectDetail: detail, severity: input.severity })
  if (r.error || !r.id) return { error: r.error ?? '불량을 저장하지 못했습니다.' }
  const admin = createAdminClient()
  const { error: linkErr } = await admin.from('inspection_defects').update({ asset_id: a.id }).eq('id', r.id)
  if (linkErr) console.error('[tag] 불량 asset_id 연결 실패(불량은 저장됨):', linkErr.message)
  const { error: evErr } = await admin.from('equipment_asset_events').insert({
    asset_id: a.id, event_type: 'inspect', event_date: todayKst(), result: 'defect',
    inspection_id: inspectionId, defect_id: r.id, actor_id: profile.id, values: { via: 'qr' },
  })
  if (evErr) console.error('[tag] 불량 이벤트 기록 실패(불량은 저장됨):', evErr.message)
  revalidatePath(`/t/${a.tag_code}`)
  return { inspectionId }
}

/** [교체] — 대장 패널의 「교체로 닫기」와 같은 액션. 새 설비는 새 라벨로 등록한다(코드 재발급 없음) */
export async function replaceTagAssetAction(assetId: string, note?: string | null): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const a = await assetById(assetId)
  if (!a) return { error: '설비를 찾지 못했습니다.' }
  const r = await closeEquipmentAction(a.customer_id, a.id, 'replaced', note ?? 'QR 카드에서 교체')
  if (!r.error && a.tag_code) revalidatePath(`/t/${a.tag_code}`)
  return r
}

/** 미등록 코드 = 첫 등록 — 선인쇄 라벨을 붙이며 찍으면 그 코드로 개체 1행(qty 1)을 만든다.
 *  행 만들기는 addEquipmentRowsAction(검증·건물 소속 확인)을 그대로 타고, 코드만 이어서 붙인다. */
export async function registerUnknownTagAction(rawCode: string, customerId: string, input: Omit<EquipmentInput, 'qty'>): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const code = normalizeTagInput(rawCode)
  if (!code || code.length !== TAG_LEN) return { error: '코드 형식이 아닙니다.' }
  if (!UUID.test(customerId)) return { error: '고객을 골라 주세요.' }
  const admin = createAdminClient()
  if (await findAssetByTag(admin, code)) return { error: '이미 등록된 코드입니다.' }
  const r = await addEquipmentRowsAction(customerId, [{ ...input, qty: 1 }])
  if (r.error) return { error: r.error }
  const rowId = r.ids?.[0]
  if (!rowId) return { error: '설비는 등록됐지만 코드를 붙이지 못했습니다 — 대장에서 확인하세요.' }
  const { error } = await admin.from('equipment_assets').update({ tag_code: code }).eq('id', rowId).is('tag_code', null)
  if (error) return { error: error.code === '23505' ? '이미 등록된 코드입니다.' : '코드를 붙이지 못했습니다.' }
  revalidatePath(`/t/${code}`)
  return {}
}

/** 첫 등록 폼 — 고객 찾기(이름 일부, 최대 20)·그 고객의 건물. 읽기라 inspection_register(전 직원) */
export async function searchCustomersForTagAction(q: string): Promise<Array<{ id: string; name: string }>> {
  await requirePermission('inspection_register')
  const term = q.trim().replace(/[%_,()]/g, '')
  if (term.length < 1) return []
  const { data } = await createAdminClient().from('customers').select('id, customer_name')
    .ilike('customer_name', `%${term}%`).order('customer_name').limit(20)
  return ((data ?? []) as Array<{ id: string; customer_name: string }>).map(c => ({ id: c.id, name: c.customer_name }))
}

export async function listBuildingsForTagAction(customerId: string): Promise<Array<{ id: string; building_name: string }>> {
  await requirePermission('inspection_register')
  if (!UUID.test(customerId)) return []
  const { data } = await createAdminClient().from('buildings').select('id, building_name')
    .eq('customer_id', customerId).eq('is_active', true).order('created_at')
  return (data ?? []) as Array<{ id: string; building_name: string }>
}
