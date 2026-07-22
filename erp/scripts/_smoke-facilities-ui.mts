// 시설현황 UI 스모크 (일회성) — 표준 코드 전환 후 설치 시설 표시 확인
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const customerId = process.argv[2]
const EMAIL = 'fac-ui-smoke@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '시설스모크', employeeId: 'E2E-FAC' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${customerId}?tab=buildings`)
  await page.waitForSelector('text=소방시설 현황')
  check('시설현황 패널 렌더', true)
  check('표준 코드 표시 (물분무소화설비)', await page.isVisible('text=물분무소화설비'))
  check('이관 노트 표시', await page.isVisible('text=코드 이관'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
