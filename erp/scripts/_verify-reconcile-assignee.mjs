// 검증 — 재배치(reconcileSpecialSlots)가 만든 자체점검이 **고객 담당을 물려받는가**.
//
// 결함(2026-09-14 발견·수리): `reconcile-special-slots.ts`가 생성기에 `assigned_employee_id: null`을
// 박아 넘겨, 고객에 담당이 있어도 재배치가 만든 항목은 미배정으로 태어났다. 자동시작 크론은
// 미배정을 건너뛰므로(auto-start-inspections:48) 그 항목은 **아무도 시작하지 않는다**.
// 지평리56의 2026-03-26이 그 자리였다(실측: 운영 4건·스테이징 7건).
//
// ⚠ 전역 크론(`/api/cron/generate-yearly-plans`)에 기대지 않는다 — 305명 전체를 도느라 느리고
//   이 고객만의 축을 가리지도 못한다(처음에 그렇게 짰다가 헤더 타임아웃으로 「호출 실패」인데
//   항목은 생기는 혼란을 겪었다). **기산점 변경 → 재배치**라는 실제 경로를 화면으로 탄다.
// 판정은 DOM이 아니라 DB다 — 이 결함은 화면에 아무 흔적을 남기지 않는다.
import { launch, login, mkUser, delUser, mkCustomer, cleanupCustomer, pollDb, check, summary, raw } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-reconcile-assignee@test.local'
const NAME = `ZZ담당전파${Math.random().toString(36).slice(2, 6)}`
const uid = await mkUser({ email: EMAIL, name: 'E2ERA', employeeId: 'ERA', role: 'admin' })
let custId = null
let custId2 = null
const { browser, page } = await launch()
page.setDefaultTimeout(60000)
page.setDefaultNavigationTimeout(60000)

const selfItems = async () => {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, plan_type, scheduled_date, assigned_employee_id')
    .eq('customer_id', custId).neq('plan_type', 'monthly').order('scheduled_date')
  return data ?? []
}

try {
  custId = await mkCustomer({
    customer_name: NAME, created_by: uid, assigned_employee_id: uid,
    use_approval_date: '2018-07-10', plan_anchor_date: '2018-07-10',
    inspection_type: '종합', inspection_sub_type: '종합',
  })
  // mkCustomer는 DB 직삽이라 계획을 만들지 않는다 — 자리가 비어 있음이 이 검사의 출발점이다
  check('전제: 시작 시 자체점검 자리가 비어 있다', (await selfItems()).length === 0)

  await login(page, EMAIL)
  await page.goto(`http://localhost:3000/customers?cols=full&q=${encodeURIComponent(NAME)}`)
  await page.waitForSelector('[data-testid="inline-use_approval_date"]', { timeout: 30000 })

  // 기산점(사용승인일)의 **달을 바꾼다** → 법정 달이 옮겨가 재배치가 새 자리를 만든다
  await page.locator('[data-testid="inline-use_approval_date"]').first().click()
  const box = page.locator('[data-testid="inline-use_approval_date-edit"]').first()
  await box.waitFor({ timeout: 15000 })
  await box.locator('input:not([type="date"])').first().fill('2018-11-10')
  await page.locator('[data-testid="inline-save"]').first().click()
  await page.locator('button:has-text("이대로 저장")').first().click({ timeout: 30000 }).catch(() => {})

  const made = await pollDb(async () => {
    const rows = await selfItems()
    return rows.length > 0 ? rows : null
  }, 40000)
  check('재배치가 자체점검을 만들었다(이 검사의 전제)', !!made, '40초 내 0건')
  if (!made) summary()

  console.log('  생성:', made.map(i => `${i.scheduled_date} ${i.plan_type} ${i.assigned_employee_id ? '담당있음' : '미배정'}`).join(' | '))
  const unassigned = made.filter(i => !i.assigned_employee_id)
  check('⭐ 새로 만든 자체점검이 고객 담당을 물려받는다', unassigned.length === 0,
    `미배정 ${unassigned.length}건: ${unassigned.map(i => i.scheduled_date).join(',')}`)
  check('   담당이 그 고객의 담당과 같다', made.every(i => i.assigned_employee_id === uid),
    made.map(i => i.assigned_employee_id).join(','))

  // 음성 축 — **별도 고객**으로 본다(같은 고객을 2회차 돌리면 앞선 항목·기산점이 섞여
  //   무엇이 언제 생겼는지 못 가른다 — 실제로 그렇게 한 번 오판했다).
  //   고객이 미배정이면 항목도 미배정이어야 한다: 없는 담당을 지어내지 않는다.
  const NAME2 = NAME + '무담당'
  custId2 = await mkCustomer({
    customer_name: NAME2, created_by: uid, assigned_employee_id: null,
    use_approval_date: '2018-07-10', plan_anchor_date: '2018-07-10',
    inspection_type: '종합', inspection_sub_type: '종합',
  })
  await page.goto(`http://localhost:3000/customers?cols=full&q=${encodeURIComponent(NAME2)}`)
  await page.waitForSelector('[data-testid="inline-use_approval_date"]', { timeout: 30000 })
  await page.locator('[data-testid="inline-use_approval_date"]').first().click()
  const box2 = page.locator('[data-testid="inline-use_approval_date-edit"]').first()
  await box2.waitFor({ timeout: 15000 })
  await box2.locator('input:not([type="date"])').first().fill('2018-11-10')
  await page.locator('[data-testid="inline-save"]').first().click()
  await page.locator('button:has-text("이대로 저장")').first().click({ timeout: 30000 }).catch(() => {})
  const made2 = await pollDb(async () => {
    const { data } = await raw.from('inspection_plan_items')
      .select('scheduled_date, assigned_employee_id')
      .eq('customer_id', custId2).neq('plan_type', 'monthly')
    return (data ?? []).length > 0 ? data : null
  }, 40000)
  console.log('  무담당 고객 생성:', (made2 ?? []).map(i => `${i.scheduled_date}=${i.assigned_employee_id ? '있음' : '미배정'}`).join(' ') || '(없음)')
  check('음성축: 고객이 미배정이면 항목도 미배정이다',
    !!made2 && made2.every(i => !i.assigned_employee_id), '담당이 지어내졌다')
} finally {
  await browser.close()
  await cleanupCustomer(custId)
  await cleanupCustomer(custId2)
  await delUser(uid)
}
summary()
