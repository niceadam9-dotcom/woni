/** FIRE-S4 시스템 테스트 (브라우저 구동): 고객 비활성 → 미완료 계획 자동취소(마커 보존) → 재활성 → 원상태 복원 (ADD-16)
 *  실행: npx tsx scripts/test-fire-s4.mts  (dev 서버 localhost:3000 필요, 테스트 데이터 자동 정리)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'fs'
import { chromium, type Page } from 'playwright'
import gen from '../src/lib/inspection-plan-generator.ts'
const { generateYearlyPlanItems, loadHolidaySet } = gen as unknown as typeof import('../src/lib/inspection-plan-generator.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = raw as never as Parameters<typeof generateYearlyPlanItems>[0]

const BASE = 'http://localhost:3000'
const SHOTS = new URL('../.test-shots/fire-s4/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

const YEAR = new Date().getFullYear()
const CUSTOMER_NAME = 'TEST-FIRE-S4-빌딩'
const TEST_EMAIL = 'test-fire-s4-admin@erp-test.com'
const TEST_PW = 'FireS4Test1!'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

let customerId = ''
let testUserId = ''
let browser: import('playwright').Browser | null = null

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: false })
  console.log(`     📸 ${name}.png`)
}

type ItemRow = { id: string; status: string; notes: string | null; scheduled_date: string | null; plan_type: string }
async function getItems(): Promise<ItemRow[]> {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, status, notes, scheduled_date, plan_type')
    .eq('customer_id', customerId).order('created_at')
  return (data ?? []) as ItemRow[]
}

/** DB 상태가 조건을 만족할 때까지 폴링 (서버 액션 완료 대기) */
async function waitFor(cond: (items: ItemRow[]) => boolean, ms = 15000): Promise<ItemRow[]> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const items = await getItems()
    if (cond(items)) return items
    await new Promise(r => setTimeout(r, 500))
  }
  return getItems()
}

try {
  // ── 셋업: 테스트 계정 + 고객 + 계획 (planned·confirmed·completed·수동취소 4종 상태 구성) ──
  console.log('\n[셋업] 테스트 계정·고객·계획 생성')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === TEST_EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: newUser, error: uErr } = await raw.auth.admin.createUser({ email: TEST_EMAIL, password: TEST_PW, email_confirm: true })
  if (uErr || !newUser?.user) throw new Error(`테스트 계정 생성 실패: ${uErr?.message}`)
  testUserId = newUser.user.id
  const { error: pErr } = await raw.from('profiles').upsert({
    id: testUserId, name: 'TEST-FIRE-S4관리자', role: 'admin', is_active: true,
    employee_id: 'TEST-S4-ADM', email: TEST_EMAIL,
  })
  if (pErr) throw new Error(`테스트 프로필 생성 실패: ${pErr.message}`)

  const { data: cust, error: cErr } = await raw.from('customers').insert({
    customer_code: `TEST-S4-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: CUSTOMER_NAME,
    inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
    use_approval_date: '2018-07-15', contract_date: '2026-01-05',
    is_active: true, created_by: testUserId, assigned_employee_id: testUserId,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id

  const hdSet = await loadHolidaySet(admin, YEAR)
  await generateYearlyPlanItems(admin,
    { id: customerId, inspection_type: '종합', use_approval_date: '2018-07-15', assigned_employee_id: testUserId },
    YEAR, testUserId, hdSet)

  let items = await getItems()
  if (items.length < 4) throw new Error(`계획 항목 부족: ${items.length}건 (4건 이상 필요)`)
  // 상태 구성: [0] confirmed, [1] completed, [2] 수동 취소, 나머지 planned
  await raw.from('inspection_plan_items').update({ status: 'confirmed', scheduled_date: `${YEAR}-07-15` }).eq('id', items[0].id)
  await raw.from('inspection_plan_items').update({ status: 'completed' }).eq('id', items[1].id)
  await raw.from('inspection_plan_items').update({ status: 'cancelled', notes: '수동 취소' }).eq('id', items[2].id)
  items = await getItems()
  const plannedCount = items.filter(i => i.status === 'planned').length
  check(`셋업: planned ${plannedCount} + confirmed 1 + completed 1 + 수동취소 1`, plannedCount >= 1
    && items.filter(i => i.status === 'confirmed').length === 1
    && items.filter(i => i.status === 'completed').length === 1
    && items.filter(i => i.status === 'cancelled').length === 1)

  // ── 브라우저: 로그인 → 고객 목록 ─────────────────────────────
  console.log('\n[FIRE-S4] 브라우저 구동')
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', TEST_EMAIL)
  await page.fill('input[type=password]', TEST_PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  check('로그인 성공', true)

  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-FIRE-S4')}&active=all`)
  const row = () => page.locator('tr', { has: page.getByText(CUSTOMER_NAME) }).first()
  await row().waitFor()
  await shot(page, '01-customers-active')

  // ── ① 비활성 전환 → 미완료 계획 자동취소 ─────────────────────
  await row().getByRole('button', { name: '활성' }).click()
  await row().getByRole('button', { name: '비활성' }).waitFor({ timeout: 15000 })
  const afterCancel = await waitFor(list =>
    list.every(i => i.id === items[1].id ? i.status === 'completed' : i.status === 'cancelled'))
  await shot(page, '02-customers-inactive')

  const c0 = afterCancel.find(i => i.id === items[0].id)! // confirmed였던 것
  const c1 = afterCancel.find(i => i.id === items[1].id)! // completed
  const c2 = afterCancel.find(i => i.id === items[2].id)! // 수동취소
  const cPlanned = afterCancel.filter(i => ![items[0].id, items[1].id, items[2].id].includes(i.id))
  check('비활성: planned → cancelled + ⟦자동취소:planned⟧ 마커',
    cPlanned.every(i => i.status === 'cancelled' && (i.notes ?? '').includes('⟦자동취소:planned⟧')),
    JSON.stringify(cPlanned.map(i => [i.status, i.notes])))
  check('비활성: confirmed → cancelled + ⟦자동취소:confirmed⟧ 마커',
    c0.status === 'cancelled' && (c0.notes ?? '').includes('⟦자동취소:confirmed⟧'), JSON.stringify(c0))
  check('🔍 비활성: completed는 불변', c1.status === 'completed' && !(c1.notes ?? '').includes('자동취소'), JSON.stringify(c1))
  check('🔍 비활성: 기존 수동취소는 마커 미부착', c2.status === 'cancelled' && c2.notes === '수동 취소', JSON.stringify(c2))

  // 계획 목록 UI에서 취소 표시 확인
  await page.goto(`${BASE}/inspection-plans?year=${YEAR}&month=7&view=list`)
  await page.getByRole('button', { name: /^전체/ }).first().click()
  const planRow = page.locator('tr', { has: page.getByText(CUSTOMER_NAME) }).first()
  await planRow.waitFor()
  const planRowText = await planRow.textContent()
  check('계획 목록 UI: 취소 상태 표시', (planRowText ?? '').includes('취소'), planRowText?.slice(0, 150))
  await shot(page, '03-plans-cancelled')

  // ── ② 재활성 전환 → 원상태 복원 ─────────────────────────────
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-FIRE-S4')}&active=all`)
  await row().getByRole('button', { name: '비활성' }).click()
  await row().getByRole('button', { name: '활성' }).waitFor({ timeout: 15000 })
  const afterRestore = await waitFor(list => {
    const r0 = list.find(i => i.id === items[0].id)
    return r0?.status === 'confirmed' && list.filter(i => i.status === 'planned').length === plannedCount
  })
  await shot(page, '04-customers-restored')

  const r0 = afterRestore.find(i => i.id === items[0].id)!
  const r1 = afterRestore.find(i => i.id === items[1].id)!
  const r2 = afterRestore.find(i => i.id === items[2].id)!
  const rPlanned = afterRestore.filter(i => ![items[0].id, items[1].id, items[2].id].includes(i.id))
  check('재활성: planned 복원 + 마커 제거',
    rPlanned.every(i => i.status === 'planned' && !(i.notes ?? '').includes('자동취소')),
    JSON.stringify(rPlanned.map(i => [i.status, i.notes])))
  check('재활성: confirmed 복원 (scheduled_date 유지) + 마커 제거',
    r0.status === 'confirmed' && r0.scheduled_date === `${YEAR}-07-15` && !(r0.notes ?? '').includes('자동취소'),
    JSON.stringify(r0))
  check('🔍 재활성: completed 불변', r1.status === 'completed', JSON.stringify(r1))
  check('🔍 재활성: 수동취소는 복원되지 않음', r2.status === 'cancelled' && r2.notes === '수동 취소', JSON.stringify(r2))

  // ── 🔍 ③ 재비활성 (2회차 사이클 안정성) ──────────────────────
  await row().getByRole('button', { name: '활성' }).click()
  await row().getByRole('button', { name: '비활성' }).waitFor({ timeout: 15000 })
  const secondCancel = await waitFor(list =>
    list.every(i => i.id === items[1].id ? true : i.status === 'cancelled'))
  const s0 = secondCancel.find(i => i.id === items[0].id)!
  check('🔍 2회차 비활성: 마커 중복 없이 재취소',
    s0.status === 'cancelled' && ((s0.notes ?? '').match(/자동취소/g) ?? []).length === 1, JSON.stringify(s0))

  await browser.close(); browser = null
} catch (e) {
  fail++
  console.error('\n❌ 테스트 중단:', (e as Error).message)
  if (browser) {
    try {
      const pages = browser.contexts().flatMap(c => c.pages())
      if (pages[0]) await pages[0].screenshot({ path: `${SHOTS}99-failure.png` })
    } catch { /* ignore */ }
    await browser.close(); browser = null
  }
} finally {
  if (browser) await browser.close()
  if (customerId) {
    console.log('\n[정리] 테스트 데이터 삭제')
    await raw.from('inspection_plan_items').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().eq('entity_id', customerId)
    const { error: delErr } = await raw.from('customers').delete().eq('id', customerId)
    console.log(delErr ? `  ⚠ 고객 삭제 실패: ${delErr.message}` : '  ✅ 고객·계획 정리 완료')
  }
  if (testUserId) {
    await raw.from('profiles').delete().eq('id', testUserId)
    const { error: auErr } = await raw.auth.admin.deleteUser(testUserId)
    console.log(auErr ? `  ⚠ 테스트 계정 삭제 실패: ${auErr.message}` : '  ✅ 테스트 계정 정리 완료')
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
