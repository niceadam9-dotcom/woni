/** 고객 상세 페이지 응답시간 실측 (2026-08-11) — 순차 DB 왕복 병렬화 효과 확인.
 *  로그인 후 데이터가 많은 고객 상세를 워밍업 2회 + 측정 5회, 문서 응답시간 중앙값을 본다.
 *  실행: node scripts/_probe-detail-latency.mjs  (dev 서버 localhost:3000 필요) */
import { raw, BASE, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-latency@test.local'

let userId, browser
try {
  // 데이터가 가장 많은 고객(건물 보유) 하나를 대상으로
  const { data: cust } = await raw.from('customers')
    .select('id, customer_name, buildings(id)')
    .eq('is_active', true).limit(20)
  const target = (cust ?? []).sort((a, b) => (b.buildings?.length ?? 0) - (a.buildings?.length ?? 0))[0]
  if (!target) throw new Error('활성 고객 없음')
  console.log(`대상: ${target.customer_name} (건물 ${target.buildings?.length ?? 0})`)

  userId = await mkUser({ email: EMAIL, name: 'E2E지연측정', employeeId: 'E2E-LAT' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  const url = `${BASE}/customers/${target.id}`
  // 워밍업 — dev 컴파일·데이터 캐시 영향 제거
  for (let i = 0; i < 2; i += 1) await page.goto(url, { waitUntil: 'domcontentloaded' })

  const runs = []
  for (let i = 0; i < 5; i += 1) {
    const s = performance.now()
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
    const ms = performance.now() - s
    runs.push(ms)
    console.log(`  #${i + 1}: ${ms.toFixed(0)}ms (HTTP ${res.status()})`)
  }
  runs.sort((a, b) => a - b)
  console.log(`\n문서 로드 중앙값 ${runs[2].toFixed(0)}ms (최소 ${runs[0].toFixed(0)} / 최대 ${runs[4].toFixed(0)})`)
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
