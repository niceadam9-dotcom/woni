// 별지 10·11호 UI 스모크 (일회성) — ⑤⑥ 행·생성 버튼·불량 계획 입력
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const inspectionId = process.argv[2]
const EMAIL = 'annex-ui-e2e@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '별지E2E', employeeId: 'E2E-ANNEX' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('text=실시결과 보고서 (별지 9호)')
  check('⑤ 이행조치 계획 행', await page.isVisible('text=⑤ 이행조치 계획'))
  check('⑥ 이행완료 처리 행', await page.isVisible('text=⑥ 이행완료 처리'))
  check('[별지 10호 생성] 버튼', await page.isVisible('button:has-text("별지 10호 생성")'))
  check('[별지 11호 생성] 버튼', await page.isVisible('button:has-text("별지 11호 생성")'))
  check('생성물 목록 — report10/11 파일', await page.isVisible('text=report10_') && await page.isVisible('text=report11_'))
  check('불량내역 — 이행계획·조치 완료 편집', await page.isVisible('text=이행계획·조치 완료'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
