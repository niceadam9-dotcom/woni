/** 정기 자동 확정(089) E2E — 생성기·기준일 변경·유형 전환·Escape 취소 검증 (2026-07-14)
 *  실행: $env:TEST_BASE_URL='https://staging.sjfire.co.kr'; npx tsx scripts/test-monthly-confirm.mts
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
const NAME = 'TEST-MONTHLY-자동확정'
const EMAIL = 'test-monthly-admin@erp-test.com'
const PW = 'MonthlyTest1!'
const ANCHOR0 = `${YEAR}-09-10`
const ANCHOR1 = `${YEAR}-09-22`  // 같은 달, '일'만 변경 — 재계산 검증

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

let customerId = ''
let userId = ''
let browser: import('playwright').Browser | null = null

type ItemRow = { id: string; status: string; plan_type: string | null; inspection_type: string; inspection_sub_type: string | null; planned_date: string | null; scheduled_date: string | null; sequence_num: number }
async function getItems(): Promise<ItemRow[]> {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, status, plan_type, inspection_type, inspection_sub_type, planned_date, scheduled_date, sequence_num')
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
  console.log('\n[셋업] 작동 고객 + 연간 계획 (신규 생성기)')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-MONTHLY관리자', role: 'admin', is_active: true, employee_id: 'TEST-MON', email: EMAIL })

  const { data: cust, error: cErr } = await raw.from('customers').insert({
    customer_code: `TEST-MON-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: NAME, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    plan_anchor_date: ANCHOR0, is_active: true, created_by: userId,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id

  const hdSet = await loadHolidaySet(admin, YEAR)
  await generateYearlyPlanItems(admin,
    { id: customerId, inspection_type: '작동', plan_anchor_date: ANCHOR0, assigned_employee_id: null },
    YEAR, userId, hdSet)

  // ── 1) 생성기: 정기 = 자동 확정, 특별 = planned ──
  const initial = await getItems()
  const monthly0 = initial.filter(i => i.plan_type === 'monthly')
  const special0 = initial.filter(i => i.plan_type === 'special_작동')
  check(`생성: 특별 ${special0.length}건 + 정기 ${monthly0.length}건`, special0.length === 1 && monthly0.length >= 2)
  check('정기 = confirmed + scheduled=planned',
    monthly0.every(i => i.status === 'confirmed' && i.scheduled_date === i.planned_date && i.planned_date != null),
    JSON.stringify(monthly0.map(i => [i.status, i.planned_date, i.scheduled_date])))
  check('특별 = planned + scheduled 없음', special0.every(i => i.status === 'planned' && i.scheduled_date === null))

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

  // ── 2) 점검계획일 변경: 확정 정기도 팝업 없이 재계산·확정 유지 ──
  console.log('\n[2] 점검계획일 인라인 변경 (10일 → 22일)')
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-MONTHLY')}&active=all`)
  await row(page).waitFor()
  await row(page).locator('td').nth(5).locator('[title="클릭하여 수정"]').click()
  const dateInput = row(page).locator('td').nth(5).locator('input[type=text]')
  await dateInput.waitFor()
  await dateInput.fill(ANCHOR1)
  await dateInput.press('Enter')
  await page.waitForTimeout(500)
  const popupShown = await page.getByText('확정된 점검 일정이 있습니다').count()
  check('확정보호 팝업 미표시 (자동 확정 정기는 제외)', popupShown === 0)
  const afterAnchor = await waitFor(getItems, list =>
    list.filter(i => i.plan_type === 'monthly')
      .every(i => i.planned_date != null && Number(i.planned_date.slice(8)) >= 22))
  const monthly1 = afterAnchor.filter(i => i.plan_type === 'monthly')
  check('정기: 새 기준일(22일) 재계산 + 확정 유지 + 확정일 동행',
    monthly1.every(i => i.status === 'confirmed' && i.scheduled_date === i.planned_date
      && Number(i.planned_date!.slice(8)) >= 22 && Number(i.planned_date!.slice(8)) <= 26),
    JSON.stringify(monthly1.map(i => [i.status, i.planned_date, i.scheduled_date])))
  const special1 = afterAnchor.filter(i => i.plan_type === 'special_작동')
  check('특별: planned + 확정일 초기화 유지', special1.every(i => i.status === 'planned' && i.scheduled_date === null))

  // ── 3) 유형 드롭다운 Escape 취소 ──
  console.log('\n[3] 유형 드롭다운 Escape 취소')
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-MONTHLY')}&active=all`)
  await row(page).waitFor()
  await row(page).locator('td').nth(1).locator('[title="클릭하여 수정"]').click()
  const typeSel = row(page).locator('td').nth(1).locator('select')
  await typeSel.waitFor()
  await typeSel.press('Escape')
  await page.waitForTimeout(300)
  check('Escape로 편집 종료 (select 사라짐)', await row(page).locator('td').nth(1).locator('select').count() === 0)
  const { data: cEsc } = await raw.from('customers').select('inspection_type').eq('id', customerId).single()
  check('값 미변경', (cEsc as { inspection_type: string } | null)?.inspection_type === '작동')

  // ── 4) 유형 전환 (작동 → 종합): 확정 정기도 동기화 ──
  console.log('\n[4] 유형 드롭다운 (작동 → 종합)')
  await row(page).locator('td').nth(1).locator('[title="클릭하여 수정"]').click()
  const typeSel2 = row(page).locator('td').nth(1).locator('select')
  await typeSel2.waitFor()
  await typeSel2.selectOption('종합')
  await page.locator('h1').click()
  const afterType = await waitFor(getItems, list =>
    list.filter(i => i.plan_type === 'monthly').every(i => i.inspection_type === '종합')
    && list.some(i => i.plan_type === 'special_종합' && i.sequence_num === 1))
  const monthly2 = afterType.filter(i => i.plan_type === 'monthly')
  check('확정 정기: 유형 종합으로 동기화 + 확정 유지',
    monthly2.every(i => i.inspection_type === '종합' && i.inspection_sub_type === '종합' && i.status === 'confirmed'),
    JSON.stringify(monthly2.map(i => [i.inspection_type, i.status])))
  check('특별: special_종합 전환 (1차)',
    afterType.some(i => i.plan_type === 'special_종합' && i.sequence_num === 1),
    JSON.stringify(afterType.map(i => [i.plan_type, i.sequence_num])))
  // 2차(+6개월)는 3월로 감겨 기준일(9월) 이전 — "기준일 이전 항목 미생성" 설계상 없어야 정상
  check('2차 유령 항목 없음 (기준일 이전 미생성 설계)',
    !afterType.some(i => i.sequence_num === 2))
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
