/** 주소를 **직접 입력**해도 건물정보가 채워지는가 — 실화면 (2026-10-06 사용자 요청)
 *  「주소 입력할 때 주소검색하지 않고 직접입력하면 건물정보가 나올 수 있게」
 *  실행: TEST_BASE_URL=http://localhost:3000 npx tsx scripts/_probe-typed-address-ledger.mts  (로컬 dev + 스테이징 DB)
 *
 *  갈래 A — 실재 주소를 쳐 넣고 칸을 벗어난다 → 지번·우편번호가 서고, 건축물대장 값이 칸에 들어온다
 *  갈래 B — 없는 주소 → 「찾지 못했습니다 — [주소 검색]」 안내, 앞 주소의 지번이 남지 않는다
 *  갈래 C — 같은 글자로 다시 벗어나도 재조회하지 않는다(안내가 그대로)
 *  고객을 **저장하지 않는다** — 임시 로그인 사용자만 만들고 지운다.
 */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const STAMP = Date.now().toString(36)
const EMAIL = `typed-addr-${STAMP}@test.local`
// 서울시청 — 대장·도로명 둘 다 확실히 있는 주소
const REAL = '서울특별시 중구 세종대로 110'

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '주소직접입력프로브', employeeId: `E2E-TA-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/new`, { waitUntil: 'domcontentloaded' })
  await page.getByText('고객명 (건물명)').first().waitFor()

  const addr = page.locator('#new-address')
  const meta = page.locator('[data-testid="new-address-meta"]')
  const noteText = async () => (await page.locator('[data-testid="new-group-info"]').innerText())

  // ── A ──
  await addr.fill(REAL)
  await page.locator('#new-customer-name').click()   // 칸을 벗어난다(blur)
  const ok = await page.waitForFunction(
    () => /건축물대장 자동 조회 완료|건물정보를 찾지 못했습니다|건축물대장:/.test(document.body.innerText),
    undefined, { timeout: 45000 }).then(() => true).catch(() => false)
  const t = await noteText()
  check('★ A 직접 입력 후 칸을 벗어나면 건축물대장 조회가 끝난다', ok && /건축물대장 자동 조회 완료/.test(t),
    (t.match(/(건축물대장[^\n]*|건물정보를 찾지[^\n]*)/) ?? [''])[0].slice(0, 160))
  check('A 어느 도로명으로 맞췄는지 말한다', /도로명 「[^」]+」 기준/.test(t))
  check('A 칸의 글자는 사용자가 친 그대로다', (await addr.inputValue()) === REAL, await addr.inputValue())
  const metaText = (await meta.count()) ? await meta.innerText() : ''
  check('★ A 우편번호·지번이 선다', /우편번호 \d{5}/.test(metaText) && /지번 /.test(metaText), metaText)
  const approval = await page.locator('#new-use-approval').inputValue()
  check('★ A 사용승인일이 대장 값으로 채워진다', /^\d{4}-\d{2}-\d{2}$/.test(approval), approval)
  const purpose = await page.locator('[aria-label="건물용도"]').inputValue().catch(() => '')
  check('A 건물용도가 채워진다', purpose.trim().length > 0, purpose)

  // ── C — 같은 글자로 다시 벗어나면 재조회하지 않는다 ──
  await addr.click(); await page.locator('#new-customer-name').click()
  await page.waitForTimeout(800)
  check('C 같은 주소로 다시 벗어나도 「찾는 중」으로 되돌아가지 않는다', !/주소로 건물정보를 찾는 중/.test(await noteText()))

  // ── B — 없는 주소 ──
  await addr.fill(`없는도 없는시 ${STAMP}로 99999`)
  await page.locator('#new-customer-name').click()
  const miss = await page.waitForFunction(() => /건물정보를 찾지 못했습니다/.test(document.body.innerText), undefined, { timeout: 30000 })
    .then(() => true).catch(() => false)
  check('★ B 없는 주소면 「찾지 못했습니다 — [주소 검색]」을 안내한다', miss, (await noteText()).match(/건물정보[^\n]*/)?.[0] ?? '')
  const metaB = (await meta.count()) ? await meta.innerText() : ''
  check('★ B 앞 주소의 지번·우편번호가 남지 않는다 (엉뚱한 건물로 저장 방지)', !/지번 |우편번호 /.test(metaB), metaB || '(없음)')
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
  summary()
}
