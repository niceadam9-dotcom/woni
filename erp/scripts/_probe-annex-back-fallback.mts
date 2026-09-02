// 소방계획서_34 S4-4 — [⑨ 9호로 돌아가기]의 **goTab 폴백 분기**만 겨냥한 프로브 (2026-08-30)
//
// 왜 따로 파는가: 34.json의 measured.unverified가 이 분기를 '미검증'으로 남겼다. 사유는
//   "Playwright 새 페이지는 about:blank에서 시작해 goto 한 번에 history.length=2가 되므로
//    window.history.length<=1 분기를 재현할 수 없다"
// 였다. 그런데 그건 **측정이 아니라 가정**이다. 실사용의 ctrl-click / target=_blank는
// `window.open(url)`이고, 그렇게 열린 브라우징 컨텍스트는 초기 about:blank가 **교체**되므로
// history.length가 1로 남는다 — Playwright로도 똑같이 열 수 있다.
//
// 그래서 이 프로브는 두 단을 밟는다:
//   ⓪ 계측  — newPage()+goto 와 popup(window.open) 각각의 history.length를 **실제로 재서**
//             위 사유가 맞는지부터 가른다. (여기서 popup이 1이 아니면 '재현 불가'가 참으로 확정된다)
//   ① 단언  — history.length===1인 팝업에서 버튼을 눌러 별지서식 탭으로 전환되는지 본다.
//             length===1이라는 계측 자체가 **router.back() 분기를 타지 않았다는 증거**다.
//   ② 판별  — 폴백 안에도 갈래가 둘이다(tabsShell.goTab vs window.location.assign).
//             누르기 직전 window에 표식을 심어 두고, 누른 뒤 표식이 살아 있으면 soft 전환(goTab),
//             사라졌으면 문서가 갈린 것(location.assign)이다. 설계가 말한 건 goTab 쪽이다.
//   ③ 대조군 — 같은 버튼을 history.length>1인 평범한 페이지에서도 눌러 back 분기도 살아 있음을 본다.
//             한쪽만 보면 '폴백이 되는 게 아니라 원래 아무 데서나 되는 것'과 구별되지 않는다.
//
// 실행: npx tsx scripts/_probe-annex-back-fallback.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-backfallback-e2e@erp-test.com'
const NAME = '폴백분기프로브고객'
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
async function annexBodyVisible(page: Pg): Promise<boolean> {
  return page.locator('text=사용승인일 기준으로 ERP가 자동 판정').first()
    .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
}
async function histLen(page: Pg): Promise<number> {
  return page.evaluate(() => window.history.length).catch(() => -1)
}
/** 1.4 설비 대장의 9호發 복귀 바가 뜰 때까지 */
async function backBtnOf(page: Pg) {
  const btn = page.locator('button:has-text("9호로 돌아가기")').first()
  const seen = await btn.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false)
  return { btn, seen }
}

const FORM14 = (c: string, i: string) => `${BASE}/customers/${c}?tab=plan&form=1.4&from=report9&insp=${i}`

try {
  userId = await mkUser({ email: EMAIL, name: '폴백분기프로브', employeeId: 'E2E-BFB' })
  custId = await mkCustomer({ customer_name: NAME, address: '경기 양평군 폴백로 34', created_by: userId })
  const { data: ins, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = ins!.id
  // 복귀 바는 1.4 설비 대장 패널 안에 산다 — 건물이 없으면 패널 자체가 안 그려진다
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

  // ══ ⓪ 계측 — 34.json이 '재현 불가'라고 적은 근거를 먼저 잰다 ═══════════════════
  const ctx = await browser!.newContext({
    viewport: { width: 1500, height: 950 },
    storageState: await page.context().storageState(),
  })
  const viaGoto: Pg = await ctx.newPage()
  viaGoto.setDefaultTimeout(20000)
  await viaGoto.goto(FORM14(custId, inspId))
  await viaGoto.waitForSelector('h1', { timeout: 30000 })
  const lenGoto = await histLen(viaGoto)
  check('⓪ 계측: newPage()+goto의 history.length (34.json 주장=2)', lenGoto > 0, `length=${lenGoto}`)

  // 팝업 = 실사용의 ctrl-click / target=_blank와 같은 경로
  const opener: Pg = await ctx.newPage()
  await opener.goto(`${BASE}/customers/${custId}?tab=info`)
  await opener.waitForSelector('h1', { timeout: 30000 })
  const [popup] = await Promise.all([
    opener.waitForEvent('popup'),
    opener.evaluate((u: string) => { window.open(u, '_blank') }, FORM14(custId, inspId)),
  ]) as [Pg, unknown]
  popup.setDefaultTimeout(20000)
  await popup.waitForSelector('h1', { timeout: 30000 })
  const { btn, seen } = await backBtnOf(popup)
  check('⓪ (전제) 팝업에서도 from=report9 복귀 바가 떴다', seen)

  // 버튼을 누르기 **직전**에 잰다 — 앱이 마운트 중 router.replace/push를 하면 여기서 드러난다
  const lenPopup = await histLen(popup)
  check('⓪ 계측: popup(window.open)의 history.length', lenPopup > 0, `length=${lenPopup}`)
  const fallbackReachable = lenPopup === 1
  check('⓪ **폴백 분기 도달 가능** — popup의 history.length===1 (34.json의 "재현 불가"는 오판)',
    fallbackReachable, `length=${lenPopup} → ${fallbackReachable ? 'else 분기(goTab)로 간다' : 'back 분기로 샌다 — 재현 불가가 참'}`)

  if (seen && fallbackReachable) {
    // ══ ② 판별용 표식 — goTab(soft)이면 살고, location.assign이면 문서가 갈려 사라진다
    await popup.evaluate(() => { (window as unknown as Record<string, unknown>).__probe34 = 'alive' })
    check('② (전제) 표식을 심었다', await popup.evaluate(() => (window as unknown as Record<string, string>).__probe34) === 'alive')

    check('① (전제) 출발은 소방계획서 탭', (await activeTab(popup)).includes('소방계획서'), await activeTab(popup))
    await btn.click()
    await popup.waitForTimeout(1500)

    check('① [⑨ 9호로 돌아가기] → [별지서식] 탭 활성 (history.length===1 = back 분기 아님)',
      (await activeTab(popup)).includes('별지서식'), await activeTab(popup))
    check('① 별지 본체 렌더', await annexBodyVisible(popup))

    const mark = await popup.evaluate(() => (window as unknown as Record<string, string>).__probe34).catch(() => undefined)
    check('② 폴백은 goTab(soft 전환)이다 — 표식 생존 (location.assign이면 사라진다)',
      mark === 'alive', `__probe34=${String(mark)}`)
  } else if (seen && !fallbackReachable) {
    // 계측이 34.json 손을 들어준 경우: 그대로 기록하고 단언은 건너뛴다(거짓 초록 금지)
    check('① (건너뜀) popup도 length>1이라 폴백 분기에 못 닿는다 — 34.json 기록이 맞다', true,
      `length=${lenPopup}`)
  }
  await ctx.close()

  // ══ ③ 대조군 — history.length>1이면 back 분기도 그대로 산다 ══════════════════
  // 이게 없으면 '폴백이 동작했다'와 '이 버튼은 원래 어디서나 동작한다'가 구별되지 않는다.
  await page.goto(`${BASE}/customers/${custId}?tab=annex`)
  await annexBodyVisible(page)
  await page.goto(FORM14(custId, inspId))
  await page.waitForSelector('h1', { timeout: 30000 })
  const { btn: btn2, seen: seen2 } = await backBtnOf(page)
  check('③ (전제) 복귀 바가 떴다', seen2)
  if (seen2) {
    const len2 = await histLen(page)
    check('③ (전제) 여기는 history.length>1 — back 분기', len2 > 1, `length=${len2}`)
    await btn2.click()
    await page.waitForTimeout(1500)
    check('③ back 분기도 [별지서식] 탭으로 돌아온다', (await activeTab(page)).includes('별지서식'),
      await activeTab(page))
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
