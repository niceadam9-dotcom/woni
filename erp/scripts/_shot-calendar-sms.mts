/** 화면 확인용 캡처 — 달력 문자 패널 · 날짜 패널 골라 보내기 · 발송 이력
 *  실행: OUT=<폴더> npx tsx scripts/_shot-calendar-sms.mts   (dev 서버 필요) */
import { chromium } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { BASE, PW, mkUser, delUser, login } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 7)
const EMAIL = `smsshot.${SUF}@e2e.test`
const OUT = process.env.OUT ?? '.'
const kst = (d = 0) => new Date(Date.now() + 9 * 3600_000 + d * 86400_000).toISOString().slice(0, 10)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(30000)
const userId = await mkUser({ email: EMAIL, name: `캡처${SUF}`, employeeId: `SS-${SUF}`, role: 'admin' })
try {
  await login(page, EMAIL, PW)
  await page.goto(`${BASE}/inspections/calendar?sms=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="sms-notice"]')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/1-panel.png` })

  await page.goto(`${BASE}/inspections/calendar?day=${kst(1)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="calendar-sms-day"]')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/2-day.png` })
  if (await page.locator('[data-testid="day-sms-toggle"]').count()) {
    await page.locator('[data-testid="day-sms-toggle"]').click()
    await page.locator('[data-testid="day-sms-all"]').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/3-day-select.png` })
  }

  await page.goto(`${BASE}/inspections/sms`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => /전체\s*\d+/.test(document.querySelector('[data-testid="history-status-all"]')?.textContent ?? ''))
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/4-history.png` })
} finally {
  await delUser(userId)
  await browser.close()
}
