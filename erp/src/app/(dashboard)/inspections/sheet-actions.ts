'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

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
    // 그룹: 표준(STD, 숫자 시작) = 코드 접두(1-A-001 → 1-A) / 외관(X)·안전시설등(MU) = 서식의 구분란(facility_type)
    .map(({ facility_type, ...i }) => ({
      ...i,
      group: /^[A-Z]/.test(i.item_code) ? (facility_type ?? i.item_code.replace(/-\d+$/, '')) : i.item_code.replace(/-\d+$/, ''),
    }))
  return { items }
}

/** 점검표 응답 저장 (P34-2) — 해당 항목들 upsert */
export async function saveSheetResponsesAction(
  inspectionId: string,
  rows: Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo?: string | null }>
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()
  if (rows.length === 0) return {}
  const payload = rows.map(r => ({
    inspection_id: inspectionId, item_code: r.item_code, result: r.result,
    memo: r.memo?.trim() || null, updated_by: profile.id, updated_at: new Date().toISOString(),
  }))
  const { error } = await admin.from('inspection_sheet_responses')
    .upsert(payload as Record<string, unknown>[], { onConflict: 'inspection_id,item_code' })
  if (error) return { error: `저장 실패: ${error.message}` }
  revalidatePath(`/inspections/${inspectionId}`)
  return {}
}

/** §9-4 A안: 설치 설비 전체 양호 — 설치 시설(fire_facilities)과 매칭되는 시트의 '미입력' 항목만 ○로 일괄 채움.
 *  기존 응답(O/X/N)은 절대 덮어쓰지 않는다 — 불량 먼저 태깅 후 눌러도, 누른 뒤 태깅해도 안전. */
export async function bulkAllGoodAction(inspectionId: string): Promise<{
  error?: string; filled?: number; sheetCount?: number; kept?: number
}> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data: insp } = await admin.from('inspections')
    .select('customer_id, customer:customers(inspection_type)').eq('id', inspectionId).maybeSingle()
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }
  const inspectionType = ((insp as unknown as { customer: { inspection_type: string } | null }).customer)?.inspection_type ?? ''
  const isSpecial = inspectionType === '종합' || inspectionType === '작동'

  // 설치 시설 코드 (V-1 누락 감지와 동일 매칭 — 공백 제거 양방향 includes)
  const { data: blds } = await admin.from('buildings').select('id')
    .eq('customer_id', (insp as { customer_id: string }).customer_id).eq('is_active', true)
  const bldIds = ((blds ?? []) as Array<{ id: string }>).map(b => b.id)
  const { data: facs } = bldIds.length > 0
    ? await admin.from('fire_facilities').select('facility_code').in('building_id', bldIds).eq('installed', true)
    : { data: [] }
  const codes = ((facs ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code.replace(/ /g, ''))
  if (codes.length === 0) return { error: '설치 시설 정보가 없습니다 — 소방계획서 탭 > 1.4 소방시설에서 설치 시설을 먼저 등록해주세요.' }

  const { data: sheetRaw } = await admin.from('inspection_sheets')
    .select('id, sheet_name').eq('version', isSpecial ? 'v2025' : 'v2022')
  const sheets = ((sheetRaw ?? []) as Array<{ id: string; sheet_name: string }>)
    .filter(s => {
      const sn = s.sheet_name.replace(/ /g, '')
      return codes.some(c => c.includes(sn) || sn.includes(c))
    })
  if (sheets.length === 0) return { error: '설치 시설과 매칭되는 점검표 시트가 없습니다.' }

  const { data: itemRaw } = await admin.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').in('sheet_id', sheets.map(s => s.id))
  let items = (itemRaw ?? []) as Array<{ item_code: string; comprehensive_only: boolean }>
  if (inspectionType === '작동') items = items.filter(i => !i.comprehensive_only)

  const { data: resp } = await admin.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', inspectionId)
  const have = new Set(((resp ?? []) as Array<{ item_code: string }>).map(r => r.item_code))
  const payload = items.filter(i => !have.has(i.item_code)).map(i => ({
    inspection_id: inspectionId, item_code: i.item_code, result: 'O',
    updated_by: profile.id, updated_at: new Date().toISOString(),
  }))
  if (payload.length > 0) {
    const { error } = await admin.from('inspection_sheet_responses').insert(payload as Record<string, unknown>[])
    if (error) return { error: `일괄 저장 실패: ${error.message}` }
  }
  revalidatePath(`/inspections/${inspectionId}`)
  return { filled: payload.length, sheetCount: sheets.length, kept: items.filter(i => have.has(i.item_code)).length }
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

  const { data: insp } = await admin.from('inspections')
    .select('customer:customers(inspection_type)').eq('id', inspectionId).maybeSingle()
  const inspectionType = ((insp as { customer: { inspection_type: string } | null } | null)?.customer)?.inspection_type ?? ''
  const isSpecial = inspectionType === '종합' || inspectionType === '작동'

  const { data: sheetRaw } = await admin.from('inspection_sheets')
    .select('id, sheet_name').eq('version', isSpecial ? 'v2025' : 'v2022')
  const sheetName = new Map(((sheetRaw ?? []) as Array<{ id: string; sheet_name: string }>).map(s => [s.id, s.sheet_name]))

  const { data: itemRaw } = await admin.from('inspection_sheet_items')
    .select('item_code, item_name, comprehensive_only, sheet_id')
    .in('sheet_id', [...sheetName.keys()])
    .or(`item_name.ilike.%${query.replace(/[%,()]/g, '')}%,item_code.ilike.%${query.replace(/[%,()]/g, '')}%`)
    .order('item_code').limit(20)
  let items = (itemRaw ?? []) as Array<{ item_code: string; item_name: string; comprehensive_only: boolean; sheet_id: string }>
  if (inspectionType === '작동') items = items.filter(i => !i.comprehensive_only)

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
  await requirePermission('inspection_register')
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
  revalidatePath(`/inspections/${inspectionId}`)
  return { added: toInsert.length }
}
