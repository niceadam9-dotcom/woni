/** 점검달력 도구줄 캡처 + 실측 — 읽기 전용 (2026-09-23 「달력 이동·고객 검색이 눈에 띄게」) */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
const S = Date.now().toString(36), OUT = process.env.SHOT_DIR ?? '.'
let uid = '', b: { close: () => Promise<void> } | null = null
try {
  uid = await mkUser({ email: `caltb-${S}@test.local`, name: '달력도구줄', employeeId: `E2E-TB-${S}` })
  const l = await launch(); b = l.browser; const { page } = l; page.setDefaultTimeout(60000)
  await login(page, `caltb-${S}@test.local`)
  for (const W of [1920, 1280, 400]) {
    await page.setViewportSize({ width: W, height: W === 400 ? 800 : 937 })
    await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="cal-toolbar"]').waitFor()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/cal-toolbar-${W}.png`, clip: { x: 0, y: 0, width: W, height: W === 400 ? 520 : 300 } })
    const nav = await page.locator('[data-testid="cal-nav-label"]').boundingBox()
    const search = await page.locator('[data-testid="cal-customer-search"]').boundingBox()
    const smsBtn = await page.locator('[data-testid="calendar-sms-toolbar"]').boundingBox()
    if (W === 1920) {
      check('★ 1920 — 달 이동과 고객 검색이 같은 첫 줄', !!nav && !!search && Math.abs((nav.y + nav.height / 2) - (search.y + search.height / 2)) < 8,
        `nav y=${nav?.y} search y=${search?.y}`)
      check('★ 1920 — 검색창이 도구줄에서 가장 넓다(≥ 400px)', !!search && search.width >= 400, `${Math.round(search?.width ?? 0)}px`)
      check('★ 1920 — 검색창 높이가 보조 버튼보다 크다', !!search && !!smsBtn && search.height > smsBtn.height + 8,
        `search ${search?.height} vs 문자 ${smsBtn?.height}`)
      await page.keyboard.press('/')
      check('★ `/` 누르면 커서가 검색창으로', await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) === 'cal-customer-search')
      const before = await page.locator('[data-testid="cal-nav-label"]').innerText()
      await page.getByRole('button', { name: '다음' }).first().click(); await page.waitForTimeout(400)
      const after = await page.locator('[data-testid="cal-nav-label"]').innerText()
      check('달 이동 [다음]이 동작한다', before !== after, `${before} → ${after}`)
    }
    check(`${W} — 가로 넘침 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${W} — [사전안내 문자]가 보인다(test-inspection-sms 계약)`, await page.locator('[data-testid="calendar-sms-toolbar"]').isVisible())
  }
} catch (e) { check('예외 없음', false, String(e)) }
finally { if (b) await b.close(); await delUser(uid); summary() }
