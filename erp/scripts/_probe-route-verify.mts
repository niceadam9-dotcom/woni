/**
 * 경로도 축척 정합 수치 검증 (소방계획서_11 §9-5) — npx tsx scripts/_probe-route-verify.mts
 *
 * 실제 경로로 renderRouteMapPng와 동일한 center/zoom을 잡은 뒤,
 * 같은 배경 지도를 **NCP 네이티브 마커**를 얹어 다시 받아 핀 끝 픽셀을 검출하고
 * static-map-compose가 쓰는 toPx 계산과 비교한다. 오차가 한 자릿수 px면 정합.
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })
import sharp from 'sharp'

const { fetchDrivingRoute } = await import('@/lib/ncp-directions')
const { fitZoom } = await import('@/lib/static-map-compose')

const W = 800, H = 600, SCALE = 2, LEVEL_OFFSET = 1
type LngLat = [number, number]

function project([lng, lat]: LngLat, zoom: number): [number, number] {
  const worldSize = 256 * 2 ** zoom
  const x = ((lng + 180) / 360) * worldSize
  const s = Math.sin((lat * Math.PI) / 180)
  return [x, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize]
}

const headers = {
  'x-ncp-apigw-api-key-id': process.env.NCP_MAPS_CLIENT_ID ?? '',
  'x-ncp-apigw-api-key': process.env.NCP_MAPS_CLIENT_SECRET ?? '',
}

/** 네이버 마커 초록 rgb(9,218,116)의 최하단 = 핀 끝. 좌하단 NAVER 로고는 제외 */
async function findPinTip(buf: Buffer): Promise<[number, number] | null> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let maxY = -1
  const xs: number[] = []
  for (let y = 0; y < info.height - 80; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
      if (r < 60 && g > 190 && b > 85 && b < 155 && g - r > 130 && g - b > 70) {
        if (y > maxY) { maxY = y; xs.length = 0 }
        if (y === maxY) xs.push(x)
      }
    }
  }
  return maxY < 0 ? null : [xs.reduce((a, b) => a + b, 0) / xs.length, maxY]
}

const CASES: Array<{ label: string; start: LngLat; goal: LngLat }> = [
  { label: 'short 3.6km', start: [127.507393, 37.500348], goal: [127.4874, 37.4917] },
  { label: 'long 9.4km', start: [127.507393, 37.500348], goal: [127.5946, 37.4826] },
]

let worst = 0
for (const c of CASES) {
  const r = await fetchDrivingRoute(c.start, c.goal)
  if (!r.route) { console.log(`[${c.label}] 경로 실패`); continue }
  const path = r.route.path
  const zoom = fitZoom(path)
  const cLng = (Math.min(...path.map(p => p[0])) + Math.max(...path.map(p => p[0]))) / 2
  const cLat = (Math.min(...path.map(p => p[1])) + Math.max(...path.map(p => p[1]))) / 2
  const [xc, yc] = project([cLng, cLat], zoom)
  const iw = W * SCALE, ih = H * SCALE
  const toPx = (p: LngLat): [number, number] => {
    const [x, y] = project(p, zoom)
    return [(x - xc) * SCALE + iw / 2, (y - yc) * SCALE + ih / 2]
  }

  console.log(`\n[${c.label}] zoom=${zoom} → 요청 level=${zoom - LEVEL_OFFSET}`)
  for (const [name, p] of [['start', path[0]], ['goal', path[path.length - 1]]] as Array<[string, LngLat]>) {
    const u = `https://maps.apigw.ntruss.com/map-static/v2/raster?center=${cLng},${cLat}`
      + `&level=${zoom - LEVEL_OFFSET}&w=${W}&h=${H}&scale=${SCALE}`
      + `&markers=${encodeURIComponent(`type:d|size:mid|pos:${p[0]} ${p[1]}`)}`
    const res = await fetch(u, { headers, cache: 'no-store' })
    if (!res.ok) { console.log(`  ${name}: HTTP ${res.status}`); continue }
    const tip = await findPinTip(Buffer.from(await res.arrayBuffer()))
    if (!tip) { console.log(`  ${name}: 마커 검출 실패`); continue }
    const [ex, ey] = toPx(p)
    const err = Math.hypot(tip[0] - ex, tip[1] - ey)
    worst = Math.max(worst, err)
    console.log(`  ${name}: 계산(${ex.toFixed(0)}, ${ey.toFixed(0)}) vs 실측(${tip[0].toFixed(0)}, ${tip[1].toFixed(0)}) → 오차 ${err.toFixed(1)}px`)
  }
}
console.log(`\n최대 오차 ${worst.toFixed(1)}px (이미지 ${W * SCALE}x${H * SCALE})`)
