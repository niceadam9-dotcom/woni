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
  check('별지 9호 — 점검 목록 표시(자체점검 건)', await page.isVisible('text=서림사'))
  // R9 버그 수정: 정기(monthly) 건은 목록에서 제외 — 행복마을아파트는 정기 건만 보유
  check('별지 9호 — 정기(monthly) 건 제외(R9)', !(await page.isVisible('text=행복마을아파트')))
  check('별지 9호 — 자체점검만 표시 캡션(R9-b)', await page.isVisible('text=자체점검(작동·종합) 건만 표시됩니다'))

  await page.goto(`${BASE}/reports?form=report9&q=서림`)
  await page.waitForSelector('text=서림사')
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
