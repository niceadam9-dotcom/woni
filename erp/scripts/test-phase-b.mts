// 소방계획서_8 Phase B(H-6) E2E — 보고서 센터 해체: 리다이렉트 매핑·대시보드 제출 현황 위젯·배치 발행·메뉴 소멸
// 실행: npx tsx scripts/test-phase-b.mts  (로컬 dev 서버 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'phase-b-e2e@erp-test.com'
let userId = ''
let customerId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '해체E2E', employeeId: 'E2E-PHASEB' })
  customerId = await mkCustomer({ customer_name: '해체E2E고객', address: '경기 양평군 테스트로 99', created_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) /reports 리다이렉트 매핑 (H-6a·H-6d) ──
  await page.goto(`${BASE}/reports`)
  await page.waitForURL(u => u.pathname === '/dashboard')
  check('리다이렉트 — /reports → 대시보드', true)

  await page.goto(`${BASE}/reports?form=submissions`)
  await page.waitForURL(u => u.pathname === '/dashboard')
  check('리다이렉트 — form=submissions → 대시보드(위젯)', true)

  await page.goto(`${BASE}/reports?form=annual`)
  await page.waitForURL(u => u.pathname === '/inspection-plans/batch')
  check('리다이렉트 — form=annual → 배치 발행', true)

  await page.goto(`${BASE}/reports?form=docs&cust=${customerId}`)
  await page.waitForURL(u => u.pathname === `/customers/${customerId}` && u.searchParams.get('form') === 'annex')
  check('리다이렉트 — form=docs&cust → 소방계획서 트리(별지 서식)', true)
  await page.waitForSelector('text=별지는 입력한 데이터로 자동 생성됩니다')
  check('트리 — 별지 서식 브랜치 로드', true)

  // 구 제출현황 리다이렉트 페이지 2종
  await page.goto(`${BASE}/action-plans/status`)
  await page.waitForURL(u => u.pathname === '/dashboard')
  check('리다이렉트 — /action-plans/status → 대시보드', true)

  // ── 2) 배치 발행 페이지 (H-6c) — 연차 발행·일괄 생성 이전 ──
  await page.goto(`${BASE}/inspection-plans/batch`)
  await page.waitForSelector('h1:has-text("배치 발행")')
  check('배치 발행 — 연차 일괄 발행 마법사', await page.isVisible('h2:has-text("연차 일괄 발행")'))
  check('배치 발행 — 소방계획서 일괄 생성', await page.isVisible('h2:has-text("소방계획서 일괄 생성")'))

  // 점검확정 페이지 진입점
  await page.goto(`${BASE}/inspection-plans`)
  await page.waitForSelector('a[href="/inspection-plans/batch"]')
  check('점검확정 — 배치 발행 진입 링크', true)

  // ── 3) 대시보드 제출 현황 위젯 (H-6b·D-16) — 요약 스트립 + 펼침 테이블 ──
  await page.goto(`${BASE}/dashboard`)
  await page.waitForSelector('text=최근 90일 · 9호·배치확인서·10·11호')
  check('대시보드 — 제출 현황 위젯 노출', true)
  await page.waitForSelector('#submissions >> text=기한초과', { timeout: 30000 })
  check('위젯 — 요약 스트립(기한초과·9호 미제출·완료)', await page.isVisible('#submissions >> text=9호 미제출'))
  await page.locator('#submissions >> button').first().click()
  await page.waitForSelector('text=타임라인에서 일하면 저절로 채워집니다')
  check('위젯 — 펼침 시 제출 현황 테이블(SubmissionBoard)', true)

  // ── 4) 사이드바 '보고서' 메뉴 소멸 (H-6d) ──
  check('사이드바 — 보고서 메뉴 없음', (await page.locator('a[href="/reports"]').count()) === 0)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (customerId) await cleanupCustomer(customerId)
  await delUser(userId)
  summary()
}
