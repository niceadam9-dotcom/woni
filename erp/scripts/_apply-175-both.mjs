// 175(소민터 등록 명칭·소재지 — customers 2열) 스테이징·운영 적용.
//
// 비파괴·멱등: ADD COLUMN IF NOT EXISTS, 백필 없음.
// 판정: ① 열 2칸 ② customers 행 수 불변 ③ 고객명·주소 지문 불변(새 열이 기존 값을 건드리지 않음)
//       ④ PostgREST 스키마 캐시 재적재(NOTIFY) — 안 하면 첫 저장이 PGRST204로 거절된다(173 실측)
// 실행: node scripts/_apply-175-both.mjs [--apply] [--only=staging|prod]   (기본은 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const REFS = Object.fromEntries(Object.entries({ staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }).filter(([k]) => !ONLY || k === ONLY))
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '175_customer_somin_name.sql'), 'utf8')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.text()
  let json = null
  try { json = JSON.parse(body) } catch { /* 비-JSON */ }
  return { ok: r.ok, status: r.status, body, json }
}
const v = (res, k = 'n') => (res.json && res.json[0] && res.json[0][k] !== undefined) ? res.json[0][k] : `?(${res.status} ${res.body.slice(0, 120)})`

// 판정 질의는 ASCII만.
const COLS = `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public'
  AND table_name='customers' AND column_name IN ('somin_name','somin_address')`
const CUST_N = `SELECT count(*)::int AS n FROM customers`
const CUST_FP = `SELECT md5(coalesce(string_agg(id::text || ':' || coalesce(customer_name,'') || ':' || coalesce(address,''), ',' ORDER BY id), ''))::text AS n FROM customers`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { cols: v(await q(ref, COLS)), cust: v(await q(ref, CUST_N)), fp: v(await q(ref, CUST_FP)) }
  console.log('before:', JSON.stringify(before), '(cols 기대 2)')
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }

  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
  console.log('✅ SQL 적용 응답 OK')
  const n = await q(ref, `NOTIFY pgrst, 'reload schema'`)
  console.log(n.ok ? '✅ 스키마 캐시 재적재 요청' : `⚠ NOTIFY 실패 ${n.status}`)

  const after = { cols: v(await q(ref, COLS)), cust: v(await q(ref, CUST_N)), fp: v(await q(ref, CUST_FP)) }
  console.log('after: ', JSON.stringify(after))
  const checks = { okCols: after.cols === 2, okRows: after.cust === before.cust, okValuesUnchanged: after.fp === before.fp }
  for (const [k, ok] of Object.entries(checks)) { console.log(`${ok ? '✅' : '❌'} ${k}`); if (!ok) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
