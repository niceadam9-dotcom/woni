/** 설비 대장 펌프 명판 → 펌프성능시험 판정 ② 규정치 (통합계획 C3 4단계, 2026-10-03)
 *  화면(pump-test-panel)과 별지 4호 조립(report9-actions)이 **같은 조회**를 쓴다 — 두 갈래 판정 금지.
 *  키 = `${별지 4호 설비 번호}|${주|예비}`. 같은 키에 명판이 둘 이상이면 어느 것인지 모르므로 판정하지 않는다(dup). */
import type { createAdminClient } from '@/lib/supabase/admin'
import { PUMP_TEST_SHEETS, PUMP_KINDS, type PumpPlate } from '@/lib/pump-test'

type Admin = ReturnType<typeof createAdminClient>
export type PumpPlateMap = Record<string, PumpPlate | 'dup'>
export const plateKey = (sheetNo: number, kind: string) => `${sheetNo}|${kind}`

export type PumpSpecs = { pump_sheet_no?: number; pump_kind?: string; rated_flow_lpm?: number; rated_head_m?: number }

/** specs → 명판(형식이 맞을 때만). 순수 — 테스트가 DB 없이 부른다 */
export function plateFromSpecs(s: PumpSpecs | null | undefined): { key: string; plate: PumpPlate } | null {
  if (!s) return null
  const sheet = Number(s.pump_sheet_no), q = Number(s.rated_flow_lpm), h = Number(s.rated_head_m)
  if (!(PUMP_TEST_SHEETS as readonly number[]).includes(sheet)) return null
  if (!(PUMP_KINDS as readonly string[]).includes(String(s.pump_kind))) return null
  if (!(q > 0) || !(h > 0)) return null
  return { key: plateKey(sheet, String(s.pump_kind)), plate: { ratedFlowLpm: q, ratedHeadM: h } }
}

export function buildPlateMap(rows: ReadonlyArray<{ specs: PumpSpecs | null }>): PumpPlateMap {
  const m: PumpPlateMap = {}
  for (const r of rows) {
    const p = plateFromSpecs(r.specs)
    if (!p) continue
    m[p.key] = m[p.key] ? 'dup' : p.plate
  }
  return m
}

/** 고객의 사용 중 펌프 행에서 명판 지도. 177 미적용·조회 실패면 빈 지도 — 판정은 종전대로 수동 */
export async function loadPumpPlates(admin: Admin, customerId: string): Promise<PumpPlateMap> {
  const { data, error } = await admin.from('equipment_assets').select('specs')
    .eq('customer_id', customerId).eq('status', 'in_use').eq('category', 'pump')
  if (error) return {}
  return buildPlateMap((data ?? []) as Array<{ specs: PumpSpecs | null }>)
}

export const plateFor = (m: PumpPlateMap | undefined, sheetNo: number, kind: string): PumpPlate | null => {
  const v = m?.[plateKey(sheetNo, kind)]
  return v && v !== 'dup' ? v : null
}
