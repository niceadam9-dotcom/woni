/** 보수 견적 전용 페이지 E2E (2026-10-02) — 5단계 칸 → [보수 견적 페이지] → 작성·미리보기·메일 보내기
 *  실행: npx tsx scripts/test-repair-sales-page.mts   (dev 서버 localhost:3000 또는 TEST_BASE_URL · 마이그 166 적용 DB)
 *
 *  고정하는 것:
 *   · 5단계 칸의 [보수 견적 페이지] 버튼이 /inspections/{id}/repair?from=…step=5 로 간다 · [←]가 그 주소로 돌아온다
 *   · 왼쪽 불량 3건 · 오른쪽 미리보기(iframe)가 「견 적 서」와 입력한 단가를 즉시 그린다(PDF와 같은 조립)
 *   · 견적 만들기 → 미리보기가 그 견적 번호로 바뀌고 보내기 칸이 열린다
 *   · 받는 사람 후보 = 관계인 이메일(시험 도메인 @erp-test.com — 실제 메일은 나가지 않는다)
 *   · 보내기: PDF 변환기(GOTENBERG_URL)가 있으면 → 시험 발송 기록(doc_kind=quote·message_id dry-run)·상태 「발송」·이력 표시
 *             없으면 → 오류 안내, 송부 기록 0·상태 「작성중」 그대로(조용히 성공한 척하지 않는다)
 *   · 어느 경우든 **3단계(관계인 보고) 상태는 바뀌지 않는다** — 견적 메일은 report9_owner가 아니다
 */
import { readFileSync } from 'fs'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const envLocal = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const HAS_PDF = /^GOTENBERG_URL=\S+/m.test(envLocal)
const EMAIL = 'repair-page-e2e@erp-test.com'
const OWNER_EMAIL = 'owner-rpage@erp-test.com'
const NAMES = ['ZZ페이지 감지기 불량', 'ZZ페이지 유도등 불량', 'ZZ페이지 소화전 누수']
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  console.log(`[셋업] PDF 변환기 ${HAS_PDF ? '있음 — 시험 발송까지' : '없음 — 실패 경로 확인'}`)
  userId = await mkUser({ email: EMAIL, name: '견적페이지E2E', employeeId: 'E2E-RSP', role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ견적페이지고객', created_by: userId, address: '서울시 시험구 2' })
  {
    const { error } = await raw.from('customer_contacts').insert({ customer_id: cust, role: '대표', name: '김관계', phone: '01000000000', email: OWNER_EMAIL })
    if (error) throw new Error(`관계인 생성 실패: ${error.message}`)
  }
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-09-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  {
    const { error } = await raw.from('inspection_defects').insert(NAMES.map((n, i) => ({ inspection_id: insp, defect_code: `P-0${i + 1}`, defect_name: n, severity: '보통' })))
    if (error) throw new Error(`불량 생성 실패: ${error.message}`)
  }
  const { data: stepBefore } = await raw.from('inspection_steps').select('step_num, status').eq('inspection_id', insp).order('step_num')

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  console.log('[1] 5단계 칸 → 전용 페이지')
  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  const open = page.getByTestId('open-repair-page')
  await open.waitFor()
  const href = await open.getAttribute('href') ?? ''
  check('1-1 버튼 주소 = /repair + from=step=5', href.startsWith(`/inspections/${insp}/repair?from=`) && decodeURIComponent(href).includes('step=5'), href)
  await open.click()
  await page.getByTestId('repair-sales-page').waitFor()
  check('1-2 전용 페이지 도착', page.url().includes(`/inspections/${insp}/repair`))
  for (const n of NAMES) check(`1-3 불량 표시: ${n}`, await page.getByText(n, { exact: false }).first().isVisible())

  console.log('[2] 미리보기가 입력을 즉시 그린다')
  const frame = page.frameLocator('[data-testid="quote-preview"]')
  await frame.locator('h1', { hasText: '견 적 서' }).waitFor()
  check('2-1 미리보기에 「견 적 서」', true)
  const prices = page.getByTestId('page-line-price')
  check('2-2 단가 입력 3칸(미견적 불량 전부 기본 선택)', await prices.count() === 3)
  await prices.nth(0).fill('120000')
  await prices.nth(1).fill('40000')
  await prices.nth(2).fill('0')
  await frame.locator('text=132,000원').first().waitFor({ timeout: 10000 }).catch(() => {})
  const pv = await frame.locator('body').textContent() ?? ''
  check('2-3 미리보기 공급가액 160,000원 · 합계 176,000원', pv.includes('160,000원') && pv.includes('176,000원'), pv.slice(0, 120))

  console.log('[3] 견적 만들기 → 그 견적이 선택된다')
  await page.getByTestId('page-quote-create').click()
  await page.waitForFunction(() => /QT-\d{8}-\d{3}/.test(document.querySelector('[data-testid="page-quote-picker"]')?.textContent ?? ''))
  const { data: q } = await raw.from('quotes').select('id, quote_number, status, total_amount, items').eq('inspection_id', insp).maybeSingle()
  check('3-1 quotes 1건 · 합계 176,000', !!q && Number(q.total_amount) === 176000)
  const pv2 = await frame.locator('body').textContent() ?? ''
  check('3-2 미리보기가 그 견적 번호로', pv2.includes(q!.quote_number))
  check('3-3 보내기 칸에 관계인 메일 후보', await page.getByText(OWNER_EMAIL).first().isVisible())

  console.log('[4] 보내기')
  await page.getByTestId('send-submit').click()
  await page.getByTestId('repair-page-msg').waitFor()
  const msg = await page.getByTestId('repair-page-msg').textContent() ?? ''
  const { data: dels } = await raw.from('report_deliveries').select('doc_kind, recipient_email, message_id, file_name').eq('inspection_id', insp)
  const { data: qs } = await raw.from('quotes').select('status, pdf_path').eq('id', q!.id).single()
  if (HAS_PDF) {
    check('4-1 시험 발송 안내', msg.includes('시험 수신자'), msg)
    check('4-2 송부 기록 1행 · doc_kind=quote · dry-run', dels?.length === 1 && dels[0].doc_kind === 'quote' && String(dels[0].message_id).startsWith('dry-run') && dels[0].recipient_email === OWNER_EMAIL)
    check('4-3 파일명에 견적 번호', String(dels?.[0]?.file_name ?? '').includes(q!.quote_number))
    check('4-4 상태 작성중 → 발송 · PDF 보관', qs?.status === '발송' && !!qs?.pdf_path)
    await page.getByTestId('delivery-list').waitFor()
    check('4-5 이력에 수신자·시험 표시', (await page.getByTestId('delivery-list').textContent() ?? '').includes(OWNER_EMAIL))
  } else {
    check('4-1 변환기 없음 → 오류 안내(⚠)', msg.startsWith('⚠') && /PDF|GOTENBERG/i.test(msg), msg)
    check('4-2 송부 기록 0행', (dels?.length ?? 0) === 0)
    check('4-3 상태는 작성중 그대로', qs?.status === '작성중')
  }

  console.log('[5] 3단계 불변 · 돌아가기')
  const { data: stepAfter } = await raw.from('inspection_steps').select('step_num, status').eq('inspection_id', insp).order('step_num')
  check('5-1 inspection_steps 전후 동일(견적 메일이 3단계를 완료시키지 않는다)', JSON.stringify(stepBefore) === JSON.stringify(stepAfter))
  await page.getByTestId('repair-back').click()
  await page.waitForURL(u => u.pathname === `/inspections/${insp}` && u.search.includes('step=5'))
  check('5-2 [←]가 5단계 칸으로', true)
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await browser?.close() } catch { /* ignore */ }
  try {
    if (insp) {
      await raw.from('report_deliveries').delete().eq('inspection_id', insp)
      const { data: qs } = await raw.from('quotes').select('pdf_path').eq('inspection_id', insp)
      const paths = (qs ?? []).map(x => x.pdf_path).filter(Boolean) as string[]
      if (paths.length) await raw.storage.from('fire-plans').remove(paths)
      await raw.from('quotes').delete().eq('inspection_id', insp)
    }
    if (cust) await cleanupCustomer(cust)
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
