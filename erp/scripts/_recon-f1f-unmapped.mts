/** 어제 recon의 '시트를 못 찾은 응답 42건' 정체 확인 — 1000행 상한 잘림 의심 (읽기 전용).
 *  서림사 2026 응답의 item_code를 .in() 직접 조회로 시트에 귀속시킨다(상한 영향 없음).
 *  실행: npx tsx scripts/_recon-f1f-unmapped.mts */
import { readFileSync } from 'node:fs'
import path from 'node:path'

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const q = async <T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> => {
  const r = await p
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return (r.data ?? []) as T[]
}

// 전체 항목 수 — 1000행 상한에 걸리는 규모인지부터
const { count } = await admin.from('inspection_sheet_items').select('id', { count: 'exact', head: true })
console.log(`inspection_sheet_items 총 ${count}행 ${count && count > 1000 ? '→ ⚠ 무페이지 전량 조회는 잘린다(어제 recon의 결함)' : ''}`)

const custs = await q<{ id: string }>(admin.from('customers').select('id').eq('customer_name', '서림사'), 'cust')
const insps = await q<{ id: string; year: number }>(
  admin.from('inspections').select('id, year').eq('customer_id', custs[0].id), 'insp')
const resp = await q<{ item_code: string; result: string }>(
  admin.from('inspection_sheet_responses').select('item_code, result').eq('inspection_id', insps[0].id), 'resp')
console.log(`서림사 ${insps[0].year} 응답 ${resp.length}건`)

const codes = [...new Set(resp.map(r => r.item_code))]
// .in() 직접 조회 — 코드 수만큼만 온다, 상한 무관
const items = await q<{ item_code: string; sheet_id: string }>(
  admin.from('inspection_sheet_items').select('item_code, sheet_id').in('item_code', codes), 'items')
const sheets = await q<{ id: string; sheet_code: string; sheet_name: string }>(
  admin.from('inspection_sheets').select('id, sheet_code, sheet_name').in('id', [...new Set(items.map(i => i.sheet_id))]), 'sheets')
const shById = new Map(sheets.map(s => [s.id, s]))
const shOfCode = new Map(items.map(i => [i.item_code, shById.get(i.sheet_id)]))

const bySheet = new Map<string, number>()
const orphan: string[] = []
for (const r of resp) {
  const s = shOfCode.get(r.item_code)
  if (!s) { orphan.push(r.item_code); continue }
  bySheet.set(`[${s.sheet_code}] ${s.sheet_name}`, (bySheet.get(`[${s.sheet_code}] ${s.sheet_name}`) ?? 0) + 1)
}
console.log('\n시트별 응답(상한 무관 정확 귀속):')
for (const [k, v] of [...bySheet].sort()) console.log(`  · ${k} — ${v}건`)
console.log(`\n진짜 고아(카탈로그에 없는 코드): ${orphan.length}건 ${orphan.length ? orphan.slice(0, 10).join(', ') : ''}`)
const guide = [...bySheet.keys()].filter(k => k.includes('유도등'))
console.log(`유도등 시트 응답: ${guide.length ? guide.map(k => `${k}=${bySheet.get(k)}`).join(', ') : '0건 — 어제 결론(정말 무응답) 유지'}`)
