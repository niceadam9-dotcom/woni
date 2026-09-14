// 163(업무대행 여부·등급) **운영** 적용 — 2026-09-14.
//
// 스테이징은 오늘 13:2x에 적용했고, 그 뒤 파일이 바뀌지 않았음을 mtime으로 확인한 뒤 운영에 올린다.
// 🚨 멱등이라(`ADD COLUMN IF NOT EXISTS` + `UPDATE ... WHERE IS NULL`) **두 번째 실행은 조용히
//   안 먹는다** — 백필 방침이 나중에 바뀌어도 재적용으로는 못 고친다. 그래서 적용 전에 파일이
//   확정됐는지 확인하는 것이 이 작업의 핵심이었다.
//
// 왜 지금 적용하나: DDL은 코드보다 **먼저** 가야 한다. 지금 운영 코드는 이 컬럼을 읽지 않으므로
//   적용해도 무해하고, 반대로 적용하지 않은 채 그 코드가 배포되면 PostgREST가 42703으로 조회
//   전체를 거절해 소방계획서가 엑셀·PDF 양쪽 다 죽는다(오늘 dev에서 실제로 그랬다).
//
// 판정은 적용 응답이 아니라 **되읽기**로 한다(160·161 규약). 판정 질의는 ASCII만.
//
// 실행: node scripts/_apply-163-prod.mjs [--apply]   (기본 드라이런)
import { readFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--apply')
const REF = 'ryuozdhnilfjlahorizh' // prod
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
// 백필이 옮겨 심을 대상 — 적용 전에 **얼마나 움직이는지** 알고 시작한다
const SRC = `SELECT coalesce(building_grade,'(null)') AS g, count(*)::int AS n
               FROM customers GROUP BY 1 ORDER BY 1`
// ⚠ 적용 **전**에는 agency_applies가 없다 — 총수는 컬럼에 기대지 않는 질의로 센다
//   (처음엔 DIST로 세려다 42703을 맞았다: 없는 컬럼을 미리 묻는 실수)
const TOTAL = `SELECT count(*)::int AS total FROM customers`

const one = (res, k) => (res.json && res.json[0] && res.json[0][k] != null) ? res.json[0][k] : `?(${res.status} ${res.body.slice(0, 140)})`

console.log(`prod (${REF})  ${APPLY ? '=== APPLY ===' : '(드라이런)'}`)
const [c0, d0, dist0, src0] = await Promise.all([q(COLS), q(DEFAULT_V), q(TOTAL), q(SRC)])
console.log(`  [전] 컬럼 = ${one(c0, 'v') || '(없음)'}`)
console.log(`       DEFAULT(agency_applies) = ${one(d0, 'v')}`)
console.log(`       고객 총수 = ${one(dist0, 'total')}`)
console.log(`       building_grade 분포(등급 백필 원천): ${(src0.json ?? []).map(r => `${r.g}=${r.n}`).join(' ')}`)

if (!APPLY) {
  console.log('\n  적용하면:')
  console.log(`   · agency_applies 컬럼 2개 추가 · DEFAULT TRUE`)
  console.log(`   · 전 고객 ${one(dist0, 'total')}명을 agency_applies=TRUE로 백필(종전 동작 보존 — 화면이 전 고객에게 「해당」을 찍고 있었다)`)
  console.log(`   · 1·2·3급 고객의 building_grade를 agency_grade로 옮겨 심음(특급은 대상 아님 — 옮기지 않는다)`)
  console.log('  드라이런 종료 — 적용하려면 --apply')
  process.exit(0)
}

const a = await q(sql163)
console.log(`  163 적용: ${a.status} ${a.ok ? 'OK' : a.body.slice(0, 400)}`)
if (!a.ok) process.exit(1)

const [c1, d1, dist1, grade1] = await Promise.all([q(COLS), q(DEFAULT_V), q(DIST), q(GRADE)])
console.log(`  [후] 컬럼 = ${one(c1, 'v')}`)
console.log(`       DEFAULT(agency_applies) = ${one(d1, 'v')}`)
console.log(`       분포: TRUE=${one(dist1, 't')} FALSE=${one(dist1, 'f')} NULL=${one(dist1, 'nul')} / 전체=${one(dist1, 'total')}`)
console.log(`       agency_grade: ${(grade1.json ?? []).map(r => `${r.g}=${r.n}`).join(' ')}`)

const colsOk = String(one(c1, 'v')).includes('agency_applies') && String(one(c1, 'v')).includes('agency_grade')
const defOk = String(one(d1, 'v')).toLowerCase().includes('true')
const nullOk = one(dist1, 'nul') === 0
const totalOk = one(dist1, 'total') === one(dist0, 'total')   // 백필이 행을 만들거나 지우지 않았다
const ok = colsOk && defOk && nullOk && totalOk
console.log(ok ? '  ✅ 적용·검증 통과 (컬럼 2개 · DEFAULT TRUE · 미백필 0건 · 행수 불변)'
               : `  ❌ 검증 실패 (컬럼=${colsOk} DEFAULT=${defOk} 미백필0=${nullOk} 행수불변=${totalOk})`)
process.exit(ok ? 0 : 1)
