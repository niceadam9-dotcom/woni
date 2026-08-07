/**
 * 관할 소방서 본서 주소·좌표 시드 (소방계획서_11.md §9-2 — 마이그레이션 114 동반)
 *
 *   node scripts/seed-fire-station-coords.mjs            # .env.local (스테이징)
 *   node scripts/seed-fire-station-coords.mjs --prod     # .env.production (운영)
 *
 * 하는 일: ① region_fire_stations.station_address 채움 ② NCP Geocoding으로 좌표 1회 확정.
 * 소방서는 이전이 드물어 정적 데이터로 둔다 — 런타임에서 매번 지오코딩하지 않는다.
 *
 * ⚠ 여기 담는 것은 **소방서 본서** 주소다. 119안전센터가 아니다.
 *    (소방계획서_11 §9-7 ① 결정: 경로 출발지 = 관할 소방서 본서)
 * 주소 출처는 각 소방서 공식 홈페이지(경기도소방재난본부 119.gg.go.kr / 강원소방본부 fire.gwd.go.kr),
 * 2026-08-07 확인. 소방서가 이전하면 이 표만 고치고 --refresh로 다시 실행하면 된다.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

const prod = process.argv.includes('--prod')
const refresh = process.argv.includes('--refresh')   // 이미 좌표가 있어도 다시 지오코딩
config({ path: resolve(process.cwd(), prod ? '.env.production' : '.env.local') })

/** 소방서명 → 본서 도로명주소 (출처: 각 소방서 공식 홈페이지 '찾아오시는 길', 2026-08-07 확인) */
const STATION_ADDRESSES = {
  '양평소방서':   '경기도 양평군 양평읍 경강로 2047',
  '하남소방서':   '경기도 하남시 대청로 76',
  '남양주소방서': '경기도 남양주시 평내로 25',
  '분당소방서':   '경기도 성남시 분당구 양현로 14',
  '용인소방서':   '경기도 용인시 처인구 명지로 45',
  '이천소방서':   '경기도 이천시 경충대로 2739',
  '안성소방서':   '경기도 안성시 미양로 855',
  '광주소방서':   '경기도 광주시 초월읍 무들로 112',
  '여주소방서':   '경기도 여주시 우암로 110',
  '홍천소방서':   '강원특별자치도 홍천군 홍천읍 공작산로 99',
  '동해소방서':   '강원특별자치도 동해시 천곡로 120',
}

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
  if (!res.ok) { console.warn(`  지오코딩 HTTP ${res.status}`); return null }
  const body = await res.json()
  const a = body.addresses?.[0]
  if (!a) return null
  const lng = Number(a.x); const lat = Number(a.y)
  // 한반도 범위 가드 — 좌표가 뒤집히거나 엉뚱한 값이면 저장하지 않는다
  if (!(lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39)) {
    console.warn(`  범위 밖 좌표 무시: ${lng},${lat}`)
    return null
  }
  return { lat, lng }
}

const { data: rows, error } = await admin.from('region_fire_stations')
  .select('region, fire_station, station_address, station_lat, station_lng')
if (error) { console.error('조회 실패:', error.message); process.exit(1) }

const stations = [...new Set(rows.map(r => r.fire_station))]
console.log(`대상: ${stations.length}개 소방서 (${rows.length}개 지역 행) — ${prod ? '운영' : '스테이징'}`)

let addr = 0; let geo = 0; let miss = 0
for (const name of stations) {
  const address = STATION_ADDRESSES[name]
  if (!address) { console.warn(`⚠ 주소 미등록: ${name} — STATION_ADDRESSES에 추가 필요`); miss += 1; continue }
  const cur = rows.find(r => r.fire_station === name)
  const patch = {}
  if (cur.station_address !== address) { patch.station_address = address; addr += 1 }
  if (refresh || cur.station_lat == null || cur.station_lng == null) {
    const c = await geocode(address)
    if (c) { patch.station_lat = c.lat; patch.station_lng = c.lng; geo += 1 }
    else console.warn(`⚠ 좌표 실패: ${name} (${address})`)
  }
  if (Object.keys(patch).length === 0) continue
  const { error: upErr } = await admin.from('region_fire_stations')
    .update(patch).eq('fire_station', name)
  if (upErr) console.error(`✗ ${name}: ${upErr.message}`)
  else console.log(`✓ ${name} — ${address}${patch.station_lat ? ` (${patch.station_lat}, ${patch.station_lng})` : ''}`)
}

console.log(`\n완료: 주소 ${addr}건 · 좌표 ${geo}건${miss ? ` · 주소 미등록 ${miss}건` : ''}`)
if (!clientId) console.log('※ NCP_MAPS_* 미설정 — 주소만 채웠습니다. 키 설정 후 다시 실행하면 좌표가 채워집니다.')
