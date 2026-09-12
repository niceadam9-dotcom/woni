// 161(계획 항목 전건 확정 백필) + 162(enum planned 제거) 스테이징·운영 적용 — 2026-09-12.
//
// ⚠ 순서 불변: 161 → 162. planned 행이 남은 채 162의 USING 캐스팅이 돌면 invalid input으로 죽는다
//   (162 서두에 같은 백필을 안전망으로 한 번 더 두긴 했다 — 멱등).
// 판정은 적용 응답이 아니라 **되읽기**로 한다(160 규약):
//   · enum 값 3종(confirmed/completed/cancelled)·planned 부재
//   · planned 행 0 (status::text 비교 — enum에서 빠진 뒤에도 안전한 형태)
//   · 컬럼 DEFAULT 'confirmed'
//   · (사전) 이 컬럼을 무는 뷰 유무 — 있으면 ALTER TYPE이 막히므로 적용 전에 알아야 한다
//
// 실행: node scripts/_apply-161-162-both.mjs [--apply]   (기본 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const REFS = { staging: 'nwflnzugwylhpdyodyog', prod: 'ryuozdhnilfjlahorizh' }
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql161 = readFileSync(join(dir, '161_plan_items_born_confirmed.sql'), 'utf8')
const sql162 = readFileSync(join(dir, '162_drop_planned_status.sql'), 'utf8')

const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.text()
  let json = null
  try { json = JSON.parse(body) } catch { /* 비-JSON */ }
  return { ok: r.ok, status: r.status, body, json }
}

// 판정 질의는 ASCII만 (160 규약 — 한글 질의가 조용히 0건을 돌려준 전례)
const ENUM_VALS = `SELECT array_agg(enumlabel ORDER BY enumsortorder)::text AS v
                     FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'plan_item_status'`
const PLANNED_N = `SELECT count(*)::int AS n FROM inspection_plan_items WHERE status::text = 'planned'`
const NULLDATE_CONFIRMED = `SELECT count(*)::int AS n FROM inspection_plan_items
                             WHERE status::text = 'confirmed' AND scheduled_date IS NULL`
const COL_DEFAULT = `SELECT column_default AS v FROM information_schema.columns
                      WHERE table_name = 'inspection_plan_items' AND column_name = 'status'`
const DEP_VIEWS = `SELECT count(*)::int AS n FROM information_schema.view_column_usage
                    WHERE table_name = 'inspection_plan_items' AND column_name = 'status'`
const LEGACY_MARKER = `SELECT count(*)::int AS n FROM inspection_plan_items
                        WHERE status::text = 'cancelled' AND notes LIKE '%planned%'`

const n = res => (res.json && res.json[0] && typeof res.json[0].n === 'number') ? res.json[0].n : `?(${res.status} ${res.body.slice(0, 120)})`
const v = res => (res.json && res.json[0] && res.json[0].v != null) ? String(res.json[0].v) : `?(${res.status} ${res.body.slice(0, 120)})`

let fail = 0
for (const [name, ref] of Object.entries(REFS)) {
  console.log(`\n===== ${name} (${ref}) =====`)
  const [vals0, planned0, nulldate0, def0, deps, marker0] = await Promise.all([
    q(ref, ENUM_VALS), q(ref, PLANNED_N), q(ref, NULLDATE_CONFIRMED), q(ref, COL_DEFAULT), q(ref, DEP_VIEWS), q(ref, LEGACY_MARKER),
  ])
  console.log(`  [전] enum=${v(vals0)}  planned행=${n(planned0)}  확정-무날짜=${n(nulldate0)}  DEFAULT=${v(def0)}`)
  console.log(`       status를 무는 뷰=${n(deps)} (0이어야 ALTER TYPE 가능)  레거시 planned 마커=${n(marker0)}`)
  if (n(deps) !== 0) { fail++; console.log('  ❌ 의존 뷰 존재 — 적용 전 뷰 처리 필요'); continue }

  if (!APPLY) { console.log('  (드라이런 — --apply 를 줘야 적용한다)'); continue }

  const a161 = await q(ref, sql161)
  console.log(`  161 적용: ${a161.status} ${a161.ok ? 'OK' : a161.body.slice(0, 300)}`)
  if (!a161.ok) { fail++; continue }
  const a162 = await q(ref, sql162)
  console.log(`  162 적용: ${a162.status} ${a162.ok ? 'OK' : a162.body.slice(0, 300)}`)
  if (!a162.ok) { fail++; continue }

  const [vals1, planned1, def1, nulldate1] = await Promise.all([
    q(ref, ENUM_VALS), q(ref, PLANNED_N), q(ref, COL_DEFAULT), q(ref, NULLDATE_CONFIRMED),
  ])
  console.log(`  [후] enum=${v(vals1)}  planned행=${n(planned1)}  DEFAULT=${v(def1)}  확정-무날짜=${n(nulldate1)}`)
  const okEnum = v(vals1) === '{confirmed,completed,cancelled}'
  const okDef = v(def1).includes("'confirmed'")
  if (!okEnum || n(planned1) !== 0 || !okDef) { fail++; console.log('  ❌ 검증 실패') }
  else console.log('  ✅ 적용·검증 통과 (planned 소멸 · DEFAULT confirmed)')
}
console.log(fail === 0 ? (APPLY ? '\n전건 적용·검증 통과' : '\n드라이런 완료') : `\n실패 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
