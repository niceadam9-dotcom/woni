// 176(equipment_asset_events event_type CHECK에 'scan') 스테이징·운영 적용 (통합 실행계획 C4 2단계 웹, 2026-10-03)
//
// 비파괴: CHECK를 넓히기만 한다(DROP IF EXISTS → ADD). 기존 행은 7종 안이라 재검증 통과. 데이터 변경 없음.
// 적용 뒤 확인: 제약 정의에 'scan' 포함 · 기존 행 수 무변화 · 'scan' 행 시험 삽입/삭제(서비스 롤, 자기 정리).
//
// 실행: node scripts/_apply-176-both.mjs [--apply] [--only=staging|prod]   (기본 드라이런)
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
const sql = readFileSync(join(root, 'supabase', 'migrations', '176_equipment_scan_event.sql'), 'utf8')

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
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='equipment_asset_events_type_check') AS def,
  (SELECT count(*)::int FROM equipment_asset_events) AS rows`

let fail = 0
for (const [name, { ref, env: envFile }] of TARGETS) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const env = envOf(envFile)
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(ref)) { fail++; console.log(`❌ ${envFile}가 ${ref}를 가리키지 않는다 — 중단`); continue }
  const before = (await q(ref, STATE)).json?.[0]
  console.log('before:', JSON.stringify(before))
  if (!before?.def) { fail++; console.log('❌ 제약이 없다(172 미적용?) — 중단'); continue }
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }

  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ DDL 실패 ${r.status}: ${r.body.slice(0, 300)}`); continue }
  const after = (await q(ref, STATE)).json?.[0]
  console.log('after: ', JSON.stringify(after))
  // 시험 삽입 — 아무 개체 하나에 scan 1행을 넣었다가 바로 지운다(개체가 없으면 건너뜀)
  const probe = await q(ref, `WITH a AS (SELECT id FROM equipment_assets LIMIT 1),
    ins AS (INSERT INTO equipment_asset_events (asset_id, event_type, event_date) SELECT id, 'scan', CURRENT_DATE FROM a RETURNING id)
    DELETE FROM equipment_asset_events WHERE id IN (SELECT id FROM ins) RETURNING id`)
  const checks = {
    defHasScan: String(after?.def ?? '').includes("'scan'"),
    rowsUnchanged: after?.rows === before.rows,
    scanInsertAccepted: probe.ok,
  }
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}${k === 'scanInsertAccepted' && !v ? ` — ${probe.body.slice(0, 200)}` : ''}`); if (!v) fail++ }
}
console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 전건 통과')
process.exit(fail ? 1 : 0)
