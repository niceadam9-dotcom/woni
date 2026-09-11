// ⑥ 불량 조치 **전건 완료** — 실주행으로 본다 (2026-09-11)
//
// 왜 별도 스위트인가: 형제인 `test-defect-completion-checkbox`는 **한 행씩** 누르는 축을 본다.
// 전건 완료는 그 축의 단순 반복이 아니다 — 한 번의 왕복이 **여러 행을 동시에** 바꾸고,
// 화면은 그 여러 행을 **한 번의 상태 갱신**으로 따라가야 한다. 그 지점에 함정이 있다:
// 제어 모드의 `setEdits`는 함수형이 아니라 렌더가 잡은 `editsProp`에 얹으므로(defect-grid :95-98)
// 행마다 `set()`을 부르면 **마지막 한 행만 남고** 나머지는 조용히 사라진다. DB만 보면 초록이고
// 화면만 틀리다 — 그래서 A-5·A-6이 **화면 축**을 따로 단언한다.
//
// 이 검사가 지키는 것:
//  ① 버튼 한 번에 **미완료 행 전부**가 총 이행기간 종료일로 완료된다 (DB 축)
//  ② 새로고침 없이 **표의 체크·집계가 전부** 따라온다 (화면 축 — ①만 보면 눈이 먼다)
//  ③ 🚨 **이미 완료된 행의 손으로 적은 날짜는 덮이지 않는다** (음성 축 — 되돌릴 수 없는 손실)
//  ④ 건수를 그대로 말한다 — 「전건 완료」라 적어 놓고 건너뛴 수를 삼키면 화면이 거짓말을 한다
//  ⑤ 전건 완료 뒤에도 **개별 해제**가 된다 (한 번의 클릭이 굳어 버리면 안 된다)
//  ⑥ 축이 새지 않는다 — ⑤(계획)에는 이 버튼이 없고, 기간이 없으면 아예 안 그린다
//
// 실행: npx tsx scripts/test-defect-complete-all.mts   (로컬 dev :3000 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'defect-complete-all@erp-test.com'
const D1 = 'ZZ전건완료불량A'        // 빈 행 — 전건 완료의 대상
const D2 = 'ZZ전건완료불량B'        // **이미 완료** — 손으로 적은 날짜가 덮이면 안 된다
const D3 = 'ZZ전건완료불량C'        // 빈 행 — A와 **함께** 채워져야 한다(한 행만 남는 함정)
const P_START = '2026-08-05'
const P_END = '2026-08-15'
const KEEP_DONE = '2026-06-30'      // D2가 손으로 적어 둔 실제 조치일 — 파생값이 이기면 안 된다
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const dbCol = async (name: string, col: string) => {
  const { data } = await raw.from('inspection_defects').select(col)
    .eq('inspection_id', insp).eq('defect_name', name).single()
  return (data as Record<string, string | null> | null)?.[col] ?? null
}
/** 서버 왕복 뒤에 본다 — 한 번 읽고 판정하면 저장 전 값을 보고 실패한다(헛 실패의 단골) */
const waitCol = async (name: string, col: string, want: string | null) => {
  for (let i = 0; i < 60; i++) {
    if ((await dbCol(name, col)) === want) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}
const setPeriodRow = async (totalPeriod: string) => {
  await raw.from('annex_inputs').delete().eq('inspection_id', insp).eq('annex_no', 'report10')
  if (totalPeriod) {
    const { error } = await raw.from('annex_inputs')
      .insert({ inspection_id: insp, annex_no: 'report10', fields: { totalPeriod } })
    if (error) throw new Error(`총 이행기간 시드 실패: ${error.message}`)
  }
}
const tallyText = async (page: { locator: (s: string) => { innerText: () => Promise<string> } }) =>
  (await page.locator('body').innerText()).match(/불량 조치 \d+\/\d+/)?.[0] ?? '(없음)'

try {
  userId = await mkUser({ email: EMAIL, name: '전건완료E2E', employeeId: 'E2E-DCA' })
  cust = await mkCustomer({ customer_name: 'ZZ전건완료E2E고객', created_by: userId })
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
    const { error } = await raw.from('inspection_defects').insert([
      { inspection_id: insp, defect_code: 'A-01', defect_name: D1, severity: '보통' },
      { inspection_id: insp, defect_code: 'A-02', defect_name: D2, severity: '보통',
        action_completed_at: KEEP_DONE },
      { inspection_id: insp, defect_code: 'A-03', defect_name: D3, severity: '보통' },
    ])
    if (error) throw new Error(`불량 생성 실패: ${error.message}`)
  }
  await setPeriodRow(`${P_START} ~ ${P_END}`)
  /* 🚨 공허 통과 방지 — 시드가 안 섰는데 아래가 전부 초록으로 끝나는 일을 막는다.
     (0건 실행을 exit 0으로 보고하는 것이 이 하니스의 알려진 함정이다) */
  check('0-1 시드 — 이미 완료된 행이 하나 있다', (await dbCol(D2, 'action_completed_at')) === KEEP_DONE,
    `D2='${await dbCol(D2, 'action_completed_at')}'`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, EMAIL)

  /* ───────────────────── ⑥ 전건 완료 ───────────────────── */
  await page.goto(`${BASE}/inspections/${insp}?step=6`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const btn = page.getByTestId('complete-all-defects')
  await btn.waitFor({ state: 'visible' })
  check('A-1 ⑥에 [전건 완료] 버튼이 있다', (await btn.count()) > 0)
  check('A-2 시작 집계는 1/3 (이미 완료 1건)', (await tallyText(page)) === '불량 조치 1/3', await tallyText(page))

  await btn.click()

  // ── ★ DB 축 — 미완료 **두 행이 함께** 채워져야 한다
  check('★ A-3 빈 행 A가 기간 종료일로 완료된다', await waitCol(D1, 'action_completed_at', P_END),
    `A='${await dbCol(D1, 'action_completed_at')}'`)
  /* 🚨 A만 보면 「마지막 한 행만 반영」 함정을 못 잡는다 — **두 번째 행**이 이 검사의 본론이다 */
  check('★ A-4 빈 행 C도 **같은 클릭으로** 완료된다', await waitCol(D3, 'action_completed_at', P_END),
    `C='${await dbCol(D3, 'action_completed_at')}'`)
  /* 🚨🚨 음성 — 이미 완료된 행을 파생값으로 덮으면 손으로 적은 **실제 조치일**이 되돌릴 수 없이
     사라지고, 그 날짜가 별지 11호 「이행조치 일자」에 그대로 인쇄된다. 화면은 멀쩡해 보인다. */
  check('★ A-5 (음성) 이미 완료된 행의 손입력 날짜가 덮이지 않는다',
    (await dbCol(D2, 'action_completed_at')) === KEEP_DONE, `B='${await dbCol(D2, 'action_completed_at')}'`)

  // ── ★ 화면 축 — DB만 초록이고 화면이 틀린 경우를 따로 잡는다(setMany 함정)
  let live = false
  for (let i = 0; i < 60; i++) {
    if ((await tallyText(page)) === '불량 조치 3/3') { live = true; break }
    await page.waitForTimeout(500)
  }
  check('★ A-6 새로고침 없이 집계가 3/3으로', live, await tallyText(page))
  const checkedAll = (await page.getByLabel(`${D1} 조치 완료`).isChecked())
    && (await page.getByLabel(`${D3} 조치 완료`).isChecked())
  check('★ A-7 표의 체크가 **두 행 모두** 즉시 반영된다', checkedAll,
    `A=${await page.getByLabel(`${D1} 조치 완료`).isChecked()} C=${await page.getByLabel(`${D3} 조치 완료`).isChecked()}`)

  const msg = await page.getByTestId('complete-all-result').innerText().catch(() => '')
  check('A-8 처리 건수를 말한다', /2건/.test(msg), msg)
  check('A-9 건드리지 않은 건수도 말한다(「전건」으로 읽히면 안 된다)', /이미 완료/.test(msg), msg)

  // ── 한 번의 클릭이 굳어 버리면 안 된다 — 개별 해제는 그대로 산다
  await page.getByLabel(`${D1} 조치 완료`).uncheck()
  check('★ B-1 전건 완료 뒤에도 개별 해제가 된다', await waitCol(D1, 'action_completed_at', null),
    `A='${await dbCol(D1, 'action_completed_at')}'`)

  /* ───────── 축이 새지 않는가 ─────────
     ⑤는 **계획** 축이다. 거기에 완료 버튼이 생기면 계획을 세우는 자리에서 완료가 찍힌다.
     ⚠ 앵커는 `defect-grid`다 — 종전에는 ⑤의 [빈 칸에 일괄 적용]을 기다렸는데, 그 버튼은
       2026-09-11에 **일부러 없어졌다**(불량별 계획 기간 입력 폐지). 남의 축이 사라졌다고
       내 단언까지 죽일 일은 아니어서 앵커만 옮겼다 — 묻는 것은 그대로 「⑤에 완료가 새는가」다. */
  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByTestId('defect-grid').waitFor({ state: 'visible' })
  check('★ C-1 (음성) ⑤에는 [전건 완료]가 없다',
    (await page.getByTestId('complete-all-defects').count()) === 0)
  check('C-2 ⑤ 화면이 실제로 떠 있다(앵커가 죽어 C-1이 공허 통과하지 않는다)',
    (await page.getByTestId('defect-grid').count()) > 0)

  /* 기간이 없으면 서버가 어차피 거절한다 — 늘 실패하는 버튼을 그려 두지 않는다 */
  await setPeriodRow('')
  await page.goto(`${BASE}/inspections/${insp}?step=6`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByLabel(`${D1} 조치 완료`).waitFor({ state: 'visible' })
  check('★ C-3 (음성) 총 이행기간이 없으면 [전건 완료]를 그리지 않는다',
    (await page.getByTestId('complete-all-defects').count()) === 0)
  check('C-4 대신 무엇을 먼저 해야 하는지 말한다',
    (await page.getByText('총 이행기간이 아직 없습니다').count()) > 0)
} catch (e) {
  check(`예외: ${(e as Error).message}`, false)
  console.log((e as Error).stack)
} finally {
  if (browser) await browser.close()
  if (insp) {
    await raw.from('annex_inputs').delete().eq('inspection_id', insp)
    await raw.from('inspection_defects').delete().eq('inspection_id', insp)
    await raw.from('inspection_steps').delete().eq('inspection_id', insp)
    await raw.from('inspections').delete().eq('id', insp)
  }
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
  summary('⑥ 불량 조치 전건 완료 실주행(2026-09-11)')
}
