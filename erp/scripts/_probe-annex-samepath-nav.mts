// 소방계획서_34 S7-4 — **같은 경로** 이동만 모아서 보는 프로브 (2026-08-29)
//
// 왜 따로 파는가: 같은 pathname으로 ?tab=만 바꾸는 next/link·router.push는 URL만 바꾸고
// **서버를 재렌더하지 않는다**(customers/[id]/page.tsx 헤더 <a> 주석의 2026-08-28 실측).
// 별지가 소방계획서 탭 **안**에 있던 동안에는 form= 동기화 하나만 걸리면 됐지만,
// 최상위 탭으로 갈라진 뒤에는 탭 동기화까지 걸려야 한다 — 실패하면 사용자는 화면에 그대로 남고
// **아무 일도 안 일어난 것처럼 보인다**(에러도, 로그도 없다). 기존 스위트에 이 축이 없다.
//
// 3동선: ① 헤더 상시 버튼(<a> 전체 이동)  ② [⑨ 9호로 돌아가기](goTab 폴백)
//        ③ Ctrl+K 팔레트에서 **지금 보고 있는 그 고객**을 다시 선택(location.assign)
//
// 실행: npx tsx scripts/_probe-annex-samepath-nav.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-samepath-e2e@erp-test.com'
const NAME = '같은경로프로브고객'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

type Pg = Awaited<ReturnType<typeof launch>>['page']

async function activeTab(page: Pg): Promise<string> {
  return page.locator('[role=tab][aria-selected="true"]').first().innerText()
    .then((v: string) => v.replace(/\s+/g, '')).catch(() => '(없음)')
}
/** 별지 본체가 실제로 떴는가 — 탭 aria만 보면 '탭은 바뀌었는데 패널이 비었다'를 놓친다 */
async function annexBodyVisible(page: Pg): Promise<boolean> {
  return page.locator('text=사용승인일 기준으로 ERP가 자동 판정').first()
    .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
}

try {
  userId = await mkUser({ email: EMAIL, name: '같은경로프로브', employeeId: 'E2E-SPN' })
  custId = await mkCustomer({ customer_name: NAME, address: '경기 양평군 테스트로 34', created_by: userId })
  const { data: ins, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = ins!.id
  // 1.4 설비 대장 패널(=[⑨ 9호로 돌아가기] 복귀 바가 사는 곳)은 건물이 있어야 렌더된다
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

  // ══ ① 헤더 상시 버튼 — 고객 상세 **안**에서 누른다 (= 같은 경로) ═══════════
  await page.goto(`${BASE}/customers/${custId}?tab=info`)
  await page.waitForSelector('h1', { timeout: 30000 })
  check('① (전제) 기본정보 탭에서 출발', (await activeTab(page)).includes('기본정보'), await activeTab(page))
  await page.locator('[data-testid="header-plan-link"]').first().click()
  await page.waitForSelector('h1', { timeout: 25000 }).catch(() => {})
  check('① 헤더 버튼 → [별지서식] 탭 활성', (await activeTab(page)).includes('별지서식'), await activeTab(page))
  check('① 별지 본체 렌더', await annexBodyVisible(page))

  // ══ ② [⑨ 9호로 돌아가기] — 별지 → 1.4 → 복귀 왕복 ═══════════════════════════
  // ⚠ 이 버튼은 history.length > 1 이면 router.back(), 아니면 goTab('annex') 폴백을 탄다.
  //   여기서 단언하는 것은 **back 분기**(주 경로)뿐이다 — newPage()+goto는 length>1이 된다.
  //   ⚠ 2026-08-30 정정: 종전 이 자리에 "폴백 분기는 이 도구로 재현할 수 없다"고 적어 두고
  //   S4-4를 미검증으로 남겼었는데, 그건 재보니 **틀렸다**. 실사용의 ctrl-click은 window.open이고
  //   그렇게 열린 컨텍스트는 초기 about:blank가 **교체**돼 length===1로 남는다 — Playwright도 똑같이 연다.
  //   폴백 분기는 _probe-annex-back-fallback.mts가 계측(length===1)까지 붙여 단언한다.
  const ctx = await browser!.newContext({
    viewport: { width: 1500, height: 950 },
    storageState: await page.context().storageState(),
  })
  const fresh: Pg = await ctx.newPage()
  fresh.setDefaultTimeout(20000)
  await fresh.goto(`${BASE}/customers/${custId}?tab=annex`)
  await annexBodyVisible(fresh)
  await fresh.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4&from=report9&insp=${inspId}`)
  await fresh.waitForSelector('h1', { timeout: 30000 })
  const backBtn = fresh.locator('button:has-text("9호로 돌아가기")').first()
  const backSeen = await backBtn.waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
  check('② (전제) from=report9 컨텍스트로 복귀 바가 떴다', backSeen)
  if (backSeen) {
    check('② (전제) 출발은 소방계획서 탭', (await activeTab(fresh)).includes('소방계획서'), await activeTab(fresh))
    await backBtn.click()
    await fresh.waitForTimeout(1500)
    check('② [⑨ 9호로 돌아가기] → [별지서식] 탭 활성', (await activeTab(fresh)).includes('별지서식'),
      await activeTab(fresh))
    check('② 별지 본체 렌더', await annexBodyVisible(fresh))
  }
  await ctx.close()

  // ══ ③ Ctrl+K 팔레트에서 **지금 보고 있는 그 고객**을 다시 선택 ═══════════════
  // 팔레트는 전역 헤더라 CustomerTabs 컨텍스트 밖이다 — router.push로는 탭이 안 바뀐다.
  await page.goto(`${BASE}/customers/${custId}?tab=buildings`)
  await page.waitForSelector('h1', { timeout: 30000 })
  check('③ (전제) 건물·시설 탭에서 출발 — 목적지와 같은 경로',
    (await activeTab(page)).includes('건물'), await activeTab(page))
  await page.keyboard.press('Control+k')
  const searchSel = 'input[placeholder*="고객명을 검색하세요"]'
  const paletteSeen = await page.waitForSelector(searchSel, { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('③ Ctrl+K 팔레트 열림', paletteSeen)
  if (paletteSeen) {
    await page.fill(searchSel, NAME)
    const hit = page.locator(`button:has-text("${NAME} — 문서 현황 열기")`).first()
    const hitSeen = await hit.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false)
    check('③ 그 고객이 후보로 뜬다', hitSeen)
    if (hitSeen) {
      await hit.click()
      await page.waitForSelector('h1', { timeout: 25000 }).catch(() => {})
      await page.waitForTimeout(800)
      check('③ 같은 고객을 다시 골라도 [별지서식] 탭으로 전환', (await activeTab(page)).includes('별지서식'),
        await activeTab(page))
      check('③ 별지 본체 렌더', await annexBodyVisible(page))
    }
  }

  // ══ ④ 대조군 — 별지 → 1.4 [수정]이 전체 이동이라 from=report9 컨텍스트가 살아나는가 ══
  // <Link>(soft nav)로 두면 URL만 바뀌고 스플릿·복귀 바가 안 켜진다. 그 회귀를 여기서 잡는다.
  await page.goto(`${BASE}/customers/${custId}?tab=annex`)
  await annexBodyVisible(page)
  const compose = page.locator('button:has-text("작성")').first()
  if (await compose.count()) {
    await compose.click().catch(() => {})
    await page.waitForTimeout(1200)
    const fix = page.locator('a:has-text("수정")').first()
    if (await fix.count()) {
      const tag = await fix.evaluate((el: Element) => el.tagName)
      check('④ 별지 작성 패널의 [수정]이 <a>(전체 이동)다 — soft nav면 무반응', tag === 'A', tag)
    } else {
      check('④ (건너뜀) 작성 패널 1단 [수정] 링크를 찾지 못함 — 회차 상태 의존', true, 'skipped')
    }
  } else {
    check('④ (건너뜀) 작성 버튼 없음 — 회차 상태 의존', true, 'skipped')
  }
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
