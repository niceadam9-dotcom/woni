/** 건축물대장 일괄 재조회가 **가능한가** — bcode·지번주소 보유율과 동기화 이력 계량(읽기 전용).
 *  실행: node scripts/_probe-ledger-coverage.mjs [.env파일]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const envFile = process.argv[2] ?? '.env.local'
const env = {}
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
console.log(`env=${envFile}  key=${process.env.BUILDING_LEDGER_API_KEY || env.BUILDING_LEDGER_API_KEY ? '있음' : '없음(.env)'}`)

const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('buildings')
    .select('id, building_name, address, address_jibun, bcode, ledger_synced_at, purpose, height, floors_above, total_area, is_active')
    .range(from, from + 999)
  if (error) throw new Error(error.message)
  rows.push(...data); if (data.length < 1000) break
}
const act = rows.filter(r => r.is_active !== false)
const n = act.length
const pct = x => `${x} (${(x / n * 100).toFixed(0)}%)`

const hasBcode = act.filter(r => r.bcode && String(r.bcode).length === 10)
const hasJibun = act.filter(r => r.address_jibun && /(\d+)(-\d+)?$/.test(String(r.address_jibun).trim()))
const runnable = act.filter(r => r.bcode && String(r.bcode).length === 10
  && r.address_jibun && /(\d+)(-\d+)?$/.test(String(r.address_jibun).trim()))
const synced = act.filter(r => r.ledger_synced_at)

console.log(`\n활성 건물 ${n}동`)
console.log(`  bcode(10자리) 보유      ${pct(hasBcode.length)}`)
console.log(`  지번주소(번지 파싱 가능) ${pct(hasJibun.length)}`)
console.log(`  ⇒ **일괄 재조회 가능**    ${pct(runnable.length)}`)
console.log(`  대장 동기화 이력 있음    ${pct(synced.length)}`)

const syncedNoPurpose = synced.filter(r => !r.purpose)
console.log(`\n동기화했는데 용도가 비어 있는 동: ${syncedNoPurpose.length}`)
console.log(`동기화 안 했고 용도도 없는 동:   ${act.filter(r => !r.ledger_synced_at && !r.purpose).length}`)

console.log(`\n[재조회 가능한 표본 5]`)
for (const r of runnable.slice(0, 5)) {
  console.log(`  ${r.building_name} | bcode=${r.bcode} | ${r.address_jibun}`)
  console.log(`     현재값: 용도=${r.purpose ?? '(없음)'} 높이=${r.height ?? '(없음)'} 층=${r.floors_above ?? '(없음)'} 연면적=${r.total_area ?? '(없음)'} 동기화=${r.ledger_synced_at ?? '없음'}`)
}
if (runnable.length === 0) {
  console.log('\n>>> 일괄 재조회 불가 — bcode/지번주소가 없다. 주소 재검색으로만 채울 수 있다.')
}
