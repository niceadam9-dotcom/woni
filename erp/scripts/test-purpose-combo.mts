// 건물용도 콤보(ComboInput) E2E — 누르면 목록이 뜨고, 목록에 없는 값도 직접 입력·저장된다
// 실행: npx tsx scripts/test-purpose-combo.mts   (로컬 dev + 스테이징 DB)
//
// 종전 결함(2026-08-19 사용자 보고): <input list> + <datalist>는 **타이핑을 시작해야** 제안이 뜬다.
// 칸을 눌러도 아무것도 안 보여 "선택하거나 직접 입력"이라는 안내가 거짓말이었고, 목록이 있는 줄도 몰랐다.
// 이 스위트가 '눌러서 펼침'과 '자유 입력 보존'을 함께 고정한다 — 후자를 잃으면(=select로 바꾸면)
// 건축물대장이 넣는 목록 밖 용도가 잘린다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'purpose-combo-e2e@erp-test.com'
let userId = '', custId = ''
let createdCustomerId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const NOVEL = `ZZ목록밖용도${Math.random().toString(36).slice(2, 6)}`

try {
  userId = await mkUser({ email: EMAIL, name: '용도콤보E2E', employeeId: 'E2E-PCB' })

  const { data: purposeRows } = await raw.from('building_purposes').select('name').order('sort_order')
  const purposes = ((purposeRows ?? []) as Array<{ name: string }>).map(r => r.name)
  if (purposes.length < 2) throw new Error(`building_purposes가 ${purposes.length}건 — 이 스위트는 2건 이상 필요`)

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  // ── 1. 고객 등록 — 누르면 목록이 펼쳐진다 ─────────────────────────────────
  console.log('— 1. 고객 등록: 눌러서 펼침')
  await page.goto(`${BASE}/customers/new`)
  await page.waitForLoadState('networkidle')
  const combo = page.getByRole('combobox', { name: '건물용도' })
  await combo.waitFor({ state: 'visible', timeout: 20000 })

  check('열기 전에는 목록이 없다', await page.locator('[data-combo-list]').count() === 0)
  await combo.click()
  await page.locator('[data-combo-list]').waitFor({ state: 'visible', timeout: 8000 })
  const shown = await page.locator('[data-combo-option]').count()
  check(`클릭만으로 전체 목록이 뜬다 (${shown}/${purposes.length}건)`, shown === purposes.length, `${shown}건`)

  // ── 2. 타이핑하면 걸러진다 ────────────────────────────────────────────────
  console.log('— 2. 타이핑 필터')
  const needle = purposes[0].slice(0, 2)
  await combo.fill(needle)
  await page.waitForTimeout(400)
  const filtered = await page.locator('[data-combo-option]').allInnerTexts()
  check(`"${needle}" 입력 시 해당 항목만 남는다`,
    filtered.length > 0 && filtered.every(t => t.includes(needle)), JSON.stringify(filtered))

  // ── 3. 항목 클릭 → 값 반영 ────────────────────────────────────────────────
  console.log('— 3. 목록에서 선택')
  await page.locator('[data-combo-option]').first().click()
  await page.waitForTimeout(400)
  check('선택하면 입력칸에 값이 들어간다', (await combo.inputValue()) === purposes[0], await combo.inputValue())
  check('선택 후 목록은 닫힌다', await page.locator('[data-combo-list]').count() === 0)

  // 이미 고른 값이 있어도 다시 열면 **전체**가 보여야 갈아탈 수 있다
  await combo.click()
  await page.locator('[data-combo-list]').waitFor({ state: 'visible', timeout: 8000 })
  check('선택된 상태로 다시 열면 전체 목록(갈아타기 가능)',
    await page.locator('[data-combo-option]').count() === purposes.length)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('ESC로 닫힌다', await page.locator('[data-combo-list]').count() === 0)

  // ── 4. 목록에 없는 값 직접 입력 (이 기능의 핵심 — select로 바꾸면 깨진다) ──
  console.log('— 4. 목록 밖 값 직접 입력')
  await combo.fill(NOVEL)
  await page.waitForTimeout(500)
  check('목록 밖 값도 그대로 입력된다', (await combo.inputValue()) === NOVEL, await combo.inputValue())
  const emptyMsg = await page.locator('[data-combo-list]').innerText().catch(() => '')
  check('목록 0건이면 저장된다는 안내가 뜬다', emptyMsg.includes('입력한 그대로'), emptyMsg.slice(0, 60))

  // ── 5. 건물·시설 탭에도 같은 콤보 + 저장까지 살아남는가 ───────────────────
  //  저장 검증은 고객 등록 폼(필수 4칸)이 아니라 건물 패널(건물명·건축허가일 필수, 그나마 자동 채움)로
  //  한다 — 확인하려는 것은 '목록 밖 값이 DB까지 가는가'이지 등록 폼의 필수 검증이 아니다.
  console.log('— 5. 건물·시설 탭 + 저장 후 DB 확인')
  custId = await mkCustomer({ customer_name: `ZZ콤보탭${Math.random().toString(36).slice(2, 6)}`, created_by: userId })
  await page.goto(`${BASE}/customers/${custId}?tab=buildings`)
  await page.waitForLoadState('networkidle')
  // '건물 등록' 폼은 항상 열림(2026-09-05) — 버튼은 기존 건물 수정 중일 때만 나타난다
  const newBtn = page.getByRole('button', { name: /건물 등록/ })
  if (await newBtn.count() > 0) await newBtn.first().click()
  await page.waitForTimeout(1500)

  const combo2 = page.locator('#bf-purpose')
  await combo2.waitFor({ state: 'visible', timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: 'scripts/_shots/combo-tab-fail.png', fullPage: true })
  })
  check('건물·시설 탭에 용도 콤보가 있다', await combo2.count() > 0)
  await combo2.click()
  await page.locator('[data-combo-list]').waitFor({ state: 'visible', timeout: 8000 })
  check('건물·시설 탭 용도 칸도 눌러서 펼쳐진다',
    await page.locator('[data-combo-option]').count() === purposes.length)

  await combo2.fill(NOVEL)
  await page.waitForTimeout(400)
  // 건축허가일 필수(2026-09-05) — 안 채우면 저장이 가드에 막혀 이 검사가 용도 축과 무관하게 빨개진다
  await page.locator('#bf-permit-date').fill('2000-01-01')
  await page.getByRole('button', { name: '저장', exact: true }).first().click()
  await page.waitForTimeout(3000)

  const { data: bld } = await raw.from('buildings').select('purpose').eq('customer_id', custId).limit(1).maybeSingle()
  const savedPurpose = (bld as { purpose: string | null } | null)?.purpose ?? null
  check('목록 밖 용도가 DB에 그대로 저장된다(강제 선택으로 잘리지 않음)', savedPurpose === NOVEL, String(savedPurpose))
} finally {
  if (browser) await browser.close()
  await cleanupCustomer(createdCustomerId)
  await cleanupCustomer(custId)
  await delUser(userId)
}

summary()
