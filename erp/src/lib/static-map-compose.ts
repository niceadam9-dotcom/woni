import sharp from 'sharp'
import { hasMapsCredentials, mapsHeaders, type LngLat } from '@/lib/ncp-directions'

/** 경로선이 그려진 지도 이미지 합성 — 소방계획서_11.md §9-5 (B-3)
 *
 *  NCP Static Map v2는 `markers`만 지원하고 **경로선(polyline) 파라미터가 없다.**
 *  그래서 ① 배경 지도를 받아 ② 경로 좌표를 Web Mercator로 픽셀 변환하고
 *  ③ SVG 오버레이를 만들어 ④ sharp로 합성한다.
 *
 *  ⚠ 축척 규약 — 실측으로 확정(2026-08-07, `scripts/_probe-route-verify.mts`로 재현 가능):
 *     **Static Map의 `level=L`은 Web Mercator zoom L+1로 렌더된다.**
 *     NCP가 직접 찍은 마커의 픽셀과 project()를 비교해 level 12·13·15 × scale 1·2에서
 *     zoom=L+1이 오차 ~2px, zoom=L은 ~100px로 어긋남을 확인했다.
 *     그래서 픽셀 계산은 zoom으로 하고 **요청은 level = zoom - 1**로 보낸다.
 *     (`scale`은 해상도만 올릴 뿐 담기는 범위는 그대로 — 그래서 SCALE은 곱하기만 하면 된다.)
 */

const W = 800
const H = 600
const SCALE = 2          // 2배 해상도 — 실제 이미지는 1600×1200
const PAD = 60           // 경로가 가장자리에 붙지 않도록 여백(스케일 전 픽셀)
const LEVEL_OFFSET = 1   // 요청 level = Web Mercator zoom - 1 (위 축척 규약)

function project([lng, lat]: LngLat, zoom: number): [number, number] {
  const worldSize = 256 * 2 ** zoom
  const x = ((lng + 180) / 360) * worldSize
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
  return [x, y]
}

/** 경로 전체가 화면에 들어오는 가장 큰(가장 확대된) **Web Mercator zoom** — 요청 level이 아니다.
 *  export는 축척 정합 검증 프로브(`scripts/_probe-route-verify.mts`)가 같은 값을 쓰기 위함이다. */
export function fitZoom(path: LngLat[]): number {
  const lngs = path.map(p => p[0])
  const lats = path.map(p => p[1])
  const bbox: [LngLat, LngLat] = [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
  for (let z = 18; z >= 6; z -= 1) {
    const [x1, y1] = project(bbox[0], z)
    const [x2, y2] = project(bbox[1], z)
    if (Math.abs(x2 - x1) <= W - PAD * 2 && Math.abs(y2 - y1) <= H - PAD * 2) return z
  }
  return 6
}

const esc = (s: string) => s.replace(/[<>&"']/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] ?? c))

export async function renderRouteMapPng(input: {
  path: LngLat[]
  startLabel: string       // 관할 소방서명
  goalLabel: string        // 고객·건물명
  caption: string          // 예: '2.4km · 6분 (일반 차량 기준)'
}): Promise<{ png?: Buffer; unavailable?: boolean; error?: string }> {
  const { path } = input
  if (!hasMapsCredentials()) return { unavailable: true }
  if (path.length < 2) return { error: '경로 좌표가 부족해 경로도를 만들 수 없습니다.' }

  const zoom = fitZoom(path)
  const cLng = (Math.min(...path.map(p => p[0])) + Math.max(...path.map(p => p[0]))) / 2
  const cLat = (Math.min(...path.map(p => p[1])) + Math.max(...path.map(p => p[1]))) / 2
  const [xc, yc] = project([cLng, cLat], zoom)

  // 배경 지도 — 기존 generateLocationMapAction과 같은 규약(w/h/scale)
  let bg: Buffer
  try {
    const mapUrl = new URL('https://maps.apigw.ntruss.com/map-static/v2/raster')
    mapUrl.searchParams.set('center', `${cLng},${cLat}`)
    mapUrl.searchParams.set('level', String(zoom - LEVEL_OFFSET))
    mapUrl.searchParams.set('w', String(W))
    mapUrl.searchParams.set('h', String(H))
    mapUrl.searchParams.set('scale', String(SCALE))
    const res = await fetch(mapUrl.toString(), { headers: mapsHeaders(), cache: 'no-store' })
    if (res.status === 401 || res.status === 403) return { unavailable: true }
    if (!res.ok) return { error: `배경 지도 생성에 실패했습니다 (HTTP ${res.status})` }
    bg = Buffer.from(await res.arrayBuffer())
  } catch {
    return { error: '지도 API 호출에 실패했습니다.' }
  }

  const iw = W * SCALE
  const ih = H * SCALE
  const toPx = (p: LngLat): [number, number] => {
    const [x, y] = project(p, zoom)
    return [(x - xc) * SCALE + iw / 2, (y - yc) * SCALE + ih / 2]
  }
  const pts = path.map(toPx)
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [sx, sy] = pts[0]
  const [gx, gy] = pts[pts.length - 1]

  // 흰 테두리 + 적색 경로선(테두리를 먼저 굵게 깔아 어떤 지도 색 위에서도 보이게)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${iw}" height="${ih}">
  <polyline points="${poly}" fill="none" stroke="#ffffff" stroke-width="14" stroke-linejoin="round" stroke-linecap="round"/>
  <polyline points="${poly}" fill="none" stroke="#e03131" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="16" fill="#1971c2" stroke="#ffffff" stroke-width="5"/>
  <circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="16" fill="#e03131" stroke="#ffffff" stroke-width="5"/>
  <g font-family="Malgun Gothic, sans-serif" font-size="30" font-weight="bold">
    <text x="${(sx + 24).toFixed(1)}" y="${(sy + 10).toFixed(1)}" fill="#ffffff" stroke="#ffffff" stroke-width="8">${esc(input.startLabel)}</text>
    <text x="${(sx + 24).toFixed(1)}" y="${(sy + 10).toFixed(1)}" fill="#1971c2">${esc(input.startLabel)}</text>
    <text x="${(gx + 24).toFixed(1)}" y="${(gy + 10).toFixed(1)}" fill="#ffffff" stroke="#ffffff" stroke-width="8">${esc(input.goalLabel)}</text>
    <text x="${(gx + 24).toFixed(1)}" y="${(gy + 10).toFixed(1)}" fill="#e03131">${esc(input.goalLabel)}</text>
  </g>
  <rect x="20" y="${ih - 76}" width="${Math.min(iw - 40, 40 + input.caption.length * 20)}" height="56" rx="10" fill="#ffffff" opacity="0.88"/>
  <text x="40" y="${ih - 38}" font-family="Malgun Gothic, sans-serif" font-size="30" fill="#212529">${esc(input.caption)}</text>
</svg>`

  try {
    const png = await sharp(bg)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png()
      .toBuffer()
    return { png }
  } catch {
    return { error: '경로도 이미지 합성에 실패했습니다.' }
  }
}
