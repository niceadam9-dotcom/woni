// 진단 — ?tab=info 에서 별지 패널이 실제로 마운트되는가. 요청 카운트가 아니라 **DOM 존재**로 본다.
// (요청 필터 body.includes(custId)는 무관한 서버액션도 잡아 오탐이 난다)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-lazy-diag@erp-test.com'
let userId = '', custId = '', browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
try {
  userId = await mkUser({ email: EMAIL, name: '지연진단', employeeId: 'E2E-LZD' })
  custId = await mkCustomer({ customer_name: '지연진단고객', address: '경기 양평군 진단로 1', created_by: userId })
  await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  })
  const l = await launch(); browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  const posts: string[] = []
  page.on('request', (r: { method: () => string; url: () => string; postData: () => string | null }) => {
    if (r.method() === 'POST') posts.push(`${r.url()} :: ${(r.postData() ?? '').slice(0, 220).replace(/\s+/g, ' ')}`)
  })

  await page.goto(`${BASE}/customers/${custId}?tab=info`)
  await page.waitForSelector('h1', { timeout: 30000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(2000)

  const annexMarker = await page.locator('text=별지는 입력한 데이터로 자동 생성됩니다').count()
  const annexPanelHtml = await page.locator('[role=tabpanel]').nth(4).innerHTML().catch(() => '(없음)')
  console.log(`\n[tab=info] 별지 마커 DOM 개수 = ${annexMarker}  (0이면 지연 마운트 정상)`)
  console.log(`[tab=info] 5번째 tabpanel innerHTML 길이 = ${annexPanelHtml.length} (0이면 비어 있음 = 지연 성공)`)
  console.log(`[tab=info] POST ${posts.length}건:`)
  posts.forEach((p, i) => console.log(`  ${i + 1}. ${p}`))

  posts.length = 0
  await page.locator('[role=tab]').filter({ hasText: '별지서식' }).first().click()
  await page.waitForSelector('text=별지는 입력한 데이터로 자동 생성됩니다', { timeout: 25000 })
  await page.waitForTimeout(1000)
  console.log(`\n[탭 클릭 후] POST ${posts.length}건:`)
  posts.forEach((p, i) => console.log(`  ${i + 1}. ${p}`))
} catch (e) {
  console.log(`예외: ${e}`)
} finally {
  if (browser) await browser.close()
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
