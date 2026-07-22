// 점검일 입력 → 자동 시작 E2E — 확정 즉시 inspections 생성(달력·점검업무·보고서 반영)
// 실행: npx tsx scripts/test-auto-start.mts  (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'auto-start-e2e@erp-test.com'
let userId = ''
let customerId = ''
let itemId = ''
let planCreated = false
let planId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '자동시작E2E', employeeId: 'E2E-AUTOSTART' })
  customerId = await mkCustomer({ customer_name: '자동시작E2E고객', created_by: userId })

  const now = new Date()
  const plan = await ensurePlan(now.getFullYear(), now.getMonth() + 1, userId)
  planId = plan.id
  planCreated = plan.created
  const { data: item, error: itemErr } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: customerId, inspection_type: '작동', sequence_num: 1,
    status: 'planned', plan_type: 'special_작동', assigned_employee_id: userId,
  }).select('id').single()
  if (itemErr) throw new Error(`계획 항목 생성 실패: ${itemErr.message}`)
  itemId = item.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspection-plans?view=list`)
  const row = page.locator('tr:has-text("자동시작E2E고객")')
  await row.waitFor()
  check('점검확정 목록에 항목 표시', true)

  // 점검일 인라인 입력 (미니 달력 → 15일 선택)
  await row.getByText('점검일 확정').click()
  const popup = page.locator('div[class*="z-[9999]"]')
  await popup.waitFor()
  await popup.getByText('15', { exact: true }).click()
  await page.waitForTimeout(4000) // 확정 + 자동 시작 + refresh

  // DB 검증 — 확정 + 자동 시작
  const { data: after } = await raw.from('inspection_plan_items')
    .select('scheduled_date, status, inspection_id, step1_date, step6_date').eq('id', itemId).single()
  check('점검일 확정 (scheduled_date=15일)', (after?.scheduled_date ?? '').endsWith('-15'), JSON.stringify(after?.scheduled_date))
  check('6단계 마감일 계산됨', !!after?.step1_date && !!after?.step6_date)
  check('자동 시작 — inspection_id 연결', !!after?.inspection_id, JSON.stringify(after))
  check('계획 항목 완료 처리(시작과 동일)', after?.status === 'completed')

  if (after?.inspection_id) {
    const { data: insp } = await raw.from('inspections')
      .select('status, inspection_start_date, plan_type').eq('id', after.inspection_id).single()
    check('inspections 생성 (in_progress — 점검업무·달력·보고서 반영)', insp?.status === 'in_progress' && insp?.plan_type === 'special_작동', JSON.stringify(insp))
    const { data: steps } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', after.inspection_id)
    check('체크리스트 6단계 생성', (steps ?? []).length === 6, `${(steps ?? []).length}단계`)
  }

  // 시작 버튼 — 완료 처리된 항목은 목록 기본 필터에서 제외되거나, 보여도 [시작] 버튼이 없어야 함
  await page.goto(`${BASE}/inspection-plans?view=list`)
  await page.waitForTimeout(3000)
  const rowAfter = page.locator('tr:has-text("자동시작E2E고객")')
  const rowCount = await rowAfter.count()
  const hasStartBtn = rowCount > 0 && await rowAfter.locator('button:has-text("시작")').isVisible().catch(() => false)
  check('[시작] 버튼 미노출(이미 시작 — 완료 필터 제외 포함)', !hasStartBtn, `rows=${rowCount}`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (itemId) await raw.from('inspection_plan_items').delete().eq('id', itemId)
  if (customerId) await cleanupCustomer(customerId)
  if (planCreated && planId) await raw.from('inspection_plans').delete().eq('id', planId)
  if (userId) await delUser(userId)
}
summary()
