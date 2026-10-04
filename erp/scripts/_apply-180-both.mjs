// 180(inspection_defects.client_key — 불량 등록 멱등 키) 스테이징·운영 적용 (C1 Phase E, 2026-10-04)
//
// 비파괴: NULL 허용 열 하나 + 부분 유니크 인덱스. 백필 없음 — 기존 행·웹 등록은 NULL(제약 밖).
// 적용 뒤 확인: 열 존재·인덱스 존재·기존 행 수 무변화·REST로 보임·**유니크가 실제로 막는가**(스테이징만).
//
// 실행: node scripts/_apply-180-both.mjs [--apply] [--only=staging|prod]   (기본 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const TARGETS = Object.entries({
  staging: { ref: 'nwflnzugwylhpdyodyog', env: '.env.local' },
  prod: { ref: 'ryuozdhnilfjlahorizh', env: '.env.production' },
}).filter(([k]) => !ONLY || k === ONLY)
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(root, 'supabase', 'migrations', '180_defect_client_key.sql'), 'utf8')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.text()
  let json = null; try { json = JSON.parse(body) } catch { /* */ }
  return { ok: r.ok, status: r.status, body, json }
}
const envOf = file => Object.fromEntries(readFileSync(join(root, file), 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const STATE = `SELECT
  (SELECT count(*)::int FROM information_schema.columns WHERE table_name='inspection_defects' AND column_name='client_key') AS col,
  (SELECT count(*)::int FROM pg_indexes WHERE indexname='uq_inspection_defects_client_key') AS idx,
  (SELECT count(*)::int FROM inspection_defects) AS rows`

let fail = 0
for (const [name, { ref, env: envFile }] of TARGETS) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const env = envOf(envFile)
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(ref)) { fail++; console.log(`❌ ${envFile}가 ${ref}를 가리키지 않는다 — 중단`); continue }
  const before = (await q(ref, STATE)).json?.[0]
  console.log('before:', JSON.stringify(before))
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }

  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ DDL 실패 ${r.status}: ${r.body.slice(0, 300)}`); continue }
  await q(ref, `NOTIFY pgrst, 'reload schema'`)
  await new Promise(res => setTimeout(res, 3000))
  const after = (await q(ref, STATE)).json?.[0]
  console.log('after: ', JSON.stringify(after))
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { error: restErr } = await db.from('inspection_defects').select('client_key').limit(1)
  const checks = { col: after?.col === 1, idx: after?.idx === 1, rowsUnchanged: after?.rows === before.rows, restSeesColumn: !restErr }

  // 유니크가 실제로 막는가 — 스테이징에서만, 트랜잭션 안에서 넣고 되돌린다(행을 남기지 않는다)
  if (name === 'staging') {
    const probe = await q(ref, `DO $$
DECLARE iid uuid; ok boolean := false;
BEGIN
  SELECT inspection_id INTO iid FROM inspection_defects LIMIT 1;
  IF iid IS NULL THEN RAISE EXCEPTION 'NO_DEFECT_ROW'; END IF;
  INSERT INTO inspection_defects (inspection_id, defect_name, severity, client_key) VALUES (iid, '__probe180', '경미', '__probe180');
  BEGIN
    INSERT INTO inspection_defects (inspection_id, defect_name, severity, client_key) VALUES (iid, '__probe180', '경미', '__probe180');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'UNIQUE_DID_NOT_BLOCK'; END IF;
  RAISE EXCEPTION 'PROBE_OK_ROLLBACK';
END $$;`)
    const blocked = probe.body.includes('PROBE_OK_ROLLBACK')
    checks.uniqueBlocksDuplicate = blocked
    if (!blocked) console.log('   probe:', probe.body.slice(0, 300))
    const left = (await q(ref, `SELECT count(*)::int AS n FROM inspection_defects WHERE client_key='__probe180'`)).json?.[0]?.n
    checks.probeLeftNothing = left === 0
  }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}${!v && k === 'restSeesColumn' && restErr ? ` — ${restErr.message}` : ''}`); if (!v) fail++ }
}
console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 전건 통과')
process.exit(fail ? 1 : 0)
