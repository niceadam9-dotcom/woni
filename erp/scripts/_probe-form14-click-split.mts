// 1.4 클릭 의미 분리 검증 (커밋 3c528fc) — ☑=설치 토글 / 설비명=설비 대장 열기(체크 무변동).
// test-plan-tab은 1.1 구간의 선행 결함에 막혀 1.4까지 도달하지 못한다. 이 프로브는 그 앞을 건너뛰고
// 바뀐 동작만 겨눈다. 실행: npx tsx scripts/_probe-form14-click-split.mts
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'form14-split-e2e@erp-test.com'
let userId = ''
let customerId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const CELL = '옥내소화전설비'          // 일반 셀
const FIRE_PARENT = '소화기구 및 자동소화장치'  // 하위를 가진 부모(별도 렌더 경로)
const EVAC_PARENT = '피난기구'          // 해제가 파괴적인 부모(별도 렌더 경로)

try {
  userId = await mkUser({ email: EMAIL, name: '분리E2E', employeeId: 'E2E-F14SPLIT' })
  customerId = await mkCustomer({ customer_name: '분리E2E고객', address: '경기 양평군 테스트로 9', created_by: userId })
  const { error: bErr } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId,
    floors_above: 3, floors_below: 1,
  })
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')

  const closePanel = async () => {
    await page.click('button[aria-label="닫기"]').catch(() => {})
    await page.waitForTimeout(300)
  }
  const pressed = (code: string) =>
    page.locator(`[data-testid="form14-check-${code}"]`).getAttribute('aria-pressed')
  const panelOpen = () => page.isVisible('button[aria-label="닫기"]')

  // ── 0) 표적이 실재하는가 (없으면 아래 단언이 전부 헛돈다) ──
  check('체크박스 표적 존재', await page.locator(`[data-testid="form14-check-${CELL}"]`).count() === 1)
  check('설비명 표적 존재', await page.locator(`[data-testid="form14-ledger-${CELL}"]`).count() === 1)
  check('안내문 — 새 조작 규약 노출', await page.isVisible('text=설비명'))

  // ── 1) ☑ 클릭 = 설치 토글 (종전 동작 보존) ──
  check('초기 미체크', await pressed(CELL) === 'false', `aria-pressed=${await pressed(CELL)}`)
  await page.click(`[data-testid="form14-check-${CELL}"]`)
  check('☑ 클릭 → 체크됨', await pressed(CELL) === 'true', `aria-pressed=${await pressed(CELL)}`)
  check('체크 시 대장 패널 자동 열림(종전 동작 유지)', await panelOpen())
  await closePanel()

  // ── 2) 핵심 회귀 — 체크된 설비의 이름을 눌러도 체크가 풀리지 않는다 ──
  const before = await pressed(CELL)
  await page.click(`[data-testid="form14-ledger-${CELL}"]`)
  const after = await pressed(CELL)
  check('설비명 클릭 → 체크 무변동 (이 화면이 생긴 이유)', before === 'true' && after === 'true',
    `before=${before} after=${after}`)
  check('설비명 클릭 → 대장 패널 열림', await panelOpen())
  await closePanel()

  // ── 3) 미설치 설비의 이름을 눌러도 체크되지 않는다 (반대 방향) ──
  const off = FIRE_PARENT
  check(`${off} 초기 미체크`, await pressed(off) === 'false')
  await page.click(`[data-testid="form14-ledger-${off}"]`)
  check('미설치 설비명 클릭 → 여전히 미체크(대장만 열림)', await pressed(off) === 'false',
    `aria-pressed=${await pressed(off)}`)
  check('미설치 설비명 클릭 → 대장 패널 열림', await panelOpen())
  await closePanel()

  // ── 4) 부모 행 2종도 같은 규약인가 (이웃 호출부 — 한 곳만 고치면 여기서 샌다) ──
  for (const parent of [FIRE_PARENT, EVAC_PARENT]) {
    await page.click(`[data-testid="form14-check-${parent}"]`)
    check(`${parent} — ☑ 클릭으로 체크됨`, await pressed(parent) === 'true')
    await closePanel()
    const b = await pressed(parent)
    await page.click(`[data-testid="form14-ledger-${parent}"]`)
    const a = await pressed(parent)
    check(`${parent} — 설비명 클릭해도 체크 무변동`, b === 'true' && a === 'true', `before=${b} after=${a}`)
    await closePanel()
  }

  // ── 5) 해제 경로는 살아 있는가 (분리하느라 토글을 죽이지 않았는지) ──
  await page.click(`[data-testid="form14-check-${CELL}"]`)
  check('☑ 재클릭 → 해제됨', await pressed(CELL) === 'false', `aria-pressed=${await pressed(CELL)}`)
} finally {
  if (browser) await browser.close()
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
  summary()
}
