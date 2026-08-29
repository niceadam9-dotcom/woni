// 소방계획서 동선 3직행 프로브 (2026-08-28, 소방계획서_34로 목적지 갱신 2026-08-29) —
// 신설 링크가 실제로 별지 서식 화면에 도달하는지. 기존 스위트는 '깨지지 않았는가'만 보므로,
// '새 길이 열렸는가'는 여기서 본다.
// 실행: npx tsx scripts/_probe-plan-access-paths.mts  (로컬 dev + 스테이징 DB)
//   ① 달력 데이 패널  ② 최근 본 고객 칩 📄  ③ 고객 상세 헤더 버튼
// ⚠ 2026-08-29 소방계획서_34: 별지 서식이 소방계획서 탭 안 트리 노드 → **최상위 [별지서식] 탭**으로
//   승격됐다. 목적지가 ?tab=plan&form=annex → ?tab=annex 로 바뀌었고, 판정 축도
//   '트리에서 선택된 노드(data-plan-node)' → '활성 탭'으로 옮겼다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'plan-access-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** KST 오늘 — 달력이 기본으로 여는 달에 점검이 있어야 데이 패널을 열 수 있다 */
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

/** 지금 활성인 탭의 라벨 — URL만 보면 탭 전환 실패를 놓친다(11-5 무반응 버그의 교훈).
 *  이 세 동선은 전부 [별지서식] 탭에 **랜딩**하는 것이 요구사항이다(소방계획서_30 S4 → _34).
 *  URL의 tab= 문자열이 아니라 **랜딩한 선택 상태**를 본다 — 링크의 tab 값을 plan으로 변조하면
 *  URL 검사는 여전히 통과하지만(문자열이 있긴 하다) 이 검사는 빨강이 된다(F-1 변이 검사). */
async function activeTabLabel(page: Awaited<ReturnType<typeof launch>>['page']): Promise<string> {
  return page.waitForSelector('[role=tab][aria-selected="true"]', { timeout: 20000 })
    .then(h => h.textContent()).then(v => (v ?? '').replace(/\s+/g, '')).catch(() => '(없음)')
}

/** 별지서식 탭이 실제로 활성인지 */
async function annexTabActive(page: Awaited<ReturnType<typeof launch>>['page']): Promise<boolean> {
  return (await activeTabLabel(page)).includes('별지서식')
}

try {
  userId = await mkUser({ email: EMAIL, name: '동선프로브', employeeId: 'E2E-NAV' })
  custId = await mkCustomer({ customer_name: '동선프로브고객', address: '경기 양평군 테스트로 9', created_by: userId })
  const { data: ins, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = ins!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── ① 달력 데이 패널 → 소방계획서 트리 (착륙 화면에서 작업대 경유 없이) ──
  await page.goto(`${BASE}/inspections/calendar`)
  await page.waitForSelector(`text=동선프로브고객`, { timeout: 30000 })
  await page.locator('text=동선프로브고객').first().click()
  const dayLink = page.locator('[data-testid="daypanel-plan-link"]')
  const dayLinkSeen = await dayLink.first().waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true).catch(() => false)
  check('① 데이 패널 — 별지서식 링크 노출', dayLinkSeen)
  if (dayLinkSeen) {
    check('① 링크 목적지 = 그 고객의 별지서식 탭',
      (await dayLink.first().getAttribute('href') ?? '').includes(`/customers/${custId}?tab=annex`))
    await dayLink.first().click()
    await page.waitForURL(u => u.pathname === `/customers/${custId}`, { timeout: 20000 }).catch(() => {})
    const n1 = await activeTabLabel(page)
    check('① 클릭 → [별지서식] 탭 활성 — 소방계획서 탭이 아니다', n1.includes('별지서식'), n1)
  }

  // ── ③ 고객 상세 헤더 상시 버튼 (다른 탭에 있어도 한 번에) ──
  await page.goto(`${BASE}/customers/${custId}?tab=buildings`)
  await page.waitForSelector('h1', { timeout: 20000 })
  const headerLink = page.locator('[data-testid="header-plan-link"]')
  const headerSeen = await headerLink.count() > 0
  check('③ 고객 상세 헤더 — [별지서식] 버튼 노출', headerSeen)
  if (headerSeen) {
    check('③ 헤더 링크 목적지도 tab=annex 지목',
      (await headerLink.getAttribute('href') ?? '').includes(`/customers/${custId}?tab=annex`),
      String(await headerLink.getAttribute('href')))
    await headerLink.click()
    const n3 = await activeTabLabel(page)
    check('③ 다른 탭(건물·시설)에서 눌러도 [별지서식] 탭 전환', n3.includes('별지서식'), n3)
  }

  // ── ② 최근 본 고객 칩 📄 (위에서 상세를 열었으므로 기록돼 있다) ──
  await page.goto(`${BASE}/customers`)
  const strip = page.locator('[data-recent-strip]')
  await strip.waitFor({ timeout: 20000 })
  // 이름 링크가 첫 <a>여야 한다 — test-recent-customers가 링크 순서로 최근순을 판정한다
  const firstHref = await strip.getByRole('link').first().getAttribute('href')
  check('② 칩의 첫 링크는 여전히 이름(고객 상세) — 최근순 판정 축 보존',
    firstHref === `/customers/${custId}`, String(firstHref))
  const planChip = strip.locator('[data-testid="recent-chip-plan-link"]').first()
  check('② 칩에 📄 별지서식 링크 존재', await planChip.count() > 0)
  check('② 칩 링크 목적지도 tab=annex 지목',
    (await planChip.getAttribute('href') ?? '').includes(`/customers/${custId}?tab=annex`),
    String(await planChip.getAttribute('href')))
  await planChip.click()
  await page.waitForURL(u => u.pathname === `/customers/${custId}`, { timeout: 20000 }).catch(() => {})
  const n2 = await activeTabLabel(page)
  check('② 📄 클릭 → [별지서식] 탭 활성', n2.includes('별지서식'), n2)

  // ── ④ 구 딥링크 하위호환 (소방계획서_34 S1-1) — 사용자 북마크·프로브 11종이 여기 의존한다.
  //    page.tsx의 정규화 3줄을 지우면 이 검사만 빨강이 된다.
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=annex`)
  await page.waitForSelector('h1', { timeout: 20000 })
  const n4 = await activeTabLabel(page)
  check('④ 구 딥링크 ?tab=plan&form=annex → [별지서식] 탭으로 해석', n4.includes('별지서식'), n4)

  // ── ⑤ 소방계획서 탭 트리에 별지 노드가 남아 있지 않다 (D34-2 완전 제거) ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.1`)
  await page.waitForSelector('h1', { timeout: 20000 })
  const annexNodeCount = await page.locator('[data-plan-node="annex"]').count()
  check('⑤ 소방계획서 트리에 [data-plan-node="annex"] 없음', annexNodeCount === 0, `count=${annexNodeCount}`)
  // 같은 화면에서 트리 선택 축은 그대로 살아 있어야 한다(변이 검사 축 보존)
  const sel11 = await page.locator('[data-plan-node][aria-current="true"]').first().getAttribute('data-plan-node').catch(() => null)
  check('⑤ form=1.1 딥링크는 여전히 트리 노드 1.1을 선택', sel11 === '1.1', String(sel11))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
