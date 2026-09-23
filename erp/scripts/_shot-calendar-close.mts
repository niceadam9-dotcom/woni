/** 달력 < > 와 사이드 패널 닫기 X — 크기·굵기 실측 + 캡처 (읽기 전용, 2026-09-23 「크고 선명하게」) */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
const S = Date.now().toString(36), OUT = process.env.SHOT_DIR ?? '.'
let uid = '', b: { close: () => Promise<void> } | null = null
try {
  uid = await mkUser({ email: `calx-${S}@test.local`, name: '달력X', employeeId: `E2E-CX-${S}` })
  const l = await launch(); b = l.browser; const { page } = l; page.setDefaultTimeout(60000)
  await login(page, `calx-${S}@test.local`)
  await page.setViewportSize({ width: 1920, height: 937 })
  const d = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  await page.goto(`${BASE}/inspections/calendar?day=${d}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="daypanel-close"]').waitFor()
  const chev = await page.locator('[data-testid="cal-nav-move"] button[title="다음"] svg').evaluate(e => ({ w: e.getBoundingClientRect().width, sw: e.getAttribute('stroke-width') }))
  check('★ > 화살표 28px · 선 두께 3', Math.round(chev.w) >= 27 && chev.sw === '3', JSON.stringify(chev))
  const x = await page.locator('[data-testid="daypanel-close"]').evaluate(e => {
    const r = e.getBoundingClientRect(); const svg = e.querySelector('svg')!
    return { w: r.width, sw: svg.getAttribute('stroke-width'), color: getComputedStyle(e).color }
  })
  check('★ 날짜 패널 닫기 = 36px 버튼 · 굵은 X', Math.round(x.w) >= 35 && x.sw === '2.75', JSON.stringify(x))
  await page.screenshot({ path: `${OUT}/cal-close-1920.png`, clip: { x: 1400, y: 0, width: 520, height: 260 } })
  await page.screenshot({ path: `${OUT}/cal-nav-1920.png`, clip: { x: 230, y: 70, width: 520, height: 90 } })
  await page.locator('[data-testid="daypanel-close"]').click()
  check('닫기 X가 패널을 닫는다', await page.locator('[data-testid="daypanel-close"]').count() === 0)
} catch (e) { check('예외 없음', false, String(e)) }
finally { if (b) await b.close(); await delUser(uid); summary() }
