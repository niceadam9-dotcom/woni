// 소방계획서 탭 E2E — 4-1 골격(§8-1) + P2 빠른 입력 모드(§1-1·§9-6①·§9-8)
// 실행: npx tsx scripts/test-plan-tab.mts  (로컬 dev 서버 + 스테이징 DB, 096·098 적용 필요)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'plan-tab-e2e@erp-test.com'
let userId = ''
let customerId = ''
let generalId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '플랜탭E2E', employeeId: 'E2E-PLANTAB' })
  customerId = await mkCustomer({ customer_name: '플랜탭E2E고객', address: '경기 양평군 테스트로 1', created_by: userId })
  generalId = await mkCustomer({
    customer_name: '플랜탭E2E일반', address: '경기 양평군 테스트로 2', created_by: userId,
    inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: null,
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 기본 진입 = 빠른 입력 모드 (P2 §1-1) ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.waitForSelector('text=필수 완성도')
  check('빠른 입력 — 필수 완성도 게이지', await page.isVisible('text=필수 완성도'))
  check('빠른 입력 — 필요 문서 칩 (소방계획서)', await page.isVisible('text=필요 문서'))
  check('빠른 입력 — 별지 9호(작동) 칩', await page.isVisible('text=별지 9호(작동)'))
  check('빠른 입력 — 누락 칩 표시', await page.isVisible('text=누락:'))
  check('빠른 입력 — 건축물대장 불러오기 버튼', await page.isVisible('button:has-text("건축물대장 불러오기")'))
  check('빠른 입력 — 송달 동의 블록', await page.isVisible('text=전자우편 송달 동의'))
  check('빠른 입력 — 보관함 요약(빈 상태)', await page.isVisible('text=보관함이 비어 있습니다'))
  check('생성 바 — [HWP 생성] 버튼', await page.isVisible('button:has-text("HWP 생성")'))

  // ── 2) 대장 불러오기 — bcode 미보유 고객은 needAddress 안내 (fail-soft 경로) ──
  await page.click('button:has-text("건축물대장 불러오기")')
  await page.waitForSelector('text=건물·시설 탭에서 먼저 등록')
  check('대장 불러오기 — 건물 없음 fail-soft 안내', true)

  // ── 3) 송달 동의 저장 (098 §9-6①) ──
  await page.click('button:has-text("동의")')
  await page.fill('input[placeholder="송달 이메일"]', 'owner@example.com')
  await page.click('button:has-text("저장")')
  await page.waitForSelector('text=송달 동의 저장됨')
  const { data: cRow } = await raw.from('customers')
    .select('email_delivery_consent, report_email').eq('id', customerId).single()
  check('DB 송달 동의 저장', cRow?.email_delivery_consent === true && cRow?.report_email === 'owner@example.com', JSON.stringify(cRow))

  // ── 4) [서식 전체] 토글 → 고급 모드 (4-1 골격) ──
  await page.click('button:has-text("서식 전체")')
  await page.waitForSelector('text=개정이력')
  check('고급 모드 — 개정이력·보관 기본 표시', await page.isVisible('text=개정이력'))
  check('고급 모드 — 2장 비활성(준비 중)', await page.isVisible('button:disabled:has-text("2장 자위소방대")'))

  // 개정이력 입력 저장 → fire_plan_forms(096)
  await page.fill('input[placeholder*="소방계획서 작성"]', '개정 E2E 검증')
  await page.click('button:has-text("저장")')
  await page.waitForSelector('text=개정이력 입력 저장됨')
  const { data: form } = await raw.from('fire_plan_forms')
    .select('sections, updated_by').eq('customer_id', customerId).maybeSingle()
  const rev = (form?.sections as { revision?: { revisionNote?: string } } | null)?.revision
  check('DB fire_plan_forms.sections.revision 저장', rev?.revisionNote === '개정 E2E 검증', JSON.stringify(form))

  // 1장 서식 칩 + 딥링크
  await page.click('button:has-text("1장 소방안전관리계획")')
  await page.waitForSelector('text=1.1 일반현황')
  check('고급 모드 — 1.1 = 계획서 정보 패널', await page.isVisible('text=계획서 정보'))
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&sub=ch1`)
  await page.waitForSelector('text=1.1 일반현황')
  check('딥링크 sub=ch1 → 고급 모드 1장 직행', await page.isVisible('text=1.1 일반현황'))

  // ── 5) 일반관리 고객 — 배너 + 입력 미노출 + 탭 뱃지 억제 (§9-8) ──
  await page.goto(`${BASE}/customers/${generalId}?tab=plan`)
  await page.waitForSelector('text=소방계획서 작성 대상이 아닙니다')
  check('일반관리 — 대상 아님 배너', true)
  check('일반관리 — 외관점검표 안내', await page.isVisible('text=외관점검표'))
  check('일반관리 — 생성 바 미노출', !(await page.isVisible('button:has-text("HWP 생성")')))
  check('일반관리 — 필수 완성도 미노출', !(await page.isVisible('text=필수 완성도')))
  const planTabBadge = await page.locator('a:has-text("소방계획서"), button:has-text("소방계획서")').first().textContent()
  check('일반관리 — 탭 준비율 뱃지 억제(n/n 없음)', !/\d+\/\d+/.test(planTabBadge ?? ''), `tab="${planTabBadge}"`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const id of [customerId, generalId]) {
    if (!id) continue
    await raw.from('fire_plan_forms').delete().eq('customer_id', id)
    await cleanupCustomer(id)
  }
  if (userId) await delUser(userId)
}
summary()
