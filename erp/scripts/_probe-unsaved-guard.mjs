/** 미저장 이탈 확인창 프로브 (2026-08-10) — 소방계획서_14 #4.
 *  1.11처럼 클릭 전용 입력(월 토글·스테퍼·프리셋)만 있는 서식은 input 이벤트가 없어
 *  캡처 휴리스틱이 dirty를 못 잡던 것을 collectPlanSaveHandlers() 신호로 보강한 뒤 검증.
 *  ① 깨끗한 상태 트리 이동 = 확인창 없음  ② 클릭 변경 후 트리 이동 = 확인창 + [저장하고 이동] 동작(DB 반영)
 *  ③ 클릭 변경 후 고객 탭 전환 = 확인창  ④ 클릭 변경 후 다른 페이지 링크(SPA 라우팅) = 확인창
 *  실행: node scripts/_probe-unsaved-guard.mjs  (dev 서버 localhost:3000 필요)
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-unsaved@test.local'

let userId, custId, browser
try {
  userId = await mkUser({ email: EMAIL, name: 'E2E미저장', employeeId: 'E2E-UN' })
  custId = await mkCustomer({ customer_name: 'E2E미저장고객', created_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  const dialogSave = page.getByTestId('unsaved-nav-save')
  const dialogDiscard = page.getByTestId('unsaved-nav-discard')
  const dialogCancel = page.getByTestId('unsaved-nav-cancel')

  // ── ① 깨끗한 상태에서 트리 이동 — 확인창이 뜨면 안 된다 ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.11`)
  await page.getByText('1.11.1 연간 훈련·교육 계획').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: /1\.10 자체점검/ }).click()
  await page.getByText('1.10.1 연간 자체점검 계획').waitFor({ state: 'visible', timeout: 15000 })
  check('① 깨끗한 트리 이동 — 확인창 없음', !(await dialogDiscard.isVisible()))

  // ── ② 1.11 월 토글(클릭 전용 변경) 후 트리 이동 — 확인창 + [저장하고 이동] ──
  await page.getByRole('button', { name: /1\.11 훈련·교육/ }).click()
  await page.getByText('1.11.1 연간 훈련·교육 계획').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('button', { name: '5', exact: true }).first().click()   // 교육 5월 토글 — input 이벤트 없는 변경
  await page.getByRole('button', { name: /1\.10 자체점검/ }).click()
  await dialogDiscard.waitFor({ state: 'visible', timeout: 10000 })
  check('② 클릭 변경 후 트리 이동 — 확인창 표시', true)
  check('② [저장하고 이동] 버튼 노출 (save 핸들러 등록)', await dialogSave.isVisible())
  await dialogSave.click()
  await page.getByText('1.10.1 연간 자체점검 계획').waitFor({ state: 'visible', timeout: 20000 })
  const saved = await pollDb(async () => {
    const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).maybeSingle()
    return data?.sections?.training?.eduMonths?.includes(5) ? data : null
  })
  check('② [저장하고 이동] → DB 반영 (교육 5월)', !!saved)

  // ── ③ 클릭 변경 후 고객 탭 전환 — 확인창 ──
  await page.getByRole('button', { name: /1\.11 훈련·교육/ }).click()
  await page.getByText('1.11.1 연간 훈련·교육 계획').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('button', { name: '6', exact: true }).first().click()
  await page.getByRole('tab', { name: /기본정보|건물|시설/ }).first().click()
  await dialogDiscard.waitFor({ state: 'visible', timeout: 10000 })
  check('③ 클릭 변경 후 탭 전환 — 확인창 표시', true)
  await dialogCancel.click()   // 머무르기
  check('③ [취소] 후 서식 유지', await page.getByText('1.11.1 연간 훈련·교육 계획').isVisible())

  // ── ④ 클릭 변경 유지 상태에서 다른 페이지 링크 클릭(SPA 라우팅) — 확인창 ──
  const outLink = page.locator('a[href="/customers"], a[href="/dashboard"], a[href="/inspection-plans"]').first()
  if (await outLink.count() > 0) {
    await outLink.click()
    await dialogDiscard.waitFor({ state: 'visible', timeout: 10000 })
    check('④ SPA 링크 이탈 — 확인창 표시', true)
    await dialogDiscard.click()   // 저장하지 않고 이동
    await page.waitForURL(u => !u.pathname.startsWith(`/customers/${custId}`), { timeout: 15000 })
    check('④ [저장하지 않고 이동] → 페이지 이동', true)
  } else {
    check('④ SPA 링크 이탈 (대상 링크 없음 — 수동 확인 필요)', false, '사이드바 링크 셀렉터 불일치')
  }
} catch (e) {
  check('예외 없음', false, String(e?.message ?? e))
} finally {
  if (custId) await raw.from('fire_plan_forms').delete().eq('customer_id', custId).then(() => {}, () => {})
  await cleanupCustomer(custId).catch(() => {})
  await delUser(userId).catch(() => {})
  if (browser) await browser.close().catch(() => {})
}
summary()
