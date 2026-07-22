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
