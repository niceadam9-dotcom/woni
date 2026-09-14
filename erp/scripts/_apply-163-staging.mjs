// 163(업무대행 여부·등급) **스테이징만** 적용 — 2026-09-14.
//
// 왜 스테이징만인가: 163은 아직 untracked이고 멱등이라(`ADD COLUMN IF NOT EXISTS` +
//   `UPDATE ... WHERE IS NULL`), 나중에 백필 방침이 바뀌어도 **두 번째 실행이 조용히 안 먹는다**.
//   운영은 배포본이 이 컬럼을 select하지 않아 오늘 고장이 없으므로 건드리지 않는다(사용자 결정).
//
// 판정은 적용 응답이 아니라 **되읽기**로 한다(160·161 규약). 판정 질의는 ASCII만.
//
// 실행: node scripts/_apply-163-staging.mjs [--apply]   (기본 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const REF = 'nwflnzugwylhpdyodyog' // staging — 운영(ryuoz…)은 의도적으로 제외
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const dir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const sql163 = readFileSync(join(dir, '163_customer_agency.sql'), 'utf8')

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.text()
  let json = null
  try { json = JSON.parse(body) } catch { /* 비-JSON */ }
  return { ok: r.ok, status: r.status, body, json }
}

const COLS = `SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY column_name) AS v
                FROM information_schema.columns
               WHERE table_name = 'customers' AND column_name IN ('agency_applies','agency_grade')`
const DEFAULT_V = `SELECT coalesce(column_default,'(none)') AS v FROM information_schema.columns
                    WHERE table_name = 'customers' AND column_name = 'agency_applies'`
const DIST = `SELECT count(*) FILTER (WHERE agency_applies IS TRUE)::int AS t,
                     count(*) FILTER (WHERE agency_applies IS FALSE)::int AS f,
                     count(*) FILTER (WHERE agency_applies IS NULL)::int AS nul,
                     count(*)::int AS total
                FROM customers`
const GRADE = `SELECT coalesce(agency_grade,'(null)') AS g, count(*)::int AS n
                 FROM customers GROUP BY 1 ORDER BY 1`

const one = (res, k) => (res.json && res.json[0] && res.json[0][k] != null) ? res.json[0][k] : `?(${res.status} ${res.body.slice(0, 140)})`

console.log(`staging (${REF})  ${APPLY ? '=== APPLY ===' : '(dry-run)'}`)

const [c0, d0] = await Promise.all([q(COLS), q(DEFAULT_V)])
console.log(`  [전] 컬럼 = ${one(c0, 'v') || '(없음)'}`)
console.log(`       DEFAULT(agency_applies) = ${one(d0, 'v')}`)

if (!APPLY) {
  console.log('  드라이런 종료 — 적용하려면 --apply')
  process.exit(0)
}

const a = await q(sql163)
console.log(`  163 적용: ${a.status} ${a.ok ? 'OK' : a.body.slice(0, 400)}`)
if (!a.ok) process.exit(1)

const [c1, d1, dist, grade] = await Promise.all([q(COLS), q(DEFAULT_V), q(DIST), q(GRADE)])
console.log(`  [후] 컬럼 = ${one(c1, 'v')}`)
console.log(`       DEFAULT(agency_applies) = ${one(d1, 'v')}`)
console.log(`       분포: TRUE=${one(dist, 't')} FALSE=${one(dist, 'f')} NULL=${one(dist, 'nul')} / 전체=${one(dist, 'total')}`)
console.log(`       agency_grade: ${(grade.json ?? []).map(r => `${r.g}=${r.n}`).join(' ')}`)

const colsOk = String(one(c1, 'v')).includes('agency_applies') && String(one(c1, 'v')).includes('agency_grade')
const defOk = String(one(d1, 'v')).toLowerCase().includes('true')
const nullOk = one(dist, 'nul') === 0
const ok = colsOk && defOk && nullOk
console.log(ok ? '  ✅ 적용·검증 통과 (컬럼 2개 · DEFAULT TRUE · 미백필 0건)'
               : `  ❌ 검증 실패 (컬럼=${colsOk} DEFAULT=${defOk} 미백필0=${nullOk})`)
process.exit(ok ? 0 : 1)
