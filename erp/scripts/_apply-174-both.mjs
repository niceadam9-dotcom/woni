// 174(company_profile.seal_path + 비공개 버킷 company-assets) 스테이징·운영 적용 (통합 실행계획 C5 마무리, 2026-10-03)
//
// 비파괴·멱등: ADD COLUMN IF NOT EXISTS · 버킷 INSERT ON CONFLICT DO NOTHING. 데이터 변경 없음.
// 적용 뒤 확인: 열 1 · 버킷 public=false · storage.objects에 company-assets 정책 0(서버만 읽기 — 사용자 결정)
//   · PostgREST 스키마 캐시를 새로 읽혀 seal_path가 REST로 보이는지(173 첫 실행이 캐시로 실패한 전례).
//
// 실행: node scripts/_apply-174-both.mjs [--apply] [--only=staging|prod]   (기본 드라이런)
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
const sql = readFileSync(join(root, 'supabase', 'migrations', '174_company_seal.sql'), 'utf8')

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
  (SELECT count(*)::int FROM information_schema.columns WHERE table_name='company_profile' AND column_name='seal_path') AS col,
  (SELECT count(*)::int FROM storage.buckets WHERE id='company-assets') AS bucket,
  (SELECT bool_or(public) FROM storage.buckets WHERE id='company-assets') AS is_public,
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='storage' AND (qual ILIKE '%company-assets%' OR with_check ILIKE '%company-assets%')) AS policies`

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
  const { error: restErr } = await db.from('company_profile').select('seal_path').limit(1)
  const checks = {
    col: after?.col === 1, bucket: after?.bucket === 1, private: after?.is_public === false,
    noPolicy: after?.policies === 0, restSeesColumn: !restErr,
  }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}${k === 'restSeesColumn' && restErr ? ` — ${restErr.message}` : ''}`); if (!v) fail++ }
}
console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 전건 통과')
process.exit(fail ? 1 : 0)
