/** 기본 담당자 카드가 직원 관리 화면에 뜨는가 — DOM 실측 (2026-09-15)
 *  ⚠ 전제·대기는 **내가 안 건드린 것**(직원 표의 「검색」)에 건다 — 재려는 카드에 걸면
 *    카드가 없을 때 타임아웃이 단언을 가린다. */
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
const EMAIL = 'default-assignee-e2e@erp-test.com'
let userId = '', browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '기본담당E2E', employeeId: 'E2E-DA', role: 'admin' })
  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(45000)
  await login(page, EMAIL)
  await page.goto(`${BASE}/admin/users`)
  for (let i = 0; i < 60; i++) {
    if ((await page.getByText('직원 계정을 생성하고 관리합니다').count()) > 0) break
    await new Promise(r => setTimeout(r, 300))
  }
  const body = await page.locator('body').innerText()
  check('직원 관리 화면이 렌더됐다 (이 절의 전제)', body.includes('직원 계정을 생성하고 관리합니다'))
  check('기본 담당자 카드가 있다', body.includes('기본 담당자'))
  check('드롭다운이 있다', (await page.locator('[data-testid="default-assignee-select"]').count()) === 1)
  check('적용 버튼이 있다', (await page.locator('[data-testid="default-assignee-apply"]').count()) === 1)
  const disabled = await page.locator('[data-testid="default-assignee-apply"]').isDisabled()
  check('🎯 설정이 비면 적용 버튼이 잠겨 있다', disabled === true)
  const cardText = await page.locator('[data-testid="default-assignee-select"]').locator('xpath=ancestor::div[1]').innerText()
  check('왜 잠겼는지 문구로 말한다', /고르면 적용할 수 있습니다|미배정 고객이 없습니다|건드리지 않습니다/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 90))
  check('「일반」 유형 한정임을 밝힌다', body.includes('「일반」 유형'))
  check('알림을 안 보낸다고 밝힌다', body.includes('배정 알림은 보내지 않습니다'))
} catch (e) {
  console.error('실행 중 오류:', e); check('프로브 완주', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
  summary()
}
