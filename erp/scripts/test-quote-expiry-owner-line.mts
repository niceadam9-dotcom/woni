/** 견적 유효기간 처리 + 3단계 칸 보수 견적 한 줄 (불량 → 매출 해결방안 절 남은 항목, 2026-10-02)
 *  실행: npx tsx scripts/test-quote-expiry-owner-line.mts   (dev 서버 · 마이그 166 이후 DB)
 *
 *  고정하는 것:
 *   · expireStaleQuotes: 유효기간 지난 「작성중·발송」만 만료 — 「승인」은 지나도 그대로, 유효기간 안의 견적도 그대로
 *   · findQuotesExpiringSoon: 오늘~7일 안의 「작성중·발송」만
 *     (주간 브리핑 크론이 같은 두 함수를 부른다 — 크론 자체는 실제 알림·회사 메일을 보내므로 dev에서 직접 돌리지 않는다)
 *   · 작업대 3단계 칸: 「보수 견적」 한 줄(최신 살아 있는 견적 번호·상태, 견적 없는 불량 수) · 견적이 없으면 「견적 미작성」
 *   · A 이메일 상자에 「본문에 회차 문서 링크」 체크가 있다(기본 꺼짐)
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { expireStaleQuotes, findQuotesExpiringSoon, addDaysISO } from '../src/lib/quote-expiry.ts'

const EMAIL = 'quote-expiry-e2e@erp-test.com'
let userId = '', cust = '', cust2 = '', insp = '', insp2 = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const tag = Math.floor(Math.random() * 900 + 100)

try {
  console.log('[셋업]')
  userId = await mkUser({ email: EMAIL, name: '만료E2E', employeeId: 'E2E-QEX', role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ견적만료고객', created_by: userId })
  // 2차 점검은 종합 고객만 허용(DB 규칙) — 견적 없는 회차는 다른 고객의 1차로 만든다
  cust2 = await mkCustomer({ customer_name: 'ZZ견적만료고객2', created_by: userId })
  const mkInsp = async (c: string) => {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: c, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-09-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    return data!.id as string
  }
  insp = await mkInsp(cust); insp2 = await mkInsp(cust2)
  const { data: defs } = await raw.from('inspection_defects').insert([
    { inspection_id: insp, defect_code: 'X-1', defect_name: 'ZZ만료 불량1', severity: '보통' },
    { inspection_id: insp, defect_code: 'X-2', defect_name: 'ZZ만료 불량2', severity: '보통' },
    { inspection_id: insp2, defect_code: 'X-3', defect_name: 'ZZ만료 불량3', severity: '보통' },
  ]).select('id, defect_name')
  const d1 = defs!.find(d => d.defect_name === 'ZZ만료 불량1')!.id
  const q = (n: string, status: string, valid: string, defectIds: string[]) => ({
    customer_id: cust, inspection_id: insp, source: 'defect', quote_number: `QT-${today.replace(/-/g, '')}-${n}`,
    quote_date: today, valid_until: valid, items: [{ description: 'x', quantity: 1, unit_price: 1000, amount: 1000, defect_ids: defectIds }],
    subtotal: 1000, tax_amount: 100, total_amount: 1100, status, created_by: userId,
  })
  // 생성 순서 = 최신 판정 순서: 지난 작성중 → 지난 승인 → 3일 뒤 발송(최신)
  for (const row of [q(`7${tag}`.slice(0, 3), '작성중', addDaysISO(today, -1), [d1]), q(`8${tag}`.slice(0, 3), '승인', addDaysISO(today, -1), [d1])]) {
    const { error } = await raw.from('quotes').insert(row); if (error) throw new Error(error.message)
    await new Promise(r => setTimeout(r, 30))
  }
  const soonNo = `QT-${today.replace(/-/g, '')}-9${String(tag).slice(1)}`
  { const r = q('x', '발송', addDaysISO(today, 3), [d1]); r.quote_number = soonNo; const { error } = await raw.from('quotes').insert(r); if (error) throw new Error(error.message) }

  console.log('[1] 만료 전환·임박 조회(크론과 같은 함수)')
  const soonBefore = await findQuotesExpiringSoon(raw as never, today, 7, { customerId: cust })
  check('1-1 임박 = 3일 뒤 발송 1건', soonBefore.quotes.length === 1 && soonBefore.quotes[0].quote_number === soonNo, JSON.stringify(soonBefore.quotes))
  const exp = await expireStaleQuotes(raw as never, today, { customerId: cust })
  check('1-2 만료 전환 1건(지난 작성중)', exp.expired === 1 && !exp.error, JSON.stringify(exp))
  const { data: after } = await raw.from('quotes').select('quote_number, status').eq('customer_id', cust).order('created_at')
  check('1-3 지난 작성중 → 만료', after?.[0]?.status === '만료')
  check('1-4 지난 승인은 그대로 승인', after?.[1]?.status === '승인')
  check('1-5 유효기간 안의 발송은 그대로', after?.[2]?.status === '발송')
  check('1-6 두 번째 실행은 0건(멱등)', (await expireStaleQuotes(raw as never, today, { customerId: cust })).expired === 0)

  console.log('[2] 3단계 칸 한 줄')
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}?step=3`)
  const line = page.getByTestId('owner-report-quote-line')
  await line.waitFor()
  await page.getByTestId('owner-quote-latest').waitFor()
  const t = await line.textContent() ?? ''
  check('2-1 불량 2건 · 최신 살아 있는 견적(3일 뒤 발송) 번호·상태', t.includes('불량 2건') && t.includes(soonNo) && t.includes('발송'), t)
  check('2-2 견적 없는 불량 1건', t.includes('견적 없는 불량 1건'), t)
  const href = await page.getByTestId('owner-quote-open').getAttribute('href') ?? ''
  check('2-3 보수 견적 페이지 링크(from=step=3)', href.startsWith(`/inspections/${insp}/repair?from=`) && decodeURIComponent(href).includes('step=3'))
  check('2-4 「본문에 회차 문서 링크」 체크 존재·기본 꺼짐', await page.getByTestId('owner-include-link').count() === 1 && !(await page.getByTestId('owner-include-link').isChecked()))
  await page.goto(`${BASE}/inspections/${insp2}?step=3`)
  await page.getByTestId('owner-quote-none').waitFor()
  check('2-5 견적 없는 회차 → 「견적 미작성」', true)
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await browser?.close() } catch { /* */ }
  try {
    if (cust) { await raw.from('quotes').delete().eq('customer_id', cust); await cleanupCustomer(cust) }
    if (cust2) await cleanupCustomer(cust2)
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
