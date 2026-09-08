/** 건축물대장 일괄 백필 — 활성 건물의 **빈 칸만** 대장 값으로 채운다(수기 값 미덮어씀).
 *
 *  왜 필요한가: 앱의 autoApplyLedgerEmptyAction은 고객당 **첫 활성 건물 1동**만(.limit(1)) 다루고,
 *  그나마 소방계획서 탭에 들어가야 발동한다. 그래서 "대장은 허가일을 주는데 DB는 공란"인 건물이 남는다.
 *  이 스크립트는 같은 규칙(LEDGER_FIELDS·empty-only·동일값 제외)을 **전 활성 건물**에 적용한다.
 *
 *  실행: node scripts/_backfill-ledger-empty.mjs [.env파일] [--apply]
 *        --apply 없으면 드라이런(쓰기 없음).
 *  되돌리기: --apply 시 _backfill-rollback-<ts>.json에 변경 전 값을 남긴다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const envFile = args.find(a => !a.startsWith('--')) ?? '.env.local'
const env = {}
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const key = env.BUILDING_LEDGER_API_KEY
if (!key) { console.log('BUILDING_LEDGER_API_KEY 없음 — 중단'); process.exit(1) }

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// 앱 단일 원천 복제 — fire-plan-info-actions.ts:271 LEDGER_FIELDS
const LEDGER_FIELDS = [
  ['permit_date', '건축허가일'], ['building_area', '건축면적(㎡)'], ['building_count', '건물동수'],
  ['parking_summary', '주차장'], ['main_structure', '구조'], ['roof_structure', '지붕'],
  ['height', '높이(m)'], ['elevator_count', '승용승강기(대)'], ['emergency_elevator_count', '비상용승강기(대)'],
  ['households', '세대수'], ['ho_count', '호수'], ['attached_building_count', '부속건축물(동)'],
  ['seismic_design', '내진설계'],
]

const day8 = v => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null)
const num = v => { const n = parseFloat(String(v ?? '')); return isNaN(n) || n === 0 ? null : n }
const isEmpty = v => v == null || v === ''

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** customers/actions.ts:1785 fetchBuildingLedgerAction과 동일 경로.
 *  + 5xx 재시도: 연속 호출 시 공공데이터포털이 간헐적으로 503을 준다. 재시도가 없으면
 *  값을 주는 건물이 조용히 누락돼 백필이 '성공한 척' 덜 채운다(드라이런에서 4동 실측). */
async function fetchLedger(bcode, jibun) {
  const m = String(jibun).trim().match(/(\d+)(?:-(\d+))?$/)
  if (!m) return { error: '번지 추출 불가' }
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo')
  url.searchParams.set('serviceKey', key)
  url.searchParams.set('sigunguCd', String(bcode).slice(0, 5))
  url.searchParams.set('bjdongCd', String(bcode).slice(5))
  url.searchParams.set('bun', m[1].padStart(4, '0'))
  url.searchParams.set('ji', (m[2] ?? '0').padStart(4, '0'))
  url.searchParams.set('numOfRows', '10'); url.searchParams.set('_type', 'json')

  let res
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url.toString(), { cache: 'no-store' })
    } catch (e) {
      if (attempt >= 4) return { error: `fetch 실패: ${e.message}` }
      await sleep(attempt * 1500); continue
    }
    if (res.ok) break
    if (res.status < 500 || attempt >= 4) return { error: `HTTP ${res.status}` }
    await sleep(attempt * 1500)
  }
  const json = await res.json()
  if (json.response?.header?.resultCode !== '00') return { error: json.response?.header?.resultMsg ?? '응답 오류' }
  const raw = json.response?.body?.items?.item
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  if (list.length === 0) return { error: '해당 지번 대장 없음' }
  const it = list.reduce((a, b) => (num(a.totArea) ?? 0) >= (num(b.totArea) ?? 0) ? a : b)
  const parking = [['옥내 기계식', num(it.indrMechUtcnt)], ['옥외 기계식', num(it.oudrMechUtcnt)],
    ['옥내 자주식', num(it.indrAutoUtcnt)], ['옥외 자주식', num(it.oudrAutoUtcnt)]]
    .filter(([, n]) => n != null && n > 0).map(([l, n]) => `${l} ${n}대`).join(' · ')
  return { info: {
    permit_date: day8(String(it.pmsDay ?? '')), building_area: num(it.archArea), building_count: list.length,
    parking_summary: parking || null, main_structure: it.strctCdNm || null, roof_structure: it.roofCdNm || null,
    height: num(it.heit), elevator_count: num(it.rideUseElvtCnt), emergency_elevator_count: num(it.emgenUseElvtCnt),
    households: num(it.hhldCnt), ho_count: num(it.hoCnt), attached_building_count: num(it.atchBldCnt),
    seismic_design: it.rserthqkDsgnApplyYn || null,
  } }
}

const cols = ['id', 'building_name', 'bcode', 'address_jibun', 'is_active', 'ledger_synced_at',
  ...LEDGER_FIELDS.map(([k]) => k)]
const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('buildings').select(cols.join(',')).range(from, from + 999)
  if (error) throw new Error(error.message)
  rows.push(...data); if (data.length < 1000) break
}
const targets = rows.filter(r => r.is_active !== false
  && r.bcode && String(r.bcode).length === 10
  && r.address_jibun && /(\d+)(-\d+)?$/.test(String(r.address_jibun).trim()))

console.log(`env=${envFile}  모드=${APPLY ? '**적용(쓰기)**' : '드라이런(쓰기 없음)'}`)
console.log(`전체 ${rows.length}동 · 활성+조회가능 ${targets.length}동\n`)

const perField = {}, rollback = []
let changedRows = 0, noChange = 0, failed = 0

for (const r of targets) {
  await sleep(400)   // 공공데이터포털 연속 호출 완화
  const res = await fetchLedger(r.bcode, r.address_jibun)
  if (res.error) { console.log(`  ✗ ${r.building_name} — ${res.error}`); failed++; continue }
  const L = res.info
  const patch = {}, before = {}
  for (const [k, label] of LEDGER_FIELDS) {
    if (L[k] == null) continue                       // 대장에 값 없음
    if (!isEmpty(r[k])) continue                     // 빈 칸만 — 수기·기존 값 보존
    const next = String(L[k])
    if (String(r[k] ?? '') === next) continue        // 동일값 제외
    patch[k] = next; before[k] = r[k] ?? null
    perField[label] = (perField[label] ?? 0) + 1
  }
  const n = Object.keys(patch).length
  if (n === 0) { noChange++; continue }
  changedRows++
  const desc = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')
  console.log(`  ${APPLY ? '✓' : '·'} ${r.building_name} — ${n}칸: ${desc}`)
  if (APPLY) {
    const { error } = await db.from('buildings')
      .update({ ...patch, ledger_synced_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { console.log(`     !! 쓰기 실패: ${error.message}`); failed++; changedRows--; continue }
    rollback.push({ id: r.id, building_name: r.building_name, before, after: patch,
      ledger_synced_at_before: r.ledger_synced_at ?? null })
  }
}

console.log(`\n=== ${APPLY ? '적용' : '드라이런'} 결과 ===`)
console.log(`  변경${APPLY ? '됨' : ' 예정'} 건물 : ${changedRows}동`)
console.log(`  채울 것 없음   : ${noChange}동`)
console.log(`  조회 실패      : ${failed}동`)
console.log(`  필드별:`)
for (const [label, n] of Object.entries(perField).sort((a, b) => b[1] - a[1])) console.log(`    ${label} ${n}`)

if (APPLY && rollback.length > 0) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const f = new URL(`../_backfill-rollback-${ts}.json`, import.meta.url)
  writeFileSync(f, JSON.stringify(rollback, null, 2), 'utf8')
  console.log(`\n되돌리기 기록: ${f.pathname.replace(/^\//, '')}`)
}
if (!APPLY) console.log(`\n>>> 실제 적용하려면 --apply 를 붙여 재실행`)
