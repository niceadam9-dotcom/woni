// 181(주된 점검인력 = 회사 대표자 — 트리거 + 백필) 스테이징·운영 적용 (2026-10-06)
//
// 적용 뒤 확인: 대표자 id 해석·트리거 존재·'주된' 없는 점검 0·보조 행 수 무변화·
//   **새 점검에 트리거가 실제로 '주된'을 넣는가**(스테이징만, 트랜잭션 안에서 넣고 되돌린다).
//
// 실행: node scripts/_apply-181-both.mjs [--apply] [--only=staging|prod]   (기본 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const TARGETS = Object.entries({
  staging: { ref: 'nwflnzugwylhpdyodyog', env: '.env.local' },
  prod: { ref: 'ryuozdhnilfjlahorizh', env: '.env.production' },
}).filter(([k]) => !ONLY || k === ONLY)
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(root, 'supabase', 'migrations', '181_main_inspector_representative.sql'), 'utf8')

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

// 대표자 해석은 함수가 생기기 전에도 같은 식으로 잰다(드라이런에서 누가 들어갈지 미리 보인다)
const STATE = `WITH rep AS (SELECT btrim(representative) AS name FROM company_profile WHERE coalesce(btrim(representative),'')<>'' ORDER BY id LIMIT 1),
cand AS (SELECT p.id, p.name FROM profiles p, rep WHERE btrim(p.name)=rep.name AND p.is_active IS TRUE AND coalesce(p.is_system,false)=false)
SELECT (SELECT name FROM rep) AS rep_name,
  (SELECT count(*)::int FROM cand) AS rep_matches,
  (SELECT count(*)::int FROM pg_trigger WHERE tgname='inspection_main_inspector') AS trg,
  (SELECT count(*)::int FROM inspections) AS insp,
  (SELECT count(*)::int FROM inspections i WHERE NOT EXISTS (SELECT 1 FROM inspection_participants ip WHERE ip.inspection_id=i.id AND ip.role='주된')) AS no_main,
  (SELECT count(*)::int FROM inspection_participants WHERE role='주된') AS main_rows,
  (SELECT count(*)::int FROM inspection_participants WHERE role='보조') AS assist_rows,
  (SELECT count(*)::int FROM inspection_participants ip JOIN cand ON cand.id=ip.employee_id WHERE ip.role='보조') AS rep_as_assist`

let fail = 0
for (const [name, { ref, env: envFile }] of TARGETS) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const env = envOf(envFile)
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(ref)) { fail++; console.log(`❌ ${envFile}가 ${ref}를 가리키지 않는다 — 중단`); continue }
  const b = await q(ref, STATE)
  if (!b.ok) { fail++; console.log(`❌ 상태 조회 실패 ${b.status}: ${b.body.slice(0, 300)}`); continue }
  const before = b.json?.[0]
  console.log('before:', JSON.stringify(before))
  if (before?.rep_matches !== 1) { fail++; console.log('❌ 대표자와 같은 이름의 활성 직원이 정확히 1명이 아니다 — 중단'); continue }
  if (!APPLY) { console.log(`(dry-run — 백필 예정 ${before.no_main - before.rep_as_assist}~${before.no_main}행 · --apply 를 주면 적용)`); continue }

  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ DDL 실패 ${r.status}: ${r.body.slice(0, 300)}`); continue }
  await q(ref, `NOTIFY pgrst, 'reload schema'`)
  await new Promise(res => setTimeout(res, 2000))
  const after = (await q(ref, STATE)).json?.[0]
  console.log('after: ', JSON.stringify(after))
  const checks = {
    trigger: after?.trg === 1,
    // 남는 '주된' 없음 = 대표자가 이미 보조로 든 점검뿐이어야 한다
    noMainLeft: after?.no_main <= before.rep_as_assist,
    assistUnchanged: after?.assist_rows === before.assist_rows,
    mainAdded: after?.main_rows === before.main_rows + (before.no_main - after.no_main),
  }

  // 트리거가 새 점검에 실제로 넣는가 — 스테이징에서만, 넣고 예외로 되돌린다(행을 남기지 않는다)
  if (name === 'staging') {
    const probe = await q(ref, `DO $$
DECLARE eid uuid; iid uuid := gen_random_uuid(); n int; cols text; src jsonb;
BEGIN
  -- 담당은 대표자가 **아닌** 직원으로 — 「담당과 무관하게 대표자가 주된」을 재는 것이다
  SELECT id INTO eid FROM profiles WHERE is_active AND id <> representative_profile_id() ORDER BY name LIMIT 1;
  -- 필수 칸을 추측하지 않는다: 기존 점검 한 건을 복사해 id·담당만 바꾼다(생성 칼럼은 뺀다)
  SELECT string_agg(quote_ident(column_name), ',') INTO cols FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inspections' AND is_generated='NEVER';
  -- 고객은 점검이 하나도 없는 고객으로 — (고객·연도·회차) 유니크에 걸리지 않는다
  SELECT to_jsonb(i) || jsonb_build_object('id', iid, 'assigned_employee_id', eid,
      'customer_id', (SELECT c.id FROM customers c WHERE NOT EXISTS (SELECT 1 FROM inspections x WHERE x.customer_id=c.id) LIMIT 1)) INTO src
    FROM inspections i ORDER BY created_at DESC LIMIT 1;
  EXECUTE format('INSERT INTO inspections (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::inspections, $1)', cols) USING src;
  SELECT count(*) INTO n FROM inspection_participants WHERE inspection_id=iid AND role='주된' AND employee_id=representative_profile_id();
  RAISE EXCEPTION 'PROBE_RESULT=%', n;
END $$`)
    const m = probe.body.match(/PROBE_RESULT=(\d+)/)
    checks.triggerInsertsOnNew = m?.[1] === '1'
    if (!m) console.log('probe body:', probe.body.slice(0, 300))
  }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
