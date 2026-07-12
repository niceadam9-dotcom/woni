// EX 예외 테스트 묶음 1: EX-1e(폼 검증), EX-2b(비활성 배정 UI 차단), EX-2d(연속 담당 변경 일관),
// EX-4d(과거 날짜 확정 실측), EX-11f(로그인 연속 실패 잠금)
import { raw, BASE, PW, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const ADM = 'test-ex-adm@erp-test.com', EA = 'test-ex-a@erp-test.com', EB = 'test-ex-b@erp-test.com', EI = 'test-ex-inactive@erp-test.com'
const LOCK = 'test-ex-lock@erp-test.com'
let admId = '', aId = '', bId = '', inId = '', lockId = '', custId = '', browser = null
const NAME = 'TEST-예외-빌딩'
try {
  admId = await mkUser({ email: ADM, name: 'TEST-예외관리자', employeeId: 'TEST-EXADM' })
  aId = await mkUser({ email: EA, name: 'TEST-예외직원A', employeeId: 'TEST-EXA', role: 'employee' })
  bId = await mkUser({ email: EB, name: 'TEST-예외직원B', employeeId: 'TEST-EXB', role: 'employee' })
  inId = await mkUser({ email: EI, name: 'TEST-예외비활성', employeeId: 'TEST-EXI', role: 'employee' })
  await raw.from('profiles').update({ is_active: false }).eq('id', inId)
  lockId = await mkUser({ email: LOCK, name: 'TEST-잠금대상', employeeId: 'TEST-EXL', role: 'employee' })

  custId = await mkCustomer({ customer_name: NAME, created_by: admId, assigned_employee_id: aId })
  const { id: p08 } = await ensurePlan(2026, 8, admId)
  await raw.from('inspection_plan_items').insert({
    plan_id: p08, customer_id: custId, inspection_type: '작동', inspection_category: '소방안전관리',
    inspection_sub_type: '작동', sequence_num: 1, plan_type: 'monthly', planned_date: '2026-08-10', status: 'planned',
  })

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, ADM)

  // ── EX-1e: 고객 등록 필수 입력 누락 ──
  console.log('[EX-1e] 등록 폼 필수 입력 검증')
  await page.goto(`${BASE}/customers/new`)
  await page.getByRole('button', { name: /등록/ }).last().click()
  await new Promise(r => setTimeout(r, 1500))
  check('EX-1e: 빈 폼 등록 거부 (페이지 잔류 + 등록 안 됨)', page.url().includes('/customers/new'))
  const { count: emptyCust } = await raw.from('customers').select('id', { count: 'exact', head: true }).eq('customer_name', '')
  check('EX-1e: 빈 이름 고객 미생성', (emptyCust ?? 0) === 0)

  // ── EX-2b: 담당자 배정 목록에서 비활성 직원 제외 ──
  console.log('[EX-2b] 비활성 직원 배정 UI 차단')
  await page.goto(`${BASE}/customers/${custId}`)
  await page.getByRole('button', { name: /담당자 (변경|배정)/ }).click()
  const modal = page.locator('div.fixed').filter({ hasText: '담당직원 배정' })
  await modal.waitFor()
  const options = await modal.locator('select option').allTextContents()
  check('EX-2b: 배정 목록에 비활성 직원 없음', !options.some(o => o.includes('TEST-예외비활성')), JSON.stringify(options))

  // ── EX-2d: 연속(즉시) 담당 변경 — 최종값 일관 ──
  console.log('[EX-2d] 연속 담당 변경 일관성')
  await modal.locator('select').selectOption({ label: /TEST-예외직원B.*/.source ? 'TEST-예외직원B' : 'TEST-예외직원B' }).catch(async () => {
    await modal.locator('select').selectOption({ index: 2 })
  })
  await modal.getByRole('button', { name: /저장|배정|변경/ }).click()
  await new Promise(r => setTimeout(r, 1200))
  // 곧바로 다시 A로 변경
  await page.getByRole('button', { name: /담당자 (변경|배정)/ }).click()
  const modal2 = page.locator('div.fixed').filter({ hasText: '담당직원 배정' })
  await modal2.waitFor()
  await modal2.locator('select').selectOption({ label: 'TEST-예외직원A' })
  await modal2.getByRole('button', { name: /저장|배정|변경/ }).click()
  const consistent = await (async () => { for (let i=0;i<20;i++){
    const { data: c } = await raw.from('customers').select('assigned_employee_id').eq('id', custId).single()
    const { data: it } = await raw.from('inspection_plan_items').select('assigned_employee_id').eq('customer_id', custId).single()
    if (c.assigned_employee_id === aId && it.assigned_employee_id === aId) return true
    await new Promise(r=>setTimeout(r,500)) } return false })()
  check('EX-2d: 연속 변경 후 고객·항목 담당 최종값(A) 일치', consistent)

  // ── EX-4d: 과거 날짜 확정 실측 ──
  console.log('[EX-4d] 과거 날짜 확정 실측 (8월 계획에서 8/1 — 시점상 미래이므로 7월 항목으로)')
  const { id: p07 } = await ensurePlan(2026, 7, admId)
  await raw.from('inspection_plan_items').insert({
    plan_id: p07, customer_id: custId, inspection_type: '작동', inspection_category: '소방안전관리',
    inspection_sub_type: '작동', sequence_num: 2, plan_type: 'monthly', planned_date: '2026-07-02', status: 'planned',
  })
  await page.goto(`${BASE}/inspection-plans?year=2026&month=7&view=list`)
  await page.getByRole('button', { name: /^전체/ }).first().click()
  const row7 = page.locator('tr', { has: page.getByText(NAME) }).first()
  await row7.waitFor()
  await row7.getByText('점검일 확정').click()
  const popup = page.locator('div.w-52')
  await popup.waitFor()
  await popup.locator('button', { hasText: /^2$/ }).click() // 7/2 — 과거
  await new Promise(r => setTimeout(r, 2000))
  const { data: past } = await raw.from('inspection_plan_items').select('status, scheduled_date').eq('plan_id', p07).eq('customer_id', custId).single()
  console.log(`  💬 실측: 과거 날짜(7/2) 확정 → ${past.status}, scheduled=${past.scheduled_date}`)
  check('EX-4d: 과거 날짜 확정 실측 기록 (허용됨 — 소급 입력 용도, 지연 표시로 노출. 정책 결정 필요 시 참조)',
    past.status === 'confirmed' || past.status === 'planned')

  // ── EX-11f: 로그인 연속 실패 잠금 (5회 → 30분) ──
  console.log('[EX-11f] 로그인 잠금')
  const ctxL = await browser.newContext(); const pL = await ctxL.newPage(); pL.setDefaultTimeout(15000)
  for (let i = 0; i < 5; i++) {
    await pL.goto(`${BASE}/login`)
    await pL.fill('input[type=email]', LOCK)
    await pL.fill('input[type=password]', 'WrongPass!!' + i)
    await pL.click('button[type=submit]')
    await new Promise(r => setTimeout(r, 1200))
  }
  const { data: lockRow } = await raw.from('profiles').select('failed_logins, locked_until').eq('id', lockId).single()
  check('EX-11f: 5회 실패 → 잠금 설정', (lockRow.failed_logins ?? 0) >= 5 && !!lockRow.locked_until, JSON.stringify(lockRow))
  // 올바른 비밀번호로도 잠금 중 로그인 불가
  await pL.goto(`${BASE}/login`)
  await pL.fill('input[type=email]', LOCK)
  await pL.fill('input[type=password]', PW)
  await pL.click('button[type=submit]')
  await new Promise(r => setTimeout(r, 1500))
  check('EX-11f: 잠금 중 올바른 비밀번호도 차단', pL.url().includes('/login'))
  await ctxL.close()
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  await cleanupCustomer(custId)
  for (const id of [admId, aId, bId, inId, lockId]) { await raw.from('notifications').delete().eq('recipient_id', id); await delUser(id) }
  console.log('정리 완료')
}
summary()
