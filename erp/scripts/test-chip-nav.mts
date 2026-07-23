// 11-5 누락 칩 → 탭 이동 회귀 E2E — 마운트 후 클라이언트 내비(칩 클릭)에서 탭 패널이 실제로 전환되는지
// (버그: CustomerTabs active가 마운트 1회 초기화 state라 router.push(?tab=)에 무반응 — 2026-07-23 사용자 보고)
// 실행: npx tsx scripts/test-chip-nav.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'chipnav-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '칩이동E2E', employeeId: 'E2E-CHIP' })
  // 건물 값(높이 등)이 비어 있는 고객 — 누락 칩이 뜨는 상태
  custId = await mkCustomer({ customer_name: '칩이동E2E고객', created_by: userId, address: '서울시 테스트로 1' })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // 1) 소방계획서 탭 진입 (마운트) → 누락 칩 노출
  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForLoadState('networkidle')
  const chip = page.locator('button:has-text("↗")').first()
  await chip.waitFor({ state: 'visible' })
  const chipLabel = (await chip.textContent() ?? '').replace('↗', '').trim()
  check('누락 칩 노출', !!chipLabel, chipLabel)

  // 2) 건물값 칩 클릭 → 건물·시설 탭으로 실제 전환 (버그 시 무반응)
  const bChip = page.locator('button:has-text("층수 ↗"), button:has-text("높이 ↗"), button:has-text("연면적 ↗")').first()
  await bChip.click()
  await page.waitForSelector('[role=tab][aria-selected="true"]:has-text("건물·시설")', { timeout: 15000 })
  check('칩 클릭 → 건물·시설 탭 전환', true)
  const urlOk = await page.waitForFunction(() => window.location.search.includes('tab=buildings'), null, { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('URL tab=buildings 반영', urlOk, page.url())
  const planHidden = await page.locator('[role=tabpanel]:has-text("필수 완성도")').first().isHidden()
  check('소방계획서 패널 숨김', planHidden)

  // 3) 수동으로 소방계획서 탭 복귀 → 주소류(기본정보) 칩 이동도 확인
  await page.locator('[role=tab]:has-text("소방계획서")').click()
  await page.waitForTimeout(500)
  const infoChip = page.locator('button:has-text("사용승인일 ↗")').first()
  if (await infoChip.count() > 0) {
    await infoChip.click()
    const infoSelected = await page.waitForSelector('[role=tab][aria-selected="true"]:has-text("기본정보")', { timeout: 15000 })
      .then(() => true).catch(() => false)
    check('사용승인일 칩 → 기본정보 탭 전환', infoSelected)
  } else {
    check('사용승인일 칩 → 기본정보 탭 전환 (칩 없음 — 스킵 아님 실패)', false)
  }

  // 4) 다른 탭에서 ?tab=plan&form= Link 케이스 — 마운트 후 서버 재렌더 딥링크 동기화
  await page.evaluate(() => { (window as unknown as { next?: { router?: unknown } }).next; history.scrollRestoration = 'auto' })
  await page.locator('[role=tab]:has-text("건물·시설")').click()
  await page.waitForTimeout(300)
  const link = page.locator('a[href*="tab=plan"][href*="form=1.4"]').first()
  if (await link.count() > 0) {
    await link.click()
    const planSel = await page.waitForSelector('[role=tab][aria-selected="true"]:has-text("소방계획서")', { timeout: 15000 })
      .then(() => true).catch(() => false)
    const activeLabel = await page.locator('[role=tab][aria-selected="true"]').first().textContent()
    check('페이지 내 Link(?tab=plan&form=1.4) → 탭 전환', planSel, `url=${page.url()} active=${activeLabel}`)
    const form14 = await page.waitForSelector('[role=tabpanel]:not([hidden]) button:has-text("1.4 소방시설")', { timeout: 15000 })
      .then(() => true).catch(() => false)
    check('form=1.4 서식 화면 표시(plan 패널 내)', form14)
  } else {
    check('페이지 내 Link 존재(1.4 안내)', false, 'a[href*=form=1.4] 미발견')
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) {
    await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
    await cleanupCustomer(custId)
  }
  if (userId) await delUser(userId)
}
summary()
