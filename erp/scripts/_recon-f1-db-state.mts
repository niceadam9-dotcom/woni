/** F-1 Phase 0 — DB 실측: STD 시트 전수 + 누락 번호대 항목 잔존 여부 (읽기 전용).
 *  조사 에이전트 보고("134에 6-A 그룹 VALUES 존재")와 커버리지 실측(23시트)의 모순 해소용.
 *  실행: npx tsx scripts/_recon-f1-db-state.mts */
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

const sheets = await q<{ id: string; sheet_code: string; sheet_name: string; version: string | null }>(
  admin.from('inspection_sheets').select('id, sheet_code, sheet_name, version').order('sheet_code'), 'sheets')
console.log(`=== 시트 전수 ${sheets.length}건`)
for (const s of sheets) console.log(`  ${s.sheet_code.padEnd(8)} ${s.version ?? '-'}  ${s.sheet_name}`)

const stdNums = sheets.filter(s => /^STD-\d+$/.test(s.sheet_code)).map(s => Number(s.sheet_code.slice(4)))
const missing = Array.from({ length: 32 }, (_, i) => i + 1).filter(n => !stdNums.includes(n))
console.log(`\nSTD 빈 번호(1~32): ${missing.join(', ') || '없음'}`)

// 누락 번호대 item_code 잔존 여부 — 시트 없이 항목만 있을 가능성(134 모순 해소)
console.log('\n=== 누락 번호대 item_code 잔존')
for (const n of missing) {
  const rows = await q<{ item_code: string; sheet_id: string }>(
    admin.from('inspection_sheet_items').select('item_code, sheet_id').like('item_code', `${n}-%`).limit(5), `items ${n}-`)
  console.log(`  ${String(n).padStart(2)}-% : ${rows.length ? `**잔존 ${rows.length}+건** ${rows.map(r => r.item_code).join(', ')}` : '0건'}`)
}

// 전체 항목의 sheet_id가 전부 실존 시트를 가리키는지 (고아 항목)
const items = await q<{ sheet_id: string }>(admin.from('inspection_sheet_items').select('sheet_id').range(0, 1999), 'items all')
const ids = new Set(sheets.map(s => s.id))
const orphan = items.filter(i => !ids.has(i.sheet_id)).length
console.log(`\n항목 ${items.length}건(상한 2000) 중 고아(시트 없음): ${orphan}건`)
