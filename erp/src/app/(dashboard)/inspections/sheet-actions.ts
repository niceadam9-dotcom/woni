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
    .select('item_code, item_name, comprehensive_only')
    .eq('sheet_id', sheetId).order('order_num')
  const items = ((data ?? []) as Array<{ item_code: string; item_name: string; comprehensive_only: boolean }>)
    .map(i => ({ ...i, group: i.item_code.replace(/-\d+$/, '') })) // 1-A-001 → 1-A
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
