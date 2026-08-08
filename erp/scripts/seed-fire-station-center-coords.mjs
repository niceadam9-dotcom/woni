/**
 * 119안전센터 주소·좌표 시드 (소방계획서_13 A-4-4 — 마이그레이션 118 동반)
 *
 *   node scripts/seed-fire-station-center-coords.mjs --csv <경로>          # 주소 적재 + 지오코딩
 *   node scripts/seed-fire-station-center-coords.mjs                        # 이미 적재된 주소만 지오코딩
 *   node scripts/seed-fire-station-center-coords.mjs --prod                 # 운영
 *   node scripts/seed-fire-station-center-coords.mjs --refresh              # 좌표가 있어도 다시 지오코딩
 *   node scripts/seed-fire-station-center-coords.mjs --csv <경로> --dry     # 매칭 결과만 출력
 *
 * 하는 일: ① fire_station_centers.center_address 채움 ② NCP Geocoding으로 좌표 1회 확정.
 * 본서(seed-fire-station-coords.mjs)와 같은 규약이다 — 정적 데이터, 런타임 재지오코딩 없음.
 *
 * ⚠ 주소를 스크립트에 하드코딩하지 않는다. 안전센터는 전국 1,300+곳이라 손으로 옮기면 오타가
 *    섞이고, 065·116의 '확신 없는 값은 심지 않는다' 원칙에 어긋난다. 그래서 **권위 있는 원본
 *    CSV를 입력으로 받는다**:
 *      공공데이터포털 「소방청_119안전센터 현황」 https://www.data.go.kr/data/15065056/fileData.do
 *    다운로드한 CSV 경로를 --csv 로 넘기면 센터명으로 매칭해 주소만 채운다.
 *    (117에 시드된 센터만 갱신한다 — CSV의 나머지 전국 데이터는 넣지 않는다.)
 *
 * ⚠ NCP Geocode는 **주소 전용**이다 — '용문119안전센터' 같은 POI명으로 지오코딩하면 안 된다.
 * 좌표가 없는 센터는 런타임이 소속 본서로 폴백하고 화면에 그 사실을 표기한다(기능 정지 아님).
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const argv = process.argv
const prod = argv.includes('--prod')
const dry = argv.includes('--dry')
const refresh = argv.includes('--refresh')
const csvPath = argv[argv.indexOf('--csv') + 1] && argv.includes('--csv') ? argv[argv.indexOf('--csv') + 1] : null
config({ path: resolve(process.cwd(), prod ? '.env.production' : '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const clientId = process.env.NCP_MAPS_CLIENT_ID
const clientSecret = process.env.NCP_MAPS_CLIENT_SECRET
if (!url || !key) { console.error('Supabase 환경변수가 없습니다.'); process.exit(1) }
const admin = createClient(url, key, { auth: { persistSession: false } })

async function geocode(address) {
  if (!clientId || !clientSecret) return null
  const u = new URL('https://maps.apigw.ntruss.com/map-geocode/v2/geocode')
  u.searchParams.set('query', address)
  const res = await fetch(u, {
    headers: { 'x-ncp-apigw-api-key-id': clientId, 'x-ncp-apigw-api-key': clientSecret },
  })
  if (!res.ok) return null
  const json = await res.json()
  const a = json?.addresses?.[0]
  return a ? [Number(a.x), Number(a.y)] : null
}

/** 따옴표·쉼표를 포함한 셀을 다루는 최소 CSV 파서 (원본이 큰따옴표로 감싸는 필드를 쓴다) */
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false }
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(v => v.trim()))
}

// ── 1) 대상 = 117에 시드된 센터 ──
const { data: centersRaw, error: cErr } = await admin.from('fire_station_centers')
  .select('region_sido, region_si, center, station, center_address, center_lat, center_lng')
if (cErr) { console.error('✗ fire_station_centers 조회:', cErr.message); process.exit(1) }
const centers = centersRaw ?? []
console.log(`대상 ${centers.length}곳 (${prod ? '운영' : '스테이징'})${dry ? ' — dry run' : ''}`)
if (centers.length === 0) { console.log('시드된 센터가 없습니다 — seed-fire-station-centers.mjs 를 먼저 실행하세요.'); process.exit(0) }

// ── 2) CSV가 주어지면 주소 채우기 ──
if (csvPath) {
  const rows = parseCsv(readFileSync(resolve(process.cwd(), csvPath), 'utf8'))
  const header = rows[0].map(h => h.trim())
  // 컬럼명이 배포 회차마다 조금씩 달라 이름으로 찾는다(안전센터명/주소 계열)
  const nameIdx = header.findIndex(h => /센터|안전센터|기관명/.test(h))
  const addrIdx = header.findIndex(h => /주소|소재지/.test(h))
  if (nameIdx < 0 || addrIdx < 0) {
    console.error(`✗ CSV에서 센터명·주소 컬럼을 찾지 못했습니다 — 헤더: ${header.join(' | ')}`)
    process.exit(1)
  }
  console.log(`CSV 컬럼 — 센터명: '${header[nameIdx]}' · 주소: '${header[addrIdx]}'`)

  const addrByName = new Map()
  for (const r of rows.slice(1)) {
    const n = (r[nameIdx] ?? '').trim()
    const a = (r[addrIdx] ?? '').trim()
    if (n && a && !addrByName.has(n)) addrByName.set(n, a)
  }

  let filled = 0, missed = []
  for (const c of centers) {
    const addr = addrByName.get(c.center)
    if (!addr) { missed.push(`${c.region_si} ${c.center}`); continue }
    if (c.center_address === addr) continue
    console.log(`  ${c.center} → ${addr}`)
    filled++
    if (dry) continue
    const { error } = await admin.from('fire_station_centers')
      .update({ center_address: addr, center_lat: null, center_lng: null })  // 주소가 바뀌면 좌표 무효
      .eq('region_sido', c.region_sido).eq('region_si', c.region_si).eq('center', c.center)
    if (error) { console.error(`  ✗ ${c.center}: ${error.message}`); process.exit(1) }
    c.center_address = addr
    c.center_lat = null; c.center_lng = null
  }
  console.log(`주소 반영 ${filled}곳 · CSV 미발견 ${missed.length}곳`)
  // 미발견은 오류가 아니다 — 그 센터는 런타임이 본서로 폴백한다. 다만 눈에 보이게 남긴다.
  for (const m of missed) console.log(`  · 미발견: ${m}`)
}

if (dry) { console.log('\ndry run — 저장하지 않았습니다.'); process.exit(0) }

// ── 3) 지오코딩 ──
if (!clientId || !clientSecret) {
  console.log('\nNCP_MAPS 자격증명이 없어 지오코딩을 건너뜁니다 — 주소만 반영됐습니다.')
  process.exit(0)
}
let ok = 0, skip = 0, fail = []
for (const c of centers) {
  if (!c.center_address) { skip++; continue }
  if (!refresh && c.center_lat != null && c.center_lng != null) { skip++; continue }
  const coords = await geocode(c.center_address)
  if (!coords) { fail.push(`${c.center} (${c.center_address})`); continue }
  const { error } = await admin.from('fire_station_centers')
    .update({ center_lat: coords[1], center_lng: coords[0] })
    .eq('region_sido', c.region_sido).eq('region_si', c.region_si).eq('center', c.center)
  if (error) { console.error(`✗ ${c.center} 저장: ${error.message}`); process.exit(1) }
  ok++
  console.log(`  ✓ ${c.center} → ${coords[1]}, ${coords[0]}`)
}
console.log(`\n지오코딩 완료 ${ok}곳 · 건너뜀 ${skip}곳(주소 없음/이미 확정) · 실패 ${fail.length}곳`)
for (const f of fail) console.log(`  ✗ ${f}`)
