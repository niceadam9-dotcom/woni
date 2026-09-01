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

  // 고객 목록에서 삭제 — 조건부 hard delete 모달(소방계획서_30 S3)에서 [비활성화] 선택
  // (종전 2단계 클릭 확인은 모달로 대체. 이 테스트의 축인 soft delete = 모달의 [비활성화])
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-삭제전파')}&active=all`)
  const row = () => page.locator('tr', { has: page.getByText(NAME) }).first()
  await row().waitFor()
  const delBtn = row().locator(`button[title*="삭제"]`)
  await delBtn.click()
  const modal = page.locator('[data-testid="delete-customer-modal"]')
  await modal.waitFor()
  await modal.locator('[data-testid="deactivate-btn"]').click()
  // 비활성 전환 대기
  const inact = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('customers').select('is_active').eq('id', custId).single(); if (data && !data.is_active) return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  check('삭제 실행 → 고객 비활성 전환', inact)

  // 자동취소는 is_active 갱신 뒤 행별 순차 update — is_active만 보고 바로 읽으면 레이스다. 취소 완료까지 폴링
  const items = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('inspection_plan_items').select('status, notes').eq('customer_id', custId); if (data?.length === 2 && data.every(x => x.status === 'cancelled')) return data; await new Promise(r=>setTimeout(r,500)) } return (await raw.from('inspection_plan_items').select('status, notes').eq('customer_id', custId)).data ?? [] })()
  check('미완료 계획 2건 자동취소 + 마커 보존',
    items.length === 2 && items.every(i => i.status === 'cancelled' && (i.notes ?? '').includes('⟦자동취소:')),
    JSON.stringify(items))

  // 화면: 고객 목록(전체) 비활성 표시 + 점검확정 취소 칩
  await page.goto(`${BASE}/customers?q=${encodeURIComponent('TEST-삭제전파')}&active=all`)
  await row().waitFor()
  check('고객 목록: 비활성 표시', await row().getByRole('button', { name: '비활성' }).isVisible())
  // 소방계획서_30 S1-3: 비활성 고객 건은 '전체' 칩에서 빠지고 '취소' 칩이 유일한 조회 창구다(ADD-9)
  await page.goto(`${BASE}/inspection-plans?year=2026&month=8&view=list`)
  await page.getByRole('button', { name: /^취소/ }).first().click()
  const planRow = page.locator('tr', { has: page.getByText(NAME) }).first()
  await planRow.waitFor()
  check('점검확정: 취소 칩에서 취소 상태 표시', ((await planRow.textContent()) ?? '').includes('취소'))

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
