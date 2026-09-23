/** 고객 등록 화면 정렬 — 실화면 (2026-09-23)
 *  실행: TEST_BASE_URL=http://localhost:3107 npx tsx scripts/_probe-customer-new-layout.mts
 *
 *  소스 단언(`test-customer-new-layout`)이 못 보는 것만 본다 — **실제로 그려진 화면**:
 *   · 열자마자 커서가 고객명에 있다(autoFocus가 하이드레이션 뒤에도 사는가)
 *   · 탭 키를 누르면 **화면 순서대로** 간다(고객명 → 주소 → [주소 검색] → 사용승인일 → 점검일자 → 점검유형)
 *   · ④가 접혀 있고, 열면 건물용도가 보인다
 *   · 하단 바가 스크롤 뒤에도 화면 안에 있다(sticky)
 *   · 1280px·400px에서 가로 넘침이 없다
 *   · 캡처 두 장(scratch)으로 눈으로도 본다
 *  읽기 전용 — 등록 버튼은 누르지 않는다.
 */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const STAMP = Date.now().toString(36)
const EMAIL = `cust-layout-${STAMP}@test.local`
const SHOT = process.env.SHOT_DIR ?? '.'

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '등록화면프로브', employeeId: `E2E-CL-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(90000)
  await login(page, EMAIL)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${BASE}/customers/new`, { waitUntil: 'domcontentloaded' })
  await page.locator('#new-customer-name').waitFor()
  await page.waitForFunction(() => document.activeElement?.id === 'new-customer-name', undefined, { timeout: 15000 }).catch(() => {})
  const first = await page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? '')
  check('★ 열자마자 커서가 고객명에 있다', first === 'new-customer-name', first)

  // 탭 순서 — 화면 위→아래와 같아야 한다
  const seen: string[] = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    seen.push(await page.evaluate(() => {
      const a = document.activeElement as HTMLInputElement | null
      if (!a) return ''
      if (a.id) return a.id
      if (a.name) return `name:${a.name}`
      return `${a.tagName}:${(a.textContent ?? '').trim().slice(0, 8)}`
    }))
  }
  const want = ['new-address', 'BUTTON:주소 검색', 'new-use-approval', 'new-anchor-date', 'name:inspection_category']
  check('★ 탭 순서 = 화면 순서 (고객명 → 주소 → [주소 검색] → 사용승인일 → 점검일자 → 점검유형)',
    want.every((w, k) => seen[k] === w), seen.join(' → '))

  check('★ ④ 추가 정보는 접혀 있다', (await page.locator('[data-testid="new-optional-body"]').count()) === 0)
  check('필수 칸은 접지 않아도 다 보인다',
    await page.locator('#new-use-approval').isVisible() && await page.locator('#contact-대표-name').isVisible())

  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check('1280px — 가로 넘침 없음', await noOverflow())
  await page.screenshot({ path: `${SHOT}/cust-new-1280.png`, fullPage: true })

  await page.locator('[data-testid="new-optional-toggle"]').click()
  await page.getByRole('combobox', { name: '건물용도' }).waitFor()
  check('④를 열면 건물용도가 보인다', true)

  // sticky — 맨 아래로 굴린 뒤 [등록] 바가 뷰포트 안에 있는가 (창을 낮춰 스크롤이 생기게)
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  const bar = await page.locator('[data-testid="new-submit-bar"]').boundingBox()
  const vh = await page.evaluate(() => window.innerHeight)
  check('★ 맨 위에서도 하단 바가 화면 안에 보인다 (sticky)', !!bar && bar.y + bar.height <= vh + 1 && bar.y >= 0,
    bar ? `y=${Math.round(bar.y)} h=${Math.round(bar.height)} vh=${vh}` : '(없음)')

  await page.setViewportSize({ width: 400, height: 800 })
  await page.waitForTimeout(300)
  check('400px — 가로 넘침 없음', await noOverflow(),
    String(await page.evaluate(() => document.documentElement.scrollWidth)))
  await page.screenshot({ path: `${SHOT}/cust-new-400.png`, fullPage: true })
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
