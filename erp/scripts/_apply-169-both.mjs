// 169(company_profile 업태·종목·세금계산서 이메일 3열) 스테이징·운영 적용. 비파괴·멱등(ADD COLUMN IF NOT EXISTS).
// 판정: 열 3칸 · company_profile 행 수 불변 · 기존 업종(industry) 값 불변.
// 실행: node scripts/_apply-169-both.mjs [--apply] [--only=staging|prod]   (기본 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'
const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const REFS = Object.fromEntries(Object.entries({ staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }).filter(([k]) => !ONLY || k === ONLY))
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '169_company_tax_fields.sql'), 'utf8')
const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
  const body = await r.text(); let json = null; try { json = JSON.parse(body) } catch {}
  return { ok: r.ok, status: r.status, body, json }
}
const v = res => (res.json && res.json[0] && res.json[0].n !== undefined) ? res.json[0].n : `?(${res.status} ${res.body.slice(0, 120)})`
const COLS = `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='company_profile' AND column_name IN ('business_type','business_item','tax_email')`
const ROWS = `SELECT count(*)::int AS n FROM company_profile`
const IND = `SELECT md5(coalesce(string_agg(id::text || ':' || coalesce(industry,''), ',' ORDER BY id), ''))::text AS n FROM company_profile`
let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { cols: v(await q(ref, COLS)), rows: v(await q(ref, ROWS)), ind: v(await q(ref, IND)) }
  console.log('before:', JSON.stringify(before), '(cols 기대 3)')
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }
  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
  const after = { cols: v(await q(ref, COLS)), rows: v(await q(ref, ROWS)), ind: v(await q(ref, IND)) }
  console.log('after: ', JSON.stringify(after))
  const checks = { okCols: after.cols === 3, okRows: after.rows === before.rows, okIndustry: after.ind === before.ind }
  for (const [k, ok] of Object.entries(checks)) { console.log(`${ok ? '✅' : '❌'} ${k}`); if (!ok) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
