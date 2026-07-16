/** 092 검증: 고객관리 건물 폼에서 Daum 주소 검색 시 bcode·address_jibun 저장 확인 (2026-07-16)
 *  실행: npx tsx scripts/verify-bcode-092.mts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'fs'
import { chromium, type Page } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const NAME = 'TEST-BCODE-검증고객'
const EMAIL = 'test-bcode-admin@erp-test.com'
const PW = 'BcodeTest1!'
const SHOT_DIR = '.verify-092'
mkdirSync(SHOT_DIR, { recursive: true })

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

let customerId = ''
let userId = ''
let browser: import('playwright').Browser | null = null

type BRow = { id: string; building_name: string; bcode: string | null; address_jibun: string | null; zipcode: string | null; address: string | null; purpose: string | null; total_area: number | null }
async function getBuildings(): Promise<BRow[]> {
  const { data } = await raw.from('buildings')
    .select('id, building_name, bcode, address_jibun, zipcode, address, purpose, total_area')
    .eq('customer_id', customerId).order('created_at')
  return (data ?? []) as BRow[]
}
async function waitFor<T>(get: () => Promise<T>, cond: (v: T) => boolean, ms = 15000): Promise<T> {
  const start = Date.now()
  let last: T = await get()
  while (Date.now() - start < ms) {
    if (cond(last)) return last
    await new Promise(r => setTimeout(r, 500))
    last = await get()
  }
  return last
}

/** Daum 우편번호 팝업에서 주소 검색 후 첫 도로명주소 결과 클릭 */
async function daumSearch(page: Page, query: string, tag: string) {
  // Daum 스크립트 로드 대기 — 미로드 시 클릭하면 안내 alert만 뜸
  await page.waitForFunction(() => !!(window as unknown as { daum?: { Postcode?: unknown } }).daum?.Postcode, undefined, { timeout: 20000 })
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 15000 }),
    page.getByRole('button', { name: '주소 검색' }).click(),
  ])
  await popup.waitForLoadState('domcontentloaded')
  await popup.waitForTimeout(1500)
  await popup.screenshot({ path: `${SHOT_DIR}/${tag}-popup-open.png` }).catch(() => {})
  // 위젯 UI는 iframe 내부 — 검색 input이 있는 프레임 탐색 (최대 10초)
  let frame: import('playwright').Frame | null = null
  for (let i = 0; i < 20 && !frame; i++) {
    for (const f of popup.frames()) {
      const n = await f.locator('input[type=text]').count().catch(() => 0)
      if (n > 0) { frame = f; break }
    }
    if (!frame) await popup.waitForTimeout(500)
  }
  if (!frame) throw new Error('Daum 팝업에서 검색 input 프레임을 찾지 못함')
  console.log('  검색 프레임:', frame.url().slice(0, 80))
  const input = frame.locator('input[type=text]').first()
  await input.fill(query)
  await input.press('Enter')
  await popup.waitForTimeout(2000)
  await popup.screenshot({ path: `${SHOT_DIR}/${tag}-popup-results.png` }).catch(() => {})
  // 결과에서 도로명주소 링크 클릭 (query 텍스트 포함 요소)
  const hit = frame.getByText(query, { exact: false }).first()
  await hit.click().catch(() => {})
  // 클릭으로 oncomplete가 발동하면 팝업이 즉시 닫힘 — 닫힘 대기(정상 경로)
  await popup.waitForEvent('close', { timeout: 5000 }).catch(async () => {
    // 아직 안 닫혔으면 상세(건물명/동) 선택 단계 — 첫 항목 클릭
    if (!popup.isClosed()) {
      await popup.screenshot({ path: `${SHOT_DIR}/${tag}-popup-step2.png` }).catch(() => {})
      const any = frame!.locator('button, a').filter({ hasText: /선택|지번|도로명/ }).first()
      await any.click().catch(() => {})
      await popup.waitForEvent('close', { timeout: 5000 }).catch(() => {})
    }
  })
}

try {
  console.log('\n[셋업] 테스트 관리자 + 고객 생성')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-BCODE관리자', role: 'admin', is_active: true, employee_id: 'TEST-BCD', email: EMAIL })

  const { data: cust, error: cErr } = await raw.from('customers').insert({
    customer_code: `TEST-BCD-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: NAME, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    address: '서울 중구 세종대로 110', is_active: true, created_by: userId,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id
  console.log('  customerId:', customerId)

  console.log('\n[로그인]')
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  page.on('dialog', d => { console.log('  [dialog]', d.message()); d.accept().catch(() => {}) })
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })
  check('로그인 성공', true)

  console.log('\n[1] 건물 탭 → 건물 등록 → 주소 검색 → 저장')
  await page.goto(`${BASE}/customers/${customerId}?tab=buildings`)
  await page.getByRole('button', { name: '건물 등록' }).click()
  await page.screenshot({ path: `${SHOT_DIR}/1-form-open.png` })
  // 고객 주소와 동일 체크가 기본일 수 있음 — 주소 검색이 해제하므로 그대로 진행
  await daumSearch(page, '세종대로 110', '1')
  await page.waitForTimeout(2500) // oncomplete 반영 + 건축물대장 자동조회 대기
  await page.screenshot({ path: `${SHOT_DIR}/1-after-search.png` })
  const addr = await page.locator('input[placeholder="주소 검색 또는 고객 주소 상속"]').inputValue()
  console.log('  폼 주소:', addr)
  check('폼에 도로명주소 반영', addr.includes('세종대로 110'), addr)
  await page.getByRole('button', { name: '저장', exact: true }).click()
  const after1 = await waitFor(getBuildings, l => l.length === 1, 20000)
  console.log('  DB row:', JSON.stringify(after1[0]))
  check('건물 1건 저장', after1.length === 1)
  check('bcode 10자리 저장', !!after1[0]?.bcode && /^\d{10}$/.test(after1[0].bcode!), String(after1[0]?.bcode))
  check('address_jibun 저장(태평로1가)', !!after1[0]?.address_jibun && after1[0].address_jibun!.includes('태평로1가'), String(after1[0]?.address_jibun))

  console.log('\n[2/probe] 두 번째 건물 — 고객 주소와 동일(상속): bcode 자동 승계 확인')
  await page.goto(`${BASE}/customers/${customerId}?tab=buildings`)
  await page.getByRole('button', { name: '건물 등록' }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT_DIR}/2-inherit-form.png` })
  const nameInput = () => page.locator('div:has(> label:text("건물명 *")) > input')
  await nameInput().fill('TEST-BCODE-상속건물')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  const after2 = await waitFor(getBuildings, l => l.length === 2, 20000)
  const b2 = after2.find(b => b.building_name === 'TEST-BCODE-상속건물')
  console.log('  DB row2:', JSON.stringify(b2))
  check('상속 건물: bcode 승계', !!b2?.bcode && b2.bcode === after1[0].bcode, `${b2?.bcode} vs ${after1[0].bcode}`)
  check('상속 건물: 지번 승계', !!b2?.address_jibun && b2.address_jibun === after1[0].address_jibun, String(b2?.address_jibun))

  console.log('\n[3/probe] 세 번째 건물 — 상속 해제 + 주소 검색 없이 저장: bcode 없이도 정상 저장')
  await page.goto(`${BASE}/customers/${customerId}?tab=buildings`)
  await page.getByRole('button', { name: '건물 등록' }).click()
  await page.waitForTimeout(1000)
  const chk = page.locator('input[type=checkbox]')
  if (await chk.count() > 0 && await chk.first().isChecked()) await chk.first().uncheck()
  await page.locator('div:has(> label:text("건물명 *")) > input').fill('TEST-BCODE-무주소건물')
  await page.screenshot({ path: `${SHOT_DIR}/3-no-addr.png` })
  await page.getByRole('button', { name: '저장', exact: true }).click()
  const after3 = await waitFor(getBuildings, l => l.length === 3, 20000)
  const b3 = after3.find(b => b.building_name === 'TEST-BCODE-무주소건물')
  console.log('  DB row3:', JSON.stringify(b3))
  check('무주소 건물 저장 성공', !!b3)
  check('상속 해제 시 주소·bcode 클리어 저장', !!b3 && !b3.bcode && !b3.address && !b3.address_jibun,
    JSON.stringify({ bcode: b3?.bcode, address: b3?.address, jibun: b3?.address_jibun }))

  await page.screenshot({ path: `${SHOT_DIR}/final-list.png` })
} catch (e) {
  fail++
  console.error('\nERROR:', e instanceof Error ? e.message : e)
} finally {
  if (browser) await browser.close()
  console.log('\n[정리] 테스트 데이터 삭제')
  if (customerId) {
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await raw.from('inspection_plan_items').delete().eq('customer_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
  }
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId).catch(() => {}) }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
}
