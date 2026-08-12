'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { sheetMatchesFacilities } from '@/lib/sheet-facility-map'
import { sheetScope, isItemInScope, sheetItemGroup } from '@/lib/sheet-scope'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { syncInspectionSteps } from '@/lib/inspection-step-sync'
import { buildSheetOverviews, canEditInspection, type SheetOverview } from '@/lib/sheet-overview'
import type { UserRole } from '@/types'

/** 점검 건의 시트 범위 판정에 필요한 축 조회 — plan_type 우선, 관리유형은 레거시 폴백용 (sheet-scope.ts) */
async function loadScope(admin: ReturnType<typeof createAdminClient>, inspectionId: string) {
  const { data } = await admin.from('inspections')
    .select('customer_id, plan_type, assigned_employee_id, customer:customers(inspection_type)')
    .eq('id', inspectionId).maybeSingle()
  if (!data) return null
  const row = data as unknown as {
    customer_id: string; plan_type: string | null
    assigned_employee_id: string | null; customer: { inspection_type: string } | null
  }
  return {
    customerId: row.customer_id,
    assignedEmployeeId: row.assigned_employee_id,
    scope: sheetScope(row.plan_type, row.customer?.inspection_type ?? null),
  }
}

/** 회차별 작성·조회 트리의 설비별 요약 행 — 회차(들)의 시트별 진행률 일괄 조회.
 *  집계는 sheet-overview.ts 단일 소스(점검 상세 배지와 같은 값). 남용 방지로 한 번에 8회차까지. */
export async function getInspectionSheetOverviewAction(inspectionIds: string[]): Promise<{
  error?: string
  overviews?: Record<string, SheetOverview>
}> {
  const profile = await requirePermission('inspection_register')
  if (inspectionIds.length === 0) return { overviews: {} }
  if (inspectionIds.length > 8) return { error: '한 번에 조회할 수 있는 회차는 8건까지입니다.' }
  const { overviews, error } = await buildSheetOverviews(
    createAdminClient(), inspectionIds, { id: profile.id, role: profile.role as UserRole })
  if (error) return { error }
  return { overviews }
}

/** 트리 인라인 확장 — 한 시트의 항목 + 현재 응답을 지연 로드.
 *  loadSheetItemsAction과 달리 이 점검 건의 범위(작동=종합전용 제외)를 서버에서 적용해 내려준다. */
export async function loadSheetEditorAction(inspectionId: string, sheetId: string): Promise<{
  error?: string
  items?: Array<{ item_code: string; item_name: string; comprehensive_only: boolean; group: string }>
  responses?: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }>
  canEdit?: boolean
}> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const [insp, { data: itemRaw }] = await Promise.all([
    loadScope(admin, inspectionId),
    admin.from('inspection_sheet_items')
      .select('item_code, item_name, comprehensive_only, facility_type')
      .eq('sheet_id', sheetId).order('order_num'),
  ])
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }

  const items = ((itemRaw ?? []) as Array<{ item_code: string; item_name: string; comprehensive_only: boolean; facility_type: string | null }>)
    .filter(i => isItemInScope(i, insp.scope))
    .map(({ facility_type, ...i }) => ({ ...i, group: sheetItemGroup(i.item_code, facility_type) }))

  const responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }> = {}
  if (items.length > 0) {
    const { data: respRaw } = await admin.from('inspection_sheet_responses')
      .select('item_code, result, memo').eq('inspection_id', inspectionId).in('item_code', items.map(i => i.item_code))
    for (const r of (respRaw ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null }>) {
      responses[r.item_code] = { result: r.result, memo: r.memo }
    }
  }
  const canEdit = canEditInspection(insp.assignedEmployeeId, { id: profile.id, role: profile.role as UserRole })
  return { items, responses, canEdit }
}

/** 선택한 설비 점검표의 표준 항목 로드 (P34-2, 지연 로드) */
export async function loadSheetItemsAction(sheetId: string): Promise<{
  items: Array<{ item_code: string; item_name: string; comprehensive_only: boolean; group: string }>
}> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data } = await admin.from('inspection_sheet_items')
    .select('item_code, item_name, comprehensive_only, facility_type')
    .eq('sheet_id', sheetId).order('order_num')
  const items = ((data ?? []) as Array<{ item_code: string; item_name: string; comprehensive_only: boolean; facility_type: string | null }>)
    .map(({ facility_type, ...i }) => ({ ...i, group: sheetItemGroup(i.item_code, facility_type) }))
  return { items }
}

/** EX-4(소방계획서_19, 125): 외관점검표 특정 월의 응답만 로드 — 연간 누적본 입력용.
 *  month=0이면 '월 무관'(레거시 저장분)을 돌려준다. 화면은 월을 바꿀 때마다 이 값으로 다시 초기화한다. */
export async function loadExteriorMonthResponsesAction(
  inspectionId: string, month: number,
): Promise<{ responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }>; error?: string }> {
  await requirePermission('inspection_register')
  if (!Number.isInteger(month) || month < 0 || month > 12) return { responses: {}, error: '점검 월 값을 확인해주세요.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('inspection_sheet_responses')
    .select('item_code, result, memo')
    .eq('inspection_id', inspectionId).eq('month', month).like('item_code', 'X%')
  if (error) return { responses: {}, error: `조회 실패: ${error.message}` }
  const responses: Record<string, { result: 'O' | 'X' | 'N'; memo: string | null }> = {}
  for (const r of (data ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null }>) {
    responses[r.item_code] = { result: r.result, memo: r.memo }
  }
  return { responses }
}

/** 점검표 응답 저장 (P34-2) — 해당 항목들 upsert
 *  EX-4(소방계획서_19, 125): month는 **외관점검표(X% 항목)의 연간 누적 축**이다.
 *  0 = 월 무관(일반 점검표 전부, 기본값) / 1~12 = 그 달의 외관점검 실적.
 *  월을 넘기지 않으면 종전과 완전히 동일하게 동작한다. */
export async function saveSheetResponsesAction(
  inspectionId: string,
  rows: Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo?: string | null }>,
  month = 0,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()
  if (rows.length === 0) return {}
  if (!Number.isInteger(month) || month < 0 || month > 12) return { error: '점검 월 값을 확인해주세요.' }
  const payload = rows.map(r => ({
    inspection_id: inspectionId, item_code: r.item_code, result: r.result,
    // 외관 항목만 월 축을 쓴다 — 일반 점검표에 월이 섞이면 유니크가 갈라져 중복 응답이 생긴다
    month: r.item_code.startsWith('X') ? month : 0,
    memo: r.memo?.trim() || null, updated_by: profile.id, updated_at: new Date().toISOString(),
  }))
  const { error } = await admin.from('inspection_sheet_responses')
    .upsert(payload as Record<string, unknown>[], { onConflict: 'inspection_id,item_code,month' })
  if (error) return { error: `저장 실패: ${error.message}` }
  // R4-6: ① 점검표 응답이 곧 근거 — 저장 즉시 단계가 스스로 완료된다(버튼 불필요)
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return {}
}

/** §9-4 A안: 설치 설비 전체 양호 — 설치 시설(fire_facilities)과 매칭되는 시트의 '미입력' 항목만 ○로 일괄 채움.
 *  기존 응답(O/X/N)은 절대 덮어쓰지 않는다 — 불량 먼저 태깅 후 눌러도, 누른 뒤 태깅해도 안전. */
export async function bulkAllGoodAction(inspectionId: string, month = 0): Promise<{
  error?: string; filled?: number; sheetCount?: number; kept?: number
}> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const insp = await loadScope(admin, inspectionId)
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }
  const { scope } = insp

  // 설치 시설 코드 → 시트 매칭 (명시 매핑 — sheet-facility-map.ts, 실전 검증에서 퍼지 매칭 결함 확인)
  const { data: blds } = await admin.from('buildings').select('id')
    .eq('customer_id', insp.customerId).eq('is_active', true)
  const bldIds = ((blds ?? []) as Array<{ id: string }>).map(b => b.id)
  const { data: facs } = bldIds.length > 0
    ? await admin.from('fire_facilities').select('facility_code').in('building_id', bldIds).eq('installed', true)
    : { data: [] }
  const codes = ((facs ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code)
  if (codes.length === 0) return { error: '설치 시설 정보가 없습니다 — 소방계획서 탭 > 1.4 소방시설에서 설치 시설을 먼저 등록해주세요.' }

  const { data: sheetRaw } = await admin.from('inspection_sheets')
    .select('id, sheet_name').eq('version', scope.version)
  const sheets = ((sheetRaw ?? []) as Array<{ id: string; sheet_name: string }>)
    .filter(s => sheetMatchesFacilities(s.sheet_name, codes))
  if (sheets.length === 0) return { error: '설치 시설과 매칭되는 점검표 시트가 없습니다.' }

  // 항목 카탈로그는 1000행을 넘을 수 있어 페이징 필수 (fetch-all.ts)
  const { rows: itemRaw, error: itemErr } = await fetchAllRows<{ item_code: string; comprehensive_only: boolean }>(
    (from, to) => admin.from('inspection_sheet_items')
      .select('item_code, comprehensive_only').in('sheet_id', sheets.map(s => s.id)).range(from, to))
  if (itemErr) return { error: `항목 조회 실패: ${itemErr}` }
  const items = itemRaw.filter(i => isItemInScope(i, scope))

  // EX-4(125): 외관 항목은 **그 달에 이미 입력했는지**로 판정해야 한다 — 월을 접어 보면
  // 3월에 채운 항목이 7월엔 영영 안 채워진다(독립 검증 지적). 일반 점검표는 종전대로 month=0 한 축.
  const { data: resp } = await admin.from('inspection_sheet_responses')
    .select('item_code, month').eq('inspection_id', inspectionId)
  const respRows = (resp ?? []) as Array<{ item_code: string; month: number }>
  const monthOf = (code: string) => (code.startsWith('X') ? month : 0)
  const have = new Set(respRows.map(r => `${r.item_code}@${r.month}`))
  const filled = (code: string) => have.has(`${code}@${monthOf(code)}`)
  const seen = new Set<string>() // 시드 중복 방어 — 같은 코드 2행이면 1건만
  const payload = items.filter(i => !filled(i.item_code) && !seen.has(i.item_code) && (seen.add(i.item_code), true)).map(i => ({
    inspection_id: inspectionId, item_code: i.item_code, result: 'O',
    month: monthOf(i.item_code),
    updated_by: profile.id, updated_at: new Date().toISOString(),
  }))
  if (payload.length > 0) {
    const { error } = await admin.from('inspection_sheet_responses').insert(payload as Record<string, unknown>[])
    if (error) return { error: `일괄 저장 실패: ${error.message}` }
  }
  await syncInspectionSteps(admin, inspectionId, profile.id)   // R4-6: ①
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return { filled: payload.length, sheetCount: sheets.length, kept: items.filter(i => filled(i.item_code)).length }
}

/** 지난 회차 결과 불러오기 (소방계획서_20 S4-9).
 *
 *  ⚠ 이 기능은 실제 점검을 대체하지 않는다. 자체점검 결과를 확인 없이 베끼면 허위 기재가 된다.
 *  그래서 설계상 안전장치를 서버에도 건다(S4-10):
 *   ① 미입력 항목에만 채운다 — 이번 회차에 이미 입력한 값은 절대 덮어쓰지 않는다(bulkAllGood와 같은 규약).
 *   ② X(불량)를 복사해도 불량내역 자동 등록은 하지 않는다 — 현장 확인 후 사용자가 직접 등록해야 한다.
 *   ③ 실행을 activity_logs에 남긴다(무엇을 몇 건 복사했는지).
 *   ④ 호출부는 확인 다이얼로그로 ①②를 고지하고, 복사 후 검토를 유도한다.
 *
 *  출처는 같은 고객의 직전 완료 회차 1건이다(연도·차수 desc). */
export async function copyPreviousRoundResponsesAction(inspectionId: string): Promise<{
  error?: string; filled?: number; skipped?: number; sourceLabel?: string; copiedX?: number
}> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const insp = await loadScope(admin, inspectionId)
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }

  // 직전 완료 회차 — 같은 고객, 이 건보다 앞선 회차 중 가장 최근
  const { data: cur } = await admin.from('inspections')
    .select('year, sequence_num').eq('id', inspectionId).maybeSingle()
  if (!cur) return { error: '점검 건을 찾을 수 없습니다.' }
  const c = cur as { year: number; sequence_num: number }

  const { data: prevRaw } = await admin.from('inspections')
    .select('id, year, sequence_num')
    .eq('customer_id', insp.customerId).eq('status', 'completed').neq('id', inspectionId)
    .order('year', { ascending: false }).order('sequence_num', { ascending: false })
    .limit(24)
  const prev = ((prevRaw ?? []) as Array<{ id: string; year: number; sequence_num: number }>)
    .find(p => p.year < c.year || (p.year === c.year && p.sequence_num < c.sequence_num))
  if (!prev) return { error: '불러올 지난 완료 회차가 없습니다.' }

  const [{ data: srcRaw }, { data: haveRaw }] = await Promise.all([
    admin.from('inspection_sheet_responses')
      .select('item_code, result, memo, month').eq('inspection_id', prev.id),
    admin.from('inspection_sheet_responses')
      .select('item_code').eq('inspection_id', inspectionId),
  ])
  const src = (srcRaw ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo: string | null; month: number | null }>
  if (src.length === 0) return { error: `${prev.year}년 ${prev.sequence_num}차에 저장된 점검표 응답이 없습니다.` }
  const have = new Set(((haveRaw ?? []) as Array<{ item_code: string }>).map(r => r.item_code))

  // ① 미입력 항목만 — 이번 회차 입력값 보존
  const seen = new Set<string>()
  const target = src.filter(r => !have.has(r.item_code) && !seen.has(r.item_code) && (seen.add(r.item_code), true))
  const payload = target.map(r => ({
    inspection_id: inspectionId, item_code: r.item_code, result: r.result,
    month: r.month ?? 0, memo: r.memo,
    updated_by: profile.id, updated_at: new Date().toISOString(),
  }))
  if (payload.length > 0) {
    const { error } = await admin.from('inspection_sheet_responses').insert(payload as Record<string, unknown>[])
    if (error) return { error: `불러오기 실패: ${error.message}` }
  }

  // ③ 감사 — 되돌리기가 없는 대량 입력이라 무엇을 베꼈는지 남긴다. ② 불량내역 자동 등록은 하지 않는다.
  const copiedX = target.filter(r => r.result === 'X').length
  await admin.from('activity_logs').insert({
    action: 'sheet_copy_previous', entity_type: 'inspection', entity_id: inspectionId, actor_id: profile.id,
    metadata: {
      source_inspection_id: prev.id, source_label: `${prev.year}년 ${prev.sequence_num}차`,
      filled: payload.length, skipped: src.length - target.length, copied_x: copiedX,
    },
  } as Record<string, unknown>)

  revalidatePath(`/inspections/${inspectionId}`)
  return {
    filled: payload.length, skipped: src.length - target.length, copiedX,
    sourceLabel: `${prev.year}년 ${prev.sequence_num}차`,
  }
}

/** §9-4 A안: 불량 빠른 태깅용 항목 검색 — 코드·명칭 부분 일치, 점검 유형에 맞는 버전 시트만 (최대 20건) */
export async function searchQuickItemsAction(inspectionId: string, q: string): Promise<{
  error?: string
  items?: Array<{ item_code: string; item_name: string; sheet_name: string; current: 'O' | 'X' | 'N' | null }>
}> {
  await requirePermission('inspection_register')
  const query = q.trim()
  if (query.length < 2) return { items: [] }
  const admin = createAdminClient()

  const insp = await loadScope(admin, inspectionId)
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }
  const { scope } = insp

  const { data: sheetRaw } = await admin.from('inspection_sheets')
    .select('id, sheet_name').eq('version', scope.version)
  const sheetName = new Map(((sheetRaw ?? []) as Array<{ id: string; sheet_name: string }>).map(s => [s.id, s.sheet_name]))

  const { data: itemRaw } = await admin.from('inspection_sheet_items')
    .select('item_code, item_name, comprehensive_only, sheet_id')
    .in('sheet_id', [...sheetName.keys()])
    .or(`item_name.ilike.%${query.replace(/[%,()]/g, '')}%,item_code.ilike.%${query.replace(/[%,()]/g, '')}%`)
    .order('item_code').limit(20)
  const items = ((itemRaw ?? []) as Array<{ item_code: string; item_name: string; comprehensive_only: boolean; sheet_id: string }>)
    .filter(i => isItemInScope(i, scope))

  const { data: resp } = items.length > 0
    ? await admin.from('inspection_sheet_responses').select('item_code, result')
        .eq('inspection_id', inspectionId).in('item_code', items.map(i => i.item_code))
    : { data: [] }
  const cur = new Map(((resp ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N' }>).map(r => [r.item_code, r.result]))

  return {
    items: items.map(i => ({
      item_code: i.item_code, item_name: i.item_name,
      sheet_name: sheetName.get(i.sheet_id) ?? '', current: cur.get(i.item_code) ?? null,
    })),
  }
}

/** X(불량) 응답 → 불량내역 자동 등록 (P34-3) — defect_catalog 표준 문구, 중복 코드 제외 */
export async function createDefectsFromXAction(
  inspectionId: string
): Promise<{ error?: string; added?: number }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data: xs } = await admin.from('inspection_sheet_responses')
    .select('item_code, memo').eq('inspection_id', inspectionId).eq('result', 'X')
  const xRows = (xs ?? []) as Array<{ item_code: string; memo: string | null }>
  if (xRows.length === 0) return { added: 0 }

  const codes = xRows.map(r => r.item_code)
  const [{ data: cat }, { data: existing }] = await Promise.all([
    admin.from('defect_catalog').select('code, equipment, description').in('code', codes),
    admin.from('inspection_defects').select('defect_code').eq('inspection_id', inspectionId),
  ])
  const catMap = new Map(((cat ?? []) as Array<{ code: string; equipment: string; description: string }>).map(c => [c.code, c]))
  const have = new Set(((existing ?? []) as Array<{ defect_code: string | null }>).map(e => e.defect_code).filter(Boolean))

  const toInsert = xRows.filter(r => !have.has(r.item_code)).map(r => {
    const c = catMap.get(r.item_code)
    return {
      inspection_id: inspectionId,
      defect_code: r.item_code,
      defect_name: c?.description ?? r.item_code,
      defect_detail: r.memo ?? null,
      severity: '보통',
    }
  })
  if (toInsert.length === 0) return { added: 0 }
  const { error } = await admin.from('inspection_defects').insert(toInsert as Record<string, unknown>[])
  if (error) return { error: `불량 등록 실패: ${error.message}` }
  // R4-6: ⑤ 불량이 생기면 분모가 6으로 늘고 ⑤가 미완료로 열린다
  await syncInspectionSteps(admin, inspectionId, profile.id)
  revalidatePath(`/inspections/${inspectionId}`)
  revalidatePath('/inspections')
  return { added: toInsert.length }
}
