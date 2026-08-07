/**
 * 경로도 합성 눈검사 프로브 (소방계획서_11 §9-5 B-3 — "첫 도입 시 눈으로 1회 확인")
 *   npx tsx scripts/_probe-route-image.mts
 *
 * DB를 건드리지 않고 Directions → Static Map → sharp 합성까지만 태워 PNG를 임시폴더에 떨군다.
 * 확인 대상: 경로선이 실제 도로 위에 얹히는지(Static Map level = Web Mercator zoom 전제).
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
config({ path: resolve(process.cwd(), '.env.local') })

const { fetchDrivingRoute, buildRouteDesc, mainApproachRoad } = await import('@/lib/ncp-directions')
const { renderRouteMapPng } = await import('@/lib/static-map-compose')

const CASES: Array<{ label: string; start: [number, number]; goal: [number, number]; station: string; target: string }> = [
  { label: 'short', start: [127.507393, 37.500348], goal: [127.4874, 37.4917], station: '양평소방서', target: '양평역 부근' },
  { label: 'long', start: [127.507393, 37.500348], goal: [127.5946, 37.4826], station: '양평소방서', target: '용문 부근' },
]

for (const c of CASES) {
  const r = await fetchDrivingRoute(c.start, c.goal)
  if (r.unavailable) { console.log(`[${c.label}] ❌ unavailable`); continue }
  if (r.error || !r.route) { console.log(`[${c.label}] ❌ ${r.error}`); continue }

  const km = (r.route.distanceM / 1000).toFixed(1)
  const min = Math.max(1, Math.round(r.route.durationMs / 60000))
  console.log(`\n[${c.label}] ${km}km · ${min}분 · path ${r.route.path.length}점`)
  console.log(`  mainRoad : ${mainApproachRoad(r.route)}`)
  console.log(`  routeDesc: ${buildRouteDesc(r.route, c.station)}`)

  const img = await renderRouteMapPng({
    path: r.route.path,
    startLabel: c.station,
    goalLabel: c.target,
    caption: `${km}km · ${min}분 (일반 차량 기준)`,
  })
  if (img.error || !img.png) { console.log(`  ❌ 합성 실패: ${img.error ?? 'unavailable'}`); continue }
  const out = resolve(tmpdir(), `probe-route-${c.label}.png`)
  await writeFile(out, img.png)
  console.log(`  → ${out} (${(img.png.length / 1024).toFixed(0)}KB)`)
}
