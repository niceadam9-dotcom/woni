// 정기·일반관리 당일 자동 시작 크론 E2E
// 실행: npx tsx scripts/test-auto-start-cron.mts  (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan } from './_e2e-helpers.mjs'
import { readFileSync } from 'fs'

const EMAIL = 'cron-start-e2e@erp-test.com'
let userId = ''
let custA = '' // 정기 — 담당 있음 → 시작
let custB = '' // event — 담당 없음 → 건너뜀
const itemIds: string[] = []
let planCreated = false
let planId = ''

try {
  userId = await mkUser({ email: EMAIL, name: '크론시작E2E', employeeId: 'E2E-CRON' })
  custA = await mkCustomer({ customer_name: '크론시작E2E정기', created_by: userId })
  custB = await mkCustomer({ customer_name: '크론시작E2E일반', created_by: userId, inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: null })

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const plan = await ensurePlan(now.getFullYear(), now.getMonth() + 1, userId)
  planId = plan.id
  planCreated = plan.created

  const { data: a } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: custA, inspection_type: '작동', sequence_num: 1,
    status: 'confirmed', plan_type: 'monthly', scheduled_date: today, planned_date: today,
    assigned_employee_id: userId,
  }).select('id').single()
  itemIds.push(a!.id)
  const { data: b } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: custB, inspection_type: '일반관리', sequence_num: 1,
    status: 'confirmed', plan_type: 'event', scheduled_date: today, planned_date: today,
    assigned_employee_id: null,
  }).select('id').single()
  itemIds.push(b!.id)

  // 크론 발화 (로컬 dev)
  const secret = (readFileSync('F:/AI/ERP/erp/.env.local', 'utf8').match(/^CRON_SECRET=(.+)$/m)?.[1] ?? '').trim()
  const res = await fetch(`${BASE}/api/cron/auto-start-inspections`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).then(r => r.json())
  check('크론 응답 ok', res.ok === true, JSON.stringify(res))
  check('담당 있는 정기 시작(started ≥ 1)', (res.started ?? 0) >= 1, JSON.stringify(res))
  check('미배정 event 건너뜀(skippedUnassigned ≥ 1)', (res.skippedUnassigned ?? 0) >= 1)

  const { data: afterA } = await raw.from('inspection_plan_items').select('inspection_id, status').eq('id', itemIds[0]).single()
  check('정기 항목 — inspection 연결·완료 처리', !!afterA?.inspection_id && afterA?.status === 'completed', JSON.stringify(afterA))
  if (afterA?.inspection_id) {
    const { data: insp } = await raw.from('inspections').select('status, plan_type').eq('id', afterA.inspection_id).single()
    const { data: steps } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', afterA.inspection_id)
    check('정기 inspections in_progress + 1단계만', insp?.status === 'in_progress' && (steps ?? []).length === 1, JSON.stringify({ insp, n: (steps ?? []).length }))
  }
  const { data: afterB } = await raw.from('inspection_plan_items').select('inspection_id').eq('id', itemIds[1]).single()
  check('미배정 event — 미시작 유지([시작] 폴백)', !afterB?.inspection_id)

  // 멱등 — 재발화 시 started 0 (이미 시작된 항목 제외)
  const res2 = await fetch(`${BASE}/api/cron/auto-start-inspections`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).then(r => r.json())
  check('재발화 멱등(테스트 정기 재시작 없음)', !!afterA?.inspection_id, JSON.stringify({ started2: res2.started }))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  for (const id of itemIds) await raw.from('inspection_plan_items').delete().eq('id', id)
  for (const cid of [custA, custB]) if (cid) await cleanupCustomer(cid)
  if (planCreated && planId) await raw.from('inspection_plans').delete().eq('id', planId)
  if (userId) await delUser(userId)
}
summary()
