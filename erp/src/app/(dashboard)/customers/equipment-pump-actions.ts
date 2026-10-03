'use server'

/** 설비 대장 펌프 명판 (통합계획 C3 4단계, 2026-10-03)
 *  펌프 행의 specs(마이그 177)에 「어느 설비의 주/예비 펌프 · 정격 토출량 · 정격 양정」을 둔다.
 *  소비처는 펌프성능시험 판정 ②(lib/pump-test.judgePumpTest + lib/pump-plates) — 화면 패널과 별지 4호가 같은 값을 읽는다.
 *  ⚠ equipment-actions.ts와 파일을 나눈 이유: 같은 파일을 여러 작업이 동시에 고치고 있어 커밋이 섞이지 않게. */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { plateFromSpecs, type PumpSpecs } from '@/lib/pump-plates'

/** 고객의 사용 중 펌프 행 specs — 행 id → specs */
export async function listPumpSpecsAction(customerId: string): Promise<{ error?: string; specs: Record<string, PumpSpecs> }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data, error } = await admin.from('equipment_assets').select('id, specs').eq('customer_id', customerId).eq('status', 'in_use').eq('category', 'pump')
  if (error) return { error: '펌프 명판을 읽지 못했습니다.', specs: {} }
  return { specs: Object.fromEntries(((data ?? []) as Array<{ id: string; specs: PumpSpecs | null }>).map(r => [r.id, r.specs ?? {}])) }
}

/** 명판 저장 — 넷 다 있어야 저장(일부만 있으면 판정에 못 쓴다). clear=true면 명판을 지운다(specs의 펌프 키만) */
export async function setPumpPlateAction(customerId: string, id: string, input: {
  sheetNo?: number; kind?: string; ratedFlowLpm?: number; ratedHeadM?: number; clear?: boolean
}): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: cur } = await admin.from('equipment_assets').select('category, specs').eq('id', id).eq('customer_id', customerId).maybeSingle()
  const row = cur as { category: string; specs: Record<string, unknown> | null } | null
  if (!row) return { error: '행을 찾을 수 없습니다.' }
  if (row.category !== 'pump') return { error: '펌프 행에만 명판을 넣습니다.' }
  const rest = Object.fromEntries(Object.entries(row.specs ?? {}).filter(([k]) => !['pump_sheet_no', 'pump_kind', 'rated_flow_lpm', 'rated_head_m'].includes(k)))
  let next: Record<string, unknown> = rest
  if (!input.clear) {
    const specs: PumpSpecs = { pump_sheet_no: Number(input.sheetNo), pump_kind: input.kind, rated_flow_lpm: Number(input.ratedFlowLpm), rated_head_m: Number(input.ratedHeadM) }
    if (!plateFromSpecs(specs)) return { error: '설비·주/예비·정격 토출량(ℓ/min)·정격 양정(m)을 모두 바르게 넣어 주세요(0보다 큰 수).' }
    next = { ...rest, ...specs }
  }
  const { data, error } = await admin.from('equipment_assets').update({ specs: next }).eq('id', id).eq('customer_id', customerId).select('id')
  if (error || !data?.length) { if (error) console.error('[equipment] 명판 저장 실패:', error.message); return { error: '명판을 저장하지 못했습니다.' } }
  revalidatePath(`/customers/${customerId}`)
  return {}
}
