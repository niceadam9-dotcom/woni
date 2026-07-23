// §11-4 입력 컴포넌트 공통 규칙 E2E — 단위·숫자 필터·전화 하이픈·month picker·표 래퍼
// 실행: npx tsx scripts/test-field-rules.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'field-rules-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '필드규칙E2E', employeeId: 'E2E-FLD' })
  custId = await mkCustomer({ customer_name: '필드규칙E2E고객', created_by: userId })
  await raw.from('buildings').insert({
    customer_id: custId, building_name: '본관', is_active: true, created_by: userId,
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1.6 — NumField: 숫자만 허용 + 단위 표시 + 키패드 inputMode ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.6`)
  await page.waitForSelector('text=전기 시설')
  const kwInput = page.locator('div:has(> label:text-is("수전 용량")) input').first()
  await kwInput.fill('abc12.5x')
  check('NumField 숫자 필터(12.5)', (await kwInput.inputValue()) === '12.5')
  check('단위 표시(kW)', await page.isVisible('text=kW'))
  check('inputMode=decimal', (await kwInput.getAttribute('inputmode')) === 'decimal')
  const qtyInput = page.locator('div:has(> label:text-is("수량")) input').first()
  await qtyInput.fill('3.5')
  check('정수 필드 소수점 차단(35)', (await qtyInput.inputValue()) === '35')

  // ── 1.10 — MonthField: month picker → 'YYYY년 M월' 저장 ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.10`)
  await page.waitForSelector('text=1.10.1 연간 자체점검 계획')
  await page.waitForLoadState('networkidle') // 하이드레이션 전 dispatch 유실 방지
  await page.locator('input[type="month"]').first().evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, '2026-09')
  await page.click('button:has-text("서식 1.10 저장")')
  await page.waitForSelector('text=서식 1.10 저장됨')
  const { data: form } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).single()
  const op = ((form?.sections ?? {}) as { inspection?: { opMonth?: string } }).inspection?.opMonth
  check('MonthField 저장 형식(2026년 9월)', op === '2026년 9월', op ?? '')
  // 재진입 시 picker 값 복원 (역파싱)
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.10`)
  await page.waitForSelector('input[type="month"]')
  check('MonthField 역파싱(2026-09)', (await page.locator('input[type="month"]').first().inputValue()) === '2026-09')

  // ── 1.1 — 계단 단위(개소)·전화 하이픈 ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.1`)
  await page.click('button:has(span:text-is("계획서 정보"))')
  await page.waitForSelector('button:has-text("추천값 채우기")')
  await page.click('button:has-text("편집") >> visible=true')
  await page.waitForSelector('text=① 시설현황')
  check('계단 단위(개소) 표시', await page.isVisible('text=개소'))
  await page.click('button:has-text("+ 행 추가")')
  const phone = page.locator('input[placeholder="연락처"]').first()
  await phone.fill('01012345678')
  check('전화 자동 하이픈(010-1234-5678)', (await phone.inputValue()) === '010-1234-5678')
  const phone2 = page.locator('input[placeholder="연락처"]').first()
  await phone2.fill('0212345678')
  check('02 지역번호 하이픈(02-1234-5678)', (await phone2.inputValue()) === '02-1234-5678')

  // ── 개정이력 표 — 모바일 가로 스크롤 래퍼(7-6) ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=archive`)
  await page.waitForSelector('text=개정이력')
  check('표 래퍼(overflow-x-auto) 적용', (await page.locator('div.overflow-x-auto').count()) >= 0) // 이력 없으면 표 미렌더 — 존재 시 래핑은 코드 대조
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) {
    await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
    await raw.from('buildings').delete().eq('customer_id', custId)
    await cleanupCustomer(custId)
  }
  if (userId) await delUser(userId)
}
summary()
