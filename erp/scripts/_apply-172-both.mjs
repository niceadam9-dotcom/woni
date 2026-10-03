// 172(설비 자산 대장 — equipment_assets·equipment_asset_events + inspection_defects.asset_id) 스테이징·운영 적용.
// 비파괴·멱등: CREATE TABLE/INDEX IF NOT EXISTS · ADD COLUMN IF NOT EXISTS. ⚠ CREATE POLICY·CREATE TRIGGER는 IF NOT EXISTS가
// 없어 두 번째 실행이 「이미 있음」으로 실패한다 — before에 표가 있으면 SQL을 보내지 않고 검사만 한다.
// 확인: 표 2·RLS 2·SELECT 정책 2·트리거 1·asset_id 열·불량 행 수 불변.
// 실행: node scripts/_apply-172-both.mjs [--apply] [--only=staging|prod]
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const REFS = Object.fromEntries(Object.entries({ staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }).filter(([k]) => !ONLY || k === ONLY))
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '172_equipment_assets.sql'), 'utf8')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  })
  const body = await r.text(); let json = null; try { json = JSON.parse(body) } catch { /* */ }
  return { ok: r.ok, status: r.status, body, json }
}
const n = res => (res.json && res.json[0] && typeof res.json[0].n === 'number') ? res.json[0].n : `?(${res.status} ${res.body.slice(0, 120)})`

// 판정 질의는 ASCII만
const TABLES = `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename IN ('equipment_assets','equipment_asset_events')`
const RLS = `SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('equipment_assets','equipment_asset_events') AND relrowsecurity`
const POL = `SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('equipment_assets','equipment_asset_events') AND cmd='SELECT'`
const TRG = `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_equipment_assets_updated_at'`
const COL = `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='inspection_defects' AND column_name='asset_id'`
const DEF_N = `SELECT count(*)::int AS n FROM inspection_defects`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { tables: n(await q(ref, TABLES)), col: n(await q(ref, COL)), defects: n(await q(ref, DEF_N)) }
  console.log('before:', JSON.stringify(before))
  if (!APPLY) { console.log('(dry-run)'); continue }
  if (before.tables === 2) console.log('이미 적용됨 — SQL 생략, 검사만')
  else {
    const r = await q(ref, sql)
    if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
    console.log('✅ SQL 적용 응답 OK')
  }
  const after = { tables: n(await q(ref, TABLES)), rls: n(await q(ref, RLS)), pol: n(await q(ref, POL)), trg: n(await q(ref, TRG)), col: n(await q(ref, COL)), defects: n(await q(ref, DEF_N)) }
  console.log('after: ', JSON.stringify(after))
  const checks = { tables2: after.tables === 2, rls2: after.rls === 2, selectPolicies2: after.pol === 2, trigger1: after.trg === 1, assetIdCol: after.col === 1, defectsSame: after.defects === before.defects }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
