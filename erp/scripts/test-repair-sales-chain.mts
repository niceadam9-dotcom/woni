/** ⑤ 보수 칸 매출 사슬 E2E — 불량 → 견적 → (발송·승인) → 수주 → 완료 → 청구 (2026-10-02, 불량 → 매출 1단계)
 *  실행: npx tsx scripts/test-repair-sales-chain.mts   (dev 서버 localhost:3000 또는 TEST_BASE_URL · 마이그 166 적용된 DB)
 *
 *  고정하는 것:
 *   · ⑤ 칸에 사슬 블록이 서고, 「견적 미발송 불량 n건」이 불량 수와 같다
 *   · 견적 만들기 → quotes 행이 회차(inspection_id)·source=defect·items[].defect_ids를 가진다 · 미발송 띠가 줄어든다
 *   · 발송 표시 → 승인 기록(이름·채널) → 수주로 전환 → orders 행이 회차·quote_id·tax_amount를 가지고 견적은 「수주」
 *   · 공사 완료 → completed_at · 청구 만들기 → bills 행 1건(order_id·보수공사·건별·금액 = 수주 합계) · 두 번은 거절
 *   · **불량 표는 바뀌지 않는다**(inspection_defects 행 값 전후 동일) · ⑤ 완료 조건(단계 상태)도 그대로
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'repair-sales-e2e@erp-test.com'
const NAMES = ['ZZ매출 수신기 기판 불량', 'ZZ매출 유도등 점등 불량', 'ZZ매출 소화기 압력 저하']
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const snapshot = async () => {
  const { data } = await raw.from('inspection_defects').select('id, defect_name, action_plan, action_taken, action_completed_at, action_start, action_end')
    .eq('inspection_id', insp).order('defect_name')
  return JSON.stringify(data)
}

try {
  console.log('[셋업]')
  userId = await mkUser({ email: EMAIL, name: '매출E2E', employeeId: 'E2E-RSC', role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ매출사슬고객', created_by: userId, address: '서울시 테스트구 1' })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-09-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  {
    const { error } = await raw.from('inspection_defects').insert(NAMES.map((n, i) => ({ inspection_id: insp, defect_code: `R-0${i + 1}`, defect_name: n, severity: '보통' })))
    if (error) throw new Error(`불량 생성 실패: ${error.message}`)
  }
  const before = await snapshot()
  const { data: stepBefore } = await raw.from('inspection_steps').select('step_num, status').eq('inspection_id', insp).order('step_num')

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  console.log('[1] ⑤ 칸에 사슬이 선다')
  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  const chain = page.getByTestId('repair-sales-chain')
  await chain.waitFor()
  check('1-1 사슬 블록 렌더', await chain.isVisible())
  const strip = page.getByTestId('unquoted-strip')
  await strip.waitFor()
  check('1-2 미발송 띠 = 불량 3건', (await strip.textContent())?.includes('3건') === true, await strip.textContent() ?? '')

  console.log('[2] 견적 만들기')
  await page.getByTestId('quote-create-open').click()
  await page.getByTestId('quote-composer').waitFor()
  const prices = page.getByTestId('quote-line-price')
  check('2-1 기본 선택 = 미발송 불량 3건(단가 입력 3개)', await prices.count() === 3)
  // 세 번째 불량은 빼고 2건만 견적
  await page.locator('[data-testid="quote-composer"] li', { hasText: NAMES[2] }).locator('input[type=checkbox]').uncheck()
  const p2 = page.getByTestId('quote-line-price')
  check('2-2 선택 해제 뒤 단가 입력 2개', await p2.count() === 2)
  await p2.nth(0).fill('150000')
  await p2.nth(1).fill('30000')
  await page.getByTestId('quote-create-submit').click()
  await page.getByTestId('repair-quote-list').waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="unquoted-strip"]')?.textContent?.includes('1건'))
  check('2-3 미발송 띠 3건 → 1건', (await strip.textContent())?.includes('1건') === true)
  const { data: q } = await raw.from('quotes').select('id, quote_number, status, source, inspection_id, customer_id, items, subtotal, tax_amount, total_amount').eq('inspection_id', insp).maybeSingle()
  check('2-4 quotes 행이 회차를 가리킨다', !!q && q.inspection_id === insp && q.customer_id === cust)
  check('2-5 source=defect · status=작성중', q?.source === 'defect' && q?.status === '작성중')
  const items = (q?.items ?? []) as Array<{ description: string; amount: number; defect_ids?: string[] }>
  check('2-6 줄 2개, 각 줄이 defect_ids 1개', items.length === 2 && items.every(it => (it.defect_ids?.length ?? 0) === 1))
  check('2-7 금액: 공급 180,000 · 부가세 18,000 · 합계 198,000', Number(q?.subtotal) === 180000 && Number(q?.tax_amount) === 18000 && Number(q?.total_amount) === 198000, `${q?.subtotal}/${q?.tax_amount}/${q?.total_amount}`)
  const quoteId = q!.id as string

  console.log('[3] 발송 표시 → 승인 기록 → 수주 전환')
  await page.getByTestId('quote-mark-sent').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="quote-status"]')?.textContent === '발송')
  check('3-1 상태 칩 발송', true)
  await page.getByTestId('quote-approve-open').click()
  await page.getByTestId('approve-name').fill('홍길동 관계인')
  await page.getByTestId('approve-submit').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="quote-status"]')?.textContent === '승인')
  const { data: qa } = await raw.from('quotes').select('status, approved_at, approved_by_name, approval_channel').eq('id', quoteId).single()
  check('3-2 승인 기록: 이름·채널·시각', qa?.status === '승인' && qa?.approved_by_name === '홍길동 관계인' && qa?.approval_channel === 'phone' && !!qa?.approved_at)
  await page.getByTestId('quote-to-order-open').click()
  await page.getByTestId('quote-order-form').waitFor()
  await page.getByTestId('order-submit').click()
  await page.getByTestId('repair-order-list').waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="quote-status"]')?.textContent === '수주')
  const { data: o } = await raw.from('orders').select('id, order_number, status, quote_id, inspection_id, total_amount, tax_amount, contractor_name, contract_file_path').eq('inspection_id', insp).maybeSingle()
  check('3-3 orders 행: 회차·견적·금액·부가세', !!o && o.quote_id === quoteId && Number(o.total_amount) === 198000 && Number(o.tax_amount) === 18000)
  check('3-4 자사 시공(시공사 null) · 계약서 없음(null)', o?.contractor_name === null && o?.contract_file_path === null)
  check('3-5 견적 상태 수주', (await raw.from('quotes').select('status').eq('id', quoteId).single()).data?.status === '수주')
  check('3-6 수주 전환 버튼이 사라진다(견적 1건당 수주 1건)', await page.getByTestId('quote-to-order-open').count() === 0)

  console.log('[4] 공사 완료 → 청구 만들기')
  await page.getByTestId('order-complete').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="order-status"]')?.textContent === '완료')
  const { data: oc } = await raw.from('orders').select('status, completed_at').eq('id', o!.id).single()
  check('4-1 완료 + completed_at 기록', oc?.status === '완료' && !!oc?.completed_at)
  await page.getByTestId('order-bill-create').click()
  await page.getByTestId('order-bill').waitFor()
  const { data: bills } = await raw.from('bills').select('id, order_id, bill_type, fee_type, supply_value, tax_value, total_amount, billing_month, customer_id').eq('order_id', o!.id)
  check('4-2 bills 1건 · 보수공사 · 건별', bills?.length === 1 && bills[0].bill_type === '보수공사' && bills[0].fee_type === '건별')
  check('4-3 금액 = 수주 합계(공급 180,000 · 부가세 18,000)', Number(bills?.[0]?.total_amount) === 198000 && Number(bills?.[0]?.supply_value) === 180000 && Number(bills?.[0]?.tax_value) === 18000)
  check('4-4 청구월 = 완료일의 YYYY.MM', bills?.[0]?.billing_month === (oc?.completed_at as string).slice(0, 7).replace('-', '.'))
  check('4-5 청구 만들기 버튼이 사라진다(수주당 1건)', await page.getByTestId('order-bill-create').count() === 0)
  check('4-6 청구가 있는 수주는 취소 버튼이 없다', await page.getByTestId('order-cancel').count() === 0)

  console.log('[5] 불량 표·단계 상태는 그대로')
  check('5-1 inspection_defects 전후 동일', (await snapshot()) === before)
  const { data: stepAfter } = await raw.from('inspection_steps').select('step_num, status').eq('inspection_id', insp).order('step_num')
  check('5-2 inspection_steps 상태 전후 동일', JSON.stringify(stepBefore) === JSON.stringify(stepAfter))

  console.log('[6] 불량별 견적 보기 · 견적 목록 화면 링크')
  const map = page.getByTestId('defect-quote-map')
  await page.locator('summary', { hasText: '불량별 견적 보기' }).click()
  const mapText = await map.textContent() ?? ''
  check('6-1 두 불량은 견적 번호, 셋째는 견적 없음', mapText.includes(q!.quote_number) && mapText.includes('견적 없음'))
  await page.goto(`${BASE}/quotes`)
  const link = page.locator(`a[href="/inspections/${insp}/repair"]`)  // 2026-10-02 — 전용 페이지로
  check('6-2 /quotes에 「불량 보수」 회차 링크', await link.count() >= 1)
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await browser?.close() } catch { /* ignore */ }
  try {
    if (insp) {
      const { data: os } = await raw.from('orders').select('id').eq('inspection_id', insp)
      for (const o of os ?? []) await raw.from('bills').delete().eq('order_id', o.id)
      await raw.from('orders').delete().eq('inspection_id', insp)
      await raw.from('quotes').delete().eq('inspection_id', insp)
    }
    if (cust) await cleanupCustomer(cust)
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
