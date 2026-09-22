/** 달력에서 고객 등록 — **실화면** 확인 (2026-09-22)
 *  실행: npx tsx scripts/_probe-calendar-new-customer.mts   (로컬 dev :3000 + 스테이징 DB)
 *
 *  🚨 **고객을 실제로 만들지 않는다.** 등록까지 가면 계획 항목·점검·단계가 줄줄이 생겨
 *     지우기가 어렵다(그리고 지우다 실데이터를 건드릴 위험이 크다).
 *     여기서 보는 것은 **폼이 달력 위에서 제 기능을 하는가**까지다:
 *       ① 버튼이 뜨고 ② 모달이 열리고 ③ 짚은 날짜가 점검일자에 박혔고
 *       ④ **주소 검색 레이어가 모달 위에 뜨는가**(이게 최대 위험이었다 — 안 뜨면 필수 6칸 중
 *          「주소」를 못 채워 기능 전체가 무용이다)
 *     실제 등록·띠는 R2에서 미래/과거 분기와 함께 픽스처로 본다.
 *
 *  🚨 달력을 클릭해 들어가지 않는다 — 칩은 그 달 표본에 의존한다. 툴바 버튼으로 연다.
 */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = `cal-nc-${Date.now().toString(36)}@test.local`
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '달력등록프로브', employeeId: `E2E-CNC-${Date.now().toString(36)}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  try {
    await login(page, EMAIL)
  } catch (e) {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ')
    throw new Error(`로그인 실패 — URL=${page.url()} · 화면="${body}" · 원인=${String(e).slice(0, 120)}`)
  }

  await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="calendar-new-customer"]').waitFor({ timeout: 60000 })
  check('툴바에 [고객 등록]이 뜬다 (admin 권한)', true)

  await page.locator('[data-testid="calendar-new-customer"]').click()
  await page.locator('[data-testid="calendar-new-customer-modal"]').waitFor({ timeout: 60000 })
  check('모달이 열린다', true)

  /* 폼이 실제로 그려질 때까지 기다린다.
     ⚠ `input[type=date]`의 **보임**을 기다리면 안 된다 — 이 폼의 날짜 칸은 커스텀 컴포넌트라
       네이티브 date는 `aria-hidden`·`opacity-0`인 보조 입력이다(첫 판이 여기서 112번 헛돌았다).
       폼 존재는 **필수 라벨**로 확인하고, 값은 숨은 input에서 `inputValue()`로 읽는다. */
  await page.locator('[data-testid="calendar-new-customer-modal"]')
    .getByText('고객명 (건물명)').first().waitFor({ timeout: 60000 })
  check('★ 지연 로드된 등록 폼이 모달 안에 그려진다', true)

  /* 점검일자 프리필 — 툴바로 열었으므로 **오늘**.
     ⚠ 값은 `input[type=date]`가 아니라 **`type=text`(YYYY-MM-DD)** 쪽에 있다 —
       숨은 date는 달력 팝업 전용이라 늘 비어 있다(`ui/date-input.tsx:84`). 첫 판이 그걸 읽어 빨갰다. */
  const inputs = page.locator('[data-testid="calendar-new-customer-modal"] input[placeholder="YYYY-MM-DD"]')
  const n = await inputs.count()
  const values: string[] = []
  for (let i = 0; i < n; i++) values.push(await inputs.nth(i).inputValue())
  check('★ 점검일자가 오늘로 프리필된다', values.includes(today), `날짜 칸 ${n}개 = ${values.join(' | ')} / 오늘=${today}`)

  // ★ 최대 위험 — 주소 검색 레이어가 모달 위에 뜨는가
  const searchBtn = page.locator('[data-testid="calendar-new-customer-modal"] button', { hasText: '주소 검색' }).first()
  if (await searchBtn.count() === 0) {
    check('★ 주소 검색 버튼이 있다', false, '버튼을 못 찾음(판정 불가)')
  } else {
    await searchBtn.click()
    // 다음 우편번호는 body에 div(z-index 9999)를 붙이고 그 안에 iframe을 임베드한다
    const layer = page.locator('body > div[style*="9999"]')
    await layer.waitFor({ timeout: 60000 })
    check('★ 주소 검색 레이어가 모달 위에 뜬다 (z-index 9999 > 모달 z-60)', true)
    const framed = await page.locator('body > div[style*="9999"] iframe').count()
    check('레이어 안에 우편번호 화면이 임베드된다', framed > 0, `iframe ${framed}개`)
    await page.locator('body > div[style*="9999"] button', { hasText: '닫기' }).first().click()
    await layer.waitFor({ state: 'detached', timeout: 30000 })
    check('레이어를 닫으면 모달이 그대로 남는다',
      (await page.locator('[data-testid="calendar-new-customer-modal"]').count()) === 1)
  }

  // 데이 패널 경로 — 짚은 날짜가 넘어가는지
  await page.locator('[data-testid="calendar-new-customer-modal"] button:has(svg)').last().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  check('모달을 닫고 달력이 남는다', (await page.locator('[data-testid="calendar-new-customer"]').count()) === 1)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
  summary()
}
