/** "다른 고객에서 복사" 전면 삭제 프로브 (2026-08-10, 소방계획서_14 #10 A안) —
 *  1.1·1.5·1.6·1.11 서식이 정상 렌더되고, 복사 칩·버튼이 완전히 사라졌으며,
 *  존치 대상([추천값 채우기]·용도 기본값·표준 패턴)은 그대로인지 확인.
 *  실행: node scripts/_probe-copy-removal.mjs  (dev 서버 localhost:3000 필요)
 */
import { BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-copyrm@test.local'
const COPY_TEXT = '다른 고객에서 복사'

let userId, custId, browser
try {
  userId = await mkUser({ email: EMAIL, name: 'E2E복사삭제', employeeId: 'E2E-CR' })
  custId = await mkCustomer({ customer_name: 'E2E복사삭제고객', created_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // 1.1 — 계획서 정보 패널: 복사 버튼 삭제 + [추천값 채우기] 존치
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.1`)
  await page.getByRole('button', { name: '추천값 채우기' }).waitFor({ state: 'visible', timeout: 30000 })
  check('1.1 [추천값 채우기] 존치', true)
  check('1.1 복사 버튼 삭제', (await page.getByText(COPY_TEXT).count()) === 0)

  // 1.5 — 칩 삭제 + 용도 기본값 프리셋 카드 정상 렌더
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.5`)
  await page.getByText('1.5.1 피난·방화시설 일반현황').waitFor({ state: 'visible', timeout: 30000 })
  check('1.5 렌더 정상', true)
  check('1.5 복사 칩 삭제', (await page.getByText(COPY_TEXT).count()) === 0)

  // 1.6 — 칩 삭제 + 전기 시설 카드 정상 렌더
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.6`)
  await page.getByText('전기 시설').waitFor({ state: 'visible', timeout: 30000 })
  check('1.6 렌더 정상', true)
  check('1.6 복사 칩 삭제', (await page.getByText(COPY_TEXT).count()) === 0)

  // 1.11 — 칩 삭제 + [표준 패턴] 존치
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.11`)
  await page.getByText('1.11.1 연간 훈련·교육 계획').waitFor({ state: 'visible', timeout: 30000 })
  check('1.11 렌더 정상', true)
  check('1.11 [표준 패턴] 존치', await page.getByRole('button', { name: /표준 패턴/ }).isVisible())
  check('1.11 복사 칩 삭제', (await page.getByText(COPY_TEXT).count()) === 0)
} catch (e) {
  check('예외 없음', false, String(e?.message ?? e))
} finally {
  await cleanupCustomer(custId).catch(() => {})
  await delUser(userId).catch(() => {})
  if (browser) await browser.close().catch(() => {})
}
summary()
