// 3-1.8 E2E — 서식 1.8 업무대행 현황 (자동 읽기 전용)
// 실행: npx tsx scripts/test-form18.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'form18-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '업무대행E2E', employeeId: 'E2E-F18' })
  custId = await mkCustomer({ customer_name: '업무대행E2E고객', created_by: userId, building_grade: '2급' })
  await raw.from('customer_contacts').insert({ customer_id: custId, role: '대표', name: '김대표', phone: '010-9999-8888' })
  const { data: company } = await raw.from('company_profile').select('company_name').limit(1).maybeSingle()

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${custId}?tab=plan&sub=ch1`)
  await page.waitForSelector('button:has-text("1.8 업무대행")')
  check('1.8 서식 칩 표시', true)
  await page.click('button:has-text("1.8 업무대행")')
  await page.waitForSelector('text=1.8 소방안전관리 업무대행 현황')
  check('서식 화면 렌더', true)
  check('자동 표시 안내', await page.isVisible('text=자동 표시'))
  if (company?.company_name) {
    check(`대행업체명(${company.company_name})`, await page.isVisible(`text=${company.company_name}`))
  } else {
    check('업체명 미입력 표시', await page.isVisible('text=미입력'))
  }
  const panel = await page.locator('div:has(> div > p:has-text("1.8 소방안전관리 업무대행 현황"))').first().textContent()
  console.log('  [panel]', (panel ?? '').slice(0, 600))
  check('계약일 자동(2026-01-05)', (panel ?? '').includes('2026-01-05'))
  check('등급 자동(2급)', (panel ?? '').includes('2급'))
  check('관계인 자동(김대표)', (panel ?? '').includes('김대표'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
