/** 드로어가 콘솔 오류를 만드는가 — 대조군 포함 (소방계획서_38 후속 확인)
 *  실행: node scripts/_probe-38-console.mjs [inspectionId]
 *
 *  스크린샷에 Next dev 오버레이의 "1 Issue" 배지가 찍혔다. 그것만 보고 '드로어 탓'이라 하면
 *  안 된다 — 페이지가 원래 갖고 있던 것일 수 있다. **드로어를 열기 전/후를 나눠** 센다.
 */
import { chromium } from 'playwright'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const EMAIL = 'drawer-console-probe@erp-test.com'
const PW = 'E2eTest1!'
let userId = null, browser = null

const norm = m => m.replace(/\s+/g, ' ').slice(0, 220)

try {
  let inspId = process.argv[2]
  if (!inspId) {
    const { data: sp } = await s.from('inspections').select('id').like('plan_type', 'special%').limit(1)
    const { data } = await s.from('inspections').select('id, plan_type').is('plan_type', null).limit(1)
    inspId = (sp ?? [])[0]?.id ?? (data ?? [])[0]?.id
  }
  const { data: created, error } = await s.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  if (created?.user) {
    userId = created.user.id
    await s.from('profiles').upsert({ id: userId, email: EMAIL, name: '콘솔프로브', employee_id: 'E2E-D38C', role: 'admin', is_active: true, is_system: false })
  } else {
    const { data: p } = await s.from('profiles').select('id').eq('email', EMAIL).maybeSingle()
    userId = p?.id
  }

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(120000)

  const errs = []
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push({ t: m.type(), m: norm(m.text()) }) })
  page.on('pageerror', e => errs.push({ t: 'pageerror', m: norm(String(e)) }))

  await page.goto(`${BASE}/login`, { timeout: 120000 })
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 60000 })

  await page.goto(`${BASE}/inspections/${inspId}`, { timeout: 120000 })
  await page.waitForSelector('[data-testid="sheet-group-board"]', { timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 120000 })
  await page.waitForTimeout(1500)

  const before = errs.length
  console.log(`\n[대조군] 드로어 열기 **전** 오류/경고: ${before}건`)
  errs.slice(0, 20).forEach(e => console.log(`   · [${e.t}] ${e.m}`))

  const cards = page.locator('[data-group-key]')
  const n = await cards.count()
  for (let i = 0; i < n; i++) {
    await cards.nth(i).click()
    await page.waitForSelector('[data-testid="sheet-drawer"] [data-outline-group]', { timeout: 90000 })
    if (await page.locator('[data-testid="sheet-drawer"] [data-subgroup]').count() > 0) break
    await page.click('[data-testid="sheet-drawer-close"]')
    await page.waitForSelector('[data-testid="sheet-drawer"]', { state: 'detached' })
  }
  // 배율 3점을 다 밟아 본다 — 토큰 배선이 끊기면 CSS 경고가 여기서 난다
  for (const fs of ['lg', 'xl', 'md']) {
    await page.evaluate(v => document.documentElement.setAttribute('data-fs', v), fs)
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(1500)

  const added = errs.slice(before)
  console.log(`\n[실험군] 드로어를 열고 배율 3점을 밟은 **뒤 추가된** 오류/경고: ${added.length}건`)
  added.slice(0, 20).forEach(e => console.log(`   · [${e.t}] ${e.m}`))

  console.log(`\n${added.length === 0 ? '✅ 드로어는 새 콘솔 오류를 만들지 않는다' : '❌ 드로어가 오류를 추가한다 — 위 목록 확인'}`)
  console.log(`   (열기 전 ${before}건은 이 화면이 원래 갖고 있던 것 — 38 소관 아님)`)
  await page.close()
  process.exitCode = added.length === 0 ? 0 : 1
} catch (e) {
  console.log('❌ 예외: ' + String(e).slice(0, 300))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (userId) {
    try { await s.from('profiles').delete().eq('id', userId) } catch { /* 이미 없음 */ }
    try { await s.auth.admin.deleteUser(userId) } catch { /* 이미 없음 */ }
  }
}
