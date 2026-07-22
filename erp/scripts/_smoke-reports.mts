// 보고서 센터 R-1·R-2 스모크 (일회성)
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'reports-e2e@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '보고서E2E', employeeId: 'E2E-RPT' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/reports`)
  await page.waitForSelector('text=보고서 센터')
  check('/reports 렌더', true)
  check('카드 — 소방계획서', await page.isVisible('text=소방계획서'))
  check('카드 — 별지 9호', await page.isVisible('text=자체점검 실시결과 (별지 9호)'))
  check('카드 — 별지 10·11 예정(흐림)', await page.isVisible('text=이행계획·완료'))
  check('소방계획서 생성 화면 흡수(고객 검색)', await page.isVisible('text=고객'))

  await page.goto(`${BASE}/reports?form=report9`)
  await page.waitForSelector('text=준비 화면')
  check('별지 9호 — 점검 건 선택 화면', true)
  check('별지 9호 — 점검 목록 표시', await page.isVisible('text=행복마을아파트'))

  await page.goto(`${BASE}/reports?form=report9&q=행복`)
  await page.waitForSelector('text=행복마을아파트')
  check('고객명 검색 필터', true)

  await page.goto(`${BASE}/fire-plans/generate`)
  await page.waitForSelector('text=보고서 센터')
  check('구 경로 리다이렉트 → /reports', page.url().includes('/reports'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
