// ⑥ 완료 체크 · ⑤ 기간 일괄 적용 — **실주행**으로 본다 (2026-09-10)
//
// 왜 별도 스위트인가: 같은 차수의 `test-action-period-derive`는 **구조**만 본다(규칙 함수와
// 원문 배선). 그건 "체크박스가 그려져 있다"까지만 말하고 **"눌렀을 때 날짜가 DB에 들어간다"**를
// 말하지 못한다 — 포장했는가만 묻고 요청이 나가는가를 안 묻는 자리다.
// 기존 불량표 E2E 3종은 조치계획·조치내용만 채우므로 이 경로를 한 번도 밟지 않는다(실측).
//
// 이 검사가 지키는 것:
//  ① ⑥ 기본 화면에 **손으로 치는 날짜 칸이 없다**(되돌아오면 이 차수가 없앤 일이 되살아난 것)
//  ② 체크 = 총 이행기간 **종료일**이 DB `action_completed_at`에 들어간다 (별지 11호가 읽는 그 칸)
//  ③ 해제 = null (⑤ 단계도 함께 열린다)
//  ④ 기간도 계획 종료일도 없으면 **거절한다** — 오늘 날짜로 조용히 떨어지지 않는다
//  ⑤ ⑤ 일괄 적용은 **빈 칸만** 채우고 값이 있는 행은 건드리지 않는다
//
// 실행: npx tsx scripts/test-defect-completion-checkbox.mts   (로컬 dev :3000 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'defect-done-check@erp-test.com'
const D1 = 'ZZ완료체크불량A'        // 빈 행 — ⑥ 체크·⑤ 일괄의 대상
const D2 = 'ZZ완료체크불량B'        // 기간이 이미 있는 행 — 일괄이 **건너뛰어야** 한다
const D3 = 'ZZ완료체크불량C'        // 계획 종료일도 없는 행 — 기간이 없으면 **거절**돼야 한다
const P_START = '2026-08-05'
const P_END = '2026-08-15'
const KEEP_START = '2026-07-01'     // D2가 손으로 정해 둔 일정 — 한 클릭에 덮이면 안 된다
const KEEP_END = '2026-07-20'
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

try {
  userId = await mkUser({ email: EMAIL, name: '완료체크E2E', employeeId: 'E2E-DDC' })
  cust = await mkCustomer({ customer_name: 'ZZ완료체크E2E고객', created_by: userId })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-07-01', status: 'in_progress',
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  const { data: dRows, error: dErr } = await raw.from('inspection_defects').insert([
    { inspection_id: insp, defect_code: 'C-01', defect_name: D1, severity: '보통' },
    { inspection_id: insp, defect_code: 'C-02', defect_name: D2, severity: '보통',
      action_start: KEEP_START, action_end: KEEP_END },
    { inspection_id: insp, defect_code: 'C-03', defect_name: D3, severity: '보통' },
  ]).select('id, defect_name')
  if (dErr) throw new Error(`불량 생성 실패: ${dErr.message}`)
  const idOf = (n: string) =>
    (dRows as Array<{ id: string; defect_name: string }>).find(r => r.defect_name === n)!.id
  await setPeriodRow(`${P_START} ~ ${P_END}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, EMAIL)

  /* ───────────────────── ⑥ 이행완료 ───────────────────── */
  await page.goto(`${BASE}/inspections/${insp}?step=6`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const box1 = page.getByLabel(`${D1} 조치 완료`)
  await box1.waitFor({ state: 'visible' })

  check('1-1 ⑥에 완료 체크박스가 있다', await box1.count() > 0)
  /* 🚨 이 차수의 본론 — 손으로 치는 날짜 칸이 **기본 화면에 없어야** 한다.
     '날짜 수정' 접이식 안의 것은 아직 안 폈으므로 보이지 않는다. */
  check('★ 1-2 ⑥ 기본 화면에 완료일 입력칸이 보이지 않는다',
    (await page.getByLabel(`${D1} 완료일`).count()) === 0)
  check('1-3 총 이행기간이 머리글에 뜬다',
    (await page.getByTestId('defect-grid-period').innerText()).includes(P_END),
    await page.getByTestId('defect-grid-period').innerText())
  check('1-4 아직 미완료 표시', (await page.getByText('불량 조치 0/3').count()) > 0,
    (await page.locator('body').innerText()).match(/불량 조치 \d+\/\d+/)?.[0] ?? '(없음)')

  // ── ★ 체크 한 번 = 기간 종료일이 DB에 들어간다
  await box1.check()
  check('★ 2-1 체크하면 기간 종료일이 DB에 저장된다', await waitCol(D1, 'action_completed_at', P_END),
    `action_completed_at='${await dbCol(D1, 'action_completed_at')}'`)
  /* 🚨 음성 — 시작일이 들어가면 서식에 이행 **시작**일이 「이행조치 일자」로 찍힌다 */
  check('★ 2-2 (음성) 기간 시작일이 아니다', (await dbCol(D1, 'action_completed_at')) !== P_START)
  check('2-3 화면에도 그 날짜가 뜬다', (await page.getByText(P_END).count()) > 0)
  let live = false
  for (let i = 0; i < 60; i++) {
    if (await page.getByText('불량 조치 1/3').count() > 0) { live = true; break }
    await page.waitForTimeout(500)
  }
  check('2-4 새로고침 없이 집계가 1/3로', live,
    (await page.locator('body').innerText()).match(/불량 조치 \d+\/\d+/)?.[0] ?? '(없음)')

  // ── 해제 = null. ⑤ 단계 판정이 이 칸에 걸려 있어 되돌아가야 한다
  await box1.uncheck()
  check('★ 3-1 해제하면 null로 되돌아간다', await waitCol(D1, 'action_completed_at', null),
    `action_completed_at='${await dbCol(D1, 'action_completed_at')}'`)

  /* ───────── ④ 기간이 없으면 거절한다 (오늘로 떨어지지 않는다) ───────── */
  await setPeriodRow('')
  await page.reload()
  await page.waitForLoadState('networkidle').catch(() => {})
  const box3 = page.getByLabel(`${D3} 조치 완료`)
  await box3.waitFor({ state: 'visible' })
  check('4-1 기간이 없으면 무엇을 먼저 할지 안내한다',
    (await page.getByText('총 이행기간이 아직 없습니다').count()) > 0)
  await box3.check()
  await page.waitForTimeout(3000)
  /* 🚨🚨 가장 중요한 단언 — 기간도 계획 종료일도 없는데 날짜가 들어가면, 그 값은 **오늘**이고
     근거 없는 날짜가 별지 11호에 그대로 찍힌다. 화면상으로는 아무 문제가 없어 보인다. */
  check('★ 4-2 기간도 계획 종료일도 없으면 저장되지 않는다',
    (await dbCol(D3, 'action_completed_at')) === null, `값='${await dbCol(D3, 'action_completed_at')}'`)
  check('4-3 거절 사유가 화면에 뜬다', (await page.getByText('총 이행기간이 아직 없습니다').count()) > 0)

  /* ───────────────────── ⑤ — 계획 기간 입력·일괄 적용이 **없다** (2026-09-11 계약 반전) ─────────────
     종전 5-1~5-5는 [빈 칸에 일괄 적용]이 불량 행에 기간을 복사하는 계약이었다. 그 복사 경로가
     통째로 폐지됐다(기간은 ④ 총 이행기간 하나 — 복사본은 ④를 고치면 낡는다). 음성으로 갈아끼운다. */
  await setPeriodRow(`${P_START} ~ ${P_END}`)
  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByTestId('defect-grid-period').waitFor({ state: 'visible' })
  check('★ 5-1 (음성) ⑤에 [빈 칸에 일괄 적용]이 없다', (await page.getByTestId('apply-period-bulk').count()) === 0)
  check('★ 5-2 (음성) ⑤에 불량별 계획 시작일 입력이 없다', (await page.getByLabel(`${D1} 계획 시작일`).count()) === 0)
  check('★ 5-3 (음성) ⑤에 불량별 계획 종료일 입력이 없다', (await page.getByLabel(`${D1} 계획 종료일`).count()) === 0)
  check('5-4 총 이행기간은 머리글에 그대로 보인다',
    (await page.getByTestId('defect-grid-period').innerText()).includes(P_END))
  /* 과거 회차의 손입력 값은 **무손상** — 입력 창구를 없앤 것이지 데이터를 지운 게 아니다 */
  check('★ 5-5 (무손상) 기존 행의 계획 기간 값은 그대로다',
    (await dbCol(D2, 'action_start')) === KEEP_START && (await dbCol(D2, 'action_end')) === KEEP_END,
    `D2=${await dbCol(D2, 'action_start')}~${await dbCol(D2, 'action_end')}`)

  /* ─────── ⑥ 폴백: 기간이 없어도 그 행의 계획 종료일이 있으면 그걸 쓴다 ─────── */
  await setPeriodRow('')
  await page.goto(`${BASE}/inspections/${insp}?step=6`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const box2 = page.getByLabel(`${D2} 조치 완료`)
  await box2.waitFor({ state: 'visible' })
  await box2.check()
  check('★ 6-1 기간이 없으면 그 불량의 계획 종료일로 내려간다',
    await waitCol(D2, 'action_completed_at', KEEP_END), `값='${await dbCol(D2, 'action_completed_at')}'`)

  /* ───── ① 불량 카드 — **이웃 표면**도 같은 규약인가 ─────
     완료일을 쓰는 화면은 둘이다. 한쪽만 체크로 바꾸면 다른 쪽에서 여전히 손으로 치게 되고,
     그렇게 들어간 날짜가 같은 칸에 실려 같은 서식에 인쇄된다. */
  await setPeriodRow(`${P_START} ~ ${P_END}`)
  await page.goto(`${BASE}/inspections/${insp}?step=1`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const card1 = page.locator(`[data-defect-card="${idOf(D1)}"]`)
  await card1.waitFor({ state: 'visible' })
  // 접혀 있으면 편다 — 이미 펴져 있는데 누르면 도로 닫힌다(펴짐 여부로 판정한다)
  if ((await card1.getByLabel(`${D1} 조치 완료`).count()) === 0) {
    await card1.getByText('이행계획·조치 완료').first().click()
  }
  const cardBox = card1.getByLabel(`${D1} 조치 완료`)
  await cardBox.waitFor({ state: 'visible' })
  check('7-1 ① 카드에도 완료 체크박스가 있다', (await cardBox.count()) > 0)
  check('★ 7-2 ① 카드 기본 화면에도 완료일 입력칸이 없다',
    (await card1.getByLabel(`${D1} 완료일`).count()) === 0)
  await cardBox.check()
  check('★ 7-3 ① 카드 체크도 기간 종료일을 DB에 쓴다',
    await waitCol(D1, 'action_completed_at', P_END), `값='${await dbCol(D1, 'action_completed_at')}'`)
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
  summary('⑥ 완료 체크·⑤ 기간입력 폐지 실주행(2026-09-11)')
}
