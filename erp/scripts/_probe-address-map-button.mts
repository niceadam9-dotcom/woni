/** 방문 준비 지도 버튼 — 네 화면 확산 검증 (소방계획서_24 S5-7 확산)
 *  실행: npx tsx scripts/_probe-address-map-button.mts
 *
 *  지키려는 것은 **양방향**이다. 주소가 있으면 버튼이 있어야 하고, 없으면 **없어야** 한다.
 *  한쪽만 보면 "항상 그린다"는 회귀를 놓친다 — 눌렀는데 빈 지도가 뜨는 것은 지도가
 *  없는 것보다 나쁘다(S5-7이 세운 원칙). 그 판단은 components/ui/address-map-button.tsx
 *  한곳에 있으므로, 여기서 깨지면 붙인 화면 네 곳이 함께 깨진다.
 *
 *  ★ 고객 목록의 단언이 특히 중요하다. 그 표는 **행 전체가 상세로 가는** ClickableRow라,
 *  모달을 행 안에 그리면 배경을 눌러 닫는 클릭이 행까지 올라가 **닫자마자 페이지가 튄다**
 *  (배경 div는 a·button이 아니라 ClickableRow의 예외 목록에 안 걸린다).
 *  모달을 createPortal로 body에 그려 막았고, 아래 '닫아도 목록에 남는다'가 그 회귀 단언이다.
 */
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, launch, login, BASE } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 7)
const EMAIL = `mapbtn.${SUF}@e2e.test`
const ADDRESS = '경기도 양평군 강하면 전수리 123-4'
const NAME_WITH = `지도있음${SUF}`
const MAP_BTN = '[data-testid="address-map-button"]'
const MODAL = '[data-testid="address-map-modal"]'

let userId = '', custWith = '', custWithout = '', inspWith = '', inspWithout = ''
let plan: { id: string; created: boolean } | null = null
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const TODAY = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]

async function mkInspection(customerId: string) {
  const { data, error } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: TODAY, status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  return (data as { id: string }).id
}

try {
  userId = await mkUser({ email: EMAIL, name: `지도${SUF}`, employeeId: `MAP-${SUF}` })
  custWith = await mkCustomer({ customer_name: NAME_WITH, created_by: userId, address: ADDRESS })
  custWithout = await mkCustomer({ customer_name: `지도없음${SUF}`, created_by: userId, address: null })
  inspWith = await mkInspection(custWith)
  inspWithout = await mkInspection(custWithout)

  // 달력 데이 패널에 뜰 정기 계획 1건
  plan = await ensurePlan(+TODAY.slice(0, 4), +TODAY.slice(5, 7), userId)
  const { error: piErr } = await raw.from('inspection_plan_items').insert({
    plan_id: plan.id, customer_id: custWith, sequence_num: 1,
    inspection_type: '작동', plan_type: 'monthly',
    scheduled_date: TODAY, status: 'confirmed', assigned_employee_id: userId,
  })
  if (piErr) throw new Error(`계획 항목 생성 실패: ${piErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  // ── ① 점검업무 상세 · 기본정보 팝오버 ────────────────────
  await page.goto(`${BASE}/inspections/${inspWith}`, { waitUntil: 'domcontentloaded' })
  const infoBtn = page.locator('button', { hasText: '기본정보' }).first()
  await infoBtn.waitFor()
  check('펼치기 전에는 지도 버튼이 없다(팝오버 안에 있다)', await page.locator(MAP_BTN).count() === 0)

  await infoBtn.click()
  await page.locator(MAP_BTN).waitFor({ timeout: 10000 })
  check('★ 점검 상세 — 주소가 있으면 [지도]가 있다', await page.locator(MAP_BTN).count() === 1)
  check('주소가 그대로 보인다(버튼이 주소 표시를 대체하지 않는다)',
    await page.locator(`text=${ADDRESS}`).count() > 0)

  // ── ② 눌렀을 때 실제로 쓸 수 있는 것이 뜨는가 ────────────
  await page.locator(MAP_BTN).click()
  const modal = page.locator(MODAL)
  await modal.waitFor({ timeout: 10000 })
  check('★ 모달이 열린다', await modal.isVisible())
  const text = await modal.innerText()
  check('모달에 주소가 있다', text.includes(ADDRESS))
  // iframe이 막혀도 길이 남아야 한다 — 이 둘이 그 대비책이다
  check('★ [새 창]이 함께 있다(iframe이 막혀도 길이 남는다)', text.includes('새 창'))
  check('★ [주소 복사]가 함께 있다(내비에 찍는 것이 실제 동선)', text.includes('주소 복사'))
  check('고객명이 모달 제목에 있다', text.includes(NAME_WITH))
  check('지도 iframe이 카카오맵을 가리킨다',
    (await modal.locator('iframe').getAttribute('src') ?? '').startsWith('https://map.kakao.com/link/search/'))
  // testid는 배경이 아니라 안쪽 흰 상자에 붙어 있다 → 배경(부모)의 부모가 body여야 포털이다
  check('★ 모달이 body 직속으로 그려진다(포털) — 붙는 자리에 갇히지 않는다',
    await page.evaluate(`document.querySelector('${MODAL}')?.parentElement?.parentElement === document.body`))

  await page.mouse.click(5, 5)
  await page.waitForTimeout(300)
  check('배경을 누르면 닫힌다', await page.locator(MODAL).count() === 0)

  // ── ③ 주소가 없는 고객 — 여기가 진짜 단언 ────────────────
  await page.goto(`${BASE}/inspections/${inspWithout}`, { waitUntil: 'domcontentloaded' })
  const infoBtn2 = page.locator('button', { hasText: '기본정보' }).first()
  await infoBtn2.waitFor()
  await infoBtn2.click()
  await page.waitForTimeout(500)
  check('★ 주소가 없으면 [지도]도 없다 — 빈 지도는 없는 것보다 나쁘다',
    await page.locator(MAP_BTN).count() === 0)
  check('그래도 팝오버 자체는 열린다', await page.locator('text=담당자').count() > 0)

  // ── ④ 고객관리 목록 — 행 전체가 클릭 대상인 표 ───────────
  await page.goto(`${BASE}/customers?q=${encodeURIComponent(NAME_WITH)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  const listBtn = page.locator(MAP_BTN)
  await listBtn.first().waitFor({ timeout: 15000 })
  check('★ 고객 목록 — 주소 줄에 지도 아이콘이 있다', await listBtn.count() >= 1, `${await listBtn.count()}개`)
  check('주소 텍스트는 그대로 남는다(아이콘이 주소를 밀어내지 않는다)',
    await page.locator(`text=${ADDRESS}`).count() > 0)

  const urlBefore = page.url()
  await listBtn.first().click()
  await page.locator(MODAL).waitFor({ timeout: 10000 })
  check('아이콘을 눌러도 상세로 가지 않는다(ClickableRow 예외에 button이 걸린다)',
    page.url() === urlBefore, page.url())
  // 이게 튕김을 막는 실제 성질이다 — 행 안에 있으면 배경 클릭이 tr까지 올라간다
  check('★ 모달이 행(tr) 바깥에 있다',
    await page.evaluate(`document.querySelector('${MODAL}')?.closest('tr') === null`))

  await page.mouse.click(5, 5)
  await page.waitForTimeout(600)
  check('★★ 모달을 닫아도 목록에 남는다 — 포털이 없으면 여기서 상세로 튄다',
    page.url() === urlBefore && await page.locator(MODAL).count() === 0, page.url())

  // ── ⑤ 고객 상세 우측 요약 패널 (xl 이상에서만 보인다) ────
  await page.goto(`${BASE}/customers/${custWith}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  const asideBtn = page.locator(`aside ${MAP_BTN}`)
  await asideBtn.waitFor({ timeout: 15000 })
  check('★ 고객 상세 요약 패널 — [지도]가 있다(서버 컴포넌트 안의 클라이언트 컴포넌트)',
    await asideBtn.count() === 1)

  await page.goto(`${BASE}/customers/${custWithout}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  check("★ 주소 미입력 고객의 요약 패널에는 버튼이 없다",
    await page.locator(`aside ${MAP_BTN}`).count() === 0)
  check("대신 '미입력'이 보인다", await page.locator('aside', { hasText: '미입력' }).count() > 0)

  // ── ⑥ 점검달력 데이 패널 ─────────────────────────────────
  await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  // 날짜 라벨은 0 채움이고 앞뒤 달 셀도 같은 숫자를 쓴다 → 현재 달 셀에서만 고른다
  const dayNum = +TODAY.slice(8, 10)
  await page.locator('.rbc-date-cell:not(.rbc-off-range) button[title="이 날짜의 전체 일정 보기"]',
    { hasText: new RegExp(`^0*${dayNum}$`) }).first().click()
  await page.waitForTimeout(600)

  const planRow = page.locator('div').filter({ hasText: new RegExp(`^정기${NAME_WITH}`) }).last()
  check('데이 패널에 그 고객의 정기 일정이 있다', await planRow.count() > 0)
  check('★ 달력 데이 패널 — 계획 행에 지도 아이콘이 있다',
    await planRow.locator(MAP_BTN).count() === 1, `${await planRow.locator(MAP_BTN).count()}개`)

  await planRow.locator(MAP_BTN).first().click()
  await page.locator(MODAL).waitFor({ timeout: 10000 })
  check('달력에서도 모달이 열리고 주소가 맞다', (await page.locator(MODAL).innerText()).includes(ADDRESS))
  await page.mouse.click(5, 5)
  await page.waitForTimeout(400)
  check('닫으면 데이 패널이 그대로 남는다(선택 상태가 날아가지 않는다)',
    await page.locator(MODAL).count() === 0 && page.url().includes('/inspections/calendar'))
} finally {
  if (browser) { try { await browser.close() } catch { /* 무시 */ } }
  for (const id of [inspWith, inspWithout]) {
    if (id) { try { await raw.from('inspections').delete().eq('id', id) } catch { /* 무시 */ } }
  }
  for (const id of [custWith, custWithout]) {
    if (id) { try { await cleanupCustomer(id) } catch { /* 무시 */ } }
  }
  if (plan?.created) { try { await raw.from('inspection_plans').delete().eq('id', plan.id) } catch { /* 무시 */ } }
  if (userId) { try { await delUser(userId) } catch { /* 무시 */ } }
}
summary()
