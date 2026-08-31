// 소방계획서_36 F-21 — 불량표 입력이 **단계(pane) 전환을 살아남는가**
//
// 왜 필요한가: ⑤(이행계획)·⑥(불량 조치)는 `sel === …` **조건부 렌더**라 단계를 바꾸면
// DefectGrid가 언마운트된다. 표의 입력값은 DefectGrid 안의 `edits`(지역 state)에 있으므로
// 그 순간 사라지고, 화면은 **서버 prop `defectRows`**만 남는다.
// 지금 그 prop이 최신인 이유는 `updateDefectActionAction`이 아직 `alsoChanged: true`라서
// 저장 응답에 RSC 페이로드가 함께 실려 오기 때문이다(F-15가 규명한 경로).
//
// ⚠ 그래서 이 검사는 **S2-5의 스위치를 내리기 전에 초록임을 먼저 확인**해야 한다(대조군).
//    지금 초록이어야, 내린 뒤 붉어진 것이 '그 변경이 깬 것'이라고 말할 수 있다.
//    F-21이 경고한 사고는 정확히 이것이다 — "방금 저장한 조치계획이 화면에서 사라진다".
//
// 실행: npx tsx scripts/test-workbench-defect-pane-switch.mts   (로컬 dev :3000 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'wb-defect-pane@erp-test.com'
const D1 = 'ZZ전환불량A'
const PLAN_TEXT = '수신기 기판 교체'
const TAKEN_TEXT = '교체 완료 · 시험 정상'
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '불량전환E2E', employeeId: 'E2E-DPS' })
  cust = await mkCustomer({ customer_name: 'ZZ불량전환E2E고객', created_by: userId })
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
  page.setDefaultTimeout(120000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, EMAIL)

  // ── ⑤에서 조치계획 입력
  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const planBox = page.getByLabel(`${D1} 조치 계획`)
  await planBox.waitFor({ state: 'visible' })
  await planBox.fill(PLAN_TEXT)
  await planBox.blur()

  // 저장이 실제로 끝났는지를 **DB로** 확인하고 넘어간다 — 화면 칩은 4초 뒤 사라져 경합이 된다
  let saved = false
  for (let i = 0; i < 120; i++) {
    const { data } = await raw.from('inspection_defects')
      .select('action_plan').eq('inspection_id', insp).eq('defect_name', D1).single()
    if ((data as { action_plan: string | null } | null)?.action_plan === PLAN_TEXT) { saved = true; break }
    await page.waitForTimeout(500)
  }
  check('1-1 ⑤에서 입력한 조치계획이 DB에 저장됐다', saved)

  // ── ★ 핵심: 단계 전환(⑤ → ⑥ → ⑤). **새로고침은 하지 않는다** — 그게 이 검사의 요점이다.
  //    새로고침하면 서버에서 다시 읽어오므로 어떤 구현이든 통과해 버린다(항진명제가 된다).
  await page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(5).click()  // ⑥
  await page.waitForTimeout(1200)
  await page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(4).click()  // ⑤
  await page.waitForTimeout(1200)

  const back = page.getByLabel(`${D1} 조치 계획`)
  await back.waitFor({ state: 'visible' })
  const shown = await back.inputValue()
  check('★ 2-1 ⑥로 갔다 ⑤로 돌아와도 조치계획이 화면에 남아 있다', shown === PLAN_TEXT,
    `화면='${shown}' / 기대='${PLAN_TEXT}' — 비었다면 F-21이 경고한 '저장한 값이 사라진다'가 실현된 것`)
  check('2-2 칸 제목도 1/1을 유지한다', await page.getByText('이행계획 1/1').count() > 0,
    (await page.locator('body').innerText()).match(/이행계획 \d+\/\d+/)?.[0] ?? '(없음)')

  // ── ⑥ 쪽도 같은 축 — 조치 내용을 ⑥에서 넣고 ⑤를 거쳐 돌아온다
  await page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(5).click()  // ⑥
  await page.waitForTimeout(1200)
  const takenBox = page.getByLabel(`${D1} 조치 내용`)
  await takenBox.waitFor({ state: 'visible' })
  await takenBox.fill(TAKEN_TEXT)
  await takenBox.blur()
  let saved2 = false
  for (let i = 0; i < 120; i++) {
    const { data } = await raw.from('inspection_defects')
      .select('action_taken').eq('inspection_id', insp).eq('defect_name', D1).single()
    if ((data as { action_taken: string | null } | null)?.action_taken === TAKEN_TEXT) { saved2 = true; break }
    await page.waitForTimeout(500)
  }
  check('3-1 ⑥에서 입력한 조치내용이 DB에 저장됐다', saved2)

  await page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(4).click()  // ⑤
  await page.waitForTimeout(1200)
  await page.locator('[data-testid="workbench-stepbar"] [data-step]').nth(5).click()  // ⑥
  await page.waitForTimeout(1200)
  const backTaken = page.getByLabel(`${D1} 조치 내용`)
  await backTaken.waitFor({ state: 'visible' })
  const shown2 = await backTaken.inputValue()
  check('★ 3-2 ⑤를 거쳐 ⑥로 돌아와도 조치내용이 남아 있다', shown2 === TAKEN_TEXT,
    `화면='${shown2}' / 기대='${TAKEN_TEXT}'`)

  // ── 마지막으로 새로고침 대조 — 위가 통과했는데 이게 실패하면 '화면만 앞서간' 것이다
  //
  // ⚠ 단계 전환은 **클릭**(setSel 지역 state)이라 URL은 `?step=5` 그대로다. 그래서 그냥
  //    reload()하면 ⑤로 돌아오고, 거기엔 ⑥ 칸('조치 내용')이 아예 없다 —
  //    처음에 그걸 모르고 reload 직후 ⑥ 칸을 기다리다 120초 타임아웃을 냈다.
  //    **제품이 아니라 검사가 틀렸던 것**이므로 단계를 URL로 명시해 각각 확인한다.
  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByLabel(`${D1} 조치 계획`).waitFor({ state: 'visible' })
  check('4-1 새로고침(⑤) 후 조치계획 보존',
    (await page.getByLabel(`${D1} 조치 계획`).inputValue()) === PLAN_TEXT)

  await page.goto(`${BASE}/inspections/${insp}?step=6`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByLabel(`${D1} 조치 내용`).waitFor({ state: 'visible' })
  check('4-2 새로고침(⑥) 후 조치내용 보존',
    (await page.getByLabel(`${D1} 조치 내용`).inputValue()) === TAKEN_TEXT)
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
