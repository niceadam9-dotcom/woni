// TS-PROP-4: 고객 삭제 → 비활성 전환 + 미완료 계획 자동취소 (+ 프로브: 재활성 복원)
import { raw, BASE, PW, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const EMAIL = 'test-tsprop4@erp-test.com'
let adminId = '', custId = '', browser = null
const NAME = 'TEST-삭제전파-빌딩'
try {
  adminId = await mkUser({ email: EMAIL, name: 'TEST-TS4관리자', employeeId: 'TEST-TS4' })
  custId = await mkCustomer({ customer_name: NAME, created_by: adminId, assigned_employee_id: adminId })
  const { id: p08 } = await ensurePlan(2026, 8, adminId)
  await raw.from('inspection_plan_items').insert([
    { plan_id: p08, customer_id: custId, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', sequence_num: 1, plan_type: 'monthly', planned_date: '2026-08-10', status: 'planned' },
    { plan_id: p08, customer_id: custId, inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동', sequence_num: 2, plan_type: 'monthly', planned_date: '2026-08-20', scheduled_date: '2026-08-20', status: 'confirmed' },
  ])

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  // 고객 목록에서 삭제 (2단계 클릭 확인)
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-삭제전파')}&active=all`)
  const row = () => page.locator('tr', { has: page.getByText(NAME) }).first()
  await row().waitFor()
  const delBtn = row().locator(`button[title*="삭제"]`)
  await delBtn.click()
  await row().locator('button[title*="한 번 더"]').click()
  // 비활성 전환 대기
  const inact = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('customers').select('is_active').eq('id', custId).single(); if (data && !data.is_active) return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  check('삭제 실행 → 고객 비활성 전환', inact)

  const { data: items } = await raw.from('inspection_plan_items').select('status, notes').eq('customer_id', custId)
  check('미완료 계획 2건 자동취소 + 마커 보존',
    items.length === 2 && items.every(i => i.status === 'cancelled' && (i.notes ?? '').includes('⟦자동취소:')),
    JSON.stringify(items))

  // 화면: 고객 목록(전체) 비활성 표시 + 점검확정 취소 칩
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-삭제전파')}&active=all`)
  await row().waitFor()
  check('고객 목록: 비활성 표시', await row().getByRole('button', { name: '비활성' }).isVisible())
  await page.goto(`${BASE}/inspection-plans?year=2026&month=8&view=list`)
  await page.getByRole('button', { name: /^전체/ }).first().click()
  const planRow = page.locator('tr', { has: page.getByText(NAME) }).first()
  await planRow.waitFor()
  check('점검확정: 취소 상태 표시', ((await planRow.textContent()) ?? '').includes('취소'))

  // 🔍 프로브: 재활성 시 복원 (PROP-3 복원 경로 공유 확인)
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-삭제전파')}&active=all`)
  await row().getByRole('button', { name: '비활성' }).click()
  await row().getByRole('button', { name: '활성' }).waitFor()
  const restored = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('inspection_plan_items').select('status').eq('customer_id', custId); if (data?.every(x => x.status !== 'cancelled')) return data; await new Promise(r=>setTimeout(r,500)) } return null })()
  check('🔍 재활성 → 원상태(planned·confirmed) 복원', !!restored && restored.some(x=>x.status==='planned') && restored.some(x=>x.status==='confirmed'), JSON.stringify(restored))
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  await cleanupCustomer(custId)
  await delUser(adminId)
  console.log('정리 완료')
}
summary()
