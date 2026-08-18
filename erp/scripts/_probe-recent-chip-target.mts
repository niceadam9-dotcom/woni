// [최근 본 고객] 칩 이동 대상 검증 — 점검업무=점검 상세 / 고객관리=고객 상세
// 실행: npx tsx scripts/_probe-recent-chip-target.mts   (dev 3000 필요)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'recent-chip@sjfire.test'
let userId = '', noInspCustId = ''

const run = async () => {
  // ① 점검이 여러 건 있는 고객 — '가장 최근' 선택 규칙 확인용
  const { data: rows } = await raw.from('inspections')
    .select('customer_id, id, inspection_start_date')
    .not('inspection_start_date', 'is', null)
    .order('inspection_start_date', { ascending: false }).limit(400)
  const byCust = new Map<string, Array<{ id: string; d: string }>>()
  for (const r of (rows ?? []) as Array<{ customer_id: string; id: string; inspection_start_date: string }>) {
    if (!byCust.has(r.customer_id)) byCust.set(r.customer_id, [])
    byCust.get(r.customer_id)!.push({ id: r.id, d: r.inspection_start_date })
  }
  const multi = [...byCust.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (!multi) throw new Error('점검 있는 고객이 없습니다.')
  const [custId, list] = multi
  const expected = list.slice().sort((a, b) => (a.d < b.d ? 1 : -1))[0]
  console.log(`대상 고객 ${custId} · 점검 ${list.length}건 · 기대 이동 ${expected.id} (${expected.d})`)

  userId = await mkUser({ email: EMAIL, name: '칩E2E', employeeId: 'RC-001', role: 'admin' })
  // ② 점검이 하나도 없는 고객 — 폴백 확인용
  noInspCustId = await mkCustomer({ customer_name: '칩폴백E2E', address: '경기도 양평군 없음로 1', created_by: userId })

  const { browser, page } = await launch()
  try {
    await login(page, EMAIL)

    // 징검다리 라우트 — 점검 있는 고객
    await page.goto(`${BASE}/inspections/by-customer/${custId}`)
    await page.waitForLoadState('networkidle')
    const u1 = new URL(page.url())
    check('점검 있는 고객 → 점검 상세로 이동', u1.pathname === `/inspections/${expected.id}`, u1.pathname)
    check('가장 최근 점검이 선택됨', u1.pathname.endsWith(expected.id), `기대 ${expected.id}`)

    // 폴백 — 점검 없는 고객
    await page.goto(`${BASE}/inspections/by-customer/${noInspCustId}`)
    await page.waitForLoadState('networkidle')
    const u2 = new URL(page.url())
    check('점검 없는 고객 → 고객 상세로 폴백', u2.pathname === `/customers/${noInspCustId}`, u2.pathname)

    // 잘못된 id — 404 대신 고객 목록
    await page.goto(`${BASE}/inspections/by-customer/not-a-uuid`)
    await page.waitForLoadState('networkidle')
    check('잘못된 경로 → 고객 목록', new URL(page.url()).pathname === '/customers', new URL(page.url()).pathname)

    // 칩 링크 주소 — 화면별로 달라야 한다
    await page.goto(`${BASE}/customers/${custId}`)          // 최근 본 고객에 기록
    await page.waitForLoadState('networkidle')

    await page.goto(`${BASE}/inspections`)
    await page.waitForLoadState('networkidle')
    const chipInsp = page.locator('[data-recent-strip] a').first()
    await chipInsp.waitFor({ state: 'visible', timeout: 15000 })
    const hrefInsp = await chipInsp.getAttribute('href')
    check('점검업무 칩 → by-customer 링크', (hrefInsp ?? '').startsWith('/inspections/by-customer/'), hrefInsp ?? '')

    await page.goto(`${BASE}/customers`)
    await page.waitForLoadState('networkidle')
    const chipCust = page.locator('[data-recent-strip] a').first()
    await chipCust.waitFor({ state: 'visible', timeout: 15000 })
    const hrefCust = await chipCust.getAttribute('href')
    check('고객관리 칩 → 고객 상세 링크 (변경 없음)', (hrefCust ?? '').startsWith('/customers/'), hrefCust ?? '')

    // 실제 클릭 — 점검업무 칩이 점검 상세까지 도달하는가
    await page.goto(`${BASE}/inspections`)
    await page.waitForLoadState('networkidle')
    // 징검다리 라우트를 한 번 거치므로 URL 확정까지 기다린다(networkidle만으론 이동 전에 통과한다)
    await page.locator('[data-recent-strip] a').first().click()
    await page.waitForURL(u => /^\/inspections\/[0-9a-f-]{36}$/i.test(new URL(u).pathname), { timeout: 20000 })
      .catch(() => {})
    await page.waitForLoadState('networkidle')
    check('칩 클릭 → 점검 상세 도달', /^\/inspections\/[0-9a-f-]{36}$/i.test(new URL(page.url()).pathname), new URL(page.url()).pathname)
  } finally {
    await browser.close()
    await cleanupCustomer(noInspCustId)
    await delUser(userId)
  }
  summary()
}

run().catch(e => { console.error(e); process.exit(1) })
