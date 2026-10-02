// 170(불량 → 매출 2단계 — share_links·share_link_events 표 + notifications.type에 quote_approved) 스테이징·운영 적용.
// 비파괴·멱등: CREATE TABLE/INDEX IF NOT EXISTS · CHECK는 DROP IF EXISTS + ADD(158 목록 + 1).
// 확인: 두 표 존재·RLS 켜짐·정책 0 · type CHECK에 quote_approved 포함 + 기존 21종 유지 · notifications 행 수 불변.
// 실행: node scripts/_apply-170-both.mjs [--apply] [--only=staging|prod]   (기본은 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
const REFS = Object.fromEntries(Object.entries({ staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }).filter(([k]) => !ONLY || k === ONLY))
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql = readFileSync(join(dir, '170_share_links.sql'), 'utf8')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  })
  const body = await r.text(); let json = null; try { json = JSON.parse(body) } catch { /* */ }
  return { ok: r.ok, status: r.status, body, json }
}
const n = res => (res.json && res.json[0] && typeof res.json[0].n === 'number') ? res.json[0].n : `?(${res.status} ${res.body.slice(0, 120)})`

// 판정 질의는 ASCII만
const TABLES = `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename IN ('share_links','share_link_events')`
const RLS = `SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('share_links','share_link_events') AND relrowsecurity`
const POLICIES = `SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('share_links','share_link_events')`
const HAS_TYPE = `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%quote_approved%'`
const KEEP_TYPES = `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='notifications_type_check'
  AND pg_get_constraintdef(oid) LIKE '%manager_edu_overdue%' AND pg_get_constraintdef(oid) LIKE '%law_revision%' AND pg_get_constraintdef(oid) LIKE '%approval_request%'`
const NOTIF_N = `SELECT count(*)::int AS n FROM notifications`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const before = { tables: n(await q(ref, TABLES)), hasType: n(await q(ref, HAS_TYPE)), keep: n(await q(ref, KEEP_TYPES)), notif: n(await q(ref, NOTIF_N)) }
  console.log('before:', JSON.stringify(before))
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }
  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ 적용 실패 ${r.status}: ${r.body.slice(0, 400)}`); continue }
  console.log('✅ SQL 적용 응답 OK')
  const after = { tables: n(await q(ref, TABLES)), rls: n(await q(ref, RLS)), policies: n(await q(ref, POLICIES)), hasType: n(await q(ref, HAS_TYPE)), keep: n(await q(ref, KEEP_TYPES)), notif: n(await q(ref, NOTIF_N)) }
  console.log('after: ', JSON.stringify(after))
  const checks = { tables2: after.tables === 2, rls2: after.rls === 2, policies0: after.policies === 0, quoteApproved: after.hasType === 1, keptTypes: after.keep === 1, notifRowsSame: after.notif === before.notif }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fail++ }
}
console.log(`\nFAIL=${fail}`)
process.exit(fail ? 1 : 0)
