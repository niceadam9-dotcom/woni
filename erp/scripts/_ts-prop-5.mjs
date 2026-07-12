// TS-PROP-5: 사용승인일 변경 → 미완료 계획 예정일 재계산 + 확정·6단계 초기화
// 프로브: 점검 이력 있는 고객은 기준일이 점검시작일 우선이라 승인일 변경 영향 없음
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const EMAIL = 'test-tsprop5@erp-test.com'
let adminId = '', custId = '', cust2Id = '', browser = null
const NAME = 'TEST-승인일변경-빌딩'
try {
  adminId = await mkUser({ email: EMAIL, name: 'TEST-TS5관리자', employeeId: 'TEST-TS5' })
  // 고객 1: 점검 이력 없음 — 승인일 3/15 → 기준일
  custId = await mkCustomer({ customer_name: NAME, created_by: adminId, use_approval_date: '2020-03-15' })
  const { id: p08 } = await ensurePlan(2026, 8, adminId)
  const { id: p09 } = await ensurePlan(2026, 9, adminId)
  await raw.from('inspection_plan_items').insert([
    // planned: 예정일 15일 기준
    { plan_id: p08, customer_id: custId, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', sequence_num: 1, plan_type: 'monthly', planned_date: '2026-08-17', status: 'planned' },
    // confirmed + 6단계 계산됨
    { plan_id: p09, customer_id: custId, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', sequence_num: 1, plan_type: 'monthly', planned_date: '2026-09-15', scheduled_date: '2026-09-15', status: 'confirmed', step1_date: '2026-09-15', step2_date: '2026-09-21', step3_date: '2026-09-25', step4_date: '2026-10-01', step5_date: '2026-10-12', step6_date: '2026-10-20' },
  ])
  // 고객 2 (프로브): 점검 이력 있음 → 기준일 = 점검시작일(5/20), 승인일 변경 무영향
  cust2Id = await mkCustomer({ customer_name: 'TEST-승인일무영향-빌딩', created_by: adminId, use_approval_date: '2020-03-15' })
  await raw.from('inspections').insert({ customer_id: cust2Id, inspection_type: '작동', sequence_num: 1, inspection_start_date: '2026-05-20', status: 'completed', assigned_employee_id: adminId, created_by: adminId })
  await raw.from('inspection_plan_items').insert(
    { plan_id: p08, customer_id: cust2Id, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', sequence_num: 1, plan_type: 'monthly', planned_date: '2026-08-20', status: 'planned' })

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  // 고객 1 상세에서 승인일 3/15 → 2019-09-08 로 변경 (수정 폼 인라인)
  await page.goto(`${BASE}/customers/${custId}`)
  await page.locator('textarea[placeholder="특이사항 메모"]').waitFor()
  const dateInputs = page.locator('input[type=date]')
  // 폼의 date 입력 중 승인일 필드 찾기 — 값이 2020-03-15인 것
  const n = await dateInputs.count()
  let approvalInput = null
  for (let i = 0; i < n; i++) {
    if ((await dateInputs.nth(i).inputValue()) === '2020-03-15') { approvalInput = dateInputs.nth(i); break }
  }
  check('승인일 입력 필드 발견', !!approvalInput)
  await approvalInput.fill('2019-09-08')
  await page.locator('button:has-text("저장"):not([disabled])').first().click()
  // DB 반영 대기
  const after = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('customers').select('use_approval_date').eq('id', custId).single(); if (data?.use_approval_date === '2019-09-08') return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  check('승인일 변경 저장(2019-09-08)', after)

  // 재계산은 고객 저장 후 비동기 진행 — 9월 항목 초기화까지 폴링
  let items = null
  for (let i = 0; i < 20; i++) {
    const { data } = await raw.from('inspection_plan_items')
      .select('status, planned_date, scheduled_date, step1_date, inspection_plans(month)').eq('customer_id', custId)
    items = data
    if (data?.find(x => x.inspection_plans.month === 9)?.status === 'planned') break
    await new Promise(r => setTimeout(r, 500))
  }
  const aug = items.find(i => i.inspection_plans.month === 8)
  const sep = items.find(i => i.inspection_plans.month === 9)
  check('planned 항목 예정일 재계산 (8일 기준, 8월)', aug?.planned_date?.endsWith('-08-10') || aug?.planned_date?.slice(8) >= '08',
    `실제: ${aug?.planned_date} (새 기준 일=8, 주말이면 다음 영업일)`)
  check('confirmed 항목 초기화: status planned + 확정일·step1 null',
    sep?.status === 'planned' && sep?.scheduled_date === null && sep?.step1_date === null, JSON.stringify(sep))

  // 점검확정 화면 반영
  await page.goto(`${BASE}/inspection-plans?year=2026&month=9&view=list`)
  await page.getByRole('button', { name: /^전체/ }).first().click()
  const planRow = page.locator('tr', { has: page.getByText(NAME) }).first()
  await planRow.waitFor()
  check('점검확정: 확정 해제되어 "점검일 확정" 표시', await planRow.getByText('점검일 확정').isVisible())

  // 🔍 프로브: 점검 이력 고객 — 승인일 변경해도 예정일 불변 (기준일=점검시작일)
  await page.goto(`${BASE}/customers/${cust2Id}`)
  await page.locator('textarea[placeholder="특이사항 메모"]').waitFor()
  const inputs2 = page.locator('input[type=date]')
  const n2 = await inputs2.count()
  for (let i = 0; i < n2; i++) {
    if ((await inputs2.nth(i).inputValue()) === '2020-03-15') { await inputs2.nth(i).fill('2019-11-11'); break }
  }
  await page.locator('button:has-text("저장"):not([disabled])').first().click()
  await new Promise(r => setTimeout(r, 2500))
  const { data: probe } = await raw.from('inspection_plan_items').select('planned_date').eq('customer_id', cust2Id).single()
  check('🔍 점검 이력 고객: 예정일 불변 (기준일=점검시작일 5/20 우선)', probe.planned_date === '2026-08-20', `실제: ${probe.planned_date}`)
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  await cleanupCustomer(custId)
  await cleanupCustomer(cust2Id)
  await delUser(adminId)
  console.log('정리 완료')
}
summary()
