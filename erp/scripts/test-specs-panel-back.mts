// 설비 대장 패널 — **브라우저 뒤로가기로 닫힌다** (2026-09-11 사용자 보고)
//
// 무엇이 깨졌었나: 1.4의 [설비 대장 — 세부 제원] 패널은 열림이 순수 React 상태라 URL에 흔적이
// 없었다. 패널은 화면을 최대 96vw까지 덮는데(헤더 ←는 오버레이에 가려 못 누른다) 그 상태에서
// 뒤로가기를 누르면 패널이 아니라 **고객 상세를 통째로 떠나 고객 목록으로 나갔다**.
//
// 이 검사가 붙드는 계약은 셋이고, 셋이 서로를 지탱한다:
//   ① 뒤로가기 = 패널만 닫기      — 고객 상세에 남아야 한다(종전 결함의 직격)
//   ② 여는 pushState는 **같은 URL** — URL이 바뀌면 라우터가 서버를 다시 불러 화면이 깜빡인다
//   ③ X로 닫으면 찌꺼기가 없다     — 되감지 않으면 여닫은 횟수만큼 뒤로가기를 눌러야 페이지를 벗어난다
//
// ⚠ ④ 대조군이 없으면 ①은 공허하다 — '패널을 안 열어도 뒤로가기가 원래 안 먹는 것'과 구별되지
//   않기 때문이다. 그래서 패널을 한 번도 열지 않은 같은 화면에서 뒤로가기가 **실제로 나가는지**를
//   먼저 재고, 그 위에서 ①을 묻는다.
//
// 실행: npx tsx scripts/test-specs-panel-back.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'specs-panel-back-e2e@erp-test.com'
const NAME = '설비대장뒤로가기고객'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

type Pg = Awaited<ReturnType<typeof launch>>['page']

/** 패널 열림 신호 — 푸터 저장바는 `canManage && specsOpen`일 때만 렌더된다(plan-form14.tsx).
 *  패널 자체는 항상 마운트돼 CSS로만 밀려나므로 가시성으로는 못 가른다. */
async function panelOpen(page: Pg): Promise<boolean> {
  return (await page.locator('[data-testid="specs-footer-status"]').count()) > 0
}
async function waitPanel(page: Pg, want: boolean, ms = 8000): Promise<boolean> {
  const start = Date.now()
  for (;;) {
    if (await panelOpen(page) === want) return true
    if (Date.now() - start > ms) return false
    await page.waitForTimeout(150)
  }
}
async function loc(page: Pg): Promise<string> {
  return page.evaluate(() => window.location.pathname + window.location.search)
}
async function histLen(page: Pg): Promise<number> {
  return page.evaluate(() => window.history.length)
}
async function activeTab(page: Pg): Promise<string> {
  return page.locator('[role=tab][aria-selected="true"]').first().innerText()
    .then((v: string) => v.replace(/\s+/g, '')).catch(() => '(없음)')
}

try {
  userId = await mkUser({ email: EMAIL, name: '설비대장뒤로가기', employeeId: 'E2E-SPB' })
  custId = await mkCustomer({ customer_name: NAME, address: '경기 양평군 뒤로로 11', created_by: userId })
  // 1.4는 건물 축으로 그려진다 — 건물이 없으면 [설비 대장] 버튼 자체가 없다
  const { data: bld, error: bErr } = await raw.from('buildings')
    .insert({ customer_id: custId, is_active: true, created_by: userId, building_name: '본관', purpose: '근린생활시설' })
    .select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  await raw.from('fire_facilities').insert({
    building_id: bld!.id, category: '소화설비', facility_code: '옥내소화전설비', installed: true, detail: { note: 'E2E 픽스처' },
  })

  const l = await launch()
  browser = l.browser
  const page: Pg = l.page
  await login(page, EMAIL)

  const LIST = '/customers'
  const FORM14 = `/customers/${custId}?tab=plan&form=1.4`
  const openBtn = () => page.locator('[data-testid="specs-open"]').first()

  /** 고객 목록 → 1.4 화면. 히스토리를 [목록, 1.4]로 만들어 놓는다(뒤로가기의 '바깥'이 목록이다) */
  async function goFresh() {
    await page.goto(`${BASE}${LIST}`)
    await page.waitForSelector('h1', { timeout: 30000 })
    await page.goto(`${BASE}${FORM14}`)
    await page.waitForSelector('h1', { timeout: 30000 })
    await openBtn().waitFor({ state: 'visible', timeout: 30000 })
  }

  // ══ ⓪ 전제 — 버튼이 실재하고 패널은 닫혀 있다 (여기가 무너지면 아래는 전부 공허하다) ══
  await goFresh()
  check('⓪ (전제) 1.4에 [설비 대장] 버튼이 있다', await openBtn().count() > 0)
  check('⓪ (전제) 출발은 소방계획서 탭', (await activeTab(page)).includes('소방계획서'), await activeTab(page))
  check('⓪ (전제) 패널은 닫힌 상태로 시작', !(await panelOpen(page)))

  // ══ ④ 대조군 먼저 — 패널을 안 연 같은 화면에서 뒤로가기는 **실제로 고객 목록으로 나간다** ══
  //    ①이 '뒤로가기가 원래 아무 일도 안 한다'로 통과하는 걸 막는 유일한 장치다.
  await page.goBack()
  await page.waitForSelector('h1', { timeout: 30000 })
  const outLoc = await loc(page)
  check('④ 대조군: 패널을 안 열면 뒤로가기는 고객 목록으로 나간다',
    outLoc.startsWith(LIST) && !outLoc.startsWith(`${LIST}/${custId}`), `도착=${outLoc}`)

  // ══ ①② 패널을 열고 뒤로가기 ═══════════════════════════════════════════════
  await goFresh()
  const urlBefore = await loc(page)
  const lenBefore = await histLen(page)
  await openBtn().click()
  check('① (전제) 클릭으로 패널이 열렸다', await waitPanel(page, true))

  const urlOpen = await loc(page)
  check('② 여는 pushState는 URL을 바꾸지 않는다 (바뀌면 라우터가 서버를 다시 부른다)',
    urlOpen === urlBefore, `열기 전=${urlBefore} / 열린 뒤=${urlOpen}`)
  const lenOpen = await histLen(page)
  check('② 히스토리 항목이 정확히 하나 쌓였다', lenOpen === lenBefore + 1,
    `${lenBefore} → ${lenOpen}`)

  await page.goBack()
  const closed = await waitPanel(page, false)
  check('① 뒤로가기로 패널이 닫힌다', closed)
  const backLoc = await loc(page)
  check('① **뒤로가기해도 고객 상세에 남는다** — 종전엔 여기서 고객 목록으로 나갔다',
    backLoc.startsWith(`${LIST}/${custId}`), `도착=${backLoc}`)
  check('① 소방계획서 탭이 그대로 활성', (await activeTab(page)).includes('소방계획서'), await activeTab(page))

  // ══ ③ X로 닫으면 히스토리에 찌꺼기가 **누적되지** 않는다 ═══════════════════
  //    되감지 않으면 여닫은 횟수만큼 뒤로가기를 눌러야 화면을 벗어난다.
  //
  //    ⚠ 자를 잘못 들면 안 된다 — `history.length`는 **앞으로 갈 항목까지** 센다. back()으로
  //      되감아도 방금 쌓은 항목은 forward 자리에 남으므로 길이는 +1에서 멈춘다(브라우저 규격이지
  //      우리 결함이 아니다. 다음 pushState가 그 forward 항목을 덮어쓴다). 그래서 '그대로인가'가
  //      아니라 **'횟수에 비례해 자라는가'**를 묻는다 — 되감기가 빠지면 1회차 대비 +2가 된다.
  await goFresh()
  const lenR0 = await histLen(page)
  let cyclesOk = true
  const cycle = async (i: number) => {
    await openBtn().click()
    if (!(await waitPanel(page, true))) { check(`③ (전제) ${i}회차 열림`, false); cyclesOk = false; return }
    await page.locator('[data-testid="specs-close"]').first().click()
    if (!(await waitPanel(page, false))) { check(`③ (전제) ${i}회차 닫힘`, false); cyclesOk = false }
  }
  await cycle(1)
  const lenR1 = await histLen(page)
  await cycle(2)
  await cycle(3)
  const lenR3 = await histLen(page)
  check('③ (전제) 세 번 모두 여닫혔다', cyclesOk)
  check('③ 여닫기 3회가 1회보다 히스토리를 더 쌓지 않는다 (되감기가 빠지면 +2)',
    lenR3 === lenR1, `1회차=${lenR1} / 3회차=${lenR3} (열기 전=${lenR0})`)

  await page.goBack()
  await page.waitForSelector('h1', { timeout: 30000 })
  const afterResidue = await loc(page)
  check('③ 여닫은 뒤 뒤로가기 **한 번**이면 고객 목록에 닿는다 (찌꺼기 0)',
    afterResidue.startsWith(LIST) && !afterResidue.startsWith(`${LIST}/${custId}`),
    `도착=${afterResidue} (찌꺼기가 남으면 여기서 1.4 화면에 머문다)`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) {
    const { data: bs } = await raw.from('buildings').select('id').eq('customer_id', custId)
    for (const b of ((bs ?? []) as Array<{ id: string }>)) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', custId)
  }
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
