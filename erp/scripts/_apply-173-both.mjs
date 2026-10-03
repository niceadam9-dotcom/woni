// 173(company_profile.address_jibun) 스테이징·운영 적용 + 회사 주소 교정 (통합 실행계획 C5 2차, 2026-10-02)
//
// 비파괴·멱등: ADD COLUMN IF NOT EXISTS. 새 열이라 백필 없음.
// 데이터 교정(사용자 결정 2026-10-02 — 「템플릿이 맞다」): 회사 주소 「…잿말길 50-1」 → 「…잿말길10번길 50-1」,
//   지번 주소 「경기도 양평군 양평읍 덕평리 98-1」 기록. 두 DB 모두 company_profile 1행(2026-10-02 정리 뒤).
// ⚠ 한글 값은 관리 API SQL이 아니라 **supabase-js REST**로 쓴다 — 한글이 든 SQL이 에러 없이 0건을 돌려준 전례.
//   쓴 뒤 다시 읽어 글자 단위로 대조한다.
//
// 실행: node scripts/_apply-173-both.mjs [--apply] [--only=staging|prod]   (기본 드라이런)
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
const sql = readFileSync(join(root, 'supabase', 'migrations', '173_company_address_jibun.sql'), 'utf8')

const ROAD = '경기도 양평군 양평읍 잿말길10번길 50-1'
const JIBUN = '경기도 양평군 양평읍 덕평리 98-1'

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

const COL = `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='company_profile' AND column_name='address_jibun'`
const ROWS = `SELECT count(*)::int AS n FROM company_profile`

let fail = 0
for (const [name, { ref, env: envFile }] of TARGETS) {
  console.log(`\n=== ${name} (${ref.slice(0, 6)}…) ===`)
  const env = envOf(envFile)
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(ref)) { fail++; console.log(`❌ ${envFile}가 ${ref}를 가리키지 않는다 — 중단`); continue }
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const col = (await q(ref, COL)).json?.[0]?.n, rows = (await q(ref, ROWS)).json?.[0]?.n
  const { data: cur } = await db.from('company_profile').select('id, address').order('id').limit(2)
  console.log(`before: address_jibun 열 ${col} · 행 ${rows} · 주소 ${JSON.stringify(cur?.[0]?.address)}`)
  if (rows !== 1) { fail++; console.log('❌ company_profile이 1행이 아니다 — 중단(정리 먼저)'); continue }
  if (!APPLY) { console.log('(dry-run — --apply 를 주면 적용)'); continue }

  const r = await q(ref, sql)
  if (!r.ok) { fail++; console.log(`❌ DDL 실패 ${r.status}: ${r.body.slice(0, 300)}`); continue }
  // 새 열은 PostgREST 스키마 캐시가 갱신돼야 REST로 쓸 수 있다(2026-10-03 첫 실행이 PGRST204로 실패)
  await q(ref, `NOTIFY pgrst, 'reload schema'`)
  await new Promise(res => setTimeout(res, 3000))
  const { error } = await db.from('company_profile').update({ address: ROAD, address_jibun: JIBUN }).eq('id', cur[0].id)
  if (error) { fail++; console.log(`❌ 주소 교정 실패: ${error.message}`); continue }
  const { data: after } = await db.from('company_profile').select('address, address_jibun').eq('id', cur[0].id).single()
  const okCol = (await q(ref, COL)).json?.[0]?.n === 1
  const okRoad = after?.address === ROAD, okJibun = after?.address_jibun === JIBUN
  for (const [k, v] of Object.entries({ okCol, okRoad, okJibun })) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fail++ }
}
console.log(fail ? `\n❌ 실패 ${fail}건` : '\n✅ 전건 통과')
process.exit(fail ? 1 : 0)
