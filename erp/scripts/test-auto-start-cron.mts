// 정기(monthly)·자체점검(special_*) 당일 자동 시작 크론 E2E — event는 대상 제외 (소방계획서_6 W-23·W-26)
//
// special_* 갈래는 2026-09-13에 추가했다. 종전엔 "자체점검은 확정 시점에 즉시 시작되므로 크론 제외"가
// 전제였는데, 점검확정 폐지(마이그 161·162)로 항목이 **생성 시점에 confirmed로 태어나** 그 확정
// 시점이 사라졌다 — 신규 특별점검을 아무도 시작하지 않고 있었다.
//
// ⭐ 여기서 가장 중요한 단언은 "시작됐다"가 아니라 **"마감일이 확정일 기준으로 채워졌다"**이다.
//    생성기는 step1~6_date를 넣지 않고, syncInspectionStepDates는 null을 조용히 건너뛴다. 그래서
//    필터만 넓히면 due_date가 DB 트리거의 **사용승인일 기준** 값으로 남는다 — 점검은 멀쩡히
//    시작되고 화면도 정상으로 보이는데 법정 마감일만 틀린, 눈에 안 띄는 부류의 사고다.
// 실행: npx tsx scripts/test-auto-start-cron.mts  (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan } from './_e2e-helpers.mjs'
import { readFileSync } from 'fs'

const EMAIL = 'cron-start-e2e@erp-test.com'
let userId = ''
let custA = '' // 정기 — 담당 있음 → 시작
let custB = '' // 정기 — 담당 없음 → 건너뜀
let custC = '' // 레거시 event — 담당 있어도 크론 대상 아님 (W-26 제거 검증)
let custD = '' // 자체점검 special_작동 — 담당 있음 → 시작 + 6단계 마감일 자동 채움
const itemIds: string[] = []
let planCreated = false
let planId = ''

try {
  userId = await mkUser({ email: EMAIL, name: '크론시작E2E', employeeId: 'E2E-CRON' })
  custA = await mkCustomer({ customer_name: '크론시작E2E정기', created_by: userId })
  custB = await mkCustomer({ customer_name: '크론시작E2E정기미배정', created_by: userId })
  custC = await mkCustomer({ customer_name: '크론시작E2E일반레거시', created_by: userId, inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: '작동' })
  custD = await mkCustomer({ customer_name: '크론시작E2E자체점검', created_by: userId, inspection_type: '작동', inspection_sub_type: '작동' })

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
    plan_id: planId, customer_id: custB, inspection_type: '작동', sequence_num: 1,
    status: 'confirmed', plan_type: 'monthly', scheduled_date: today, planned_date: today,
    assigned_employee_id: null,
  }).select('id').single()
  itemIds.push(b!.id)
  const { data: c } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: custC, inspection_type: '일반관리', sequence_num: 1,
    status: 'confirmed', plan_type: 'event', scheduled_date: today, planned_date: today,
    assigned_employee_id: userId,
  }).select('id').single()
  itemIds.push(c!.id)

  // 자체점검 — **생성기가 만드는 모양 그대로** step1~6_date를 비워 둔다.
  // 여기에 날짜를 미리 넣으면 "크론이 채운다"는 축이 한 번도 실행되지 않는다(공허 통과).
  const { data: d } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: custD, inspection_type: '작동', sequence_num: 1,
    status: 'confirmed', plan_type: 'special_작동', scheduled_date: today, planned_date: today,
    assigned_employee_id: userId,
  }).select('id, step1_date').single()
  itemIds.push(d!.id)
  check('셋업: 자체점검 항목의 6단계 마감일이 비어 있다(생성기와 같은 모양)',
    !d!.step1_date, JSON.stringify(d))

  // 크론 발화 (로컬 dev)
  const secret = (readFileSync('F:/AI/ERP/erp/.env.local', 'utf8').match(/^CRON_SECRET=(.+)$/m)?.[1] ?? '').trim()
  const res = await fetch(`${BASE}/api/cron/auto-start-inspections`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).then(r => r.json())
  check('크론 응답 ok', res.ok === true, JSON.stringify(res))
  check('담당 있는 정기 시작(started ≥ 1)', (res.started ?? 0) >= 1, JSON.stringify(res))
  check('미배정 정기 건너뜀(skippedUnassigned ≥ 1)', (res.skippedUnassigned ?? 0) >= 1)

  const { data: afterA } = await raw.from('inspection_plan_items').select('inspection_id, status').eq('id', itemIds[0]).single()
  check('정기 항목 — inspection 연결·완료 처리', !!afterA?.inspection_id && afterA?.status === 'completed', JSON.stringify(afterA))
  if (afterA?.inspection_id) {
    const { data: insp } = await raw.from('inspections').select('status, plan_type').eq('id', afterA.inspection_id).single()
    const { data: steps } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', afterA.inspection_id)
    check('정기 inspections in_progress + 1단계만', insp?.status === 'in_progress' && (steps ?? []).length === 1, JSON.stringify({ insp, n: (steps ?? []).length }))
  }
  const { data: afterB } = await raw.from('inspection_plan_items').select('inspection_id').eq('id', itemIds[1]).single()
  check('미배정 정기 — 미시작 유지([시작] 폴백)', !afterB?.inspection_id)

  // W-26: event는 담당이 있어도 크론 대상 아님 — 미시작 유지 (미시작 event는 W-12 스크립트가 정리)
  const { data: afterC } = await raw.from('inspection_plan_items').select('inspection_id').eq('id', itemIds[2]).single()
  check('레거시 event — 크론 대상 제외(미시작 유지)', !afterC?.inspection_id)

  // ── 자체점검(special_*) — 2026-09-13 신설 축 ───────────────────────────────
  const { data: afterD } = await raw.from('inspection_plan_items')
    .select('inspection_id, status, step1_date, step2_date, step6_date').eq('id', itemIds[3]).single()
  check('자체점검 — 크론이 시작한다(종전엔 제외돼 영영 미시작)',
    !!afterD?.inspection_id && afterD?.status === 'completed', JSON.stringify(afterD))
  check('자체점검 — 비어 있던 6단계 마감일을 계획 항목에 채웠다',
    !!afterD?.step1_date && !!afterD?.step2_date && !!afterD?.step6_date, JSON.stringify(afterD))
  // ⭐ 핵심 — 기산점이 **확정일**이어야 한다. DB 트리거는 사용승인일 기준으로 due_date를 만들므로,
  //    채우지 않으면 여기서만 조용히 갈라진다(점검은 정상 시작되고 화면도 멀쩡해 보인다).
  check('자체점검 — step1_date = 확정일(사용승인일 기준 아님)', afterD?.step1_date === today,
    `step1=${afterD?.step1_date} today=${today}`)
  if (afterD?.inspection_id) {
    const { data: insp } = await raw.from('inspections').select('status, plan_type').eq('id', afterD.inspection_id).single()
    const { data: dSteps } = await raw.from('inspection_steps')
      .select('step_num, due_date').eq('inspection_id', afterD.inspection_id).order('step_num')
    check('자체점검 inspections in_progress + 6단계', insp?.status === 'in_progress' && (dSteps ?? []).length === 6,
      JSON.stringify({ insp, n: (dSteps ?? []).length }))
    const due = (dSteps ?? []).map((s: { due_date: string | null }) => s.due_date)
    check('자체점검 — inspection_steps.due_date가 계획 항목 값과 일치(1단계=확정일)',
      due[0] === afterD.step1_date && due[1] === afterD.step2_date && due[5] === afterD.step6_date,
      JSON.stringify({ due, item: [afterD.step1_date, afterD.step2_date, afterD.step6_date] }))
    check('자체점검 — 마감일이 단조 증가한다', due.every((v, i) => i === 0 || (!!v && !!due[i-1] && v > due[i-1]!)),
      JSON.stringify(due))
  }
  // 음성 짝 — 정기(1단계형)에는 6단계 마감일을 쓰지 않는다.
  // 이게 없으면 "무조건 채우는" 구현도 위 단언들을 전부 통과한다.
  const { data: afterAsteps } = await raw.from('inspection_plan_items')
    .select('step1_date, step6_date').eq('id', itemIds[0]).single()
  check('[음성] 정기에는 6단계 마감일을 채우지 않는다',
    !afterAsteps?.step6_date, JSON.stringify(afterAsteps))

  // 멱등 — 재발화 시 started 0 (이미 시작된 항목 제외)
  const res2 = await fetch(`${BASE}/api/cron/auto-start-inspections`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).then(r => r.json())
  check('재발화 멱등(테스트 정기 재시작 없음)', !!afterA?.inspection_id, JSON.stringify({ started2: res2.started }))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  for (const id of itemIds) await raw.from('inspection_plan_items').delete().eq('id', id)
  for (const cid of [custA, custB, custC, custD]) if (cid) await cleanupCustomer(cid)
  if (planCreated && planId) await raw.from('inspection_plans').delete().eq('id', planId)
  if (userId) await delUser(userId)
}
summary()
