/** 기본 착륙지 + 사이드바 순서 계약 E2E (2026-08-19)
 *  실행: npx tsx scripts/test-landing-and-nav.mts   (dev 서버 필요)
 *
 *  고정하는 것 —
 *   ① 로그인 직후·루트(`/`)·권한 부족 폴백이 **모두 같은 곳**(HOME_PATH=점검 달력)으로 간다.
 *      종전엔 '/dashboard' 문자열이 여섯 곳에 흩어져 있어, 한 곳만 빠뜨리면
 *      "로그인하면 달력인데 권한 없는 화면을 누르면 대시보드로 튄다"처럼 조용히 갈라졌다.
 *   ② 폴백지는 **모든 역할이 들어갈 수 있어야** 한다 — 아니면 튕긴 사용자가 다시 튕겨 무한 리다이렉트.
 *   ③ 사이드바 첫 그룹은 소방안전관리이고, 대시보드 단독 항목은 그룹들 **아래**에 있다.
 *   ④ 착륙 직후 소방안전관리 그룹이 펼쳐져 있다(현재 경로가 속한 그룹 자동 열기와의 상승효과).
 */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { BASE, PW, mkUser, delUser, launch, check, summary } from './_e2e-helpers.mjs'

/** 공용 login()은 20초 고정이라 dev 첫 컴파일에서 죽는다 — 착륙지가 바뀌면 그 라우트를
 *  처음 컴파일하는 시간까지 기다려야 해서 여기서는 넉넉히 잡는다 */
async function signIn(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 120_000 })
}

const HOME = '/inspections/calendar'
const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const ADMIN_EMAIL = `landadm.${SUF}@e2e.test`
const EMP_EMAIL = `landemp.${SUF}@e2e.test`

let adminId: string | null = null
let empId: string | null = null
let browser: import('playwright').Browser | null = null

async function main() {
  const l = await launch(); browser = l.browser
  const page: Page = l.page
  page.setDefaultTimeout(60000)

  adminId = await mkUser({ email: ADMIN_EMAIL, name: `착륙관리${SUF}`, employeeId: `LA-${SUF}`, role: 'admin' })
  empId = await mkUser({ email: EMP_EMAIL, name: `착륙직원${SUF}`, employeeId: `LE-${SUF}`, role: 'employee' })

  console.log('\n[1] 로그인 직후 착륙지')
  await signIn(page, ADMIN_EMAIL)
  await page.waitForLoadState('networkidle')
  check('1-1 ★ 로그인하면 점검 달력', new URL(page.url()).pathname === HOME, page.url())

  console.log('\n[2] 루트 경로')
  await page.goto(`${BASE}/`)
  await page.waitForLoadState('networkidle')
  check('2-1 ★ `/`도 같은 곳으로', new URL(page.url()).pathname === HOME, page.url())

  console.log('\n[3] 사이드바 순서')
  const navTexts = await page.locator('nav > div').evaluateAll(els =>
    els.map(e => (e.querySelector('button, a')?.textContent ?? '').trim()))
  check('3-1 ★ 첫 항목이 소방안전관리', navTexts[0]?.includes('소방안전관리') === true, JSON.stringify(navTexts))
  const dashIdx = navTexts.findIndex(t => t.includes('대시보드'))
  check('3-2 ★ 대시보드는 그룹들 아래(마지막)', dashIdx === navTexts.length - 1, `index ${dashIdx}/${navTexts.length - 1}`)
  check('3-3 My Page는 소방안전관리 다음', navTexts[1]?.includes('My Page') === true, JSON.stringify(navTexts.slice(0, 3)))

  console.log('\n[4] 착륙 직후 소방안전관리 그룹이 펼쳐져 있다')
  const calLink = page.locator('nav a[href="/inspections/calendar"]')
  check('4-1 ★ 하위 [점검 달력] 링크가 펼쳐진 채 보인다', await calLink.isVisible(), `${await calLink.count()}개`)

  console.log('\n[5] 대시보드는 그대로 접근된다')
  await page.goto(`${BASE}/dashboard`)
  await page.waitForLoadState('networkidle')
  check('5-1 대시보드 페이지 유지', new URL(page.url()).pathname === '/dashboard', page.url())

  console.log('\n[6] 권한 부족 폴백 (직원 계정)')
  await page.context().clearCookies()
  await signIn(page, EMP_EMAIL)
  await page.waitForLoadState('networkidle')
  check('6-1 직원도 로그인하면 점검 달력', new URL(page.url()).pathname === HOME, page.url())

  // proxy.ts: /admin은 admin만 — 직원은 폴백지로 튕긴다
  await page.goto(`${BASE}/admin/users`)
  await page.waitForLoadState('networkidle')
  check('6-2 ★ 직원이 /admin/users → 폴백지(점검 달력)', new URL(page.url()).pathname === HOME, page.url())

  // proxy.ts: /approvals는 manager↑
  await page.goto(`${BASE}/approvals`)
  await page.waitForLoadState('networkidle')
  check('6-3 ★ 직원이 /approvals → 폴백지(점검 달력)', new URL(page.url()).pathname === HOME, page.url())

  // 폴백지가 권한 게이트를 가지면 여기서 무한 리다이렉트가 난다 — 화면이 실제로 그려지는지 본다
  check('6-4 ★ 폴백 후 화면이 그려진다(무한 리다이렉트 없음)',
    await page.locator('nav a[href="/inspections/calendar"]').isVisible())

  console.log('\n[7] 직원 사이드바도 소방안전관리가 첫 항목')
  const empNav = await page.locator('nav > div').evaluateAll(els =>
    els.map(e => (e.querySelector('button, a')?.textContent ?? '').trim()))
  check('7-1 직원 사이드바 첫 항목', empNav[0]?.includes('소방안전관리') === true, JSON.stringify(empNav))
}

main()
  .catch(e => { console.error(`\n  ❌ 예외: ${(e as Error).message}\n${(e as Error).stack}`); process.exitCode = 1 })
  .finally(async () => {
    if (browser) await browser.close()
    if (adminId) { try { await delUser(adminId) } catch { /* 무시 */ } }
    if (empId) { try { await delUser(empId) } catch { /* 무시 */ } }
    summary()
  })
