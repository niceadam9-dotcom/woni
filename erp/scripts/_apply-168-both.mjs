// 168(cron_runs — 크론 실행 기록, A3 관측) 스테이징·운영 적용.
//
// 비파괴·멱등: CREATE TABLE IF NOT EXISTS · CREATE INDEX IF NOT EXISTS · DROP POLICY IF EXISTS + CREATE.
// 기존 표는 하나도 건드리지 않는다 — 새 표 1·인덱스 2·RLS 1정책뿐이라 백필도 없다.
// 적용 후 withCronRun(src/lib/cron-run.ts)이 발화마다 기록하고, 미적용 상태에서도 라우트는 돈다(best-effort).
//
// 실행: node scripts/_apply-168-both.mjs [--apply] [--only=staging|prod]   (기본은 드라이런: 사전 상태만 읽는다)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const REFS = Object.fromEntries(Object.entries({ staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }).filter(([k]) => !ONLY || k === ONLY))
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '168_cron_runs.sql'), 'utf8')

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

// 판정 질의는 ASCII만 — 한글이 든 질의는 에러 없이 0건을 돌려준 전례가 있다.
const TABLE = `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename='cron_runs'`
const COLS = `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='cron_runs'
  AND column_name IN ('id','job','started_at','finished_at','ok','status','duration_ms','error','result','company_id')`
const EXPECT_COLS = 10
const IDX = `SELECT count(*)::int AS n FROM pg_indexes WHERE tablename='cron_runs'
  AND indexname IN ('idx_cron_runs_job_started','idx_cron_runs_started')`
const RLS = `SELECT count(*)::int AS n FROM pg_tables WHERE tablename='cron_runs' AND rowsecurity`
const POLICY = `SELECT count(*)::int AS n FROM pg_policies WHERE tablename='cron_runs' AND policyname='cron_runs_select_authenticated' AND cmd='SELECT'`
const WRITE_POLICY = `SELECT count(*)::int AS n FROM pg_policies WHERE tablename='cron_runs' AND cmd <> 'SELECT'`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { table: n(await q(ref, TABLE)), cols: n(await q(ref, COLS)), idx: n(await q(ref, IDX)) }
  console.log('before:', JSON.stringify(before), `(기대: table 0→1, cols 0→${EXPECT_COLS}, idx 0→2)`)
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }

  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
  console.log('✅ SQL 적용 응답 OK')

  const after = { table: n(await q(ref, TABLE)), cols: n(await q(ref, COLS)), idx: n(await q(ref, IDX)),
    rls: n(await q(ref, RLS)), policy: n(await q(ref, POLICY)), writePolicy: n(await q(ref, WRITE_POLICY)) }
  console.log('after: ', JSON.stringify(after))
  for (const [k, v] of Object.entries({
    okTable: after.table === 1, okCols: after.cols === EXPECT_COLS, okIdx: after.idx === 2,
    okRls: after.rls === 1, okPolicy: after.policy === 1,
    okNoWritePolicy: after.writePolicy === 0, // 쓰기 정책 0 = 서비스 롤만 쓴다
  })) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fail++ }
}
console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 전건 통과')
process.exit(fail ? 1 : 0)
