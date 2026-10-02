// 166(불량 → 매출 1단계 — quotes·orders·bills 열 추가, quotes.status에 「승인」) 스테이징·운영 적용.
//
// 비파괴·멱등: ADD COLUMN IF NOT EXISTS · CREATE INDEX IF NOT EXISTS · DROP CONSTRAINT IF EXISTS + ADD.
// ⭐ quotes·orders는 양쪽 0건(2026-10-02 실측)이라 백필이 없다. 그래도 적용 전후 행 수를 찍어 0→0을 확인한다.
//    bills는 스테이징 75·운영 0 — order_id 열이 전부 NULL로 생겨야 한다(월정액 크론 영향 0).
//
// 실행: node scripts/_apply-166-both.mjs [--apply]   (기본은 드라이런: 사전 상태만 읽는다)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const REFS = { staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '166_defect_to_revenue.sql'), 'utf8')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.text()
  let json = null
  try { json = JSON.parse(body) } catch { /* 비-JSON 응답 */ }
  return { ok: r.ok, status: r.status, body, json }
}
const n = res => (res.json && res.json[0] && typeof res.json[0].n === 'number') ? res.json[0].n : `?(${res.status} ${res.body.slice(0, 120)})`

// 판정 질의는 **ASCII만** — 한글이 든 질의는 에러 없이 0건을 돌려준 전례가 있다.
const COLS = `SELECT count(*)::int AS n FROM information_schema.columns WHERE
  (table_name='quotes' AND column_name IN ('inspection_id','source','approved_at','approved_by_name','approval_channel','pdf_path'))
  OR (table_name='orders' AND column_name IN ('inspection_id','contract_file_path','contractor_name','contractor_biz_no','contractor_rep','contractor_phone','contractor_address','completed_at','tax_amount'))
  OR (table_name='bills' AND column_name='order_id')`
const EXPECT_COLS = 6 + 9 + 1
// 「승인」을 CHECK가 받는가 — 제약 정의문에 한글을 넣지 않고 유니코드 이스케이프로 비교
const STATUS_CHECK = `SELECT count(*)::int AS n FROM pg_constraint
  WHERE conname='quotes_status_check' AND pg_get_constraintdef(oid) LIKE '%' || U&'\\C2B9\\C778' || '%'`
const IDX = `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname IN ('idx_quotes_inspection','idx_orders_inspection','idx_bills_order')`
const QUOTES_N = `SELECT count(*)::int AS n FROM quotes`
const ORDERS_N = `SELECT count(*)::int AS n FROM orders`
const BILLS_N = `SELECT count(*)::int AS n FROM bills`
const BILLS_ORDER_NULL = `SELECT count(*)::int AS n FROM bills WHERE order_id IS NOT NULL`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { cols: n(await q(ref, COLS)), check: n(await q(ref, STATUS_CHECK)), idx: n(await q(ref, IDX)),
    quotes: n(await q(ref, QUOTES_N)), orders: n(await q(ref, ORDERS_N)), bills: n(await q(ref, BILLS_N)) }
  console.log('before:', JSON.stringify(before), `(cols 기대 ${EXPECT_COLS}, check 1, idx 3)`)
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }

  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
  console.log('✅ SQL 적용 응답 OK')

  const after = { cols: n(await q(ref, COLS)), check: n(await q(ref, STATUS_CHECK)), idx: n(await q(ref, IDX)),
    quotes: n(await q(ref, QUOTES_N)), orders: n(await q(ref, ORDERS_N)), bills: n(await q(ref, BILLS_N)), billsOrderNotNull: n(await q(ref, BILLS_ORDER_NULL)) }
  console.log('after: ', JSON.stringify(after))
  const okCols = after.cols === EXPECT_COLS, okCheck = after.check === 1, okIdx = after.idx === 3
  const okRows = after.quotes === before.quotes && after.orders === before.orders && after.bills === before.bills && after.billsOrderNotNull === 0
  for (const [k, v] of Object.entries({ okCols, okCheck, okIdx, okRows })) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
