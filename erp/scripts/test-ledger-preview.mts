// 11-1c E2E — 대장값 미리보기(앰버) → 확정 저장 (빠른 입력 화면, 임시 고객 + 실제 대장 API)
// 실행: npx tsx scripts/test-ledger-preview.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'ledger-preview-e2e@erp-test.com'
let userId = ''
let custId = ''
let bldId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '대장E2E', employeeId: 'E2E-LDG' })
  custId = await mkCustomer({ customer_name: '대장미리보기E2E', created_by: userId })
  // 실존 지번(스테이징 다른 고객과 동일 대장) — 임시 건물이라 실데이터 영향 없음
  const { data: bld, error: bErr } = await raw.from('buildings').insert({
    customer_id: custId, building_name: '본관', is_active: true, created_by: userId,
    bcode: '4183039521', address_jibun: '경기 양평군 지평면 지평리 481-1',
  }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  bldId = bld!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${custId}?tab=plan`)
  await page.waitForSelector('button:has-text("건축물대장 불러오기")')
  check('빠른 입력 화면 진입', true)

  await page.waitForLoadState('networkidle') // 하이드레이션 전 클릭 무시 경합 방지
  await page.click('button:has-text("건축물대장 불러오기")')
  await page.waitForSelector('text=건축물대장 조회 결과', { timeout: 30000 })
  check('미리보기 패널(저장 전)', true)
  // 빈 건물이므로 대장 값 전부 "변경" — 앰버 하이라이트 행 존재
  check('변경값 앰버 하이라이트', (await page.locator('.bg-amber-100').count()) > 0)
  // 아직 저장 전 — DB 미변경 확인
  const { data: before } = await raw.from('buildings').select('main_structure, ledger_synced_at').eq('id', bldId).single()
  check('미리보기 단계 DB 미변경', !before?.ledger_synced_at && !before?.main_structure, JSON.stringify(before))

  await page.click('button:has-text("확정 저장")')
  await page.waitForSelector('text=확정 저장됐습니다')
  check('확정 저장 완료 메시지', true)
  const { data: after } = await raw.from('buildings')
    .select('main_structure, height, ledger_synced_at, permit_date').eq('id', bldId).single()
  check('DB 반영(ledger_synced_at)', !!after?.ledger_synced_at)
  check('DB 반영(구조 등 값)', !!(after?.main_structure || after?.height || after?.permit_date), JSON.stringify(after))

  // 취소 경로 — 다시 불러오기 후 취소하면 패널 닫힘
  await page.click('button:has-text("건축물대장 불러오기")')
  await page.waitForSelector('text=건축물대장 조회 결과', { timeout: 30000 })
  await page.click('button:has-text("취소")')
  check('취소로 패널 닫힘', !(await page.isVisible('text=건축물대장 조회 결과')))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (bldId) await raw.from('buildings').delete().eq('id', bldId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
