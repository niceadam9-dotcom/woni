/** 백필 독립 검증 — API를 다시 부르지 않고 **DB만 읽어** 채움률과 되돌리기 기록의 실재를 확인한다.
 *  실행: node scripts/_verify-ledger-backfill.mjs [.env파일] [되돌리기json]
 */
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const envFile = args[0] ?? '.env.local'
const rbFile = args[1]
const env = {}
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('buildings')
    .select('id, building_name, bcode, address_jibun, is_active, permit_date, building_area, ledger_synced_at')
    .range(from, from + 999)
  if (error) throw new Error(error.message)
  rows.push(...data); if (data.length < 1000) break
}
const act = rows.filter(r => r.is_active !== false)
const runnable = act.filter(r => r.bcode && String(r.bcode).length === 10
  && r.address_jibun && /(\d+)(-\d+)?$/.test(String(r.address_jibun).trim()))
const pct = (x, n) => n ? `${x}/${n} (${(x / n * 100).toFixed(0)}%)` : `${x}/0`

console.log(`env=${envFile}  (${env.NEXT_PUBLIC_SUPABASE_URL})`)
console.log(`활성 건물 ${act.length}동 · 대장 조회가능 ${runnable.length}동\n`)
console.log(`[조회가능 ${runnable.length}동 기준]`)
console.log(`  건축허가일 채워짐 : ${pct(runnable.filter(r => r.permit_date).length, runnable.length)}`)
console.log(`  건축면적  채워짐 : ${pct(runnable.filter(r => r.building_area != null).length, runnable.length)}`)
console.log(`\n[활성 전체 ${act.length}동 기준]`)
console.log(`  건축허가일 채워짐 : ${pct(act.filter(r => r.permit_date).length, act.length)}`)
console.log(`  건축면적  채워짐 : ${pct(act.filter(r => r.building_area != null).length, act.length)}`)

console.log(`\n[조회가능 건물 상세]`)
for (const r of runnable) {
  console.log(`  ${r.permit_date ? '✓' : '·'} ${r.building_name} — 허가일=${r.permit_date ?? '(공란)'} 면적=${r.building_area ?? '(공란)'} 동기화=${r.ledger_synced_at ? r.ledger_synced_at.slice(0, 19) : '없음'}`)
}

if (rbFile && existsSync(new URL(`../${rbFile}`, import.meta.url))) {
  const rb = JSON.parse(readFileSync(new URL(`../${rbFile}`, import.meta.url), 'utf8'))
  const byId = new Map(rows.map(r => [r.id, r]))
  let ok = 0, bad = 0
  for (const e of rb) {
    const cur = byId.get(e.id)
    const hit = cur && Object.entries(e.after).every(([k, v]) =>
      k in cur ? String(cur[k] ?? '') === String(v) : true)
    if (hit) ok++; else { bad++; console.log(`  !! 불일치: ${e.building_name}`) }
  }
  console.log(`\n[되돌리기 기록 대조] ${rbFile}`)
  console.log(`  기록 ${rb.length}건 중 DB와 일치 ${ok} · 불일치 ${bad}`)
}
