// EX 예외 테스트 묶음 2: EX-5d(동시 점검 시작 레이스), EX-5e(시작 직후 새로고침),
// EX-6c(단계 이중 완료 멱등), EX-7c(이력 있는 점검 삭제 정리 범위)
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const ADM = 'test-race-adm@erp-test.com'
let admId = '', custId = '', browser = null
const NAME = 'TEST-레이스-빌딩'
try {
  admId = await mkUser({ email: ADM, name: 'TEST-레이스관리자', employeeId: 'TEST-RACE' })
  custId = await mkCustomer({ customer_name: NAME, created_by: admId, assigned_employee_id: admId })
  const { id: p08 } = await ensurePlan(2026, 8, admId)
  const { data: item } = await raw.from('inspection_plan_items').insert({
    plan_id: p08, customer_id: custId, inspection_type: '작동', inspection_category: '소방안전관리',
    inspection_sub_type: '작동', sequence_num: 1, plan_type: 'monthly', planned_date: '2026-08-10',
    scheduled_date: '2026-08-10', status: 'confirmed', assigned_employee_id: admId,
    step1_date: '2026-08-10', step2_date: '2026-08-14', step3_date: '2026-08-20',
    step4_date: '2026-08-24', step5_date: '2026-09-01', step6_date: '2026-09-10',
  }).select('id').single()

  const l = await launch(); browser = l.browser
  const pA = l.page
  pA.on('dialog', d => d.accept())
  await login(pA, ADM)
  const ctxB = await browser.newContext(); const pB = await ctxB.newPage(); pB.setDefaultTimeout(20000)
  pB.on('dialog', d => d.accept())
  await login(pB, ADM)

  // ── EX-5d: 두 세션이 같은 항목을 동시에 시작 ──
  console.log('[EX-5d] 동시 점검 시작 레이스')
  const goList = async (p) => {
    await p.goto(`${BASE}/inspection-plans?year=2026&month=8&view=list`)
    await p.getByRole('button', { name: /^전체/ }).first().click()
    await p.locator('tr', { has: p.getByText(NAME) }).first().waitFor()
  }
  await goList(pA); await goList(pB)
  const clickStart = async (p) => {
    try {
      await p.locator('tr', { has: p.getByText(NAME) }).first().getByText('시작', { exact: false }).click({ timeout: 8000 })
      return 'clicked'
    } catch { return 'no-button' }
  }
  await Promise.all([clickStart(pA), clickStart(pB)])
  await new Promise(r => setTimeout(r, 4000))
  const { data: insps } = await raw.from('inspections').select('id').eq('customer_id', custId)
  check('EX-5d: 동시 시작 → 점검 중복 생성 없음 (1건)', insps.length === 1, `생성 ${insps.length}건`)
  const inspectionId = insps[0]?.id

  // ── EX-5e: 시작 직후 새로고침 — 상태 일관 ──
  console.log('[EX-5e] 시작 직후 새로고침')
  await goList(pA)
  const rowA = pA.locator('tr', { has: pA.getByText(NAME) }).first()
  check('EX-5e: 새로고침 후 목록 "점검 보기"로 전환 (시작 버튼 없음)',
    await rowA.getByText('점검 보기').isVisible({ timeout: 10000 }).catch(() => false))

  // ── EX-6c: 단계 이중 완료 (두 세션 동시 클릭) ──
  console.log('[EX-6c] 단계 이중 완료 멱등')
  const goDetail = async (p) => { await p.goto(`${BASE}/inspections/${inspectionId}`); await p.getByText('6단계 업무 체크리스트').waitFor() }
  await goDetail(pA); await goDetail(pB)
  const clickComplete = async (p) => {
    try { await p.getByRole('button', { name: '완료' }).first().click({ timeout: 8000 }); return 'clicked' } catch { return 'no-button' }
  }
  await Promise.all([clickComplete(pA), clickComplete(pB)])
  await new Promise(r => setTimeout(r, 3000))
  const { data: steps } = await raw.from('inspection_steps').select('step_num, status').eq('inspection_id', inspectionId).order('step_num')
  const doneCount = steps.filter(s => s.status === 'completed').length
  check('EX-6c: 동시 완료 클릭 → 1단계만 완료 (중복·건너뜀 없음)', doneCount === 1 && steps[0].status === 'completed',
    JSON.stringify(steps.map(s => [s.step_num, s.status])))
  const { data: insp1 } = await raw.from('inspections').select('status').eq('id', inspectionId).single()
  check('EX-6c: 점검 상태 in_progress 유지 (완료 오판 없음)', insp1.status === 'in_progress', insp1.status)

  // ── EX-7c: 단계 이력 있는 점검 삭제 — 정리 범위 ──
  console.log('[EX-7c] 이력 있는 점검 삭제')
  await goDetail(pA)
  await pA.getByText('이 점검 삭제').click()
  await pA.getByRole('button', { name: '삭제', exact: true }).click()
  await pA.waitForURL(u => u.pathname === '/inspections', { timeout: 15000 })
  const { count: stepLeft } = await raw.from('inspection_steps').select('id', { count: 'exact', head: true }).eq('inspection_id', inspectionId)
  const { data: itemAfter } = await raw.from('inspection_plan_items').select('status, inspection_id').eq('id', item.id).single()
  check('EX-7c: 단계 이력 함께 삭제 (잔재 0건)', (stepLeft ?? 0) === 0)
  check('EX-7c: 항목 confirmed 복귀 + 연결 해제 (GAP-2 동작)', itemAfter.status === 'confirmed' && itemAfter.inspection_id === null, JSON.stringify(itemAfter))
  // 모니터링에서 행 소멸 확인
  await pA.goto(`${BASE}/inspection-plans/monitor?year=2026&month=8`)
  await pA.getByText('점검현황 모니터링').first().waitFor()
  await new Promise(r => setTimeout(r, 1000))
  const monHas = await pA.locator('tr', { has: pA.getByText(NAME) }).locator('td', { hasText: /\d{4}-\d{2}-\d{2}/ }).first().isVisible({ timeout: 3000 }).catch(() => false)
  check('EX-7c: 모니터링 점검일 흔적 없음', !monHas)
  await ctxB.close()
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  await cleanupCustomer(custId)
  await delUser(admId)
  console.log('정리 완료')
}
summary()
