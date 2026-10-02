// B5 E2E — 점검 대장 「능력평가 실적」: 매니저만 보이고, 내려받은 파일 세 시트에 심은 점검·인력·세금계산서가 실린다.
// 연도는 올해(선택지 범위) — 실데이터와 섞이므로 심은 고객 이름으로 행을 찾는다. 심은 것은 끝에 지운다.
import XLSXmod from 'xlsx'
const XLSX = (XLSXmod as unknown as { default?: typeof XLSXmod }).default ?? XLSXmod
import { readFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const Y = new Date(Date.now() + 9 * 3600_000).getUTCFullYear()
const TAG = `B5E2E${Date.now() % 100000}`
const mgrEmail = `e2e-b5m-${Date.now()}@test.local`, empEmail = `e2e-b5e-${Date.now()}@test.local`
let mgr: string | null = null, emp: string | null = null, cust: string | null = null, insp: string | null = null, bill: string | null = null
let browser: { close: () => Promise<void> } | null = null
try {
  mgr = await mkUser({ email: mgrEmail, name: `${TAG}주`, employeeId: `${TAG}M`, role: 'manager' })
  emp = await mkUser({ email: empEmail, name: `${TAG}보`, employeeId: `${TAG}E`, role: 'employee' })
  await raw.from('profiles').update({ license_no: 'LIC-B5', license_grade: '특급' }).eq('id', mgr)
  cust = await mkCustomer({ customer_name: TAG, address: '경기 양평군 B5로 1', created_by: mgr })
  await raw.from('buildings').insert({ customer_id: cust, building_name: '본관', total_area: 777, is_active: true, created_by: mgr })
  const { data: i, error: iErr } = await raw.from('inspections').insert({
    customer_id: cust, inspection_type: '종합', plan_type: 'special_종합', sequence_num: 1, status: 'completed',
    inspection_start_date: `${Y}-01-20`, inspection_end_date: `${Y}-01-21`, assigned_employee_id: mgr, created_by: mgr,
    placement_reported_at: `${Y}-01-23`, placement_result: 'fit', report9_submitted_at: `${Y}-02-05`, report9_submitted_via: 'somin', report9_receipt_no: 'RCV-B5',
  }).select('id').single()
  if (iErr) throw new Error(`점검 심기 실패: ${iErr.message}`)
  insp = (i as { id: string }).id
  await raw.from('inspection_participants').insert({ inspection_id: insp, employee_id: emp, role: '보조', sort_order: 1 })
  const { data: b, error: bErr } = await raw.from('bills').insert({ customer_id: cust, billing_month: `${Y}.01`, bill_type: '월정액', fee_type: '정액',
    bill_date: `${Y}-01-31`, supply_value: 300000, tax_value: 30000, total_amount: 330000, paid_amount: 0, created_by: mgr }).select('id').single()
  if (bErr) throw new Error(`청구 심기 실패: ${bErr.message}`)
  bill = (b as { id: string }).id
  await raw.from('tax_invoices').insert({ bill_id: bill, issue_date: `${Y}-01-31`, approval_num: `APR-${TAG}`, invoice_status: '발행완료', issued: true })

  const l = await launch(); browser = l.browser; const page = l.page

  console.log('\n[1] 직원(employee)에게는 버튼이 없다 — 세금계산서 금액 포함')
  await login(page, empEmail)
  await page.goto(`${BASE}/customers/ledger`, { waitUntil: 'networkidle' })
  check('1-1 직원 화면에 능력평가 실적 버튼 없음', await page.getByTestId('capability-eval-export').count() === 0)
  await page.context().clearCookies()

  console.log('\n[2] 매니저 — 내려받은 파일 세 시트')
  await login(page, mgrEmail)
  await page.goto(`${BASE}/customers/ledger`, { waitUntil: 'networkidle' })
  await page.getByTestId('capability-eval-year').selectOption(String(Y))
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('capability-eval-export').click()])
  const path = join(mkdtempSync(join(tmpdir(), 'b5-')), dl.suggestedFilename()); await dl.saveAs(path)
  check('2-1 파일 이름', dl.suggestedFilename() === `점검능력평가_실적_${Y}.xlsx`, dl.suggestedFilename())
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' })
  check('2-2 시트 셋', JSON.stringify(wb.SheetNames) === '["점검 실적","기술인력","세금계산서"]', JSON.stringify(wb.SheetNames))
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['점검 실적'])
  const r = rows.find(x => x['대상물'] === TAG)
  check('2-3 심은 점검 행', !!r, `${rows.length}행`)
  if (r) {
    check('2-4 상태·종류·연면적', r['상태'] === '완료' && r['점검 종류'] === '종합' && r['연면적(㎡)'] === 777, JSON.stringify([r['상태'], r['점검 종류'], r['연면적(㎡)']]))
    check('2-5 주된·보조 인력', r['주된 기술인력'] === `${TAG}주 (LIC-B5)` && r['보조 인력'] === `${TAG}보`, `${r['주된 기술인력']} / ${r['보조 인력']}`)
    check('2-6 배치신고·적합·제출·수단·접수번호', r['배치신고일'] === `${Y}-01-23` && r['적합 판정'] === '적합' && r['결과보고(9호) 제출일'] === `${Y}-02-05` && r['제출 수단'] === '소방민원센터' && r['접수번호'] === 'RCV-B5')
    check('2-7 세금계산서 승인번호(고객 단위)', r['세금계산서 승인번호(고객 단위, 그해)'] === `APR-${TAG}`, String(r['세금계산서 승인번호(고객 단위, 그해)']))
  }
  const st = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['기술인력'])
  const sm = st.find(x => x['이름'] === `${TAG}주`)
  check('2-8 기술인력 — 주된 점검 1건·자격·번호', !!sm && sm['그해 주된 점검'] === 1 && sm['자격 구분'] === '특급' && sm['경력수첩번호'] === 'LIC-B5', JSON.stringify(sm))
  const iv = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['세금계산서'])
  const ir = iv.find(x => x['승인번호'] === `APR-${TAG}`)
  check('2-9 세금계산서 행·금액', !!ir && ir['합계'] === 330000 && ir['고객'] === TAG, JSON.stringify(ir))
  const msg = (await page.getByTestId('capability-eval-msg').textContent()) ?? ''
  check('2-10 완료 안내 문구', msg.startsWith('✅'), msg.slice(0, 80))
} catch (e) {
  check('예외 없이 완주', false, String(e))
} finally {
  if (bill) { await raw.from('tax_invoices').delete().eq('bill_id', bill); await raw.from('bills').delete().eq('id', bill) }
  if (insp) { await raw.from('inspection_participants').delete().eq('inspection_id', insp); await raw.from('inspection_steps').delete().eq('inspection_id', insp); await raw.from('inspections').delete().eq('id', insp) }
  if (cust) { await raw.from('buildings').delete().eq('customer_id', cust); await cleanupCustomer(cust) }
  if (emp) await delUser(emp)
  if (mgr) await delUser(mgr)
  if (browser) await browser.close()
}
summary()
