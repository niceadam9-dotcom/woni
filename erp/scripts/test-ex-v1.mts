// Victory10_entire EX-V1 — 회계 금액 경계(음수 금액 차단) 라이브 검증
// batch2 지적: 음수 전표(−10만/−10만)가 저장됨(서버 부호검증 부재). 수정: createVoucherAction 진입부 음수 가드.
// 실행: (prod build 기동 후) npx tsx scripts/test-ex-v1.mts
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'ex-v1-e2e@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const NEG = -100000

try {
  userId = await mkUser({ email: EMAIL, name: 'EXV1검증', employeeId: 'E2E-XV1', role: 'admin' })
  // 계정과목 2개 확보
  const { data: acc } = await raw.from('account_codes').select('id').limit(2)
  const accs = (acc ?? []) as Array<{ id: string }>
  if (accs.length < 2) { console.log('SKIP: account_codes 2개 미만'); summary(); }

  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(20000)
  page.on('dialog', d => d.accept().catch(() => {}))
  await login(page, EMAIL)

  await page.goto(`${BASE}/accounting/vouchers`)
  await page.getByRole('button', { name: '전표 등록' }).first().click()
  await page.waitForSelector('text=계정 명세')                 // 모달 열림

  await page.locator('input[placeholder="전표 내용 요약"]').fill('EXV1 음수 검증 테스트')
  const selects = page.locator('select')
  // LinesEditor: 각 라인당 계정 select 1개 (총 2라인)
  await selects.nth(0).selectOption(accs[0].id)
  await selects.nth(1).selectOption(accs[1].id)
  const nums = page.locator('input[type=number]')            // 라인0 차/대, 라인1 차/대
  await nums.nth(0).fill(String(NEG))                        // 라인0 차변 = -10만
  await nums.nth(3).fill(String(NEG))                        // 라인1 대변 = -10만 (합계 균형)

  await page.getByRole('button', { name: '등록', exact: true }).click()
  // 서버 가드 에러 노출 확인
  await page.waitForSelector('text=음수', { timeout: 8000 }).catch(() => {})
  const errShown = await page.isVisible('text=음수')
  check('EX-V1 음수 금액 → 서버 거부 에러 노출', errShown)

  // DB에 음수 전표 명세가 저장되지 않았는지
  await page.waitForTimeout(1500)
  const { data: negLines } = await raw.from('voucher_lines').select('id').eq('debit_amount', NEG)
  const noNeg = (negLines ?? []).length === 0
  check('EX-V1 음수 전표 명세 미저장(DB)', noNeg, `negLines=${(negLines ?? []).length}`)

  summary()
} catch (e) {
  console.error('❌ 예외:', (e as Error).message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  // 혹시 저장됐다면 정리
  const { data: bad } = await raw.from('voucher_lines').select('voucher_id').eq('debit_amount', NEG)
  for (const b of (bad ?? []) as Array<{ voucher_id: string }>) {
    await raw.from('voucher_lines').delete().eq('voucher_id', b.voucher_id)
    await raw.from('vouchers').delete().eq('id', b.voucher_id)
  }
  await raw.from('profiles').delete().eq('id', userId)
  await raw.auth.admin.deleteUser(userId).catch(() => {})
}
