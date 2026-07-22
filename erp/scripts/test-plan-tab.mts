// 소방계획서 탭 골격(4-1) E2E — 소방계획서_4.md §8-1 실동작 검증
// 실행: npx tsx scripts/test-plan-tab.mts  (로컬 dev 서버 + 스테이징 DB, 096 적용 필요)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'plan-tab-e2e@erp-test.com'
let userId = ''
let customerId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '플랜탭E2E', employeeId: 'E2E-PLANTAB' })
  customerId = await mkCustomer({ customer_name: '플랜탭E2E고객', address: '경기 양평군 테스트로 1', created_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // 1) 탭 진입 — 생성 바 + 서브탭 골격
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.waitForSelector('text=HWP 생성')
  check('생성 바 — [HWP 생성] 버튼', await page.isVisible('button:has-text("HWP 생성")'))
  check('생성 바 — [PDF 생성] 버튼', await page.isVisible('button:has-text("PDF 생성")'))
  check('생성 바 — [데이터 시트] 버튼', await page.isVisible('button:has-text("데이터 시트")'))
  check('기본 진입 = 개정이력·보관 (개정이력 패널 표시)', await page.isVisible('text=개정이력'))
  check('개정이력 빈 상태 안내', await page.isVisible('text=생성 이력이 없습니다'))
  check('2장 서브탭 비활성(준비 중)', await page.isVisible('button:disabled:has-text("2장 자위소방대")'))
  check('3장 서브탭 비활성(준비 중)', await page.isVisible('button:disabled:has-text("3장 피난계획")'))

  // 2) 개정이력 입력 저장 → fire_plan_forms(096) 반영
  await page.fill('input[placeholder*="소방계획서 작성"]', '개정 E2E 검증')
  await page.click('button:has-text("저장")')
  await page.waitForSelector('text=개정이력 입력 저장됨')
  check('저장 성공 메시지', true)
  const { data: form } = await raw.from('fire_plan_forms')
    .select('sections, updated_by').eq('customer_id', customerId).maybeSingle()
  const rev = (form?.sections as { revision?: { revisionNote?: string } } | null)?.revision
  check('DB fire_plan_forms.sections.revision 저장', rev?.revisionNote === '개정 E2E 검증', JSON.stringify(form))
  check('updated_by 기록', form?.updated_by === userId)

  // 3) 1장 서브탭 — 서식 칩 + 1.1 패널
  await page.click('button:has-text("1장 소방안전관리계획")')
  await page.waitForSelector('text=1.1 일반현황')
  check('서식 칩 1.1 활성', await page.isVisible('text=1.1 일반현황'))
  check('서식 칩 1.4 예정 표시', await page.isVisible('text=1.4 소방시설'))
  check('1.1 = 계획서 정보 패널 배치', await page.isVisible('text=계획서 정보'))

  // 4) 딥링크 ?tab=plan&sub=ch1
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&sub=ch1`)
  await page.waitForSelector('text=1.1 일반현황')
  check('딥링크 sub=ch1 → 1장 직행', await page.isVisible('text=1.1 일반현황'))

  // 5) 개정이력 기본값 연동 — getFirePlanGenDefaultsAction이 revision 입력을 반영하는지 재진입으로 확인
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.waitForSelector('text=HWP 생성')
  const noteVal = await page.inputValue('input[placeholder*="소방계획서 작성"]')
  check('재진입 시 저장된 개정내용 로드', noteVal === '개정 E2E 검증', `value=${noteVal}`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (customerId) {
    await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
}
summary()
