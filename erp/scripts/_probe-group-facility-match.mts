/** 점검표 group_name ↔ 1.4 대장 40종 **정확 일치** 전수 — 자동 ／의 대상 범위를 데이터가 정하게 한다 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { ALL_STANDARD_CODES } from '../src/lib/facility-codes.ts'
config({ path: '.env.local', quiet: true })
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
// 🚨 PostgREST 기본 1000행 상한 — 항목이 860행대라 아슬아슬하고, 넘으면 **그룹이 조용히 사라진다**
//    (실제로 21-C가 8건→2건으로 보였다). 페이징으로 전건을 받는다. [[risk_supabase_1000row_cap]]
const rows: Array<{ item_code: string; group_code: string | null; group_name: string | null; facility_type: string | null; sheet_id: string }> = []
for (let from = 0; ; from += 1000) {
  const { data: page, error } = await a.from('inspection_sheet_items')
    .select('item_code, group_code, group_name, facility_type, sheet_id')
    .order('item_code').range(from, from + 999)
  if (error) throw new Error(error.message)
  rows.push(...(page ?? []) as never)
  if ((page?.length ?? 0) < 1000) break
}
console.log(`항목 전건 ${rows.length}행 읽음`)
const { data: sheetRows, error: eS } = await a.from('inspection_sheets').select('id, sheet_code')
if (eS) throw new Error(eS.message)
const sheetOf = new Map((sheetRows ?? []).map(s => [s.id as string, s.sheet_code as string]))
const data = rows
const std = new Set(ALL_STANDARD_CODES as readonly string[])
const groups = new Map<string, { name: string; ft: string; n: number; sheet: string }>()
for (const r of data ?? []) {
  const g = String(r.group_code ?? '')
  if (!g) continue
  const cur = groups.get(g) ?? { name: String(r.group_name ?? ''), ft: String(r.facility_type ?? ''), n: 0, sheet: sheetOf.get(String(r.sheet_id)) ?? '?' }
  cur.n++; groups.set(g, cur)
}
const hit: string[] = [], miss: string[] = []
for (const [g, v] of [...groups].sort()) {
  ;(std.has(v.name) ? hit : miss).push(`${v.sheet.padEnd(7)} ${g.padEnd(8)} ${String(v.n).padStart(2)}건  "${v.name}"`)
}
console.log(`그룹 ${groups.size}개 중 **1.4 표준 40종과 정확히 일치** ${hit.length}개 — 자동 ／ 대상\n`)
console.log(hit.join('\n'))
console.log(`\n일치하지 않는 그룹 ${miss.length}개 — 구성요소라 종전대로(예시 12개)\n`)
console.log(miss.slice(0, 12).join('\n'))
