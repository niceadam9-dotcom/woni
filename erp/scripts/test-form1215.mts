// §12 결정 반영 E2E — 1.10.2 업무수행 기록(dutyLog) + 1.12~1.15 기록부 4종
// 실행: npx tsx scripts/test-form1215.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'form1215-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '기록부E2E', employeeId: 'E2E-1215' })
  custId = await mkCustomer({ customer_name: '기록부E2E고객', created_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1.10.2 업무수행 기록 (§12-1: ERP 입력 관리) ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.10`)
  await page.waitForSelector('text=1.10.2 소방안전관리자 업무수행 기록')
  check('1.10.2 카드 표시', true)
  await page.locator('div:has(> div > p:text-is("1.10.2 소방안전관리자 업무수행 기록")) button:has-text("기록 추가")').click()
  await page.fill('input[placeholder="일자 (YYYY-MM-DD)"]', '2026-07-23')
  await page.fill('input[placeholder="수행 업무 내용"]', '피난시설 상시 점검')
  await page.fill('input[placeholder="조치사항"]', '비상구 적치물 제거')
  await page.click('button:has-text("서식 1.10 저장")')
  await page.waitForSelector('text=서식 1.10 저장됨')
  const { data: f110 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).single()
  const duty = ((f110?.sections ?? {}) as { dutyLog?: Array<Record<string, string>> }).dutyLog
  check('DB dutyLog 저장', duty?.[0]?.content === '피난시설 상시 점검' && duty?.[0]?.action === '비상구 적치물 제거', JSON.stringify(duty))

  // ── 1.12~1.15 기록부 (§12-3: v1 포함) ──
  await page.waitForSelector('button:has-text("1.12~1.15 기록부")')
  check('목차에 1.12~1.15 항목', true)
  await page.click('button:has-text("1.12~1.15 기록부")')
  await page.waitForSelector('text=1.12 화기취급 감독')
  check('기록부 카드 4종', await page.isVisible('text=1.13 소방시설 공사·정비 기록')
    && await page.isVisible('text=1.14 화재예방 및 홍보') && await page.isVisible('text=1.15 피해 복구'))
  check('URL 딥링크 form=1.12', page.url().includes('form=1.12'))

  // 1.12 화기취급 기록 추가
  await page.locator('div:has(> div > p:text-is("1.12 화기취급 감독")) button:has-text("기록 추가")').click()
  await page.fill('input[placeholder="작업 장소"]', '지하 기계실')
  await page.fill('input[placeholder="작업 내용"]', '배관 용접')
  await page.fill('input[placeholder="감독자"]', '김감독')
  // 1.15 피해 복구 기록 추가
  await page.locator('div:has(> div > p:text-is("1.15 피해 복구")) button:has-text("기록 추가")').click()
  await page.fill('input[placeholder="피해 내용"]', '누수로 감지기 오작동')
  await page.fill('input[placeholder="복구 조치"]', '감지기 2개 교체')
  await page.click('button:has-text("서식 1.12~1.15 저장")')
  await page.waitForSelector('text=서식 1.12~1.15 저장됨')

  const { data: f1215 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).single()
  const s = (f1215?.sections ?? {}) as Record<string, Array<Record<string, string>>>
  check('DB fireworkLog 저장', s.fireworkLog?.[0]?.work === '배관 용접' && s.fireworkLog?.[0]?.supervisor === '김감독', JSON.stringify(s.fireworkLog))
  check('DB recoveryLog 저장', s.recoveryLog?.[0]?.recovery === '감지기 2개 교체')
  check('빈 카드 미저장(promoLog 0행)', (s.promoLog ?? []).length === 0)
  check('dutyLog 보존', (s.dutyLog ?? []).length === 1)

  // 재진입 로드 + 목차 완성도 ✓
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.12`)
  await page.waitForSelector('text=1.12 화기취급 감독')
  check('재진입 값 로드', await page.locator('input[placeholder="작업 내용"]').first().inputValue() === '배관 용접')
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) {
    await raw.from('fire_plan_forms').delete().eq('customer_id', custId)
    await cleanupCustomer(custId)
  }
  if (userId) await delUser(userId)
}
summary()
