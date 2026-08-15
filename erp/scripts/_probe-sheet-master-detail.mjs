/** 점검표 마스터-디테일 실측 — "전체가 조회되면서 세부항목이 팝업" (dev :3000 필요)
 *  실행: node scripts/_probe-sheet-master-detail.mjs <inspectionId>
 *
 *  소방계획서_23 개편판(재작성 2026-08-15): 레일(w-36)은 폐지됐고, 왼쪽 = 머더 카드 보드 상시(Q-2),
 *  오른쪽 = 시트 단위 포털 드로어(Q-14)다. 종전 프로브의 불변식(레일 유지·:has() 칸 확대)은 전부
 *  신판에서 반전됐다 — 카드를 눌러도 보드가 그대로고, 3칸 폭은 개폐와 무관하게 **불변**이어야 한다(Q-15).
 *  test-all에는 없지만 마스터-디테일 회귀 감지용으로 유지한다.
 */
import { chromium } from 'playwright'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? (pass++, console.log(`  ✅ ${n}${d ? ` — ${d}` : ''}`)) : (fail++, console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`)) }

const EMAIL = 'sheet-md-probe@erp-test.com'
const PW = 'E2eTest1!'
let userId = null, browser = null

try {
  // 자체점검 건 하나 — 점검표 시트가 붙는 건이어야 한다
  let inspId = process.argv[2]
  if (!inspId) {
    const { data } = await s.from('inspections')
      .select('id, plan_type').is('plan_type', null).limit(1)
    const { data: sp } = await s.from('inspections')
      .select('id').like('plan_type', 'special%').limit(1)
    inspId = (sp ?? [])[0]?.id ?? (data ?? [])[0]?.id
  }
  if (!inspId) throw new Error('자체점검 건을 찾지 못했습니다 — 인자로 inspectionId를 주세요')
  console.log(`대상 점검: ${inspId.slice(0, 8)}\n`)

  const { data: created, error } = await s.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  if (created?.user) {
    userId = created.user.id
    await s.from('profiles').upsert({
      id: userId, email: EMAIL, name: '점검표프로브', employee_id: 'E2E-SMD',
      role: 'admin', is_active: true, is_system: false,
    })
  } else {
    const { data: p } = await s.from('profiles').select('id').eq('email', EMAIL).maybeSingle()
    userId = p?.id
  }

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.setDefaultTimeout(45000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('text=점검표 입력')
  await page.waitForLoadState('networkidle')

  const paneW = async () => page.evaluate(() => {
    const g = document.querySelector('[data-testid="workbench-panes"]')
    return g ? [...g.children].map(c => Math.round(c.getBoundingClientRect().width)) : []
  })

  const before = await paneW()
  console.log(`드로어 열기 전 칸 너비: ${before.join(' / ')}`)
  await page.waitForSelector('[data-testid="sheet-group-board"]')
  const cards = await page.locator('[data-group-key]').count()
  check('★ 머더 카드 보드가 먼저 보인다(접이 없음)', cards >= 2, `${cards}장`)
  check('구판 레일(w-36)은 없다', await page.locator('[data-testid="sheet-rail"]').count() === 0)

  // 첫 머더 카드 선택 — 시트 전체가 드로어로 열린다(Q-14)
  const card = page.locator('[data-group-key]').first()
  const pickedKey = await card.getAttribute('data-group-key')
  await card.click()
  await page.waitForSelector('[data-testid="sheet-drawer"] [data-outline-group]', { timeout: 30000 })
  console.log(`\n선택 카드: ${pickedKey}`)

  const after = await paneW()
  console.log(`드로어 연 후 칸 너비: ${after.join(' / ')}`)

  check('★ 보드가 사라지지 않는다 (카드 수 불변 — Q-2)', await page.locator('[data-group-key]').count() === cards)
  check('★ 항목 편집기(드로어)가 뜬다', await page.locator('[data-testid="sheet-drawer"] [aria-label$=" O"]').count() > 0)
  check('★ 3칸 폭이 변하지 않는다 (오버레이 — Q-15, 종전 :has() 확대의 반전판)',
    before.length === after.length && before.every((w, i) => Math.abs(w - after[i]) <= 1),
    `${before.join('/')} → ${after.join('/')}`)

  // 드로어 안 목차로 다른 머더로 바로 이동 — 여닫기·네트워크 없이 (Q-5·Q-14)
  const toc = page.locator('[data-toc-group]:not([data-toc-active])')
  if (await toc.count() > 0) {
    const target = await toc.first().getAttribute('data-toc-group')
    await toc.first().click()
    await page.waitForSelector(`[data-toc-group="${target}"][data-toc-active]`, { timeout: 20000 })
    check('★ 목차로 다른 머더 즉시 이동(여닫기 불필요)', true, target ?? '')
    check('★ 이동 후에도 드로어 유지', await page.locator('[data-testid="sheet-drawer"]').isVisible())
  }

  // 페이지 스크롤 0 유지 (R6-9 — 드로어 점프는 내부 박스만 움직인다)
  const of = await page.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)
  check('페이지 스크롤은 여전히 0', of <= 2, `초과 ${of}px`)

} catch (e) {
  check('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (userId) {
    await s.from('profiles').delete().eq('id', userId)
    await s.auth.admin.deleteUser(userId).catch(() => {})
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
  process.exit(fail === 0 ? 0 : 1)
}
