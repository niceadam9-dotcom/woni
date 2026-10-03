// 177(equipment_assets.specs JSONB — 펌프 명판 등 품목 제원, C3 4단계) 스테이징·운영 적용.
// 비파괴·멱등: ADD COLUMN IF NOT EXISTS + 기본값 '{}'. 적용 뒤 PostgREST 스키마 캐시를 다시 읽힌다(173의 PGRST204 교훈).
// 확인: 열 1·NOT NULL·기본값 '{}' · 대장 행 수 불변 · 기존 행 specs 전부 '{}'.
// 실행: node scripts/_apply-177-both.mjs [--apply] [--only=staging|prod]
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const REFS = Object.fromEntries(Object.entries({ staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }).filter(([k]) => !ONLY || k === ONLY))
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '177_equipment_specs.sql'), 'utf8')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  })
  const body = await r.text(); let json = null; try { json = JSON.parse(body) } catch { /* */ }
  return { ok: r.ok, status: r.status, body, json }
}
const n = res => (res.json && res.json[0] && typeof res.json[0].n === 'number') ? res.json[0].n : `?(${res.status} ${res.body.slice(0, 120)})`

// 판정 질의는 ASCII만
const COL = `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='equipment_assets' AND column_name='specs' AND is_nullable='NO' AND column_default LIKE '''{}''%'`
const ROWS = `SELECT count(*)::int AS n FROM equipment_assets`
const NONEMPTY = `SELECT count(*)::int AS n FROM equipment_assets WHERE specs <> '{}'::jsonb`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { col: n(await q(ref, COL)), rows: n(await q(ref, ROWS)) }
  console.log('before:', JSON.stringify(before))
  if (!APPLY) { console.log('(dry-run)'); continue }
  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
  console.log('✅ SQL 적용 응답 OK')
  const rl = await q(ref, `NOTIFY pgrst, 'reload schema'`)
  console.log(rl.ok ? '✅ PostgREST 스키마 다시 읽기' : `⚠ NOTIFY 실패 ${rl.status}`)
  const after = { col: n(await q(ref, COL)), rows: n(await q(ref, ROWS)), nonEmpty: n(await q(ref, NONEMPTY)) }
  console.log('after: ', JSON.stringify(after))
  const checks = { specsCol: after.col === 1, rowsSame: after.rows === before.rows, allEmpty: after.nonEmpty === 0 }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
