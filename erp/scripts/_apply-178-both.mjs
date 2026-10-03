// 178(equipment_points — 지점 책갈피 QR) 스테이징·운영 적용 (통합 실행계획 C4 — QR 절 3단계, 2026-10-03)
//
// 비파괴: 새 표만 만든다(IF NOT EXISTS). 데이터 변경 없음.
// 적용 뒤 확인: 표·인덱스·RLS(SELECT 정책 1)·updated_at 트리거 · REST로 보임 · 시험 삽입/삭제(자기 정리).
//
// 실행: node scripts/_apply-178-both.mjs [--apply] [--only=staging|prod]   (기본 드라이런)
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
const sql = readFileSync(join(root, 'supabase', 'migrations', '178_equipment_points.sql'), 'utf8')

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
  (to_regclass('public.equipment_points') IS NOT NULL) AS tbl,
  (SELECT count(*)::int FROM pg_policies WHERE tablename='equipment_points') AS policies,
  (SELECT count(*)::int FROM pg_trigger WHERE tgname='trg_equipment_points_updated_at') AS trg`

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
  // 시험 삽입/삭제 — 아무 고객 하나로(없으면 건너뜀). sheet_codes 배열도 함께 검증
  const probe = await q(ref, `WITH c AS (SELECT id FROM customers LIMIT 1),
    ins AS (INSERT INTO equipment_points (customer_id, label, sheet_codes) SELECT id, '_probe', ARRAY['STD-15'] FROM c RETURNING id)
    DELETE FROM equipment_points WHERE id IN (SELECT id FROM ins) RETURNING id`)
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { error: restErr } = await db.from('equipment_points').select('id').limit(1)
  const checks = {
    tbl: after?.tbl === true, selectPolicyOnly: after?.policies === 1, trigger: after?.trg >= 1,
    probeInsertDelete: probe.ok, restSeesTable: !restErr,
  }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}${!v && k === 'probeInsertDelete' ? ` — ${probe.body.slice(0, 200)}` : ''}${!v && k === 'restSeesTable' && restErr ? ` — ${restErr.message}` : ''}`); if (!v) fail++ }
}
console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 전건 통과')
process.exit(fail ? 1 : 0)
