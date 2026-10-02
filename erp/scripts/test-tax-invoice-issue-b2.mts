// B2 E2E — 발행 화면이 공급받는자 사업자정보(billing_profiles)를 싣는가 + 사업자정보 저장의 서버 검증.
// 고객·청구·사업자정보를 심고 끝에 지운다(실데이터 무접촉).
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { formatBizNoDash } from '../src/lib/biz-no'

const makeValid = (nine: string) => {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let s = 0
  for (let i = 0; i < 9; i++) s += Number(nine[i]) * w[i]
  s += Math.floor((Number(nine[8]) * 5) / 10)
  return nine + String((10 - (s % 10)) % 10)
}
const GOOD = makeValid('987654321')
const email = `e2e-b2-${Date.now()}@test.local`
let userId: string | null = null, custId: string | null = null, billId: string | null = null
let browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email, name: 'B2 검증', employeeId: `B2-${Date.now() % 100000}`, role: 'admin' })
  custId = await mkCustomer({ customer_name: `E2E-B2 ${Date.now() % 100000}`, address: '경기 양평군 양평읍 테스트로 1', created_by: userId })
  const { data: bill, error: bErr } = await raw.from('bills').insert({
    customer_id: custId, billing_month: '2026.10', bill_type: '월정액', fee_type: '정액', bill_date: '2026-10-02',
    supply_value: 100000, tax_value: 10000, total_amount: 110000, paid_amount: 0, created_by: userId,
  }).select('id').single()
  if (bErr) throw new Error(`청구 심기 실패: ${bErr.message}`)
  billId = (bill as { id: string }).id
  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, email)

  console.log('\n[1] 사업자정보 없음 — 「미입력」으로 보인다(종전 하드코딩 「—」가 아니다)')
  await page.goto(`${BASE}/tax-invoices/issue?billId=${billId}`, { waitUntil: 'networkidle' })
  const empty = (await page.getByTestId('buyer-bizno').textContent())?.trim() ?? ''
  check('1-1 공급받는자 사업자번호 칸 = 미입력', empty === '미입력', empty)

  console.log('\n[2] 사업자정보를 넣으면 발행 화면에 실린다')
  await raw.from('billing_profiles').upsert({ customer_id: custId, business_no: formatBizNoDash(GOOD), rep_name: '홍길동',
    company_name: '(주)이투이', tax_email: 'tax@e2e.local', business_type: '서비스', business_item: '시설관리' }, { onConflict: 'customer_id' })
  await page.goto(`${BASE}/tax-invoices/issue?billId=${billId}`, { waitUntil: 'networkidle' })
  const filled = (await page.getByTestId('buyer-bizno').textContent())?.trim() ?? ''
  check('2-1 사업자번호 표시', filled === formatBizNoDash(GOOD), filled)
  const body = (await page.locator('body').textContent()) ?? ''
  check('2-2 대표자 표시', body.includes('홍길동'))
  check('2-3 상호는 사업자정보 상호 우선', body.includes('(주)이투이'))
  check('2-4 수신 이메일 표시', body.includes('tax@e2e.local'))
  check('2-5 업태·종목 표시', body.includes('서비스 / 시설관리'))
  check('2-6 공급자 업태·종목 줄 존재', body.includes('업태·종목'))

  console.log('\n[3] 사업자정보 저장 — 서버가 틀린 번호·이메일을 거부한다')
  // 서버 액션은 요청 컨텍스트가 필요해 직접 부르지 않는다 — 화면 저장(청구·수금 탭 SaveBar)으로 검증한다
  await page.goto(`${BASE}/customers/${custId}?tab=billing`, { waitUntil: 'networkidle' })
  const bizInput = page.locator('input[placeholder="000-00-00000"]').first()
  const hasForm = await bizInput.count() > 0
  check('3-0 고객 청구 탭 사업자번호 입력칸', hasForm)
  if (hasForm) {
    const bad = GOOD.slice(0, 9) + String((Number(GOOD[9]) + 1) % 10)
    await bizInput.fill(bad)
    await bizInput.locator('xpath=ancestor::div[contains(@class,"rounded")][1]').locator('button', { hasText: '저장' }).first().click()
    await page.waitForTimeout(2000)
    const { data: bp } = await raw.from('billing_profiles').select('business_no').eq('customer_id', custId).single()
    const kept = (bp as { business_no: string }).business_no
    check('3-1 검증번호 틀린 사업자번호는 저장되지 않는다(이전 값 유지)', kept === formatBizNoDash(GOOD), kept)
    const shown = (await page.locator('body').textContent()) ?? ''
    check('3-2 화면에 서버 거절 문구', shown.includes('사업자등록번호가 올바르지 않습니다'))
  }
} catch (e) {
  check('예외 없이 완주', false, String(e))
} finally {
  if (billId) await raw.from('bills').delete().eq('id', billId)
  if (custId) { await raw.from('billing_profiles').delete().eq('customer_id', custId); await cleanupCustomer(custId) }
  if (userId) await delUser(userId)
  if (browser) await browser.close()
}
summary()
