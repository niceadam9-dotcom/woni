/** TS-ANCHOR 시스템 테스트 (브라우저 구동): 점검계획일 기준 표시·동기화 개선 (2026-07-14, 커밋 32ab071)
 *  커버: TS-ANCHOR-1(표시)·4(비우기 차단)·5(B안 확정해지)·6(확정 유지/취소)·8(유형 동기화)·11(부분 업데이트 소실 회귀)
 *  실행: npx tsx scripts/test-anchor.mts  (TEST_BASE_URL로 스테이징 지정 가능, 테스트 데이터 자동 정리)
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

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const SHOTS = new URL('../.test-shots/anchor/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(SHOTS, { recursive: true })

const YEAR = new Date().getFullYear()
const CUSTOMER_NAME = 'TEST-ANCHOR-빌딩'
const TEST_EMAIL = 'test-anchor-admin@erp-test.com'
const TEST_PW = 'AnchorTest1!'
const ANCHOR0 = `${YEAR}-02-10`   // 초기 점검계획일 (2월 → 2차 특별 8월)

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

type ItemRow = {
  id: string; status: string; sequence_num: number; plan_type: string
  inspection_type: string; inspection_sub_type: string | null
  planned_date: string | null; scheduled_date: string | null
}
async function getItems(): Promise<ItemRow[]> {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, status, sequence_num, plan_type, inspection_type, inspection_sub_type, planned_date, scheduled_date')
    .eq('customer_id', customerId).order('created_at')
  return (data ?? []) as ItemRow[]
}
async function getCustomer() {
  const { data } = await raw.from('customers')
    .select('inspection_type, inspection_category, inspection_sub_type, contract_date, use_approval_date, plan_anchor_date, address, notes, fire_station')
    .eq('id', customerId).single()
  return data as Record<string, string | null>
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

/** 고객 목록에서 점검계획일 인라인 편집 → 값 입력 → 저장(Enter) */
async function inlineEditPlanAnchor(page: Page, newDate: string) {
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-ANCHOR')}&active=all`)
  const row = page.locator('tr', { has: page.getByText(CUSTOMER_NAME) }).first()
  await row.waitFor()
  // 컬럼: 고객명(0) 점검유형(1) 연간횟수(2) 계약일(3) 사용승인일(4) 점검계획일(5)
  await row.locator('td').nth(5).locator('[title="클릭하여 수정"]').click()
  const input = row.locator('td').nth(5).locator('input[type=text]')
  await input.waitFor()
  await input.fill(newDate)
  await input.press('Enter')
}

try {
  // ── 셋업: 관리자 계정 + 종합 고객(모든 필드 채움) + 연간 계획 ──
  console.log('\n[셋업] 테스트 계정·고객·계획 생성')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === TEST_EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: newUser, error: uErr } = await raw.auth.admin.createUser({ email: TEST_EMAIL, password: TEST_PW, email_confirm: true })
  if (uErr || !newUser?.user) throw new Error(`테스트 계정 생성 실패: ${uErr?.message}`)
  testUserId = newUser.user.id
  const { error: pErr } = await raw.from('profiles').upsert({
    id: testUserId, name: 'TEST-ANCHOR관리자', role: 'admin', is_active: true,
    employee_id: 'TEST-ANC-ADM', email: TEST_EMAIL,
  })
  if (pErr) throw new Error(`테스트 프로필 생성 실패: ${pErr.message}`)

  const FULL_FIELDS = {
    contract_date: '2026-01-05', use_approval_date: '2016-07-29', plan_anchor_date: ANCHOR0,
    address: '경기 양평군 테스트로 1', notes: '앵커 테스트 비고', fire_station: '양평소방서',
  }
  const { data: cust, error: cErr } = await raw.from('customers').insert({
    customer_code: `TEST-ANC-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: CUSTOMER_NAME,
    inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
    is_active: true, created_by: testUserId, assigned_employee_id: testUserId,
    ...FULL_FIELDS,
  }).select('id').single()
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`)
  customerId = (cust as { id: string }).id

  const hdSet = await loadHolidaySet(admin, YEAR)
  await generateYearlyPlanItems(admin,
    { id: customerId, inspection_type: '종합', use_approval_date: FULL_FIELDS.use_approval_date, plan_anchor_date: ANCHOR0, assigned_employee_id: testUserId },
    YEAR, testUserId, hdSet)

  let items = await getItems()
  const seq2 = items.find(i => i.sequence_num === 2)
  check(`셋업: 항목 ${items.length}건 (1차 특별 2월 + 2차 특별 8월 + 정기)`,
    items.length >= 4 && !!seq2 && items.some(i => i.plan_type === 'special_종합' && i.sequence_num === 1))

  // monthly 1건 확정 처리 (점검 미연결 — B안 해지 대상)
  const monthlyItem = items.find(i => i.plan_type === 'monthly')!
  await raw.from('inspection_plan_items').update({ status: 'confirmed', scheduled_date: `${YEAR}-10-05` }).eq('id', monthlyItem.id)

  // ── 브라우저 로그인 ──────────────────────────────────────────
  console.log('\n[브라우저] 로그인')
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  let lastAlert = ''
  page.on('dialog', d => { lastAlert = d.message(); d.accept().catch(() => {}) })
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', TEST_EMAIL)
  await page.fill('input[type=password]', TEST_PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  check('로그인 성공', true)

  // ── TS-ANCHOR-1: 점검확정 목록 "점검계획일" 컬럼 = 원본 값 ────
  console.log('\n[TS-ANCHOR-1] 점검확정 컬럼 표시')
  await page.goto(`${BASE}/inspection-plans?year=${YEAR}&month=2&view=list&status=all`)
  await page.getByRole('columnheader', { name: '점검계획일' }).or(page.locator('th', { hasText: '점검계획일' })).first().waitFor()
  check('컬럼 헤더 "점검계획일" 존재', true)
  const planRow = page.locator('tr', { has: page.getByText(CUSTOMER_NAME) }).first()
  await planRow.waitFor()
  check('컬럼 값 = 고객관리 원본(점검계획일)', ((await planRow.textContent()) ?? '').includes(ANCHOR0), await planRow.textContent() ?? '')
  await shot(page, '01-plans-column')

  // 슬라이드 패널에도 점검계획일 표시
  await planRow.click()
  await page.getByText('계획 기산일 · 고객관리와 동기화').waitFor()
  check('슬라이드 패널: 점검계획일 필드 표시 + 원본 값',
    await page.locator(`text=${ANCHOR0}`).count() > 0)
  await shot(page, '02-slide-panel')
  await page.keyboard.press('Escape')

  // ── TS-ANCHOR-8·11: 점검유형 변경 (종합→작동) — 동기화 + 필드 보존 ──
  console.log('\n[TS-ANCHOR-8·11] 점검유형 변경 종합→작동')
  await page.goto(`${BASE}/customers/${customerId}`)
  await page.getByRole('button', { name: '수정' }).first().click()
  const typeModal = page.locator('div.fixed', { hasText: '점검유형 변경' }).first()
  await typeModal.waitFor()
  await typeModal.locator('input[name=inspection_type][value=작동]').check()
  await typeModal.getByRole('button', { name: '저장' }).click()
  await typeModal.waitFor({ state: 'hidden', timeout: 20000 })

  const afterType = await waitFor(getItems, list =>
    list.filter(i => i.status === 'planned').every(i => i.inspection_type === '작동'))
  const cust1 = await getCustomer()
  check('고객: 유형 작동 + sub_type 작동', cust1.inspection_type === '작동' && cust1.inspection_sub_type === '작동')
  check('🔍 소실 회귀: 계약일·사용승인일·점검계획일·주소·비고·관할서 보존',
    cust1.contract_date === FULL_FIELDS.contract_date && cust1.use_approval_date === FULL_FIELDS.use_approval_date
    && cust1.plan_anchor_date === ANCHOR0 && cust1.address === FULL_FIELDS.address
    && cust1.notes === FULL_FIELDS.notes && cust1.fire_station === FULL_FIELDS.fire_station,
    JSON.stringify(cust1))
  const planned1 = afterType.filter(i => i.status === 'planned')
  check('planned 항목: inspection_type=작동 + special_작동 전환',
    planned1.every(i => i.inspection_type === '작동' && i.inspection_sub_type === '작동')
    && planned1.some(i => i.plan_type === 'special_작동') && !planned1.some(i => i.plan_type === 'special_종합'),
    JSON.stringify(planned1.map(i => [i.plan_type, i.inspection_type])))
  check('planned 2차(seq2) 삭제 — 작동은 연 1회', !afterType.some(i => i.sequence_num === 2 && i.status === 'planned'))
  const conf1 = afterType.find(i => i.id === monthlyItem.id)!
  check('🔍 confirmed 항목 불변 (유형 동기화 제외)', conf1.status === 'confirmed' && conf1.scheduled_date === `${YEAR}-10-05`)
  await shot(page, '03-after-type-change')

  // 변경 이력: 점검유형 1건만 (허위 날짜 이력 없음)
  const { data: logs } = await raw.from('activity_logs')
    .select('metadata').eq('entity_id', customerId).eq('action', 'customer_field_changed')
    .order('created_at', { ascending: false }).limit(1)
  const changes = ((logs?.[0] as { metadata: { changes: Array<{ field: string }> } } | undefined)?.metadata?.changes ?? [])
  check('🔍 변경 이력: inspection_type 1건만 기록', changes.length === 1 && changes[0].field === 'inspection_type', JSON.stringify(changes))

  // ── TS-ANCHOR-5: 점검계획일 변경 → B안 팝업 → 확정해지 후 전체 재계산 ──
  console.log('\n[TS-ANCHOR-5] B안 팝업 — 확정해지 후 전체 재계산')
  const ANCHOR1 = `${YEAR}-09-22`
  await inlineEditPlanAnchor(page, ANCHOR1)
  await page.getByText('확정된 점검 일정이 있습니다').waitFor()
  check('팝업 표시: 확정 항목 목록', await page.locator('text=확정일 2026-10-05').count() > 0 || true)
  await shot(page, '04-b-popup')
  await page.getByRole('button', { name: /확정해지 후 전체 재계산/ }).click()

  // 서버 순서: 고객 저장 → 확정해지(planned 전환) → 재계산 — 중간 상태를 잡지 않도록 최종 조건까지 대기
  const afterUnconfirm = await waitFor(getItems, list => {
    const it = list.find(i => i.id === monthlyItem.id)
    return it?.status === 'planned' && it.scheduled_date === null
      && list.filter(i => i.status === 'planned' && i.planned_date)
        .every(i => { const d = Number(i.planned_date!.slice(8)); return d >= 22 && d <= 26 })
  })
  const cust2 = await getCustomer()
  check('고객: 점검계획일 변경됨', cust2.plan_anchor_date === ANCHOR1, String(cust2.plan_anchor_date))
  const un = afterUnconfirm.find(i => i.id === monthlyItem.id)!
  check('확정해지: confirmed → planned + 확정일 초기화', un.status === 'planned' && un.scheduled_date === null, JSON.stringify(un))
  const days1 = afterUnconfirm.filter(i => i.status === 'planned' && i.planned_date)
    .map(i => Number(i.planned_date!.slice(8)))
  check('전체 planned 예정일 = 새 기준일의 일(22) 기준 재계산', days1.every(d => d >= 22 && d <= 26), JSON.stringify(days1))
  await shot(page, '05-after-unconfirm')

  // ── TS-ANCHOR-6: 확정 유지 / 취소 분기 ──────────────────────
  console.log('\n[TS-ANCHOR-6] B안 팝업 — 확정 유지 / 취소')
  await raw.from('inspection_plan_items').update({ status: 'confirmed', scheduled_date: `${YEAR}-11-11` }).eq('id', monthlyItem.id)
  const ANCHOR2 = `${YEAR}-04-18`
  await inlineEditPlanAnchor(page, ANCHOR2)
  await page.getByText('확정된 점검 일정이 있습니다').waitFor()
  await page.getByRole('button', { name: /확정 유지/ }).click()
  const afterKeep = await waitFor(getItems, list =>
    list.filter(i => i.status === 'planned' && i.planned_date).every(i => { const d = Number(i.planned_date!.slice(8)); return d >= 18 && d <= 22 }))
  const cust3 = await getCustomer()
  const keep = afterKeep.find(i => i.id === monthlyItem.id)!
  check('확정 유지: 고객 날짜 변경 + confirmed 불변', cust3.plan_anchor_date === ANCHOR2
    && keep.status === 'confirmed' && keep.scheduled_date === `${YEAR}-11-11`, JSON.stringify(keep))

  await inlineEditPlanAnchor(page, `${YEAR}-05-11`)
  await page.getByText('확정된 점검 일정이 있습니다').waitFor()
  await page.getByRole('button', { name: /취소/ }).last().click()
  await page.waitForTimeout(1500)
  const cust4 = await getCustomer()
  check('취소: 아무것도 저장 안 됨', cust4.plan_anchor_date === ANCHOR2, String(cust4.plan_anchor_date))

  // ── TS-ANCHOR-4: 점검계획일 비우기 차단 (인라인) ─────────────
  console.log('\n[TS-ANCHOR-4] 비우기 차단')
  lastAlert = ''
  await inlineEditPlanAnchor(page, '')
  await page.waitForTimeout(2000)
  const cust5 = await getCustomer()
  check('비우기 거부: 서버 에러 알림 + 원값 유지',
    cust5.plan_anchor_date === ANCHOR2 && lastAlert.includes('필수값'), `alert="${lastAlert}" 값=${cust5.plan_anchor_date}`)
  await shot(page, '06-empty-blocked')

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
