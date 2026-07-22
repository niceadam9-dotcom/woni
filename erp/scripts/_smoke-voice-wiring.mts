// V-1 배선 스모크 (일회성) — AI 크레딧 차단 상태에서 fail-soft 에러 표시 확인
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const inspectionId = process.argv[2]
const EMAIL = 'voice-wire-e2e@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '배선스모크', employeeId: 'E2E-VW' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('text=음성 점검표 입력 (V-1)')
  check('섹션 렌더', true)
  await page.fill('textarea[placeholder*="발화 규칙"]', '소화기 전부 양호')
  await page.click('button:has-text("AI 구조화")')
  await page.waitForSelector('text=AI 구조화 실패')
  check('fail-soft — API 오류가 화면에 표시됨 (크레딧 차단 상태)', true)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
