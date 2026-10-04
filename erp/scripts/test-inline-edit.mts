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

/** 9366e6f1(2026-09-02)부터 인라인 칸도 기산점·종류 변경 시 전체 폼과 같은 미리보기
 *  「저장하면 이렇게 바뀝니다」를 띄우고, 사용자가 [이대로 저장]을 눌러야 저장된다.
 *  일정이 안 바뀌면 팝업 없이 조용히 저장하므로(anchorPreviewWorthShowing) 떴을 때만 누른다.
 *  종전 이 검사는 팝업을 몰라 저장이 안 된 채 끝났다(유형·점검일자 단언 4건 빨강). */
async function confirmPreviewIfShown(page: Page): Promise<boolean> {
  const title = page.getByText('저장하면 이렇게 바뀝니다')
  const shown = await title.waitFor({ timeout: 5000 }).then(() => true, () => false)
  if (shown) {
    await page.getByRole('button', { name: '이대로 저장' }).click()
    await title.waitFor({ state: 'hidden' })
  }
  return shown
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
  // 2026-08-05 종류 세분화로 이 셀렉트의 값은 종합·작동·일반종합·일반작동 넷이 됐다.
  // 종전 '일반관리'는 값 목록에 없어 selectOption이 계속 타임아웃났다(옵션을 못 찾는다).
  // 일반(작동)을 고르는 이유: 110 백필 기본이 작동이라 기존 동작과 같은 자리에 떨어진다.
  await typeSel.selectOption('일반작동')
  await page.locator('h1').click() // blur → 저장
  console.log(`  (미리보기 팝업 ${await confirmPreviewIfShown(page) ? '표시 → 이대로 저장' : '없음 — 조용히 저장'})`)
  // ⚠ 기대를 현행 설계로 바꿨다(2026-08-19). 소방계획서_6 W-9·W-26으로 일반관리는
  //   **event를 만들지 않는다** — 소방안전관리와 같은 special_* 파이프라인을 쓰고
  //   정기(monthly)만 미생성한다(customers/actions.ts:290-291 및 312-313 주석).
  //   종전 이 자리의 기대(special 전부 삭제 + event 1건 자동 생성·자동 확정)는 그 이전 모델이라
  //   현행에서는 영영 참이 될 수 없었다. 앞줄 selectOption이 먼저 타임아웃나서 가려져 있었다.
  const afterType = await waitFor(getItems, list => list.length > 0 && !list.some(i => i.plan_type === 'monthly'))
  const { data: c1 } = await raw.from('customers').select('inspection_type, inspection_sub_type').eq('id', customerId).single()
  const c1o = c1 as { inspection_type: string; inspection_sub_type: string | null } | null
  check('고객: 일반관리(작동)로 변경', c1o?.inspection_type === '일반관리' && c1o?.inspection_sub_type === '작동', JSON.stringify(c1))
  check('정기(monthly) 항목은 사라진다 — 일반관리는 매달 돌지 않는다',
    !afterType.some(i => i.plan_type === 'monthly'), JSON.stringify(afterType.map(i => i.plan_type)))
  check('특별(special_*) 항목은 남는다 — 일반관리도 같은 파이프라인(W-26)',
    afterType.some(i => i.plan_type?.startsWith('special')), JSON.stringify(afterType.map(i => i.plan_type)))
  check('event는 생성되지 않는다 — event 신규 생성 중단(W-26)',
    !afterType.some(i => i.plan_type === 'event'), JSON.stringify(afterType.map(i => i.plan_type)))

  // ── 2) 담당직원 드롭다운: 미배정 → 테스트관리자 ──
  console.log('\n[2] 담당직원 드롭다운 (미배정 → 배정)')
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-INLINE')}&active=all`)
  await row(page).waitFor()
  // 컬럼은 고객명·점검유형·계약일·사용승인일·점검일자·담당직원·상태·문서·(액션) — 담당직원은 5번이다.
  // 「기본/전체 컬럼」 토글 폐지(2026-09-20)로 계약일·사용승인일이 상시 표시된다 — 종전 nth(3)은 토글 시절 인덱스다.
  await row(page).locator('td').nth(5).locator('[title="클릭하여 수정"]').click()
  const empSel = row(page).locator('td').nth(5).locator('select')
  await empSel.waitFor()
  await empSel.selectOption(userId)
  await page.locator('h1').click()
  const afterEmp = await waitFor(getItems, list => list.every(i => i.assigned_employee_id === userId))
  const { data: c2 } = await raw.from('customers').select('assigned_employee_id').eq('id', customerId).single()
  check('고객: 담당직원 저장', (c2 as { assigned_employee_id: string | null } | null)?.assigned_employee_id === userId)
  check('계획항목(확정 event 포함)에 담당 전파', afterEmp.every(i => i.assigned_employee_id === userId), JSON.stringify(afterEmp.map(i => i.assigned_employee_id)))

  // ── 3) 점검계획일 인라인 변경 (일반관리): 그 달 안에서 날짜만 따라간다 ──
  console.log('\n[3] 점검일자 변경 (9-10 → 10-05, 특별은 기산월로 이동)')
  lastAlert = ''
  // 점검일자는 4번 컬럼(위 주석 참조) — 종전 nth(2)는 토글 시절 인덱스다
  await row(page).locator('td').nth(4).locator('[title="클릭하여 수정"]').click()
  const dateInput = row(page).locator('td').nth(4).locator('input[type=text]')
  await dateInput.waitFor()
  await dateInput.fill(ANCHOR1)
  await dateInput.press('Enter')
  await page.waitForTimeout(500)
  const popupShown = await page.getByText('확정된 점검 일정이 있습니다').count()
  check('확정보호 팝업 미표시 (확정 보호 팝업은 2026-09-12 폐지)', popupShown === 0)
  // 같은 달 안에서 날짜가 바뀌므로 미리보기는 반드시 뜬다 — 안 뜨면 그 자체가 회귀다
  check('기산점 변경 미리보기 표시 → 이대로 저장', await confirmPreviewIfShown(page))
  // ★ 먼저 **저장 자체**를 확인한다 — 이게 빠져 있어서, 인라인 저장이 안 된 경우에도
  //   아래 항목 단언만 실패하고 원인이 계획 재계산 쪽으로 오인됐다.
  const savedAnchor = await waitFor(
    async () => ((await raw.from('customers').select('plan_anchor_date').eq('id', customerId).single()).data as { plan_anchor_date: string } | null)?.plan_anchor_date ?? '',
    v => v === ANCHOR1)
  check('★ 점검계획일이 실제로 저장된다', savedAnchor === ANCHOR1, `anchor=${savedAnchor}`)
  // ★ 기준일은 **달까지** 옮긴다 — 「변동 = 재계산」(reconcileSpecialSlots, customers/actions.ts
  //   기산점 변경 분기). 이 고객은 사용승인일이 없어 점검일자가 곧 기산점(잠정 기산점, ac9cbed7)이고,
  //   특별점검은 기산월(10월)로 자리를 옮긴 뒤 그 달의 기준일 일자(주말·공휴일이면 다음 영업일)에 앉는다.
  //   롤링이라 올해+내년 두 해를 맞추므로 내년 특별도 생긴다 — **해마다 1건**이 계약이다.
  //   종전 기대(「달은 그대로·특별 1건뿐」)는 _resetPlanItemsForCustomer만 돌던 시절의 것이고,
  //   그 단언들은 인라인 저장이 미리보기 팝업에 막혀(위 confirmPreviewIfShown) 오래 가려져 있었다.
  const beforeDate = afterEmp.find(i => i.plan_type?.startsWith('special'))?.planned_date ?? ''
  const anchorDay = +ANCHOR1.slice(8, 10)
  const thisYearSpecial = (list: ItemRow[]) =>
    list.find(i => i.plan_type?.startsWith('special') && i.planned_date?.startsWith(`${YEAR}-`))
  const afterAnchor = await waitFor(getItems, list => {
    const sp = thisYearSpecial(list)
    return !!sp && sp.planned_date !== beforeDate
  })
  const sp2 = thisYearSpecial(afterAnchor)
  const specialsPerYear = new Map<string, number>()
  for (const i of afterAnchor) if (i.plan_type?.startsWith('special')) {
    const y = i.planned_date?.slice(0, 4) ?? '?'
    specialsPerYear.set(y, (specialsPerYear.get(y) ?? 0) + 1)
  }
  check('특별 항목은 해마다 1건 (재계산이 같은 해에 중복을 만들지 않는다)',
    specialsPerYear.size >= 1 && [...specialsPerYear.values()].every(n => n === 1),
    JSON.stringify(Object.fromEntries(specialsPerYear)))
  check('★ 올해 특별은 새 기준일의 달로 옮겨진다',
    !!sp2 && sp2.planned_date?.slice(0, 7) === ANCHOR1.slice(0, 7), `${beforeDate} → ${sp2?.planned_date}`)
  check('★ 그 달 안에서 새 기준일의 일자로 이동(주말·공휴일이면 다음 영업일)',
    !!sp2 && +sp2.planned_date!.slice(8, 10) >= anchorDay && +sp2.planned_date!.slice(8, 10) <= anchorDay + 4,
    `기준일 ${anchorDay}일 → ${sp2?.planned_date}`)
  check('event는 여전히 없다', !afterAnchor.some(i => i.plan_type === 'event'), JSON.stringify(afterAnchor.map(i => i.plan_type)))
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
