/** 고객관리 인라인 편집(드롭다운) E2E — 점검유형/담당직원/점검계획일 셀 편집이 실제로 전파되는지 (2026-07-14)
 *  실행: $env:TEST_BASE_URL='https://staging.sjfire.co.kr'; npx tsx scripts/test-inline-edit.mts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
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

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const YEAR = new Date().getFullYear()
const NAME = 'TEST-INLINE-드롭다운'
const EMAIL = 'test-inline-admin@erp-test.com'
const PW = 'InlineTest1!'
const ANCHOR0 = `${YEAR}-09-10`
const ANCHOR1 = `${YEAR}-10-05`

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

let customerId = ''
let userId = ''
let browser: import('playwright').Browser | null = null

type ItemRow = { id: string; status: string; plan_type: string | null; inspection_type: string; planned_date: string | null; scheduled_date: string | null; assigned_employee_id: string | null }
async function getItems(): Promise<ItemRow[]> {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, status, plan_type, inspection_type, planned_date, scheduled_date, assigned_employee_id')
    .eq('customer_id', customerId).order('created_at')
  return (data ?? []) as ItemRow[]
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

function row(page: Page) {
  return page.locator('tr', { has: page.getByText(NAME) }).first()
}

try {
  // ── 셋업: 관리자 + 작동 고객 + 연간 계획 ──
  console.log('\n[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-INLINE관리자', role: 'admin', is_active: true, employee_id: 'TEST-INL', email: EMAIL })

  const { data: cust, error: cErr } = await raw.from('customers').insert({
    customer_code: `TEST-INL-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: NAME, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    plan_anchor_date: ANCHOR0, is_active: true, created_by: userId,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id

  const hdSet = await loadHolidaySet(admin, YEAR)
  await generateYearlyPlanItems(admin,
    { id: customerId, inspection_type: '작동', plan_anchor_date: ANCHOR0, assigned_employee_id: null },
    YEAR, userId, hdSet)
  const initial = await getItems()
  check(`셋업: 소방 계획 ${initial.length}건 생성 (특별 9월 + 정기)`, initial.length >= 3 && initial.some(i => i.plan_type === 'special_작동'))

  // ── 로그인 ──
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  let lastAlert = ''
  page.on('dialog', d => { lastAlert = d.message(); d.accept().catch(() => {}) })
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  check('로그인 성공', true)

  // ── 1) 점검유형 드롭다운: 작동 → 일반관리 ──
  console.log('\n[1] 점검유형 드롭다운 (작동 → 일반관리)')
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-INLINE')}&active=all`)
  await row(page).waitFor()
  await row(page).locator('td').nth(1).locator('[title="클릭하여 수정"]').click()
  const typeSel = row(page).locator('td').nth(1).locator('select')
  await typeSel.waitFor()
  await typeSel.selectOption('일반관리')
  await page.locator('h1').click() // blur → 저장
  const afterType = await waitFor(getItems, list =>
    list.some(i => i.plan_type === 'event') && !list.some(i => i.inspection_category !== undefined && i.plan_type?.startsWith('special')))
  const { data: c1 } = await raw.from('customers').select('inspection_type, inspection_category').eq('id', customerId).single()
  check('고객: 일반관리로 변경', (c1 as { inspection_type: string } | null)?.inspection_type === '일반관리', JSON.stringify(c1))
  check('planned 소방 항목 삭제', !afterType.some(i => i.plan_type?.startsWith('special') || i.plan_type === 'monthly'), JSON.stringify(afterType.map(i => i.plan_type)))
  const ev1 = afterType.find(i => i.plan_type === 'event')
  check('event 1건 자동 생성 + 자동 확정 + 날짜=점검계획일',
    !!ev1 && ev1.status === 'confirmed' && ev1.planned_date === ANCHOR0 && ev1.scheduled_date === ANCHOR0, JSON.stringify(ev1))

  // ── 2) 담당직원 드롭다운: 미배정 → 테스트관리자 ──
  console.log('\n[2] 담당직원 드롭다운 (미배정 → 배정)')
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-INLINE')}&active=all`)
  await row(page).waitFor()
  await row(page).locator('td').nth(6).locator('[title="클릭하여 수정"]').click()
  const empSel = row(page).locator('td').nth(6).locator('select')
  await empSel.waitFor()
  await empSel.selectOption(userId)
  await page.locator('h1').click()
  const afterEmp = await waitFor(getItems, list => list.every(i => i.assigned_employee_id === userId))
  const { data: c2 } = await raw.from('customers').select('assigned_employee_id').eq('id', customerId).single()
  check('고객: 담당직원 저장', (c2 as { assigned_employee_id: string | null } | null)?.assigned_employee_id === userId)
  check('계획항목(확정 event 포함)에 담당 전파', afterEmp.every(i => i.assigned_employee_id === userId), JSON.stringify(afterEmp.map(i => i.assigned_employee_id)))

  // ── 3) 점검계획일 인라인 변경 (일반관리): 팝업 없이 event 이동 ──
  console.log('\n[3] 점검계획일 변경 (9월 → 10월, 확정 event 자동 이동)')
  lastAlert = ''
  await row(page).locator('td').nth(5).locator('[title="클릭하여 수정"]').click()
  const dateInput = row(page).locator('td').nth(5).locator('input[type=text]')
  await dateInput.waitFor()
  await dateInput.fill(ANCHOR1)
  await dateInput.press('Enter')
  await page.waitForTimeout(500)
  const popupShown = await page.getByText('확정된 점검 일정이 있습니다').count()
  check('확정보호 팝업 미표시 (event는 제외)', popupShown === 0)
  const afterAnchor = await waitFor(getItems, list => {
    const ev = list.find(i => i.plan_type === 'event')
    return !!ev && ev.planned_date === ANCHOR1
  })
  const ev2 = afterAnchor.find(i => i.plan_type === 'event')
  check('event 재생성: 새 날짜 + 확정 유지 + 1건뿐',
    afterAnchor.filter(i => i.plan_type === 'event').length === 1
    && !!ev2 && ev2.status === 'confirmed' && ev2.planned_date === ANCHOR1 && ev2.scheduled_date === ANCHOR1,
    JSON.stringify(afterAnchor))
  const { data: plans } = await raw.from('inspection_plan_items')
    .select('id, inspection_plans!inner(year, month)').eq('customer_id', customerId).eq('plan_type', 'event')
  const evMonth = ((plans ?? [])[0] as { inspection_plans: { month: number } } | undefined)?.inspection_plans?.month
  check('event가 10월 계획으로 이동', evMonth === 10, `month=${evMonth}`)
  check('오류 알림 없음', lastAlert === '', `alert="${lastAlert}"`)

  await browser.close(); browser = null
} catch (e) {
  fail++
  console.error('\n❌ 테스트 중단:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  if (customerId) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().eq('entity_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
    console.log('\n[정리] 고객·계획 삭제 완료')
  }
  if (userId) {
    await raw.from('profiles').delete().eq('id', userId)
    await raw.auth.admin.deleteUser(userId).catch(() => {})
    console.log('[정리] 테스트 계정 삭제 완료')
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
