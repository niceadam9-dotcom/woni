// 소방계획서_36 F-24 — ⑤ 불량표에서 저장한 값이 **① '불량 내역' 칸**에 반영되는가.
//
// 왜 별도 검사인가: test-workbench-defect-pane-switch.mts는 ⑤↔⑥만 오간다. 그 두 pane은
//   부모가 쥔 미러(defectsLocal·defectEdits)를 공유하므로 클라이언트 안에서 값이 이어진다.
//   그러나 ①의 불량 카드(slots.defects = InspectionDefectsClient)는 **서버가 그려 준 노드**라
//   그 미러가 닿지 않는다 — S3-7이 셀당 router.refresh()를 걷어내며 이 표면이 드러났고,
//   독립 판정이 라이브로 잡았다(DB는 옳고 화면만 낡음). F-23이 고친 것과 같은 종류·다른 표면.
//
// ⚠ **새로고침하지 않는다.** 새로고침하면 어떤 구현이든 통과하므로 항진명제가 된다.
//   비항진성의 근거: 페이지를 열 때 ① 카드는 **빈 값**으로 서버 렌더된다. 그 뒤 리로드 없이
//   ⑤에서만 저장하므로, ①이 값을 보이려면 이탈 시 갱신이 실제로 돌아야만 한다.
//
// ⚠ 고정 대기를 쓰지 않는다 — 이 상세 페이지의 서버 재렌더는 실측 6.8~7.6초까지 나온다.
//   고정 대기로 잡으면 느린 날에 붉어지는 플레이크가 된다(F-13이 데인 자리).
//
// 범위 밖(의도적 비단언): 역방향 ① 카드 → ⑤ 표는 **선재 결함**이다. DefectActionSection.save()는
//   기준선에도 refresh가 없었고 revalidate만으로는 마운트된 트리에 prop이 밀리지 않는다(F-23 규명).
//   36이 만든 것이 아니라 여기서 단언하면 영구히 붉다 — 관측만 하고 판정하지 않는다.
//
// 실행: npx tsx scripts/test-workbench-defect-pane1.mts
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'wb-pane1@erp-test.com'
const D1 = 'ZZ전환불량A'
const PLAN_TEXT = '수신기 기판 교체'
const CARD_PH = '이행조치 계획 (별지 10호 — 예: 유도등 램프 교체)'
let userId = '', cust = '', insp = ''
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
  const { error: dErr } = await raw.from('inspection_defects').insert([
    { inspection_id: insp, defect_code: 'A-01', defect_name: D1, severity: '보통' },
  ])
  if (dErr) throw new Error(`불량 생성 실패: ${dErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(90000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, EMAIL)

  // ── 모집단 선단언 — ①이 처음에 **비어 있음**을 먼저 본다(공허 통과 차단)
  await page.goto(`${BASE}/inspections/${insp}?step=1`)
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })
  const cardBox = () => page.getByPlaceholder(CARD_PH).first()
  const openCard = async () => {
    if (await cardBox().count() === 0) {
      const t = page.getByText('이행계획·조치 완료').first()
      if (await t.count() > 0) await t.click()
    }
  }
  await openCard()
  await cardBox().waitFor({ state: 'visible' })
  check('0-1 [대조군] 착수 시 ① 불량 카드의 계획 칸은 비어 있다', (await cardBox().inputValue()) === '')

  // ── ⑤로 이동해 조치계획 입력 (여기부터 새로고침 없음)
  await page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(4).click()
  const planBox = page.getByLabel(`${D1} 조치 계획`)
  await planBox.waitFor({ state: 'visible' })
  await planBox.fill(PLAN_TEXT)
  await planBox.blur()

  let saved = false
  for (let i = 0; i < 90 && !saved; i++) {
    const { data, error } = await raw.from('inspection_defects')
      .select('action_plan').eq('inspection_id', insp).eq('defect_name', D1).single()
    if (error) throw new Error(`불량 조회 실패: ${error.message}`)   // 조용한 0행을 통과로 읽지 않는다
    if ((data as { action_plan: string | null } | null)?.action_plan === PLAN_TEXT) saved = true
    else await page.waitForTimeout(500)
  }
  check('0-2 ⑤에서 입력한 조치계획이 DB에 저장됐다', saved)

  // ── ★ ①로 이탈 — 새로고침 없이. 갱신 왕복은 폴링으로 기다린다
  await page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(0).click()
  await page.getByTestId('workbench-panes').waitFor({ state: 'visible' })

  let cardVal = ''
  for (let i = 0; i < 60; i++) {
    await openCard()
    if (await cardBox().count() > 0) {
      cardVal = await cardBox().inputValue()
      if (cardVal === PLAN_TEXT) break
    }
    await page.waitForTimeout(500)
  }
  check('★ 1-1 ⑤에서 저장한 계획이 (새로고침 없이) ① 불량 카드에 보인다',
    cardVal === PLAN_TEXT, `① 카드='${cardVal}' / 기대='${PLAN_TEXT}'`)

  const plannedBadge = await page.locator('span', { hasText: /^계획$/ }).count()
  check('1-2 ① 카드에 "계획" 배지가 떴다', plannedBadge > 0, `배지 수=${plannedBadge}`)

  // ── 되돌아가도 ⑤ 표의 값은 그대로다(갱신이 방금 입력을 되감지 않는다)
  await page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(4).click()
  const back = page.getByLabel(`${D1} 조치 계획`)
  await back.waitFor({ state: 'visible' })
  check('2-1 ①를 들렀다 돌아와도 ⑤ 표의 값이 남아 있다', (await back.inputValue()) === PLAN_TEXT,
    `⑤ 표='${await back.inputValue()}'`)

  // ── 관측만(비단언): 역방향은 선재 결함이라 판정하지 않는다
  console.log('  ℹ 역방향(① 카드 → ⑤ 표)은 이 검사의 범위 밖 — 선재 결함(F-23 규명)')
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
