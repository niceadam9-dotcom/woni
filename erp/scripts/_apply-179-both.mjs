// 179(buildings.tag_code — 건물 QR) 스테이징·운영 적용 (통합 실행계획 C4 — QR 절 4단계, 2026-10-03)
//
// 비파괴: 열 하나(NULL 허용·UNIQUE)만 더한다. 백필 없음 — 코드는 기록표 생성 때 발급된다.
// 적용 뒤 확인: 열 존재·UNIQUE 제약·기존 행 수 무변화·REST로 보임.
//
// 실행: node scripts/_apply-179-both.mjs [--apply] [--only=staging|prod]   (기본 드라이런)
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
const sql = readFileSync(join(root, 'supabase', 'migrations', '179_building_tag.sql'), 'utf8')

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
  (SELECT count(*)::int FROM information_schema.columns WHERE table_name='buildings' AND column_name='tag_code') AS col,
  (SELECT count(*)::int FROM pg_constraint WHERE conname LIKE 'buildings_tag_code%') AS uniq,
  (SELECT count(*)::int FROM buildings) AS rows`

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
  const { error: restErr } = await db.from('buildings').select('tag_code').limit(1)
  const checks = { col: after?.col === 1, uniq: after?.uniq >= 1, rowsUnchanged: after?.rows === before.rows, restSeesColumn: !restErr }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}${!v && k === 'restSeesColumn' && restErr ? ` — ${restErr.message}` : ''}`); if (!v) fail++ }
}
console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 전건 통과')
process.exit(fail ? 1 : 0)
