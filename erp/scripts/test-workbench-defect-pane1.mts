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
/** ⑤축 — **계획이 이미 있는** 불량. 문구만 고치면 집계(planned/done/total)가 안 움직여
 *  편집분 폐기 방아쇠가 안 당겨진다. A·B로는 이 축을 못 밟는다(둘 다 빈 값→값이라
 *  저장하는 순간 planned가 늘어 방아쇠가 당겨져 버린다) — 3차 판정이 잡은 구멍이다. */
const DC = 'ZZ전환불량C'
const SEED_C = 'P1 최초 계획'
const C_IN_GRID = 'P2 표에서 고침'
const C_IN_CARD = 'P3 카드에서 고침'
/** 6축 — **`action_taken`(조치 내용)**. 4차 판정 지적: 17단언이 사실상 `action_plan`
 *  한 칸만 지켰다(나머지 4칸 가드를 전부 지워도 17/0 초록이었다). 그중 `action_taken`은
 *  **집계(planned/done)에 아예 안 들어가** 3차가 막은 함정이 가장 잘 되살아나는 칸이다. */
const DD = 'ZZ전환불량D'
const SEED_D = 'T1 최초 조치'
const D_IN_GRID = 'T2 표에서 고침'
const D_IN_CARD = 'T3 카드에서 고침'
/** 7축 — 결함 A(⑤의 뒤집힌 기간이 ⑥ 저장을 막던 것)와 결함 B(낡은 카드가 [저장]만으로
 *  다른 칸을 지우던 것)를 상시 검사로 못박는다. 둘 다 4차 판정이 라이브로 잡은 것이다. */
const DE = 'ZZ전환불량E'
/** ⓑ는 **다른 불량**을 쓴다 — E에는 뒤집힌 기간이 남아 있어 ⑤에서 계획 저장이 막히는 게
 *  옳은 동작이다(그 축은 ⓐ가 본다). 두 시나리오를 한 행에 겹치면 검사가 스스로를 막는다. */
const DF = 'ZZ전환불량F'
/** 8축 — **서버 계층**을 직접 시험한다. 클라이언트가 부분 전송하도록 고친 것만으로는
 *  서버의 '항상 덮어쓰기'가 드러나지 않는다(안 보낸 칸이 없으니 덮을 일이 없다).
 *  그래서 **한 칸만 보내는 경로**에서 **다른 칸이 살아남는지**를 본다 — 서버가 안 온 칸을
 *  건드리면 여기서 붉어진다. 절제로 실증했다(서버만 되돌리면 이 축만 빨강). */
const DG = 'ZZ전환불량G'
const SEED_G_TAKEN = 'G 조치 완료'
const SEED_G_DATE = '2026-08-20'
const PLAN_A = '수신기 기판 교체'
const PLAN_B = '유도등 램프 교체'
const TYPED_B = '내가 고치던 계획'
const CARD_PLAN = '카드에서 고친 계획'
const CARD_PH = '이행조치 계획 (별지 10호 — 예: 유도등 램프 교체)'
const TAKEN_PH = '조치 내용'
let userId = '', cust = '', insp = ''
let idA = '', idB = '', idC = '', idD = '', idE = '', idF = ''
/** 실행된 단언 수. ⚠ 예외가 나면 뒤 단언이 통째로 **미실행**되는데 요약은 '통과/실패'만
 *  말해 그 사실이 안 남는다 — 실제로 기준선 실행 1회가 17 중 8만 돌고도 그렇게 보고됐다
 *  (4차 판정 H-5). 마지막에 총수를 못박아 조용한 축소를 붉게 만든다. */
let ran = 0
const EXPECTED = 32
// @ts-expect-error mjs 헬퍼 시그니처
const ck = (name: string, ok: boolean, detail = '') => { ran++; check(name, ok, detail) }
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
      // C만 계획을 **미리** 심는다 — 이래야 이후 수정이 집계를 안 움직인다
      { inspection_id: insp, defect_code: 'A-03', defect_name: DC, severity: '보통', action_plan: SEED_C },
      // D는 조치 내용을 미리 심는다 — 이 칸은 집계에 아예 안 들어간다
      { inspection_id: insp, defect_code: 'A-04', defect_name: DD, severity: '보통', action_taken: SEED_D },
      { inspection_id: insp, defect_code: 'A-05', defect_name: DE, severity: '보통' },
      { inspection_id: insp, defect_code: 'A-06', defect_name: DF, severity: '보통' },
      // G는 ⑤가 안 보내는 두 칸을 미리 채운다 — 서버가 그걸 지우는지 보는 축
      { inspection_id: insp, defect_code: 'A-07', defect_name: DG, severity: '보통',
        action_taken: SEED_G_TAKEN, action_completed_at: SEED_G_DATE },
    ]).select('id, defect_name')
    if (error) throw new Error(`불량 생성 실패: ${error.message}`)
    const rows = data as Array<{ id: string; defect_name: string }>
    idA = rows.find(r => r.defect_name === DA)!.id
    idB = rows.find(r => r.defect_name === DB_)!.id
    idC = rows.find(r => r.defect_name === DC)!.id
    idD = rows.find(r => r.defect_name === DD)!.id
    idE = rows.find(r => r.defect_name === DE)!.id
    idF = rows.find(r => r.defect_name === DF)!.id
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
  type Col = 'action_plan' | 'action_taken' | 'action_completed_at'
  const dbCol = async (name: string, col: Col = 'action_plan') => {
    const { data, error } = await raw.from('inspection_defects')
      .select(col).eq('inspection_id', insp).eq('defect_name', name).single()
    if (error) throw new Error(`불량 조회 실패: ${error.message}`)   // 조용한 0행을 통과로 읽지 않는다
    return (data as Record<string, string | null> | null)?.[col] ?? null
  }
  const dbPlan = (name: string) => dbCol(name, 'action_plan')
  const waitCol = async (name: string, want: string, col: Col = 'action_plan') => {
    for (let i = 0; i < 90; i++) {
      if ((await dbCol(name, col)) === want) return true
      await page.waitForTimeout(500)
    }
    return false
  }
  const waitPlan = (name: string, want: string) => waitCol(name, want, 'action_plan')
  /** ⚠ **고정 대기로 '안 바뀌었다'를 판정하지 않는다**(4차 판정 지적). 되쓰기가 늦게 도착하면
   *  조용히 초록이 된다 — 파일 스스로 적은 재렌더 실측(6.8~7.6초)보다 짧은 대기였다.
   *  대신 **바뀌면 즉시 실패**하도록 관측하고, 창을 그 실측보다 넉넉히 잡는다. */
  const staysFor = async (name: string, want: string, col: Col, ms: number) => {
    const until = ms / 500
    for (let i = 0; i < until; i++) {
      if ((await dbCol(name, col)) !== want) return false   // 바뀌는 순간 실패 확정
      await page.waitForTimeout(500)
    }
    return true
  }
  const toStep = (n: number) => page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(n)

  // ── 모집단 선단언 — ① 카드 두 건이 처음에 **비어 있음**을 먼저 본다(공허 통과 차단)
  await page.goto(`${BASE}/inspections/${insp}?step=1`)
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  for (const [id, label] of [[idA, 'A'], [idB, 'B']] as const) {
    await openCard(id)
    await cardBox(id).waitFor({ state: 'visible' })
    ck(`0-1${label} [대조군] 착수 시 ① 카드(${label})의 계획 칸은 비어 있다`,
      (await cardBox(id).inputValue()) === '')
  }

  // ── ⑤에서 두 건 모두 저장 (여기부터 새로고침 없음)
  await toStep(4).click()
  for (const [name, plan] of [[DA, PLAN_A], [DB_, PLAN_B]] as const) {
    const box = page.getByLabel(`${name} 조치 계획`)
    await box.waitFor({ state: 'visible' })
    await box.fill(plan)
    await box.blur()
    ck(`0-2${name === DA ? 'A' : 'B'} ⑤에서 입력한 조치계획이 DB에 저장됐다`, await waitPlan(name, plan))
  }

  // ── ★ ①로 이탈 — 갱신이 **도착하기 전에** B의 계획 칸을 타이핑한다(경합 창)
  await toStep(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  await openCard(idB)
  await cardBox(idB).waitFor({ state: 'visible' })
  const preB = await cardBox(idB).inputValue()
  ck('1-0 [모집단] 이탈 직후엔 아직 갱신이 도착하지 않았다', preB === '',
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
  ck('★ 1-1 ⑤에서 저장한 계획이 (새로고침 없이) ① 카드 A에 보인다',
    valA === PLAN_A, `A 카드='${valA}' / 기대='${PLAN_A}'`)

  /** ⚠ 4차 판정이 이 단언을 **항진명제**로 판정했다 — 로케이터가 **페이지 전역**이었는데
   *  불량 C가 `action_plan`을 씨딩받아 최초 서버 렌더부터 배지가 있었다. 실제로 1-1이 붉은
   *  실행에서도 이것만 초록이었다. 카드 **A 안**으로 좁혀 판정 대상과 일치시킨다. */
  ck('1-2 ① 카드 A에 "계획" 배지가 떴다',
    (await card(idA).locator('span', { hasText: /^계획$/ }).count()) > 0,
    `A 카드 배지=${await card(idA).locator('span', { hasText: /^계획$/ }).count()}`)

  // ★ B는 내가 고치는 중이었다 — 서버가 같은 칸을 바꿔도 내 입력이 이겨야 한다
  ck('★ 1-3 같은 칸을 서버도 바꿨지만 타이핑 중이던 내 값이 살아 있다',
    (await cardBox(idB).inputValue()) === TYPED_B,
    `B 카드='${await cardBox(idB).inputValue()}' / 기대='${TYPED_B}'(서버값 '${PLAN_B}'가 덮으면 실패)`)

  // ── 되돌아가도 ⑤ 표의 값은 그대로다(갱신이 방금 입력을 되감지 않는다)
  await toStep(4).click()
  const backGrid = page.getByLabel(`${DA} 조치 계획`)
  await backGrid.waitFor({ state: 'visible' })
  ck('2-1 ①를 들렀다 돌아와도 ⑤ 표의 값이 남아 있다',
    (await backGrid.inputValue()) === PLAN_A, `⑤ 표='${await backGrid.inputValue()}'`)

  // ── ★ 역방향 — ① 카드 A에서 저장한 값이 ⑤ 표와 ① 자신에게 남는가
  await toStep(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  await openCard(idA)
  await cardBox(idA).waitFor({ state: 'visible' })
  await cardBox(idA).fill(CARD_PLAN)
  await card(idA).getByRole('button', { name: /^저장/ }).first().click()
  ck('3-1 ① 카드에서 고친 계획이 DB에 저장됐다', await waitPlan(DA, CARD_PLAN))

  await toStep(4).click()
  const grid = page.getByLabel(`${DA} 조치 계획`)
  await grid.waitFor({ state: 'visible' })
  let gridVal = ''
  for (let i = 0; i < 60; i++) {
    gridVal = await grid.inputValue()
    if (gridVal === CARD_PLAN) break
    await page.waitForTimeout(500)
  }
  ck('★ 4-1 ① 카드에서 저장한 계획이 (새로고침 없이) ⑤ 표에 보인다',
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
  ck('★ 4-2 ⑤를 들렀다 ①로 돌아와도 내가 저장한 값이 남아 있다',
    backVal === CARD_PLAN, `① 카드='${backVal}' / 기대='${CARD_PLAN}'`)

  /* ── ★ 5축 — **집계가 안 움직이는 수정**(문구만 고치기). 3차 판정이 잡은 구멍이다.
     계획이 이미 있는 불량은 문구를 바꿔도 planned/done/total이 그대로라, 편집분 폐기가
     집계를 방아쇠로 삼으면 **낡은 편집분이 서버 값을 이긴 채 남는다**. 그 상태에서 칸을
     blur로 지나가기만 해도 commit이 낡은 값을 DB로 되써서 **저장이 조용히 사라진다**. */
  await toStep(4).click()
  const gridC = page.getByLabel(`${DC} 조치 계획`)
  await gridC.waitFor({ state: 'visible' })
  ck('5-0 [모집단] C는 계획이 미리 있다(집계가 안 움직이는 축)',
    (await gridC.inputValue()) === SEED_C, `⑤ 표 C='${await gridC.inputValue()}'`)

  await gridC.fill(C_IN_GRID)
  await gridC.blur()
  ck('5-1 ⑤에서 고친 문구가 DB에 저장됐다', await waitPlan(DC, C_IN_GRID))

  await toStep(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  await openCard(idC)
  await cardBox(idC).waitFor({ state: 'visible' })
  for (let i = 0; i < 60 && (await cardBox(idC).inputValue()) !== C_IN_GRID; i++) await page.waitForTimeout(500)
  await cardBox(idC).fill(C_IN_CARD)
  await card(idC).getByRole('button', { name: /^저장/ }).first().click()
  ck('5-2 ① 카드에서 다시 고친 문구가 DB에 저장됐다', await waitPlan(DC, C_IN_CARD))

  await toStep(4).click()
  const gridC2 = page.getByLabel(`${DC} 조치 계획`)
  await gridC2.waitFor({ state: 'visible' })
  let cVal = ''
  for (let i = 0; i < 60; i++) {
    cVal = await gridC2.inputValue()
    if (cVal === C_IN_CARD) break
    await page.waitForTimeout(500)
  }
  ck('★ 5-3 집계가 안 바뀌는 수정도 ⑤ 표에 반영된다(낡은 편집분이 안 이긴다)',
    cVal === C_IN_CARD, `⑤ 표 C='${cVal}' / 기대='${C_IN_CARD}'(낡은 '${C_IN_GRID}'가 보이면 실패)`)

  // ★ 가장 나쁜 축 — 그 칸을 **지나가기만** 해도 DB가 되돌아가는가
  await gridC2.focus()
  await gridC2.blur()
  ck('★ 5-4 그 칸을 blur로 지나가도 DB가 되돌아가지 않는다(저장 소실 없음)',
    await staysFor(DC, C_IN_CARD, 'action_plan', 9000), `DB='${await dbPlan(DC)}' / 기대='${C_IN_CARD}'`)

  /* ── ★ 6축 — **`action_taken`**. 17단언이 `action_plan` 한 칸만 지키고 있었다(4차 판정이
     나머지 4칸 가드를 전부 지워도 초록임을 실증). 이 칸은 **집계에 아예 안 들어가** 3차가
     막은 함정이 가장 잘 되살아난다. 5축과 같은 4단 왕복을 ⑥↔①로 돌린다. */
  await toStep(5).click()
  const gridD = page.getByLabel(`${DD} 조치 내용`)
  await gridD.waitFor({ state: 'visible' })
  ck('6-0 [모집단] D는 조치 내용이 미리 있다(집계 무관 칸)',
    (await gridD.inputValue()) === SEED_D, `⑥ 표 D='${await gridD.inputValue()}'`)

  await gridD.fill(D_IN_GRID)
  await gridD.blur()
  ck('6-1 ⑥에서 고친 조치 내용이 DB에 저장됐다', await waitCol(DD, D_IN_GRID, 'action_taken'))

  await toStep(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  await openCard(idD)
  const takenD = card(idD).getByPlaceholder(TAKEN_PH)
  await takenD.waitFor({ state: 'visible' })
  for (let i = 0; i < 60 && (await takenD.inputValue()) !== D_IN_GRID; i++) await page.waitForTimeout(500)
  await takenD.fill(D_IN_CARD)
  await card(idD).getByRole('button', { name: /^저장/ }).first().click()
  ck('6-2 ① 카드에서 다시 고친 조치 내용이 DB에 저장됐다', await waitCol(DD, D_IN_CARD, 'action_taken'))

  await toStep(5).click()
  const gridD2 = page.getByLabel(`${DD} 조치 내용`)
  await gridD2.waitFor({ state: 'visible' })
  let dVal = ''
  for (let i = 0; i < 60; i++) {
    dVal = await gridD2.inputValue()
    if (dVal === D_IN_CARD) break
    await page.waitForTimeout(500)
  }
  ck('★ 6-3 집계에 안 들어가는 칸도 ⑥ 표에 반영된다',
    dVal === D_IN_CARD, `⑥ 표 D='${dVal}' / 기대='${D_IN_CARD}'`)

  await gridD2.focus()
  await gridD2.blur()
  ck('★ 6-4 그 칸을 blur로 지나가도 DB가 되돌아가지 않는다',
    await staysFor(DD, D_IN_CARD, 'action_taken', 9000),
    `DB='${await dbCol(DD, 'action_taken')}' / 기대='${D_IN_CARD}'`)

  /* ── ★ 7축 — 4차 판정이 라이브로 잡은 제품 결함 2건을 상시 검사로 못박는다.
     ⓐ ⑤에서 **뒤집힌 이행 기간**을 치면 저장이 차단되는데 그 값이 편집 버퍼에 남는다.
        ⑤·⑥이 버퍼를 공유하므로 ⑥의 저장이 통째로 막혔다(⑥엔 그 칸이 없는데 그 오류가 떴다).
     ⓑ ⑤에서 저장한 뒤 갱신 도착 **전에** ① 카드의 [저장]만 눌러도 그 값이 지워졌다. */
  await toStep(4).click()
  const eStart = page.getByLabel(`${DE} 계획 시작일`)
  const eEnd = page.getByLabel(`${DE} 계획 종료일`)
  await eStart.waitFor({ state: 'visible' })
  await eStart.fill('2026-09-20')
  await eEnd.fill('2026-09-10')   // 뒤집힌 기간 — 저장은 차단되고 편집분만 남는다
  await eEnd.blur()

  await toStep(5).click()
  const eTaken = page.getByLabel(`${DE} 조치 내용`)
  await eTaken.waitFor({ state: 'visible' })
  await eTaken.fill('E 조치 완료')
  await eTaken.blur()
  ck('★ 7-1 ⑤의 뒤집힌 기간이 ⑥의 조치 내용 저장을 막지 않는다',
    await waitCol(DE, 'E 조치 완료', 'action_taken'),
    `DB action_taken='${await dbCol(DE, 'action_taken')}'`)
  ck('★ 7-2 ⑥ 화면에 "이행 기간" 오류가 뜨지 않는다(⑥엔 그 칸이 없다)',
    (await page.getByText('이행 기간').count()) === 0,
    `오류 표시 ${await page.getByText('이행 기간').count()}개`)

  // ⓑ 낡은 ① 카드가 [저장]만으로 다른 칸을 지우는가
  await toStep(4).click()
  const fPlan = page.getByLabel(`${DF} 조치 계획`)
  await fPlan.waitFor({ state: 'visible' })
  await fPlan.fill('F 계획 표에서 저장')
  await fPlan.blur()
  ck('7-3 ⑤에서 계획을 저장했다', await waitPlan(DF, 'F 계획 표에서 저장'))

  await toStep(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  await openCard(idF)
  await cardBox(idF).waitFor({ state: 'visible' })
  ck('7-4 [모집단] 이탈 직후 ① 카드는 아직 낡은 값(빈 칸)이다',
    (await cardBox(idF).inputValue()) === '',
    `F 카드='${await cardBox(idF).inputValue()}' — 값이 이미 있으면 이 창을 못 잡은 것`)
  // 아무것도 안 치고 [저장]만 누른다
  await card(idF).getByRole('button', { name: /^저장/ }).first().click()
  ck('★ 7-5 낡은 ① 카드의 [저장]이 ⑤에서 저장한 계획을 지우지 않는다',
    await staysFor(DF, 'F 계획 표에서 저장', 'action_plan', 9000),
    `DB='${await dbPlan(DF)}' / 기대='F 계획 표에서 저장'`)

  /* ── ★ 8축 — **서버 계층**. 클라이언트를 부분 전송으로 고친 것만으로는 서버의
     '항상 덮어쓰기'가 드러나지 않는다(안 보낸 칸이 없으니 덮을 일이 없다). ⑤에서 계획만
     저장하면 조치내용·완료일은 **아예 안 실려 간다** — 서버가 그때 그 칸을 건드리는지 본다. */
  await toStep(4).click()
  const gPlan = page.getByLabel(`${DG} 조치 계획`)
  await gPlan.waitFor({ state: 'visible' })
  ck('8-0 [모집단] G는 ⑤가 안 보내는 두 칸이 미리 차 있다',
    (await dbCol(DG, 'action_taken')) === SEED_G_TAKEN && (await dbCol(DG, 'action_completed_at')) === SEED_G_DATE,
    `taken='${await dbCol(DG, 'action_taken')}' date='${await dbCol(DG, 'action_completed_at')}'`)

  await gPlan.fill('G 계획만 저장')
  await gPlan.blur()
  ck('8-1 ⑤에서 계획만 저장했다', await waitPlan(DG, 'G 계획만 저장'))
  ck('★ 8-2 안 보낸 칸(조치 내용)이 서버에서 지워지지 않았다',
    (await dbCol(DG, 'action_taken')) === SEED_G_TAKEN, `taken='${await dbCol(DG, 'action_taken')}'`)
  ck('★ 8-3 안 보낸 칸(완료일)이 서버에서 지워지지 않았다',
    (await dbCol(DG, 'action_completed_at')) === SEED_G_DATE, `date='${await dbCol(DG, 'action_completed_at')}'`)

  // ⚠ 실행 개수 단언 — 자기 자신을 포함하므로 ran+1과 비교한다
  ck(`전 단언이 실행됐다(${EXPECTED}건 기대)`, ran + 1 === EXPECTED, `실행 ${ran + 1}건`)
} catch (e) {
  ck(`예외: ${(e as Error).message}`, false)
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
