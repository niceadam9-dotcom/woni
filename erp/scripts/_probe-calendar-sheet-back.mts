/** 점검달력 ↔ 점검표 입력 **복귀 왕복** 프로브 (2026-09-21 사용자 요청).
 *
 *  요청: 「점검달력 → 단계 클릭 사이드 화면 → 점검표 입력」으로 들어간 뒤 [←]를 누르면
 *        **직전 화면(달력 + 그 사이드 패널이 열린 상태)**으로 돌아와야 한다.
 *        종전엔 `?from=`이 없어 고정 목적지(점검 상세)로 떨어졌고, 패널 상태는 로컬 state라 유실됐다.
 *
 *  붙드는 것:
 *   ① 달력에서 단계를 누르면 사이드 패널이 열리고 **주소에 `?insp=`가 박힌다**
 *      (이게 없으면 복귀 주소가 «어느 패널»인지 가리킬 수 없다)
 *   ② [점검표 입력] 링크가 **복귀 주소를 싣는다**(`from=`에 `insp`가 들어 있다)
 *   ③ 점검표 입력 화면의 [←]가 **달력으로** 되돌린다(점검 상세가 아니라)
 *   ④ 돌아온 달력에서 **그 사이드 패널이 다시 열려 있다** — 이 요청의 알맹이
 *   ⑤ **브라우저 뒤로가기**로도 같은 상태가 된다([←]만 살고 back이 죽으면 어긋난 화면이다)
 *   ⑥ (음성) `from=` 없이 곧장 들어가면 [←]는 종전대로 점검 상세로 간다 — 다른 진입 경로를 안 깼다
 *
 *  실행: npx tsx scripts/_probe-calendar-sheet-back.mts   (로컬 dev + 스테이징 DB)
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'cal-back-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

try {
  userId = await mkUser({ email: EMAIL, name: '달력복귀프로브', employeeId: 'E2E-CALB' })
  custId = await mkCustomer({ customer_name: '달력복귀프로브고객', address: '경기 양평군 테스트로 87', created_by: userId })
  const { data: ins, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = ins.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  /* 🚨 [←]는 필수 미입력이 남아 있으면 `window.confirm`으로 되묻는다(39 S2-1).
     Playwright의 기본값은 **dismiss**라 그냥 두면 `preventDefault()`가 걸려 이동이 안 된다 —
     제품이 멀쩡한데 프로브가 빨개진다(실측으로 잡혔다). 사람이 [확인]을 누르는 쪽을 흉내 낸다.
     ⚠ 이 승인은 «이탈해도 되는가»에만 쓰인다. 미입력 경고 자체가 뜨는지는 이 프로브의 축이 아니다. */
  page.on('dialog', (d: { accept: () => Promise<void> }) => { void d.accept() })
  await login(page, EMAIL)

  // ══ ① 달력 → 단계 클릭 → 사이드 패널 + 주소에 ?insp= ═════════════════════
  await page.goto(`${BASE}/inspections/calendar`)
  await page.waitForSelector('text=/점검 달력|달력/', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)
  // 이 회차의 단계 행을 달력에서 찾아 연다 — 고객명으로 좁힌다(달력엔 남의 일정도 많다)
  const chip = page.locator(`text=달력복귀프로브고객`).first()
  const chipSeen = await chip.waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
  check('(전제) 달력에 이 회차가 보인다', chipSeen)
  if (!chipSeen) throw new Error('달력에 회차가 없다 — 이후 단언이 공허하다')
  await chip.click()
  await page.waitForTimeout(1200)

  const inputLink = page.locator('[data-testid="calendar-step-input"]').first()
  const linkSeen = await inputLink.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false)
  check('① 단계를 누르면 사이드 패널에 [점검표 입력]이 뜬다', linkSeen)
  if (!linkSeen) throw new Error('사이드 패널을 못 열었다')
  check('① 주소에 ?insp= 가 박힌다 (복귀 주소의 원천)',
    page.url().includes(`insp=${inspId}`), page.url())

  // ══ ② 링크가 복귀 주소를 싣는가 ═══════════════════════════════════════════
  const href = (await inputLink.getAttribute('href')) ?? ''
  // 🚨 `includes('from=')`로 물으면 안 된다 — `xfrom=`·`myfrom=` 같은 **부분 문자열**이 통과한다
  //    (변이 M1이 실제로 뚫었다: 쿼리 이름을 바꿔 기능을 죽였는데 초록이었다).
  //    쿼리 경계(`?`/`&`)까지 함께 물어야 「그 이름의 쿼리」를 잰 것이 된다.
  check('② [점검표 입력] 링크가 from= 을 싣는다', /[?&]from=/.test(href), href.slice(0, 160))
  check('② 그 from= 이 **패널까지 담긴** 달력 주소다(insp 포함)',
    decodeURIComponent(href).includes('/inspections/calendar') && decodeURIComponent(href).includes(`insp=${inspId}`),
    decodeURIComponent(href).slice(0, 200))

  // ══ ③ 점검표 입력 → [←] → 달력 ════════════════════════════════════════════
  await inputLink.click()
  await page.waitForURL(u => u.pathname.includes('/sheet'), { timeout: 30000 })
  // 🚨 시트 자동열기(`?sheet=auto` → 실제 코드)가 **끝난 뒤** 누른다. 적재 중에 누르면
  //    늦게 도착한 replaceState와 경쟁해 계측기가 스스로 거짓 빨강을 만든다(실측).
  await page.waitForURL(u => !u.search.includes('sheet=auto'), { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(600)
  check('③ (전제) 점검표 입력 화면에 도착', page.url().includes('/sheet'), page.url())
  const back = page.locator('[data-testid="sheet-entry-back"]')
  await back.waitFor({ state: 'visible', timeout: 25000 })
  check('③ [←]의 목적지가 달력이다(점검 상세가 아니다)',
    ((await back.getAttribute('href')) ?? '').includes('/inspections/calendar'),
    (await back.getAttribute('href')) ?? '')
  await back.click()
  await page.waitForURL(u => u.pathname.includes('/inspections/calendar'), { timeout: 30000 })

  // ══ ④ 돌아온 달력에 그 패널이 다시 열려 있는가 — 이 요청의 알맹이 ══════════
  const reopened = await page.locator('[data-testid="calendar-step-input"]').first()
    .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
  check('④ 돌아오니 그 사이드 패널이 다시 열려 있다', reopened, page.url())
  check('④ 주소에도 그 회차가 남아 있다', page.url().includes(`insp=${inspId}`), page.url())

  // ══ ⑤ 브라우저 뒤로가기로도 같은 상태인가 ═══════════════════════════════════
  await page.goto(`${BASE}/inspections/calendar?insp=${inspId}`)
  await page.locator('[data-testid="calendar-step-input"]').first().waitFor({ state: 'visible', timeout: 25000 })
  await page.locator('[data-testid="calendar-step-input"]').first().click()
  await page.waitForURL(u => u.pathname.includes('/sheet'), { timeout: 30000 })
  // 🚨 시트 자동열기(`?sheet=auto` → 실제 코드)가 **끝난 뒤** 누른다. 적재 중에 누르면
  //    늦게 도착한 replaceState와 경쟁해 계측기가 스스로 거짓 빨강을 만든다(실측).
  await page.waitForURL(u => !u.search.includes('sheet=auto'), { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(600)
  await page.goBack()
  await page.waitForURL(u => u.pathname.includes('/inspections/calendar'), { timeout: 30000 })
  const backOk = await page.locator('[data-testid="calendar-step-input"]').first()
    .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
  check('⑤ 브라우저 뒤로가기로도 패널이 열려 있다([←]만 살고 back이 죽지 않는다)', backOk, page.url())

  /* ══ ⑥ (대조군) from= 없이 들어가면 **기본 귀소처**로 ═══════════════════════
     ⚠ 2026-09-21 갈아끼움. 종전 이 자리는 「점검 상세(`/inspections/{id}`)로 간다」였는데,
       같은 날 타 세션이 E-2·B-4로 **기본 귀소처를 점검 달력으로 통일**했다(점검표·작업대·설비 셋이
       같은 곳으로 돌아간다 — 달력이 일감을 내주는 화면이고 끝나면 거기서 다음 일정을 본다).
       구계약은 지우지 않고 **반대 방향으로 바꾼다** — 여기가 지키는 뜻은 그대로다:
       「`from=`이 있으면 그 자리로, 없으면 **정해진 기본값**으로」이고, 내 변경이 그 기본값을
       건드리지 않았음을 문다. 이 대조군이 없으면 ③이 「[←]는 늘 달력으로」라는
       헐거운 계약을 통과시킨다(from을 무시해도 초록이 된다). */
  await page.goto(`${BASE}/inspections/${inspId}/sheet`)
  const back2 = page.locator('[data-testid="sheet-entry-back"]')
  await back2.waitFor({ state: 'visible', timeout: 25000 })
  const h2 = (await back2.getAttribute('href')) ?? ''
  check('⑥ (대조군) from= 없으면 기본 귀소처(달력)로 — 내 변경이 기본값을 안 건드렸다',
    h2 === '/inspections/calendar', h2)
  check('⑥ 그 기본값에는 insp가 없다 — from이 있을 때만 패널이 실린다',
    !h2.includes('insp='), h2)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
