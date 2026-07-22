// 점검대장 최신 입력 정렬 스모크 (일회성)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'ledger-e2e@erp-test.com'
let userId = ''
let customerId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '대장E2E', employeeId: 'E2E-LEDGER' })
  customerId = await mkCustomer({ customer_name: '대장정렬E2E고객', created_by: userId }) // 방금 등록 = 최신 입력
  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspection-ledger`)
  await page.waitForSelector('text=대장정렬E2E고객')
  const firstRowText = await page.locator('tbody tr').first().textContent()
  check('최신 입력 고객이 첫 행', (firstRowText ?? '').includes('대장정렬E2E고객'), firstRowText?.slice(0, 60) ?? '')
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
}
summary()
