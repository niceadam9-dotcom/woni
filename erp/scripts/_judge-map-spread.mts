/** [판정자] 방문 준비 지도 — S5-7(문자 발송) + S5-7b(네 화면 확산) 독립 재검증
 *  실행: npx tsx scripts/_judge-map-spread.mts
 *
 *  구현자 프로브(_probe-address-map-button.mts)가 **덮지 않은 곳**을 겨냥한다:
 *   ① 고객 목록의 음성 방향(주소 없는 고객 행에 버튼이 없는가) — 구현자는 양성만 봤다
 *   ② 달력 데이 패널의 음성 방향
 *   ③ 달력 **단계 행**(S5-7b desc가 '계획/단계 행'이라 못박았는데 프로브는 계획 행만 봤다)
 *   ④ 문자 발송 화면(S5-7 본체) — 별도 프로브(test-inspection-sms)에 있다지만 여기서 직접 본다
 *   ⑤ 공백뿐인 주소('   ') — 판단이 정말 한곳인지 드러내는 리트머스
 */
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, launch, login, BASE } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 7)
const EMAIL = `judgemap.${SUF}@e2e.test`
const ADDRESS = '경기도 양평군 강하면 전수리 123-4'
const N_WITH = `판정지도유${SUF}`
const N_NONE = `판정지도무${SUF}`
const N_BLANK = `판정지도공${SUF}`
const MAP_BTN = '[data-testid="address-map-button"]'
const MODAL = '[data-testid="address-map-modal"]'
const SMS_MAP = '[data-testid="row-map"]'

const TODAY = new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]

let userId = ''
const custs: Record<string, string> = {}
const insps: Record<string, string> = {}
let plan: { id: string; created: boolean } | null = null
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

async function mkInspection(customerId: string) {
  const { data, error } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: TODAY, status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  const id = (data as { id: string }).id
  // 단계 행이 데이 패널에 뜨려면 오늘 마감인 단계가 필요하다.
  const { data: st } = await raw.from('inspection_steps').select('id').eq('inspection_id', id)
  if ((st ?? []).length > 0) {
    await raw.from('inspection_steps').update({ due_date: TODAY, status: 'pending' }).eq('id', (st as { id: string }[])[0].id)
  } else {
    const { error: sErr } = await raw.from('inspection_steps').insert({
      inspection_id: id, step_num: 2, name_ko: '점검 실시', due_date: TODAY, status: 'pending',
    })
    if (sErr) throw new Error(`단계 생성 실패: ${sErr.message}`)
  }
  return id
}

try {
  userId = await mkUser({ email: EMAIL, name: `판정${SUF}`, employeeId: `JMAP-${SUF}` })
  custs.with = await mkCustomer({ customer_name: N_WITH, created_by: userId, address: ADDRESS })
  custs.none = await mkCustomer({ customer_name: N_NONE, created_by: userId, address: null })
  custs.blank = await mkCustomer({ customer_name: N_BLANK, created_by: userId, address: '   ' })
  insps.with = await mkInspection(custs.with)
  insps.none = await mkInspection(custs.none)

  plan = await ensurePlan(+TODAY.slice(0, 4), +TODAY.slice(5, 7), userId)
  for (const [k, cid] of Object.entries(custs)) {
    const { error } = await raw.from('inspection_plan_items').insert({
      plan_id: plan.id, customer_id: cid, sequence_num: 1,
      inspection_type: '작동', plan_type: 'monthly',
      scheduled_date: TODAY, status: 'confirmed', assigned_employee_id: userId,
    })
    if (error) throw new Error(`계획 항목(${k}) 실패: ${error.message}`)
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  // ─────────────────────────────────────────────────────────────
  // A. S5-7 본체 — 문자 발송 화면
  // ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/inspections/sms`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const rowWith = page.locator('tr[data-testid="sms-row"]', { hasText: N_WITH })
  const rowNone = page.locator('tr[data-testid="sms-row"]', { hasText: N_NONE })
  const rowBlank = page.locator('tr[data-testid="sms-row"]', { hasText: N_BLANK })
  check('[A0] 문자 발송 화면에 세 고객 행이 모두 뜬다',
    await rowWith.count() === 1 && await rowNone.count() === 1 && await rowBlank.count() === 1,
    `with=${await rowWith.count()} none=${await rowNone.count()} blank=${await rowBlank.count()}`)

  check('[A1] 주소 있으면 [지도]가 있다', await rowWith.locator(SMS_MAP).count() === 1)
  check('[A2] 주소 없으면 [지도]가 없다(양방향)', await rowNone.locator(SMS_MAP).count() === 0,
    `${await rowNone.locator(SMS_MAP).count()}개`)
  const blankSms = await rowBlank.locator(SMS_MAP).count()
  check('[A3] 공백뿐인 주소에도 [지도]가 없다(빈 지도 금지 원칙)', blankSms === 0, `${blankSms}개 — 발송 화면은 자체 판단(r.address &&)을 쓴다`)

  await rowWith.locator(SMS_MAP).click()
  await page.locator(MODAL).waitFor({ timeout: 15000 })
  const smsModalText = await page.locator(MODAL).innerText()
  check('[A4] 모달에 주소·[새 창]·[주소 복사]가 모두 있다',
    smsModalText.includes(ADDRESS) && smsModalText.includes('새 창') && smsModalText.includes('주소 복사'))
  check('[A5] iframe이 카카오맵을 가리킨다',
    (await page.locator(`${MODAL} iframe`).getAttribute('src') ?? '').startsWith('https://map.kakao.com/link/search/'))
  check('[A6] 모달이 body 직속(포털)',
    await page.evaluate(`document.querySelector('${MODAL}')?.parentElement?.parentElement === document.body`))
  await page.mouse.click(5, 5)
  await page.waitForTimeout(400)
  check('[A7] 배경 클릭으로 닫히고 발송 화면에 남는다',
    await page.locator(MODAL).count() === 0 && page.url().includes('/inspections/sms'))

  // ─────────────────────────────────────────────────────────────
  // B. 점검업무 상세 — 기본정보 팝오버
  // ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/inspections/${insps.with}`, { waitUntil: 'domcontentloaded' })
  const info1 = page.locator('button', { hasText: '기본정보' }).first()
  await info1.waitFor()
  await info1.click()
  await page.locator(MAP_BTN).waitFor({ timeout: 15000 })
  check('[B1] 점검 상세 — 주소 있으면 [지도]', await page.locator(MAP_BTN).count() === 1)

  await page.goto(`${BASE}/inspections/${insps.none}`, { waitUntil: 'domcontentloaded' })
  const info2 = page.locator('button', { hasText: '기본정보' }).first()
  await info2.waitFor()
  await info2.click()
  await page.waitForTimeout(600)
  check('[B2] 점검 상세 — 주소 없으면 [지도] 없음', await page.locator(MAP_BTN).count() === 0)

  // ─────────────────────────────────────────────────────────────
  // C. 고객관리 목록 — 음성 방향 + 튕김 회귀 (구현자 프로브 공백)
  // ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/customers?q=${encodeURIComponent(SUF)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  const trWith = page.locator('tr', { hasText: N_WITH })
  const trNone = page.locator('tr', { hasText: N_NONE })
  const trBlank = page.locator('tr', { hasText: N_BLANK })
  await trWith.first().waitFor({ timeout: 20000 })
  check('[C0] 세 고객이 한 목록에 함께 뜬다(같은 조건에서 비교)',
    await trWith.count() >= 1 && await trNone.count() >= 1 && await trBlank.count() >= 1,
    `with=${await trWith.count()} none=${await trNone.count()} blank=${await trBlank.count()}`)
  check('[C1] 주소 있는 행에 지도 아이콘', await trWith.first().locator(MAP_BTN).count() === 1)
  check('[C2] ★ 주소 없는 행에는 아이콘이 없다(구현자 프로브가 안 본 방향)',
    await trNone.first().locator(MAP_BTN).count() === 0, `${await trNone.first().locator(MAP_BTN).count()}개`)
  check('[C3] 공백뿐인 주소 행에도 아이콘이 없다',
    await trBlank.first().locator(MAP_BTN).count() === 0, `${await trBlank.first().locator(MAP_BTN).count()}개`)

  const urlBefore = page.url()
  await trWith.first().locator(MAP_BTN).click()
  await page.locator(MODAL).waitFor({ timeout: 15000 })
  check('[C4] 아이콘 클릭이 행 내비게이션을 일으키지 않는다', page.url() === urlBefore, page.url())
  check('[C5] 모달이 tr 바깥(포털)', await page.evaluate(`document.querySelector('${MODAL}')?.closest('tr') === null`))
  await page.mouse.click(5, 5)
  await page.waitForTimeout(900)
  check('[C6] ★★ 배경 클릭으로 닫아도 상세로 튀지 않는다',
    page.url() === urlBefore && await page.locator(MODAL).count() === 0, page.url())
  // ESC로 닫는 경로는 없다 — 있는지만 확인하고 기록
  await trWith.first().locator(MAP_BTN).click()
  await page.locator(MODAL).waitFor({ timeout: 15000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check('[C7] (참고) ESC로도 닫힌다', await page.locator(MODAL).count() === 0, 'ESC 핸들러 없음 — 배경/X만')
  if (await page.locator(MODAL).count() > 0) { await page.mouse.click(5, 5); await page.waitForTimeout(400) }

  // ─────────────────────────────────────────────────────────────
  // D. 고객 상세 우측 요약 패널
  // ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/customers/${custs.with}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  await page.locator(`aside ${MAP_BTN}`).waitFor({ timeout: 20000 })
  check('[D1] 고객 상세 요약 패널 — [지도] 있음', await page.locator(`aside ${MAP_BTN}`).count() === 1)
  await page.goto(`${BASE}/customers/${custs.none}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  check('[D2] 주소 없는 고객 상세 — [지도] 없음', await page.locator(`aside ${MAP_BTN}`).count() === 0)
  await page.goto(`${BASE}/customers/${custs.blank}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  check('[D3] 공백 주소 고객 상세 — [지도] 없음', await page.locator(`aside ${MAP_BTN}`).count() === 0,
    `${await page.locator(`aside ${MAP_BTN}`).count()}개`)

  // ─────────────────────────────────────────────────────────────
  // E. 점검달력 데이 패널 — 계획 행 + 단계 행, 양방향
  // ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
  const dayNum = +TODAY.slice(8, 10)
  await page.locator('.rbc-date-cell:not(.rbc-off-range) button[title="이 날짜의 전체 일정 보기"]',
    { hasText: new RegExp(`^0*${dayNum}$`) }).first().click()
  await page.waitForTimeout(900)

  const panel = page.locator('div.fixed.top-0.right-0').first()
  // 계획 행
  const planWith = panel.locator('div').filter({ hasText: new RegExp(`^정기${N_WITH}`) }).last()
  const planNone = panel.locator('div').filter({ hasText: new RegExp(`^정기${N_NONE}`) }).last()
  check('[E0] 데이 패널에 두 계획 행이 있다', await planWith.count() > 0 && await planNone.count() > 0)
  check('[E1] 계획 행 — 주소 있으면 아이콘', await planWith.locator(MAP_BTN).count() === 1,
    `${await planWith.locator(MAP_BTN).count()}개`)
  check('[E2] ★ 계획 행 — 주소 없으면 아이콘 없음(구현자 프로브 공백)',
    await planNone.locator(MAP_BTN).count() === 0, `${await planNone.locator(MAP_BTN).count()}개`)

  // 단계 행 — S5-7b desc가 명시한 '단계 행'. 단계 일정 섹션 안에서 고객명으로 찾는다.
  const stepSection = panel.locator('div').filter({ hasText: /단계 일정 \(종합·작동\)/ }).last()
  const stepRowWith = stepSection.locator('div.flex.items-center.gap-1', { hasText: N_WITH })
  const stepRowNone = stepSection.locator('div.flex.items-center.gap-1', { hasText: N_NONE })
  check('[E3] 데이 패널에 단계 행이 있다',
    await stepRowWith.count() > 0 && await stepRowNone.count() > 0,
    `with=${await stepRowWith.count()} none=${await stepRowNone.count()}`)
  check('[E4] ★ 단계 행 — 주소 있으면 아이콘(프로브가 아예 안 본 자리)',
    await stepRowWith.first().locator(MAP_BTN).count() === 1,
    `${await stepRowWith.first().locator(MAP_BTN).count()}개`)
  check('[E5] ★ 단계 행 — 주소 없으면 아이콘 없음',
    await stepRowNone.first().locator(MAP_BTN).count() === 0,
    `${await stepRowNone.first().locator(MAP_BTN).count()}개`)

  // 단계 행의 지도 클릭이 행 버튼(점검 상세로 이동)을 함께 발화시키지 않아야 한다
  const calUrl = page.url()
  await stepRowWith.first().locator(MAP_BTN).click()
  await page.locator(MODAL).waitFor({ timeout: 15000 })
  check('[E6] 단계 행 지도 클릭이 패널을 닫거나 페이지를 옮기지 않는다',
    page.url() === calUrl && (await page.locator(MODAL).innerText()).includes(ADDRESS))
  await page.mouse.click(5, 5)
  await page.waitForTimeout(500)
  check('[E7] 닫아도 데이 패널이 남는다',
    await page.locator(MODAL).count() === 0 && await panel.count() > 0)
} finally {
  if (browser) { try { await browser.close() } catch { /* 무시 */ } }
  for (const id of Object.values(insps)) {
    if (id) {
      try { await raw.from('inspection_steps').delete().eq('inspection_id', id) } catch { /* 무시 */ }
      try { await raw.from('inspections').delete().eq('id', id) } catch { /* 무시 */ }
    }
  }
  for (const id of Object.values(custs)) {
    if (id) { try { await cleanupCustomer(id) } catch { /* 무시 */ } }
  }
  if (plan?.created) { try { await raw.from('inspection_plans').delete().eq('id', plan.id) } catch { /* 무시 */ } }
  if (userId) { try { await delUser(userId) } catch { /* 무시 */ } }
}
summary()
