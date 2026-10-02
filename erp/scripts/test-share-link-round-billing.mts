/** 관계인 링크 3단계 E2E — 회차 문서 묶음·청구 이력·손글씨 서명 승인·고객 청구 탭 (2026-10-02)
 *  실행: npx tsx scripts/test-share-link-round-billing.mts   (dev 서버 · 마이그 170·171 적용 DB)
 *
 *  고정하는 것:
 *   · 보수 견적 페이지 [회차 문서 묶음 링크] → /p/{token}: 별지 9·10·11호 줄 3개, 파일이 없으면 「준비 전」
 *     · ?doc= 허용목록 밖(report4 등)은 404
 *   · 고객 상세 「청구」 탭: 이 고객 청구 행·미입금 합계·[링크 만들기] → 청구 이력 링크(비로그인)에서 같은 금액
 *     · 청구 이력 링크의 /file 은 404(내려받을 파일 없음) · 철회하면 404
 *   · 견적 링크에서 캔버스에 서명을 그리고 승인 → quotes.approval_signature_path(PNG 실재) · pdf_path 비워짐
 *   · 직원(employee)은 청구 탭에서 패널이 보이지 않고 홈으로 튕기지도 않는다(조용한 권한 숨김)
 */
import { chromium } from 'playwright'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const ADMIN = 'share3-admin@erp-test.com', EMP = 'share3-emp@erp-test.com'
let adminId = '', empId = '', cust = '', insp = '', quoteId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
let anon: import('playwright').Browser | null = null

try {
  console.log('[셋업]')
  adminId = await mkUser({ email: ADMIN, name: '링크3관리', employeeId: 'E2E-SH3A', role: 'admin' })
  empId = await mkUser({ email: EMP, name: '링크3직원', employeeId: 'E2E-SH3E', role: 'employee' })
  cust = await mkCustomer({ customer_name: 'ZZ링크3고객', created_by: adminId })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-09-01', status: 'in_progress', assigned_employee_id: adminId, created_by: adminId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  await raw.from('inspection_defects').insert({ inspection_id: insp, defect_code: 'R3-01', defect_name: 'ZZ링크3 유도등', severity: '보통' })
  {
    const { error } = await raw.from('bills').insert([
      { customer_id: cust, billing_month: '2026.09', bill_type: '월정액', fee_type: '정액', bill_date: '2026-09-01', supply_value: 100000, tax_value: 10000, total_amount: 110000, paid_amount: 110000, paid_at: '2026-09-10', created_by: adminId },
      { customer_id: cust, billing_month: '2026.10', bill_type: '보수공사', fee_type: '건별', bill_date: '2026-10-01', supply_value: 50000, tax_value: 5000, total_amount: 55000, paid_amount: 0, created_by: adminId },
    ])
    if (error) throw new Error(`청구 생성 실패: ${error.message}`)
  }
  {
    const { data, error } = await raw.from('quotes').insert({
      customer_id: cust, inspection_id: insp, source: 'defect', quote_number: `QT-20261002-8${Math.floor(Math.random() * 90 + 10)}`,
      quote_date: '2026-10-02', valid_until: '2099-12-31',
      items: [{ description: 'ZZ링크3 유도등', quantity: 1, unit_price: 30000, amount: 30000 }],
      subtotal: 30000, tax_amount: 3000, total_amount: 33000, status: '발송', created_by: adminId, pdf_path: 'stale/placeholder.pdf',
    }).select('id').single()
    if (error) throw new Error(`견적 생성 실패: ${error.message}`)
    quoteId = data!.id as string
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, ADMIN)
  anon = await chromium.launch()
  const ap = await (await anon.newContext()).newPage()
  ap.setDefaultTimeout(60000)

  console.log('[1] 회차 문서 묶음 링크')
  await page.goto(`${BASE}/inspections/${insp}/repair`)
  await page.getByTestId('share-links-section').waitFor()
  await page.getByRole('button', { name: '회차 문서 묶음 링크' }).click()
  const roundUrl = await (await page.getByTestId('share-link-url').waitFor().then(() => page.getByTestId('share-link-url'))).inputValue()
  const roundTok = roundUrl.split('/p/')[1]
  await ap.goto(`${BASE}/p/${roundTok}`)
  await ap.getByTestId('share-round-list').waitFor()
  check('1-1 별지 줄 3개', await ap.locator('[data-testid="share-round-list"] li').count() === 3)
  check('1-2 파일 없으니 전부 「준비 전」', await ap.locator('[data-testid$="-none"]').count() === 3)
  check('1-3 ?doc=report4 는 404', (await ap.goto(`${BASE}/p/${roundTok}/file?doc=report4`))?.status() === 404)
  check('1-4 ?doc=report9 도 파일이 없으면 404', (await ap.goto(`${BASE}/p/${roundTok}/file?doc=report9`))?.status() === 404)

  console.log('[2] 고객 청구 탭 + 청구 이력 링크')
  await page.goto(`${BASE}/customers/${cust}?tab=billing`)
  await page.getByTestId('customer-bills-panel').waitFor()
  await page.getByTestId('customer-bills-table').waitFor()
  check('2-1 청구 행 2개', await page.locator('[data-testid="customer-bills-table"] tbody tr').count() === 2)
  check('2-2 미입금 합계 55,000원', (await page.getByTestId('customer-bills-unpaid').textContent())?.includes('55,000원') === true)
  await page.getByTestId('billing-link-create').click()
  const billUrl = await (await page.getByTestId('billing-link-url').waitFor().then(() => page.getByTestId('billing-link-url'))).inputValue()
  const billTok = billUrl.split('/p/')[1]
  const r = await ap.goto(`${BASE}/p/${billTok}`)
  check('2-3 비로그인 열람 200', r?.status() === 200 && !ap.url().includes('/login'))
  await ap.getByTestId('share-billing-table').waitFor()
  check('2-4 링크에도 미입금 55,000원', (await ap.getByTestId('share-billing-unpaid').textContent())?.includes('55,000원') === true)
  check('2-5 청구 링크 /file 은 404', (await ap.goto(`${BASE}/p/${billTok}/file`))?.status() === 404)
  await page.getByTestId('billing-link-list').waitFor()
  page.once('dialog', d => d.accept())
  await page.getByTestId('billing-link-revoke').first().click()
  await page.waitForFunction(() => document.querySelector('[data-testid="billing-link-list"]')?.textContent?.includes('철회됨'))
  check('2-6 철회 뒤 404', (await ap.goto(`${BASE}/p/${billTok}`))?.status() === 404)

  console.log('[3] 서명 승인')
  await page.goto(`${BASE}/inspections/${insp}/repair`)
  await page.getByTestId('share-links-section').waitFor()
  await page.getByTestId('share-link-create').click()
  const qUrl = await (await page.getByTestId('share-link-url').waitFor().then(() => page.getByTestId('share-link-url'))).inputValue()
  await ap.goto(qUrl.replace(/^https?:\/\/[^/]+/, BASE))
  await ap.getByTestId('share-sign-canvas').waitFor()
  const box = (await ap.getByTestId('share-sign-canvas').boundingBox())!
  await ap.mouse.move(box.x + 20, box.y + 30); await ap.mouse.down()
  for (let i = 1; i <= 12; i++) await ap.mouse.move(box.x + 20 + i * 15, box.y + 30 + (i % 2 ? 40 : 0))
  await ap.mouse.up()
  await ap.getByTestId('share-approve-name').fill('최서명')
  await ap.getByTestId('share-approve-agree').check()
  await ap.getByTestId('share-approve-submit').click()
  await ap.getByTestId('share-approved').waitFor()
  const { data: q } = await raw.from('quotes').select('status, approved_by_name, approval_signature_path, pdf_path').eq('id', quoteId).single()
  check('3-1 승인·이름', q?.status === '승인' && q?.approved_by_name === '최서명')
  check('3-2 서명 경로 기록', !!q?.approval_signature_path && /signatures\/quote_.+\.png$/.test(q.approval_signature_path))
  check('3-3 pdf_path 비워짐(다음 PDF가 승인란을 담아 재생성)', q?.pdf_path === null)
  const { data: blob } = await raw.storage.from('fire-plans').download(q!.approval_signature_path!)
  const head = blob ? new Uint8Array(await blob.arrayBuffer()).slice(0, 4) : new Uint8Array()
  check('3-4 저장된 서명은 PNG', head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)

  console.log('[4] 직원은 청구 패널이 조용히 숨는다')
  const ep = await (await browser.newContext()).newPage()
  ep.setDefaultTimeout(60000)
  await login(ep, EMP)
  await ep.goto(`${BASE}/customers/${cust}?tab=billing`)
  await ep.waitForTimeout(4000)
  check('4-1 고객 상세에 머문다(홈으로 안 튕김)', ep.url().includes(`/customers/${cust}`), ep.url())
  check('4-2 청구 패널 없음', await ep.getByTestId('customer-bills-panel').count() === 0)
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await anon?.close() } catch { /* */ }
  try { await browser?.close() } catch { /* */ }
  try {
    if (quoteId) {
      const { data: q } = await raw.from('quotes').select('approval_signature_path, pdf_path').eq('id', quoteId).maybeSingle()
      const paths = [q?.approval_signature_path, q?.pdf_path].filter((p): p is string => !!p && !p.startsWith('stale/'))
      if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    }
    if (insp) await raw.from('notifications').delete().eq('reference_id', insp).eq('type', 'quote_approved')
    if (cust) {
      await raw.from('share_links').delete().eq('customer_id', cust)
      await raw.from('quotes').delete().eq('customer_id', cust)
      await raw.from('bills').delete().eq('customer_id', cust)
      await cleanupCustomer(cust)
    }
    if (adminId) await delUser(adminId)
    if (empId) await delUser(empId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
