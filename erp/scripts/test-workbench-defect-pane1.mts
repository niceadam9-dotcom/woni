// 소방계획서_36 F-24 — 불량표(⑤/⑥)와 ① '불량 내역' 칸이 **서로의 저장을 본다**.
//
// 왜 별도 검사인가: test-workbench-defect-pane-switch.mts는 ⑤↔⑥만 오간다. 그 둘은 부모가 쥔
//   미러(defectsLocal·defectEdits)를 공유하므로 클라이언트 안에서 값이 이어진다. ① 카드
//   (slots.defects = InspectionDefectsClient)는 **서버가 그려 준 노드**라 그 미러가 안 닿는다.
//
// ⚠ **새로고침하지 않는다.** 새로고침하면 어떤 구현이든 통과하므로 항진명제가 된다.
//   비항진성의 근거: 페이지를 열 때 ① 카드는 **빈 값**으로 서버 렌더된다(0-1이 선단언).
//
// ⚠ 고정 대기를 쓰지 않는다 — 이 상세 페이지의 서버 재렌더는 실측 6.8~7.6초까지 나온다.
//
// 축 4개(둘은 2026-08-31 독립 재판정이 추가시켰다):
//   ①→ 정방향: ⑤에서 저장 → ① 카드에 보이는가
//   ②→ 역방향: ① 카드에서 저장 → ⑤ 표와 ① 자신에게 남는가
//        ⚠ 이 자리에 한때 "역방향은 **선재 결함**이라 단언하면 영구히 붉다"고 적었는데
//          **거짓이었다** — 판정자가 단일변수 대조군으로 반증했다(defect-actions.ts의
//          `alsoChanged: true` 하나만 되돌리면 초록). 기준선에는 서버가 prop을 밀어 주고
//          있었고 S2-5가 그걸 내리면서 ① 카드 저장 경로가 **책임지는 쪽 없이** 남았다.
//          그 거짓 문장이 실결함을 '범위 밖'으로 봉인하고 있었다.
//   ③→ 경합: 갱신이 **도착하기 전에** 같은 칸을 타이핑하면 내 입력이 이기는가
//        1차 수리는 서버 값으로 key를 만들어 remount시켰는데 이 창에서 입력을 조용히 지웠다.
//        ⚠ 이 축은 불량 **2건**이 필요하다 — 한 건은 갱신을 받아야 하고(A) 다른 한 건은
//          같은 칸을 내가 타이핑 중이어야(B) '서버도 바꾸고 나도 고치는' 경합이 성립한다.
//          한 건으로 조치 내용만 타이핑하면 그 칸은 서버 값이 안 변해 **구조적으로** 안 덮이고,
//          그러면 단언은 dirty 보호를 전혀 시험하지 못한다(절제 대조군으로 확인했다).
//   ④→ 곁가지 정정: "revalidatePath는 마운트된 클라이언트 트리에 새 props를 밀어 넣지
//        않는다"(F-23)는 일반 명제로 **거짓**이다. 억제자는 revalidatePath가 아니라
//        shouldRevalidate 가드다.
//
// 실행: npx tsx scripts/test-workbench-defect-pane1.mts
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'wb-pane1@erp-test.com'
const DA = 'ZZ전환불량A'     // 갱신을 받는 쪽
const DB_ = 'ZZ전환불량B'    // 경합(타이핑) 쪽
const PLAN_A = '수신기 기판 교체'
const PLAN_B = '유도등 램프 교체'
const TYPED_B = '내가 고치던 계획'
const CARD_PLAN = '카드에서 고친 계획'
const CARD_PH = '이행조치 계획 (별지 10호 — 예: 유도등 램프 교체)'
let userId = '', cust = '', insp = ''
let idA = '', idB = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '전환36', employeeId: 'E2E-WBP1' })
  cust = await mkCustomer({ customer_name: 'ZZ전환36고객', created_by: userId })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-07-01', status: 'in_progress',
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  {
    const { data, error } = await raw.from('inspection_defects').insert([
      { inspection_id: insp, defect_code: 'A-01', defect_name: DA, severity: '보통' },
      { inspection_id: insp, defect_code: 'A-02', defect_name: DB_, severity: '보통' },
    ]).select('id, defect_name')
    if (error) throw new Error(`불량 생성 실패: ${error.message}`)
    const rows = data as Array<{ id: string; defect_name: string }>
    idA = rows.find(r => r.defect_name === DA)!.id
    idB = rows.find(r => r.defect_name === DB_)!.id
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(90000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, EMAIL)

  /** 불량별 ① 카드 — nth()로 순서에 기대지 않는다 */
  const card = (id: string) => page.locator(`[data-defect-card="${id}"]`)
  const cardBox = (id: string) => card(id).getByPlaceholder(CARD_PH)
  const openCard = async (id: string) => {
    if (await cardBox(id).count() === 0) {
      const t = card(id).getByText('이행계획·조치 완료').first()
      if (await t.count() > 0) await t.click()
    }
  }
  const dbPlan = async (name: string) => {
    const { data, error } = await raw.from('inspection_defects')
      .select('action_plan').eq('inspection_id', insp).eq('defect_name', name).single()
    if (error) throw new Error(`불량 조회 실패: ${error.message}`)   // 조용한 0행을 통과로 읽지 않는다
    return (data as { action_plan: string | null } | null)?.action_plan ?? null
  }
  const waitPlan = async (name: string, want: string) => {
    for (let i = 0; i < 90; i++) {
      if ((await dbPlan(name)) === want) return true
      await page.waitForTimeout(500)
    }
    return false
  }
  const toStep = (n: number) => page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(n)

  // ── 모집단 선단언 — ① 카드 두 건이 처음에 **비어 있음**을 먼저 본다(공허 통과 차단)
  await page.goto(`${BASE}/inspections/${insp}?step=1`)
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  for (const [id, label] of [[idA, 'A'], [idB, 'B']] as const) {
    await openCard(id)
    await cardBox(id).waitFor({ state: 'visible' })
    check(`0-1${label} [대조군] 착수 시 ① 카드(${label})의 계획 칸은 비어 있다`,
      (await cardBox(id).inputValue()) === '')
  }

  // ── ⑤에서 두 건 모두 저장 (여기부터 새로고침 없음)
  await toStep(4).click()
  for (const [name, plan] of [[DA, PLAN_A], [DB_, PLAN_B]] as const) {
    const box = page.getByLabel(`${name} 조치 계획`)
    await box.waitFor({ state: 'visible' })
    await box.fill(plan)
    await box.blur()
    check(`0-2${name === DA ? 'A' : 'B'} ⑤에서 입력한 조치계획이 DB에 저장됐다`, await waitPlan(name, plan))
  }

  // ── ★ ①로 이탈 — 갱신이 **도착하기 전에** B의 계획 칸을 타이핑한다(경합 창)
  await toStep(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  await openCard(idB)
  await cardBox(idB).waitFor({ state: 'visible' })
  const preB = await cardBox(idB).inputValue()
  check('1-0 [모집단] 이탈 직후엔 아직 갱신이 도착하지 않았다', preB === '',
    `B 계획 칸='${preB}' — 값이 이미 있으면 경합 창을 못 잡은 것(판정 불가)`)
  await cardBox(idB).fill(TYPED_B)

  // A는 안 건드렸으므로 갱신을 받아야 한다
  let valA = ''
  for (let i = 0; i < 60; i++) {
    await openCard(idA)
    if (await cardBox(idA).count() > 0) {
      valA = await cardBox(idA).inputValue()
      if (valA === PLAN_A) break
    }
    await page.waitForTimeout(500)
  }
  check('★ 1-1 ⑤에서 저장한 계획이 (새로고침 없이) ① 카드 A에 보인다',
    valA === PLAN_A, `A 카드='${valA}' / 기대='${PLAN_A}'`)

  check('1-2 ① 카드에 "계획" 배지가 떴다',
    (await page.locator('span', { hasText: /^계획$/ }).count()) > 0)

  // ★ B는 내가 고치는 중이었다 — 서버가 같은 칸을 바꿔도 내 입력이 이겨야 한다
  check('★ 1-3 같은 칸을 서버도 바꿨지만 타이핑 중이던 내 값이 살아 있다',
    (await cardBox(idB).inputValue()) === TYPED_B,
    `B 카드='${await cardBox(idB).inputValue()}' / 기대='${TYPED_B}'(서버값 '${PLAN_B}'가 덮으면 실패)`)

  // ── 되돌아가도 ⑤ 표의 값은 그대로다(갱신이 방금 입력을 되감지 않는다)
  await toStep(4).click()
  const backGrid = page.getByLabel(`${DA} 조치 계획`)
  await backGrid.waitFor({ state: 'visible' })
  check('2-1 ①를 들렀다 돌아와도 ⑤ 표의 값이 남아 있다',
    (await backGrid.inputValue()) === PLAN_A, `⑤ 표='${await backGrid.inputValue()}'`)

  // ── ★ 역방향 — ① 카드 A에서 저장한 값이 ⑤ 표와 ① 자신에게 남는가
  await toStep(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  await openCard(idA)
  await cardBox(idA).waitFor({ state: 'visible' })
  await cardBox(idA).fill(CARD_PLAN)
  await card(idA).getByRole('button', { name: /^저장/ }).first().click()
  check('3-1 ① 카드에서 고친 계획이 DB에 저장됐다', await waitPlan(DA, CARD_PLAN))

  await toStep(4).click()
  const grid = page.getByLabel(`${DA} 조치 계획`)
  await grid.waitFor({ state: 'visible' })
  let gridVal = ''
  for (let i = 0; i < 60; i++) {
    gridVal = await grid.inputValue()
    if (gridVal === CARD_PLAN) break
    await page.waitForTimeout(500)
  }
  check('★ 4-1 ① 카드에서 저장한 계획이 (새로고침 없이) ⑤ 표에 보인다',
    gridVal === CARD_PLAN, `⑤ 표='${gridVal}' / 기대='${CARD_PLAN}'`)

  await toStep(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  let backVal = ''
  for (let i = 0; i < 60; i++) {
    await openCard(idA)
    if (await cardBox(idA).count() > 0) {
      backVal = await cardBox(idA).inputValue()
      if (backVal === CARD_PLAN) break
    }
    await page.waitForTimeout(500)
  }
  check('★ 4-2 ⑤를 들렀다 ①로 돌아와도 내가 저장한 값이 남아 있다',
    backVal === CARD_PLAN, `① 카드='${backVal}' / 기대='${CARD_PLAN}'`)
} catch (e) {
  check(`예외: ${(e as Error).message}`, false)
  console.log((e as Error).stack)
} finally {
  if (browser) await browser.close()
  if (insp) {
    await raw.from('inspection_defects').delete().eq('inspection_id', insp)
    await raw.from('inspection_steps').delete().eq('inspection_id', insp)
    await raw.from('inspections').delete().eq('id', insp)
  }
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
}
summary()
