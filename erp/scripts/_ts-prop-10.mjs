// TS-PROP-10: 미점검 초과 경보 → 자동 해결 → 과거 승인월 계획 생성 + 경보 소멸
// 프로브: 생성 항목 취소 후 경보 재포착 없음 (ADD-20 회귀)
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'test-tsprop10@erp-test.com'
let adminId = '', custId = '', browser = null
const NAME = 'TEST-초과해결-빌딩'
const createdPlanIds = []
try {
  adminId = await mkUser({ email: EMAIL, name: 'TEST-TS10관리자', employeeId: 'TEST-TS10' })
  // 승인월 4월(과거) + 계획 항목 없음 → 초과 대상
  custId = await mkCustomer({ customer_name: NAME, created_by: adminId, use_approval_date: '2021-04-12', assigned_employee_id: adminId })
  const { data: p04before } = await raw.from('inspection_plans').select('id').eq('year', 2026).eq('month', 4).maybeSingle()

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  // ① 경보 노출
  await page.goto(`${BASE}/inspection-plans?year=2026&month=7&view=list`)
  await page.getByText(/미점검 초과 \d+건/).waitFor({ timeout: 15000 })
  check('경보: 미점검 초과 배너 노출', true)

  // ② 자동 해결 모달 → 승인
  await page.getByRole('button', { name: '자동 해결' }).click()
  await page.getByText('미점검 초과 자동 해결').waitFor()
  const modal = page.locator('div.fixed').filter({ hasText: '미점검 초과 자동 해결' })
  check('모달: 대상 고객 표시', ((await modal.textContent()) ?? '').includes(NAME))
  await modal.getByRole('button', { name: /승인 — \d+건 계획에 추가/ }).click()
  await modal.getByRole('button', { name: /완료/ }).click()

  // ③ 과거 승인월(4월) 항목 생성 확인
  const created = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('inspection_plan_items').select('status, plan_type, inspection_plans(year, month)').eq('customer_id', custId); if (data?.length) return data; await new Promise(r=>setTimeout(r,500)) } return [] })()
  check('과거 승인월(4월) 항목 생성', created.some(i => i.inspection_plans.year === 2026 && i.inspection_plans.month === 4), JSON.stringify(created.map(i=>i.inspection_plans)))

  // ④ 경보 소멸
  await page.goto(`${BASE}/inspection-plans?year=2026&month=7&view=list`)
  await new Promise(r => setTimeout(r, 1500))
  const bannerText = await page.getByText(/미점검 초과 \d+건/).textContent().catch(() => null)
  const stillListed = bannerText !== null && (await page.locator('div', { hasText: NAME }).count()) > 0 && false
  check('경보: 해당 고객 소멸', !(bannerText && (await page.getByText(NAME).isVisible().catch(() => false))), `배너: ${bannerText ?? '없음'}`)

  // 🔍 ⑤ ADD-20 회귀: 생성 항목 취소 → 경보 재등장 없음
  await raw.from('inspection_plan_items').update({ status: 'cancelled' }).eq('customer_id', custId)
  await page.goto(`${BASE}/inspection-plans?year=2026&month=7&view=list`)
  await page.getByText('월간 점검계획 확정').first().waitFor()
  await new Promise(r => setTimeout(r, 1000))
  const reappear = await page.getByText(/미점검 초과 \d+건/).isVisible().catch(() => false)
    ? ((await page.locator('.fixed, body').first().textContent()) ?? '').includes(NAME) && (await page.getByRole('button', { name: '자동 해결' }).isVisible())
      ? (await (async () => { await page.getByRole('button', { name: '자동 해결' }).click(); await page.getByText('미점검 초과 자동 해결').waitFor(); const t = (await page.locator('div.fixed').filter({ hasText: '미점검 초과 자동 해결' }).textContent()) ?? ''; const has = t.includes(NAME); await page.keyboard.press('Escape'); return has })())
      : false
    : false
  check('🔍 ADD-20 회귀: 취소 건 경보 재포착 없음', !reappear)

  // 4월 플랜이 이번 테스트로 새로 생겼다면 정리 대상 기록
  if (!p04before) {
    const { data: p04 } = await raw.from('inspection_plans').select('id').eq('year', 2026).eq('month', 4).maybeSingle()
    if (p04) createdPlanIds.push(p04.id)
  }
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  await cleanupCustomer(custId)
  for (const pid of createdPlanIds) {
    const { count } = await raw.from('inspection_plan_items').select('id', { count: 'exact', head: true }).eq('plan_id', pid)
    if ((count ?? 0) === 0) await raw.from('inspection_plans').delete().eq('id', pid)
  }
  console.log('정리 완료')
}
summary()
