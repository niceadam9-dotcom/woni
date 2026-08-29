// 소방계획서_30 독립 판정 v2 — S1(3화면 차단)·S2(잔여 표면)·S4-6(same-path Link 수리) 적대적 E2E
// v2: ①달력은 ?cust= 검색으로 rbc "+N more" 크라우딩 제거(1차 실행에서 대조군 B가 셀 접힘에 가려짐)
//     ②뱃지는 admin 전역이 99+라 판독 불가 → employee 역할 축(본인 담당만 집계)으로 결정적 측정
//     ③이웃 표면(대시보드 마감임박·내 일정)은 employee 컨텍스트에서 이름 증거로 실측
// 실행: cmd /c "npx tsx scripts/_judge-s30-block.mts > _judge-s30-out.txt 2>&1"
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'judge-s30@e2e.local'
const EMP_EMAIL = 'judge-s30-emp@e2e.local'
const A_NAME = 'ZJUDGE30A'
const B_NAME = 'ZJUDGE30B'
const CUST_Q = 'ZJUDGE30'

const d = (days: number) => new Date(Date.now() + 9 * 3600_000 + days * 86400_000).toISOString().split('T')[0]
const TODAY = d(0), YESTERDAY = d(-1)

let userId: string | null = null, empId: string | null = null
let custA: string | null = null, custB: string | null = null
const inspIds: string[] = []
const quoteIds: string[] = []
const planItemIds: string[] = []
const reportStatusIds: string[] = []
const actionPlanIds: string[] = []
let madePlan: { id: string; created: boolean } | null = null
let browser: any = null

// 렌더된 DOM 텍스트만 센다(script 태그의 RSC 페이로드는 Playwright text 엔진이 제외).
// /inspection-plans 는 전 항목을 클라이언트로 내려 필터하므로 content() 검사는 오탐 — 반드시 이 축.
async function domCount(page: any, text: string) {
  return await page.getByText(text, { exact: false }).count()
}
async function readRedBadge(page: any): Promise<number> {
  await page.goto(`${BASE}/inspections`, { waitUntil: 'networkidle' })
  const b = page.locator('a[href="/inspections/calendar"] span.bg-red-500')
  if (await b.count() === 0) return 0
  const t = (await b.first().innerText()).trim()
  return t.includes('+') ? -1 : parseInt(t, 10)
}
async function activeTabLabel(page: any): Promise<string> {
  const t = page.locator('button[role=tab][aria-selected="true"]')
  return (await t.count()) > 0 ? (await t.first().innerText()).trim() : '(없음)'
}

async function mkInsp(cid: string, fields: Record<string, unknown>) {
  const { data, error } = await raw.from('inspections').insert({
    customer_id: cid, inspection_type: '종합', assigned_employee_id: empId, created_by: userId, ...fields,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspIds.push(data.id); return data.id as string
}

async function main() {
  console.log('=== 소방계획서_30 독립 판정 v2 (S1·S2·S4-6) ===')
  userId = await mkUser({ email: EMAIL, name: 'S30판정자', employeeId: 'E2E-S30J', role: 'admin' })
  empId = await mkUser({ email: EMP_EMAIL, name: 'S30판정직원', employeeId: 'E2E-S30E', role: 'employee' })
  // 종합 유형 — sequence_num 2(완료 회차)를 함께 쓰기 위해 (작동은 seq=1만 허용)
  custA = await mkCustomer({ customer_name: A_NAME, assigned_employee_id: empId, created_by: userId, inspection_type: '종합', inspection_sub_type: '종합' })
  custB = await mkCustomer({ customer_name: B_NAME, assigned_employee_id: empId, created_by: userId, inspection_type: '종합', inspection_sub_type: '종합' })

  // 각 고객: ①진행중 점검(단계→뱃지·목록·달력·마감임박) ②완료 점검(자체점검→제출현황·문서할일)
  const a1 = await mkInsp(custA!, { sequence_num: 1, status: 'in_progress', inspection_start_date: d(-5) })
  const b1 = await mkInsp(custB!, { sequence_num: 1, status: 'in_progress', inspection_start_date: d(-5) })
  await mkInsp(custA!, { sequence_num: 2, status: 'completed', inspection_start_date: d(-12), inspection_end_date: d(-10) })
  await mkInsp(custB!, { sequence_num: 2, status: 'completed', inspection_start_date: d(-12), inspection_end_date: d(-10) })

  // 트리거 단계 대기 → 진행중 점검: 1~5단계 pending·기한 어제(빨간 뱃지), 6단계 D+2(마감임박 이름 증거)
  const stepsOk = await pollDb(async () => {
    const { data } = await raw.from('inspection_steps').select('id').in('inspection_id', [a1, b1])
    return (data ?? []).length >= 2 ? data : null
  })
  check('셋업: 트리거가 단계 생성', !!stepsOk, '단계 0건 — 뱃지 축 무효')
  await raw.from('inspection_steps').update({ status: 'pending', due_date: YESTERDAY }).in('inspection_id', [a1, b1])
  await raw.from('inspection_steps').update({ due_date: d(2) }).in('inspection_id', [a1, b1]).eq('step_num', 6)
  const { data: bSteps } = await raw.from('inspection_steps').select('id').eq('inspection_id', b1).eq('status', 'pending').lte('due_date', TODAY)
  const nB1 = (bSteps ?? []).length
  console.log(`  B1 pending·기한경과 단계 수 = ${nB1}`)

  // 계획 항목: planned 1건(자동취소 대상) + completed 1건(자동취소를 벗어나는 잔재 — 핵심)
  const now = new Date()
  madePlan = await ensurePlan(now.getFullYear(), now.getMonth() + 1, userId)
  for (const [cid, status, sd] of [
    [custA, 'planned', null], [custB, 'planned', null],
    [custA, 'completed', d(1)], [custB, 'completed', d(1)],
  ] as Array<[string, string, string | null]>) {
    const { data, error } = await raw.from('inspection_plan_items').insert({
      plan_id: madePlan.id, customer_id: cid, inspection_type: '종합', sequence_num: status === 'completed' ? 1 : 2,
      plan_type: 'monthly', status, scheduled_date: sd, planned_date: sd ?? d(3), assigned_employee_id: empId,
      notes: '⟦judge-s30⟧',
    }).select('id').single()
    if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)
    planItemIds.push(data.id)
  }

  // 견적: 기존 행의 고객명 표시가 비활성화 후에도 남아야 한다(S2-2c 후반부)
  for (const [cid, tag] of [[custA, 'A'], [custB, 'B']] as Array<[string, string]>) {
    const { data, error } = await raw.from('quotes').insert({
      customer_id: cid, quote_number: `S30J-${tag}-${Math.random().toString(36).slice(2, 6)}`,
      quote_date: TODAY, items: [{ description: '판정용', quantity: 1, unit_price: 0, amount: 0 }],
      subtotal: 0, tax_amount: 0, total_amount: 0, created_by: userId,
    }).select('id').single()
    if (error) { console.log(`  ⚠ 견적 생성 실패(${tag}): ${error.message}`); continue }
    quoteIds.push(data.id)
  }

  // 대시보드 KPI 카드 2종(점검보고서 제출대기·이행계획 제출대기)을 **실제로 채운다**.
  // 이 두 표를 안 심으면 위젯이 비어 있어 아래 'B 제외' 검사가 항진명제가 된다 —
  // 종전 판정이 그래서 실결함을 통과시켰다(위젯 자체는 필터가 없었다). [[feedback_exhaustive_has_an_axis]]
  // completed 계획 항목을 쓴다: 자동취소가 안 건드리는 상태라 비활성 후에도 살아남는 축이다.
  for (const [cid, tag] of [[custA, 'A'], [custB, 'B']] as Array<[string, string]>) {
    const { data: pi } = await raw.from('inspection_plan_items')
      .select('id').eq('customer_id', cid).eq('status', 'completed').limit(1).single()
    if (pi) {
      const { data, error } = await raw.from('inspection_report_status')
        .insert({ plan_item_id: pi.id, inspection_completed_at: YESTERDAY, fire_station_submitted: false })
        .select('id').single()
      if (error) console.log(`  ⚠ 보고서현황 생성 실패(${tag}): ${error.message}`)
      else reportStatusIds.push(data.id)
    }
    const insp = tag === 'A' ? a1 : b1
    const { data: ap, error: apErr } = await raw.from('action_plans')
      .insert({ inspection_id: insp, completion_target_date: d(3), submitted_at: null, created_by: userId })
      .select('id').single()
    if (apErr) console.log(`  ⚠ 이행계획 생성 실패(${tag}): ${apErr.message}`)
    else actionPlanIds.push(ap.id)
  }
  console.log(`  대시보드 KPI 시드: 보고서현황 ${reportStatusIds.length}건 · 이행계획 ${actionPlanIds.length}건`)

  const { browser: br, page } = await launch()
  browser = br
  await login(page, EMAIL)
  // employee 컨텍스트 — 뱃지·대시보드 마감임박·내 일정(본인 담당 축이라 우리 데이터만 잡혀 결정적)
  const empCtx = await br.newContext({ viewport: { width: 1500, height: 950 } })
  const empPage = await empCtx.newPage()
  empPage.setDefaultTimeout(15000)
  await login(empPage, EMP_EMAIL)

  // ───────── Phase 1: 대조군 (B 활성 — 전부 보여야 검사가 항진명제가 아니다) ─────────
  console.log('\n--- Phase 1: 대조군 (B 활성) ---')
  await page.goto(`${BASE}/inspections`, { waitUntil: 'networkidle' })
  check('P1 점검업무: A 보임', await domCount(page, A_NAME) > 0)
  check('P1 점검업무: B 보임', await domCount(page, B_NAME) > 0)
  // D-8: '취소' 필터 폐지 후 ?status=cancelled는 **알 수 없는 값**이다. status는 Postgres enum이라
  // 그대로 넘기면 22P02로 페이지가 깨진다 — 화이트리스트가 이를 '전체 상태'로 떨구는지 확인한다.
  // 따라서 여기서 기대값은 '0건'이 아니라 '전체와 동일'이다(활성 A·B 둘 다 보임 + 500 아님).
  const staleResp = await page.goto(`${BASE}/inspections?status=cancelled`, { waitUntil: 'networkidle' })
  check('P1 낡은 ?status=cancelled: 200 (enum 22P02 방지)', (staleResp?.status() ?? 0) === 200,
        `status=${staleResp?.status()}`)
  check('P1 낡은 ?status=cancelled: 전체 상태로 폴백(A 보임)', await domCount(page, A_NAME) > 0)
  check('P1 낡은 ?status=cancelled: 전체 상태로 폴백(B 보임)', await domCount(page, B_NAME) > 0)

  await page.goto(`${BASE}/inspections/calendar?cust=${CUST_Q}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  check('P1 점검달력(cust검색): A 보임', await domCount(page, A_NAME) > 0)
  check('P1 점검달력(cust검색): B 보임', await domCount(page, B_NAME) > 0)

  await page.goto(`${BASE}/inspection-plans?status=all`, { waitUntil: 'networkidle' })
  check('P1 점검확정 전체칩: A 보임', await domCount(page, A_NAME) > 0)
  check('P1 점검확정 전체칩: B 보임', await domCount(page, B_NAME) > 0)
  await page.goto(`${BASE}/inspection-plans?view=calendar&cust=${CUST_Q}`, { waitUntil: 'networkidle' })
  check('P1 점검확정 달력뷰: B 보임', await domCount(page, B_NAME) > 0)

  const R1 = await readRedBadge(empPage)
  console.log(`  빨간 뱃지(직원 축·전) = ${R1} (기대 ${nB1 * 2})`)
  check('P1 뱃지: A+B 단계 집계(대조)', R1 === nB1 * 2, `실측 ${R1}`)

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  check('P1 대시보드 문서할일: B 보임', await domCount(page, B_NAME) > 0)
  // KPI 카드 2종이 **정말 채워졌는지** 먼저 못박는다. 여기서 B가 안 보이면 Phase 2의
  // 'B 제외'는 필터가 아니라 빈 위젯 덕분에 통과하는 것이므로 판정 근거가 못 된다.
  const kpiReport = page.locator('div').filter({ hasText: /점검보고서|제출 대기/ })
  check('P1 KPI 보고서제출대기: 시드 반영(B 보임)',
    await page.getByText(B_NAME, { exact: false }).count() > 0,
    `보고서현황 시드 ${reportStatusIds.length}건·이행계획 ${actionPlanIds.length}건인데 B 미표시`)
  void kpiReport
  const subBtn = page.locator('button', { hasText: '제출 현황' })
  if (await subBtn.count() > 0) {
    await subBtn.first().click(); await page.waitForTimeout(1200)
    check('P1 제출현황 위젯: B 보임', await domCount(page, B_NAME) > 0)
  } else check('P1 제출현황 위젯 존재', false, '버튼 못 찾음')

  await page.goto(`${BASE}/quotes`, { waitUntil: 'networkidle' })
  check('P1 견적 목록: B 행 보임', await domCount(page, B_NAME) > 0)

  // 이웃 표면 대조군 (employee 축)
  await empPage.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await empPage.waitForTimeout(800)
  const p1DashA = await domCount(empPage, A_NAME), p1DashB = await domCount(empPage, B_NAME)
  console.log(`  [이웃 대조군] 직원 대시보드 마감임박: A=${p1DashA} B=${p1DashB}`)
  await empPage.goto(`${BASE}/my/schedules`, { waitUntil: 'networkidle' })
  const p1MyA = await domCount(empPage, A_NAME), p1MyB = await domCount(empPage, B_NAME)
  console.log(`  [이웃 대조군] 내 일정: A=${p1MyA} B=${p1MyB}`)

  // ───────── B 삭제 시뮬레이션 (deleteCustomerAction과 동일: is_active=false + planned/confirmed 자동취소) ─────────
  console.log('\n--- B 비활성화 (soft delete 재현: completed 계획·점검 행은 잔존) ---')
  const { error: deErr } = await raw.from('customers').update({ is_active: false }).eq('id', custB)
  if (deErr) throw new Error(`비활성화 실패: ${deErr.message}`)
  await raw.from('inspection_plan_items').update({ status: 'cancelled' })
    .eq('customer_id', custB).in('status', ['planned', 'confirmed'])

  // ───────── Phase 2: 차단 + 취소 창구 보존 ─────────
  console.log('\n--- Phase 2: 차단 실측 (B 비활성) ---')
  // S1-1 점검업무
  await page.goto(`${BASE}/inspections`, { waitUntil: 'networkidle' })
  check('S1-1 기본목록: A 잔존(대조)', await domCount(page, A_NAME) > 0)
  check('S1-1 기본목록: B 제외', await domCount(page, B_NAME) === 0)
  await page.goto(`${BASE}/inspections?status=completed`, { waitUntil: 'networkidle' })
  check('S1-1 완료필터: B 제외(완료 점검 잔재도)', await domCount(page, B_NAME) === 0)
  // D-8(2026-08-29): '취소' 필터는 폐지됐다. 종전 이 자리는 'B 조회 유지'를 단언했으나
  // 사용자 지시로 이력 창구 자체가 사라져 **어떤 status 값으로도 B는 나오지 않아야** 한다.
  // ⚠ B가 빠지는 이유는 status가 아니라 is_active다 — status=cancelled는 화이트리스트에서
  //   걸러져 '전체 상태'로 폴백하므로(Phase 1에서 실증), 여기서 B가 없는 것은 순수하게 D-8 축이다.
  await page.goto(`${BASE}/inspections?status=cancelled`, { waitUntil: 'networkidle' })
  check('S1-1 취소필터 폐지(D-8): B 제외', await domCount(page, B_NAME) === 0)

  // S1-2 점검달력 — 점검 건 + 완료 계획 잔재 모두 (cust 검색으로 크라우딩 제거한 같은 축)
  await page.goto(`${BASE}/inspections/calendar?cust=${CUST_Q}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  check('S1-2 점검달력: A 잔존(대조)', await domCount(page, A_NAME) > 0)
  check('S1-2 점검달력: B 전면 제외(점검+완료계획)', await domCount(page, B_NAME) === 0)

  // S1-3 점검확정 — 전체/취소 칩 + 달력 뷰
  await page.goto(`${BASE}/inspection-plans?status=all`, { waitUntil: 'networkidle' })
  check('S1-3 전체칩: A 잔존(대조)', await domCount(page, A_NAME) > 0)
  check('S1-3 전체칩: B 제외(completed 잔재 포함)', await domCount(page, B_NAME) === 0)
  // D-8: '취소' 칩은 항목 자체가 취소된 계획 전용 — 비활성 고객은 여기서도 빠진다.
  // B의 계획 항목은 위에서 status='cancelled'로 자동취소됐으므로, 칩이 고객 축을 아직 본다면
  // 여기서 반드시 잡힌다(이 검사가 무력해지지 않는 이유).
  await page.goto(`${BASE}/inspection-plans?status=cancelled`, { waitUntil: 'networkidle' })
  check('S1-3 취소칩 고객축 폐지(D-8): B 제외', await domCount(page, B_NAME) === 0)
  await page.goto(`${BASE}/inspection-plans?view=calendar&cust=${CUST_Q}`, { waitUntil: 'networkidle' })
  check('S1-3 달력뷰: A 잔존(대조)', await domCount(page, A_NAME) > 0)
  check('S1-3 달력뷰: B 제외', await domCount(page, B_NAME) === 0)

  // S2-1 사이드바 뱃지 (직원 축 — 본인 담당만 집계라 결정적)
  const R2 = await readRedBadge(empPage)
  console.log(`  빨간 뱃지(직원 축·후) = ${R2} (기대 ${nB1})`)
  check('S2-1 뱃지: B 단계 제외', R2 === nB1, `전${R1} 후${R2} 기대${nB1}`)

  // S2-2a·b 대시보드 위젯 (admin)
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  check('S2-2b 문서할일: A 잔존(대조)', await domCount(page, A_NAME) > 0)
  check('S2-2b 문서할일: B 제외', await domCount(page, B_NAME) === 0)
  // KPI 카드 2종 — 위 시드 덕에 이 검사는 더 이상 항진명제가 아니다(D-8 후속).
  // A는 같은 위젯에 남아 있어야 한다: '위젯이 통째로 비었다'와 '비활성만 빠졌다'를 가른다.
  check('S2-2d KPI(보고서·이행계획): A 잔존(대조)', await domCount(page, A_NAME) > 0)
  check('S2-2d KPI(보고서·이행계획): B 제외', await domCount(page, B_NAME) === 0)
  const subBtn2 = page.locator('button', { hasText: '제출 현황' })
  if (await subBtn2.count() > 0) {
    await subBtn2.first().click(); await page.waitForTimeout(1200)
    check('S2-2a 제출현황: A 잔존(대조)', await domCount(page, A_NAME) > 0)
    check('S2-2a 제출현황: B 제외', await domCount(page, B_NAME) === 0)
  } else check('S2-2a 제출현황 위젯 존재', false)

  // S2-2c 견적 — 기존 행 이름은 남고, 신규 선택지에서만 빠져야
  await page.goto(`${BASE}/quotes`, { waitUntil: 'networkidle' })
  check('S2-2c 견적 기존행: B 이름 유지', await domCount(page, B_NAME) > 0)
  const newBtn = page.locator('button.bg-brand', { hasText: '견적' })
  if (await newBtn.count() > 0) {
    await newBtn.first().click(); await page.waitForTimeout(600)
    const opts = await page.locator('select option').allInnerTexts()
    check('S2-2c 신규 선택지: A 있음(대조)', opts.some(o => o.includes(A_NAME)))
    check('S2-2c 신규 선택지: B 없음', !opts.some(o => o.includes(B_NAME)), `옵션 ${opts.length}개`)
    await page.keyboard.press('Escape').catch(() => {})
  } else check('S2-2c 견적 등록 버튼', false, '못 찾음')

  // ───────── 이웃 사냥(실브라우저): 차단 밖 표면 실측 (employee 축 — 이름 증거) ─────────
  console.log('\n--- 이웃 표면 (차단 누락 후보 실측) ---')
  await empPage.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await empPage.waitForTimeout(800)
  const p2DashB = await domCount(empPage, B_NAME)
  console.log(`  [이웃] 직원 대시보드 마감임박: B=${p2DashB} (대조군 ${p1DashB})`)
  if (p1DashB > 0) check('[이웃] 대시보드 마감임박: B 제외돼야', p2DashB === 0, '비활성 고객 잔존 — 차단 누락')
  else console.log('  [이웃] 대시보드 축 무효(대조군에서 B 미표시) — 판정 보류')

  await empPage.goto(`${BASE}/my/schedules`, { waitUntil: 'networkidle' })
  const p2MyB = await domCount(empPage, B_NAME)
  console.log(`  [이웃] 내 일정: B=${p2MyB} (대조군 ${p1MyB})`)
  if (p1MyB > 0) check('[이웃] 내 일정: B 제외돼야', p2MyB === 0, '비활성 고객 마감 오버레이 잔존 — 차단 누락')
  else console.log('  [이웃] 내 일정 축 무효(대조군에서 B 미표시) — 판정 보류')

  // ───────── S4-6: same-path Link 수리 + 잔존 이웃 ─────────
  console.log('\n--- S4-6: 같은 경로 ?tab= 이동 ---')
  // ① 건물·시설 탭 → '1.4 소방시설' <a>
  await page.goto(`${BASE}/customers/${custA}?tab=buildings`, { waitUntil: 'networkidle' })
  const a14 = page.locator('div[role=tabpanel]:not([hidden]) a[href*="form=1.4"]')
  if (await a14.count() > 0) {
    await Promise.all([page.waitForURL(/form=1\.4/, { timeout: 15000 }), a14.first().click()])
    await page.waitForLoadState('networkidle')
    const tab1 = await activeTabLabel(page)
    check('S4-6① 1.4 안내: 계획서 탭 도달', tab1.includes('소방계획서'), `활성탭=${tab1}`)
    const vis14 = await page.locator('div[role=tabpanel]:not([hidden])').first().innerText()
    check('S4-6① form=1.4 서식 표시', vis14.includes('소방시설') || vis14.includes('1.4'), '1.4 내용 미확인')
  } else check('S4-6① 1.4 안내 <a> 존재', false, '건물 탭에서 못 찾음')

  // ② 관계인 탭 → 보조자 선임현황 <a>
  await page.goto(`${BASE}/customers/${custA}?tab=contacts`, { waitUntil: 'networkidle' })
  const fsm = page.locator('[data-testid=fsm-assistant-link]')
  if (await fsm.count() > 0) {
    await Promise.all([page.waitForURL(/form=1\.7/, { timeout: 15000 }), fsm.first().click()])
    await page.waitForLoadState('networkidle')
    const tab2 = await activeTabLabel(page)
    check('S4-6② 보조자 링크: 계획서 탭 도달', tab2.includes('소방계획서'), `활성탭=${tab2}`)
    const vis17 = await page.locator('div[role=tabpanel]:not([hidden])').first().innerText()
    check('S4-6② form=1.7 보조자 서식 표시', vis17.includes('보조자') || vis17.includes('1.7'), '1.7 내용 미확인')
  } else check('S4-6② fsm-assistant-link 존재', false, '관계인 탭에서 못 찾음')

  // ③ 이웃 잔존 실측 — 1.7 서식의 '관계인 탭에서 수정' Link (같은 증상 예상)
  await page.goto(`${BASE}/customers/${custA}?tab=plan&form=1.7`, { waitUntil: 'networkidle' })
  const sib17 = page.locator('div[role=tabpanel]:not([hidden]) a[href*="tab=contacts"]')
  if (await sib17.count() > 0) {
    const href17 = await sib17.first().getAttribute('href')
    await sib17.first().click(); await page.waitForTimeout(1800)
    const tab3 = await activeTabLabel(page)
    console.log(`  [이웃] 1.7 링크(${href17}) 클릭 후 활성탭=${tab3.split('\n')[0]} · URL=${page.url().split('?')[1]}`)
    check('[이웃] 1.7→관계인 Link 정상 이동이면 통과', tab3.includes('관계인'), 'same-path Link 잔존 — 탭 안 바뀜')
  } else console.log('  [이웃] 1.7 관계인 링크 미발견')

  // ④ 이웃 잔존 실측 — 1.1 일반현황(FirePlanInfoPanel)의 소방안전관리자 정보 Link
  await page.goto(`${BASE}/customers/${custA}?tab=plan&form=1.1`, { waitUntil: 'networkidle' })
  const sib11 = page.locator('div[role=tabpanel]:not([hidden]) a[href*="tab=contacts"]')
  if (await sib11.count() > 0) {
    const href11 = await sib11.first().getAttribute('href')
    await sib11.first().scrollIntoViewIfNeeded()
    await sib11.first().click(); await page.waitForTimeout(1800)
    const tab4 = await activeTabLabel(page)
    console.log(`  [이웃] 1.1 링크(${href11}) 클릭 후 활성탭=${tab4.split('\n')[0]} · URL=${page.url().split('?')[1]}`)
    check('[이웃] 1.1→관계인 Link 정상 이동이면 통과', tab4.includes('관계인'), 'same-path Link 잔존 — 탭 안 바뀜')
  } else console.log('  [이웃] 1.1 관계인 링크 미발견')

  await empCtx.close().catch(() => {})
}

async function cleanup() {
  console.log('\n--- 정리 ---')
  try { if (browser) await browser.close() } catch {}
  try {
    if (quoteIds.length) await raw.from('quotes').delete().in('id', quoteIds)
    // KPI 시드 — 고객보다 먼저 지운다. inspection_report_status는 plan_item에 CASCADE지만
    // action_plans는 inspections를 참조하고 inspections는 customers에 ON DELETE RESTRICT라,
    // 남겨두면 cleanupCustomer가 조용히 실패해 판정용 고객이 스테이징에 눌러앉는다.
    if (actionPlanIds.length) await raw.from('action_plans').delete().in('id', actionPlanIds)
    if (reportStatusIds.length) await raw.from('inspection_report_status').delete().in('id', reportStatusIds)
    if (custA) await cleanupCustomer(custA)
    if (custB) await cleanupCustomer(custB)
    if (madePlan?.created) await raw.from('inspection_plans').delete().eq('id', madePlan.id)
    if (userId) await delUser(userId)
    if (empId) await delUser(empId)
    console.log('정리 완료')
  } catch (e) { console.error('정리 실패:', e) }
}

main().catch(e => { console.error('판정 중단:', e) }).finally(async () => { await cleanup(); summary() })
