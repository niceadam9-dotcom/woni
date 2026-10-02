// 171(불량 → 매출 3단계 — share_links.kind += round·billing, quotes.approval_signature_path) 스테이징·운영 적용.
// 비파괴·멱등: CHECK DROP IF EXISTS + ADD · ADD COLUMN IF NOT EXISTS · CREATE INDEX IF NOT EXISTS. 기존 행 수 불변 확인.
// 실행: node scripts/_apply-171-both.mjs [--apply] [--only=staging|prod]   (기본은 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const REFS = Object.fromEntries(Object.entries({ staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }).filter(([k]) => !ONLY || k === ONLY))
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '171_share_round_billing_signature.sql'), 'utf8')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  })
  const body = await r.text(); let json = null; try { json = JSON.parse(body) } catch { /* */ }
  return { ok: r.ok, status: r.status, body, json }
}
const n = res => (res.json && res.json[0] && typeof res.json[0].n === 'number') ? res.json[0].n : `?(${res.status} ${res.body.slice(0, 120)})`

// 판정 질의는 ASCII만
const KIND6 = `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='share_links_kind_check' AND pg_get_constraintdef(oid) LIKE '%round%' AND pg_get_constraintdef(oid) LIKE '%billing%'`
const INSP = `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='share_links_report_has_insp' AND pg_get_constraintdef(oid) LIKE '%billing%'`
const SIGCOL = `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='quotes' AND column_name='approval_signature_path'`
const IDX = `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='idx_share_links_customer'`
const LINKS_N = `SELECT count(*)::int AS n FROM share_links`
const QUOTES_N = `SELECT count(*)::int AS n FROM quotes`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { kind6: n(await q(ref, KIND6)), insp: n(await q(ref, INSP)), sig: n(await q(ref, SIGCOL)), links: n(await q(ref, LINKS_N)), quotes: n(await q(ref, QUOTES_N)) }
  console.log('before:', JSON.stringify(before))
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }
  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
  console.log('✅ SQL 적용 응답 OK')
  const after = { kind6: n(await q(ref, KIND6)), insp: n(await q(ref, INSP)), sig: n(await q(ref, SIGCOL)), idx: n(await q(ref, IDX)), links: n(await q(ref, LINKS_N)), quotes: n(await q(ref, QUOTES_N)) }
  console.log('after: ', JSON.stringify(after))
  const checks = { kind6: after.kind6 === 1, inspRule: after.insp === 1, sigCol: after.sig === 1, idx: after.idx === 1, linksSame: after.links === before.links, quotesSame: after.quotes === before.quotes }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
