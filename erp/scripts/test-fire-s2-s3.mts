/** FIRE-S2/S3 시스템 테스트 (브라우저 구동): 계획 확정 → 6단계 자동계산 → 점검업무 생성 → 단계 완료 → 모니터링·달력 반영
 *  실행: npx tsx scripts/test-fire-s2-s3.mts  (dev 서버 localhost:3000 필요, 테스트 데이터 자동 정리)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'fs'
import { chromium, type Page, type Locator } from 'playwright'
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
const SHOTS = new URL('../.test-shots/fire-s2-s3/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

const YEAR = 2026
const CUSTOMER_NAME = 'TEST-FIRE-S2-빌딩'
const TEST_EMAIL = 'test-fire-s2-admin@erp-test.com'
const TEST_PW = 'FireS2Test1!'

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

try {
  // ── 셋업: 테스트 고객(종합, 승인일 7월) + 2026 연간계획 생성 ──────────
  console.log('\n[셋업] 테스트 관리자 계정 + 테스트 고객 + 연간계획 생성')
  // 기존 잔여 테스트 계정 제거 후 생성
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) {
    if (u.email === TEST_EMAIL) await raw.auth.admin.deleteUser(u.id)
  }
  const { data: newUser, error: uErr } = await raw.auth.admin.createUser({
    email: TEST_EMAIL, password: TEST_PW, email_confirm: true,
  })
  if (uErr || !newUser?.user) throw new Error(`테스트 계정 생성 실패: ${uErr?.message}`)
  testUserId = newUser.user.id
  const { error: pErr } = await raw.from('profiles').upsert({
    id: testUserId, name: 'TEST-FIRE-S2관리자', role: 'admin', is_active: true,
    employee_id: 'TEST-S2-ADM', email: TEST_EMAIL,
  })
  if (pErr) throw new Error(`테스트 프로필 생성 실패: ${pErr.message}`)
  const adminId = testUserId

  const { data: cust, error: cErr } = await raw.from('customers').insert({
    customer_code: `TEST-S2-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: CUSTOMER_NAME,
    inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
    use_approval_date: '2018-07-15', contract_date: '2026-01-05',
    is_active: true, created_by: adminId, assigned_employee_id: adminId,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id

  const hdSet = await loadHolidaySet(admin, YEAR)
  await generateYearlyPlanItems(admin,
    { id: customerId, inspection_type: '종합', use_approval_date: '2018-07-15', assigned_employee_id: adminId },
    YEAR, adminId, hdSet)

  const { data: julyItem } = await raw.from('inspection_plan_items')
    .select('id, plan_type, scheduled_date, status, inspection_plans!inner(year, month)')
    .eq('customer_id', customerId)
    .eq('inspection_plans.year', YEAR).eq('inspection_plans.month', 7)
    .eq('plan_type', 'special_종합').limit(1)
  const item = julyItem?.[0] as { id: string; scheduled_date: string | null; status: string } | undefined
  if (!item) throw new Error('7월 특별(종합) 계획 항목이 생성되지 않았습니다.')
  check('셋업: 7월 특별(종합) 항목 생성됨 — 미확정(scheduled_date null)', item.scheduled_date === null && item.status === 'planned', JSON.stringify(item))

  // ── 브라우저: 로그인 ─────────────────────────────────────────
  console.log('\n[FIRE-S2] 브라우저 구동')
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)

  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', TEST_EMAIL)
  await page.fill('input[type=password]', TEST_PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  check('로그인 성공 (admin)', true)

  // ── FIRE-S2 ①: 목록에서 점검일 확정 ────────────────────────
  await page.goto(`${BASE}/inspection-plans?year=${YEAR}&month=7&view=list`)
  await page.getByText(CUSTOMER_NAME).first().waitFor()
  // 목록 뷰가 아니면 토글
  const row = () => page.locator('tr', { has: page.getByText(CUSTOMER_NAME) }).first()
  if (!(await row().isVisible().catch(() => false))) {
    await page.getByText('목록', { exact: true }).first().click()
    await row().waitFor()
  }
  await shot(page, '01-list-before-confirm')
  check('목록: 미확정 상태 "점검일 확정" 표시', await row().getByText('점검일 확정').isVisible())

  await row().getByText('점검일 확정').click()
  const popup = page.locator('div.w-52')
  await popup.waitFor()
  await popup.locator('button', { hasText: /^15$/ }).click()
  // 확정되면 항목이 기본 필터 탭(계획 중)에서 빠져나감 — "전체" 탭으로 전환 후 확인
  await page.getByRole('button', { name: /^전체/ }).first().click()
  await row().getByText('2026-07-15').waitFor({ timeout: 15000 })
  await shot(page, '02-list-after-confirm')
  check('확정: 점검일자 2026-07-15 표시', true)
  check('확정: 상태 칩 "확정"', await row().getByText('확정', { exact: true }).first().isVisible().catch(() => false))

  // ── FIRE-S2 ②: 6단계 자동 계산 (DB 교차검증) ──────────────────
  const { data: after } = await raw.from('inspection_plan_items')
    .select('status, scheduled_date, step1_date, step2_date, step3_date, step4_date, step5_date, step6_date')
    .eq('id', item.id).single()
  const a = after as Record<string, string | null>
  console.log('     step1~6:', [a.step1_date, a.step2_date, a.step3_date, a.step4_date, a.step5_date, a.step6_date].join(' → '))
  check('6단계 자동 계산: step1 = 확정일(2026-07-15)', a.step1_date === '2026-07-15', `실제: ${a.step1_date}`)
  check('6단계 자동 계산: step2~6 모두 채워짐 + 오름차순',
    [a.step2_date, a.step3_date, a.step4_date, a.step5_date, a.step6_date].every(Boolean) &&
    [a.step1_date, a.step2_date, a.step3_date, a.step4_date, a.step5_date, a.step6_date]
      .every((d, i, arr) => i === 0 || d! >= arr[i - 1]!))

  // ── FIRE-S2 ③: 점검 시작 → 점검업무 생성 ─────────────────────
  await row().getByText('시작', { exact: false }).click()
  await page.waitForURL(/\/inspections\/[0-9a-f-]+/, { timeout: 20000 })
  const inspectionId = page.url().split('/inspections/')[1].split('?')[0]
  await page.getByText('6단계 업무 체크리스트').waitFor()
  const dueTexts = await page.locator('text=마감일:').allTextContents()
  await shot(page, '03-inspection-detail')
  check('점검업무 생성: /inspections/{id} 상세 페이지 진입', true)
  check(`점검업무: 6단계 체크리스트 마감일 ${dueTexts.length}건 표시`, dueTexts.length === 6, `실제: ${dueTexts.length}`)
  check('점검업무: 1단계 마감일 = 확정일', dueTexts[0]?.includes('2026-07-15') === true, dueTexts[0])

  // ── FIRE-S3 ①: 1단계 완료 처리 ───────────────────────────────
  console.log('\n[FIRE-S3] 단계 완료 → 반영 확인')
  await page.locator('button', { hasText: '완료' }).first().click()
  await page.getByText(/완료: \d{4}-\d{2}-\d{2}/).first().waitFor({ timeout: 15000 })
  await shot(page, '04-step1-completed')
  check('1단계 완료: 완료일 표시', true)

  // 🔍 프로브: 완료 버튼은 다음 진행 단계(2단계)에만 노출 — 순서 강제 확인
  const btnCount = await page.locator('button', { hasText: '완료' }).count()
  check('🔍 완료 버튼 1개만 노출 (다음 단계로 이동, 건너뛰기 불가)', btnCount === 1, `실제: ${btnCount}개`)

  // ── FIRE-S3 ②: 모니터링 반영 ────────────────────────────────
  await page.goto(`${BASE}/inspection-plans/monitor?year=${YEAR}&month=7`)
  const monRow = page.locator('tr', { has: page.getByText(CUSTOMER_NAME) }).first()
  await monRow.waitFor({ timeout: 15000 })
  const monRowText = await monRow.textContent()
  await shot(page, '05-monitor')
  check('모니터링: 고객 행 표시', true)
  check('모니터링: 1단계 점검일 반영', /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|07-15|07\/15/.test(monRowText ?? ''), monRowText?.slice(0, 200))

  // ── FIRE-S3 ③: 달력 반영 ────────────────────────────────────
  await page.goto(`${BASE}/inspections/calendar?year=${YEAR}&month=7`)
  await page.getByText(CUSTOMER_NAME).first().waitFor({ timeout: 15000 })
  await shot(page, '06-calendar')
  check('달력: 점검 항목 표시', true)

  // 🔍 프로브: 재확정 — 날짜 셀 재클릭 후 16일로 변경 → 미완료 단계 마감일 재계산
  await page.goto(`${BASE}/inspection-plans?year=${YEAR}&month=7&view=list`)
  await page.getByRole('button', { name: /^전체/ }).first().click()
  await row().getByText('2026-07-15').waitFor()
  await row().getByText('2026-07-15').click()
  await popup.waitFor()
  await popup.locator('button', { hasText: /^16$/ }).click()
  await page.getByRole('button', { name: /^전체/ }).first().click()
  await row().getByText('2026-07-16').waitFor({ timeout: 15000 })
  const { data: re } = await raw.from('inspection_steps')
    .select('step_num, due_date, status').eq('inspection_id', inspectionId).order('step_num')
  const steps = (re ?? []) as Array<{ step_num: number; due_date: string; status: string }>
  check('🔍 재확정(07-16): 완료된 1단계는 유지, 미완료 단계 마감일 재계산',
    steps[0]?.status === 'completed' && steps.slice(1).every(s => s.due_date >= '2026-07-16'),
    JSON.stringify(steps))
  await shot(page, '07-reconfirm')

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
  // ── 정리: 테스트 데이터 삭제 ──────────────────────────────────
  if (customerId) {
    console.log('\n[정리] 테스트 데이터 삭제')
    const inspIds = ((await raw.from('inspections').select('id').eq('customer_id', customerId)).data ?? []).map(r => (r as { id: string }).id)
    const itemIds = ((await raw.from('inspection_plan_items').select('id').eq('customer_id', customerId)).data ?? []).map(r => (r as { id: string }).id)
    if (itemIds.length) await raw.from('inspection_status_log').delete().in('plan_item_id', itemIds)
    if (inspIds.length) {
      await raw.from('inspection_logs').delete().in('inspection_id', inspIds)
      await raw.from('inspection_steps').delete().in('inspection_id', inspIds)
    }
    await raw.from('inspection_plan_items').delete().eq('customer_id', customerId)
    await raw.from('inspections').delete().eq('customer_id', customerId)
    const { error: delErr } = await raw.from('customers').delete().eq('id', customerId)
    console.log(delErr ? `  ⚠ 고객 삭제 실패: ${delErr.message}` : '  ✅ 고객·계획·점검 정리 완료')
  }
  if (testUserId) {
    await raw.from('profiles').delete().eq('id', testUserId)
    const { error: auErr } = await raw.auth.admin.deleteUser(testUserId)
    console.log(auErr ? `  ⚠ 테스트 계정 삭제 실패: ${auErr.message}` : '  ✅ 테스트 계정 정리 완료')
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
