/** 운영 DB 148 적용 실측 (읽기 전용) — .env.local.prod-backup의 운영 키 사용.
 *  술어는 전부 ASCII(sheet_code) — 한글 술어는 조용히 0건을 주는 함정이 있다.
 *  실행: npx tsx scripts/_probe-prod-148.mts */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const envPath = path.join(import.meta.dirname, '..', '.env.local.prod-backup')
const env: Record<string, string> = {}
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('운영 키를 .env.local.prod-backup에서 찾지 못함')
console.log(`대상: ${url} (운영)`)

const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url, key)

const EXPECT: Record<string, { items: number; comp: number }> = {
  'STD-06': { items: 62, comp: 35 }, 'STD-07': { items: 61, comp: 27 },
  'STD-08': { items: 83, comp: 46 }, 'STD-12': { items: 55, comp: 23 },
  'STD-18': { items: 9, comp: 6 },  'STD-24': { items: 17, comp: 6 },
  'STD-30': { items: 15, comp: 7 },
}

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `  ${extra}`}`); ok ? pass++ : fail++
}

const sRes = await admin.from('inspection_sheets').select('id, sheet_code, sheet_name')
  .eq('version', 'v2025').in('sheet_code', Object.keys(EXPECT))
if (sRes.error) throw new Error(`sheets: ${sRes.error.message}`)
const sheets = (sRes.data ?? []) as Array<{ id: string; sheet_code: string; sheet_name: string }>
check(`시트 7건 존재 (실제 ${sheets.length})`, sheets.length === 7,
  `있는 것: ${sheets.map(s => s.sheet_code).join(', ') || '없음'}`)

for (const s of sheets.sort((a, b) => a.sheet_code.localeCompare(b.sheet_code))) {
  const r = await admin.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', s.id)
  if (r.error) throw new Error(`items ${s.sheet_code}: ${r.error.message}`)
  const rows = (r.data ?? []) as Array<{ item_code: string; comprehensive_only: boolean }>
  const comp = rows.filter(x => x.comprehensive_only).length
  const e = EXPECT[s.sheet_code]
  check(`${s.sheet_code} ${s.sheet_name} — ${rows.length}항목(● ${comp})`,
    rows.length === e.items && comp === e.comp, `기대 ${e.items}(● ${e.comp})`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exitCode = fail ? 1 : 0
