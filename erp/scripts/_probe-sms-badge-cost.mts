/** 사이드바 뱃지 비용 실측 (소방계획서_24 S9-5)
 *  실행: npx tsx --conditions=react-server scripts/_probe-sms-badge-cost.mts
 *
 *  경위: 처음엔 이 함수를 대시보드 **레이아웃**에서 불렀다. 레이아웃은 모든 화면이 지나므로
 *  화면 전환마다 비용이 붙는데, 실측 **중앙값 497ms**였다 — 뱃지 하나 때문에 앱 전체가
 *  0.5초씩 느려지는 셈이라 렌더 경로에서 빼고 사이드바가 마운트 후 가져오게 바꿨다.
 *
 *  지금 이 함수가 첫 페인트를 막는 곳은 **대시보드 위젯 하나**이고, 거기서도 문서 할 일 조회와
 *  병렬로 묶여 있다. 그래서 상한은 "레이아웃에 넣어도 되는 값"이 아니라
 *  "대시보드가 기다려 줄 수 있는 값"으로 둔다. 이 수치가 크게 나빠지면 위젯도 지연 로드로 옮겨야 한다.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const { countUnsentNotices } = await import('../src/lib/sms.ts')

const admin = createAdminClient()

// 워밍업 1회(연결·DNS) 후 5회 측정 — 첫 호출만 유독 느린 것을 평균이 가리지 않게 분리한다
const warm = Date.now(); const first = await countUnsentNotices(admin); const warmMs = Date.now() - warm

const ms: number[] = []
for (let i = 0; i < 5; i++) {
  const t = Date.now()
  await countUnsentNotices(admin)
  ms.push(Date.now() - t)
}
ms.sort((a, b) => a - b)
const median = ms[Math.floor(ms.length / 2)]

console.log(`첫 호출(연결 포함): ${warmMs}ms`)
console.log(`이후 5회: ${ms.join(', ')}ms — 중앙값 ${median}ms`)
console.log(`결과: 미발송 ${first.count}곳 · ${first.messages}통 · 규칙 ${JSON.stringify(first.rules)}`)

// 대시보드 위젯이 기다려 주는 값. 넘으면 위젯도 지연 로드로 옮기거나 경량 쿼리를 검토한다.
const LIMIT = 1200
if (median > LIMIT) {
  console.error(`\n❌ 중앙값 ${median}ms > ${LIMIT}ms — 대시보드 첫 페인트를 이만큼 막을 수는 없다.`)
  console.error('   대안: 위젯도 클라이언트 지연 로드 / count 전용 경량 쿼리 / 조회 범위 축소')
  process.exit(1)
}
console.log(`\n✅ 중앙값 ${median}ms ≤ ${LIMIT}ms`)
console.log('   (사이드바 뱃지는 렌더 경로 밖 — 마운트 후 가져오므로 이 값이 화면 전환을 막지 않는다)')
