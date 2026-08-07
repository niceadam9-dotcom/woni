/**
 * NCP Directions 5 활성화 프로브 (소방계획서_11 §14-4)
 *   node scripts/_probe-directions.mjs
 *
 * 403 = 콘솔에서 Directions 5 미활성 / 200 + code:0 = 사용 가능.
 * 경로: 양평소방서 → 양평역 부근(실좌표).
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

const id = process.env.NCP_MAPS_CLIENT_ID
const secret = process.env.NCP_MAPS_CLIENT_SECRET
if (!id || !secret) { console.error('NCP_MAPS_* 환경변수가 없습니다.'); process.exit(1) }

const u = new URL('https://maps.apigw.ntruss.com/map-direction/v1/driving')
u.searchParams.set('start', '127.507393,37.500348')   // 양평소방서(시드 좌표)
u.searchParams.set('goal', '127.4874,37.4917')
u.searchParams.set('option', 'trafast')

const res = await fetch(u, {
  headers: { 'x-ncp-apigw-api-key-id': id, 'x-ncp-apigw-api-key': secret },
})
const text = await res.text()
console.log('HTTP', res.status)

if (res.status === 403 || res.status === 401) {
  console.log('\n❌ 미활성 — NCP 콘솔 > Services > Maps 에서 Directions 5 이용 신청이 필요합니다.')
  console.log('   (키 자체는 유효 — Geocoding·Static Map은 정상 동작 중)')
  process.exit(2)
}
if (!res.ok) { console.log(text.slice(0, 400)); process.exit(1) }

const body = JSON.parse(text)
if (body.code !== 0) {
  console.log(`\n❌ code=${body.code} ${body.message ?? ''}`)
  process.exit(1)
}
const leg = body.route?.trafast?.[0]
const roads = [...new Set((leg?.section ?? []).map(s => s.name).filter(Boolean))]
console.log('\n✅ 사용 가능')
console.log(`   거리 ${(leg.summary.distance / 1000).toFixed(1)}km · 소요 ${Math.round(leg.summary.duration / 60000)}분`)
console.log(`   경로 좌표 ${leg.path?.length ?? 0}점 · 구간 도로 ${roads.length}개: ${roads.slice(0, 5).join(' → ')}`)
console.log(`   안내 문장 ${leg.guide?.length ?? 0}개 (마지막: ${leg.guide?.at(-1)?.instructions ?? '-'})`)
