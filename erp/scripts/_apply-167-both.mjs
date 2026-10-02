// 167(법정 외부 연계 1단계 — inspections 9열·customers 2열 + 배치신고 마커 → placement_reported_at 백필) 스테이징·운영 적용.
//
// 비파괴·멱등: ADD COLUMN IF NOT EXISTS + 마지막 마커 기준 UPDATE(재실행해도 같은 값).
// 판정: ① 열 11칸 ② 백필 건수 = 마커 폴드(마지막이 cert_reported) 건수 ③ inspection_steps.status 지문 불변
//       ④ inspections·customers 행 수 불변.
// 실행: node scripts/_apply-167-both.mjs [--apply] [--only=staging|prod]   (기본은 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const REFS = Object.fromEntries(Object.entries({ staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }).filter(([k]) => !ONLY || k === ONLY))
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '167_legal_link_records.sql'), 'utf8')

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
const COLS = `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND (
  (table_name='inspections' AND column_name IN ('report9_submitted_via','report9_receipt_no','report9_submitted_by','report11_submitted_via','report11_receipt_no','report11_submitted_by','placement_reported_at','placement_result','placement_no'))
  OR (table_name='customers' AND column_name IN ('somin_object_no','kfma_object_no')))`
const EXPECT_COLS = 11
// 마커 폴드 기대 건수 — findArchivedCertInspections의 reported 집합과 같은 규칙(마지막 마커가 cert_reported)
const FOLD = `SELECT count(*)::int AS n FROM (
  SELECT DISTINCT ON (entity_id) entity_id, action FROM activity_logs
   WHERE entity_type='inspection' AND action IN ('cert_reported','cert_reported_undo')
   ORDER BY entity_id, created_at DESC, id DESC) t
  JOIN inspections i ON i.id = t.entity_id::uuid WHERE t.action='cert_reported'`
const BACKFILLED = `SELECT count(*)::int AS n FROM inspections WHERE placement_reported_at IS NOT NULL`
const STEPS_FP = `SELECT md5(coalesce(string_agg(id::text || ':' || status, ',' ORDER BY id), ''))::text AS n FROM inspection_steps`
const INSP_N = `SELECT count(*)::int AS n FROM inspections`
const CUST_N = `SELECT count(*)::int AS n FROM customers`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { cols: v(await q(ref, COLS)), fold: v(await q(ref, FOLD)), steps: v(await q(ref, STEPS_FP)),
    insp: v(await q(ref, INSP_N)), cust: v(await q(ref, CUST_N)) }
  console.log('before:', JSON.stringify(before), `(cols 기대 ${EXPECT_COLS})`)
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }

  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
  console.log('✅ SQL 적용 응답 OK')

  const after = { cols: v(await q(ref, COLS)), fold: v(await q(ref, FOLD)), backfilled: v(await q(ref, BACKFILLED)),
    steps: v(await q(ref, STEPS_FP)), insp: v(await q(ref, INSP_N)), cust: v(await q(ref, CUST_N)) }
  console.log('after: ', JSON.stringify(after))
  const checks = {
    okCols: after.cols === EXPECT_COLS,
    okBackfill: after.backfilled === after.fold,
    okStepsUnchanged: after.steps === before.steps,
    okRows: after.insp === before.insp && after.cust === before.cust,
  }
  for (const [k, ok] of Object.entries(checks)) { console.log(`${ok ? '✅' : '❌'} ${k}`); if (!ok) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
