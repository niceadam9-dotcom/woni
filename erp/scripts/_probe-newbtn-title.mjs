// [+ 고객 등록] 제목 옆 이사 실측 (2026-09-20) — 양성(새 자리에 있다)·음성(옛 자리에 없다) 짝.
// 실행: (dev 기동 후) node scripts/_probe-newbtn-title.mjs
import { BASE, check, summary, launch, login, mkUser, raw } from './_e2e-helpers.mjs'

const EMAIL = 'newbtn-probe@erp-test.com'
let userId = ''
let browser = null
try {
  userId = await mkUser({ email: EMAIL, name: '버튼이사', employeeId: 'E2E-NB', role: 'admin' })
  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1:has-text("고객 관리")')

  // 양성 — 제목 h1의 **형제 줄 안**에 등록 링크가 있다 (h1과 같은 flex 컨테이너)
  const inTitleRow = await page.locator('xpath=//h1[contains(text(),"고객 관리")]/following-sibling::a[contains(@href,"/customers/new")]').count()
  check('새 자리: 제목 바로 옆에 [고객 등록] 링크', inTitleRow === 1, `${inTitleRow}개`)

  // 음성 — 검색/필터 form 안에는 더 이상 없다 (옛 자리 잔존이면 진입구가 둘)
  const inForm = await page.locator('form[action="/customers"] a[href="/customers/new"]').count()
  check('옛 자리: 검색줄 안에는 없다', inForm === 0, `${inForm}개`)

  // 전 화면에서 등록 진입구는 정확히 하나
  const total = await page.locator('a[href="/customers/new"]').count()
  check('등록 진입구는 화면에 정확히 1개', total === 1, `${total}개`)

  // 링크가 실제로 등록 화면으로 간다 (모양만 단언하지 않는다)
  await page.locator('a[href="/customers/new"]').click()
  await page.waitForURL('**/customers/new', { timeout: 30000 })
  check('클릭하면 /customers/new로 이동', page.url().includes('/customers/new'))
} catch (e) {
  check('예외 없이 끝까지 실행됐다', false, e.message)
} finally {
  if (browser) await browser.close()
  if (userId) {
    await raw.from('profiles').delete().eq('id', userId)
    await raw.auth.admin.deleteUser(userId).catch(() => {})
  }
  summary()
}
