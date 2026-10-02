// B2-2 E2E — 홈택스 엑셀 내보내기(실제 내려받은 파일의 행·열 위치) → 발급 결과 가져오기(승인번호 기록)
// 심은 고객 둘(사업자정보 있음·없음)·청구 둘을 끝에 지운다. 청구월은 실데이터와 겹치지 않는 2099.01.
import XLSXmod from 'xlsx'
const XLSX = (XLSXmod as unknown as { default?: typeof XLSXmod }).default ?? XLSXmod
import { writeFileSync, mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const makeValid = (nine: string) => {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let s = 0
  for (let i = 0; i < 9; i++) s += Number(nine[i]) * w[i]
  s += Math.floor((Number(nine[8]) * 5) / 10)
  return nine + String((10 - (s % 10)) % 10)
}
const BIZ = makeValid('314159265')
const dash = `${BIZ.slice(0, 3)}-${BIZ.slice(3, 5)}-${BIZ.slice(5)}`
const MONTH = '2099.01', DATE = '2099-01-15'
const email = `e2e-b22-${Date.now()}@test.local`
let userId: string | null = null
const custs: string[] = [], bills: string[] = []
let browser: { close: () => Promise<void> } | null = null
try {
  userId = await mkUser({ email, name: 'B2-2 검증', employeeId: `B22-${Date.now() % 100000}`, role: 'admin' })
  const ready = await mkCustomer({ customer_name: `E2E-홈택스준비 ${Date.now() % 10000}`, created_by: userId }); custs.push(ready)
  const notReady = await mkCustomer({ customer_name: `E2E-홈택스미비 ${Date.now() % 10000}`, created_by: userId }); custs.push(notReady)
  await raw.from('billing_profiles').upsert({ customer_id: ready, business_no: dash, company_name: '(주)준비', rep_name: '이준비',
    address: '경기 양평군 테스트로 2', business_type: '서비스', business_item: '관리', tax_email: 'ready@e2e.local' }, { onConflict: 'customer_id' })
  for (const c of custs) {
    const { data, error } = await raw.from('bills').insert({ customer_id: c, billing_month: MONTH, bill_type: '월정액', fee_type: '정액',
      bill_date: DATE, supply_value: 200000, tax_value: 20000, total_amount: 220000, paid_amount: 0, created_by: userId }).select('id').single()
    if (error) throw new Error(`청구 심기 실패: ${error.message}`)
    bills.push((data as { id: string }).id)
  }
  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, email)
  await page.goto(`${BASE}/tax-invoices`, { waitUntil: 'networkidle' })

  console.log('\n[1] 홈택스 엑셀 — 사업자정보 있는 건만 담고, 없는 건은 사유와 함께 뺀다')
  await page.getByTestId('hometax-month').selectOption(MONTH)
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('hometax-export').click()])
  const dir = mkdtempSync(join(tmpdir(), 'hometax-'))
  const path = join(dir, dl.suggestedFilename()); await dl.saveAs(path)
  check('1-1 파일 이름', dl.suggestedFilename() === '홈택스_일괄발급_2099-01.xlsx', dl.suggestedFilename())
  const grid = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(readFileSync(path), { type: 'buffer' }).Sheets['Sheet1'], { header: 1, defval: '' })
  check('1-2 1행 양식 제목', String(grid[0]?.[0]).startsWith('엑셀 업로드 양식'))
  check('1-3 6행 머리글 59열', (grid[5] as unknown[]).length === 59, String((grid[5] as unknown[]).length))
  check('1-4 데이터는 7행부터 1건(사업자정보 있는 고객만)', grid.length === 7, String(grid.length))
  const row = grid[6] as unknown[]
  check('1-5 K 공급받는자 번호 = 하이픈 없는 10자리 텍스트', row[10] === BIZ, String(row[10]))
  check('1-6 B 작성일자 20990115', row[1] === '20990115', String(row[1]))
  check('1-7 T 공급가액 200000 · U 세액 20000', row[19] === 200000 && row[20] === 20000, `${row[19]}/${row[20]}`)
  check('1-8 BG 청구(02)', row[58] === '02', String(row[58]))
  await page.getByTestId('hometax-export-result').waitFor()
  const skippedText = (await page.getByTestId('hometax-skipped').textContent()) ?? ''
  check('1-9 미비 1건 안내', skippedText.includes('미비 1건'), skippedText)

  console.log('\n[2] 발급 결과 가져오기 — 짝이 맞는 청구에 승인번호·발행일 기록')
  const APPROVAL = `2099011541000099${String(Date.now()).slice(-8)}`
  const res: unknown[][] = [['매출 전자세금계산서 목록'], [], [], [], [],
    ['작성일자', '승인번호', '발급일자', '전송일자', '공급자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소',
      '공급받는자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소', '합계금액', '공급가액', '세액'],
    ['2099-01-15', APPROVAL, '2099-01-15', '2099-01-16', '1234567890', '', '본사', '김', '양평', BIZ, '', '(주)준비', '이준비', '', 220000, 200000, 20000],
    ['2099-01-15', 'NO-MATCH-1', '2099-01-15', '2099-01-16', '1234567890', '', '본사', '김', '양평', '0000000000', '', '모름', '', '', 999, 900, 99],
  ]
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(res), 'Sheet1')
  const resPath = join(dir, '매출전자세금계산서목록.xlsx'); writeFileSync(resPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  await page.locator('[data-testid="hometax-bulk-panel"] input[type=file]').setInputFiles(resPath)
  await page.getByTestId('hometax-import-result').waitFor({ timeout: 30000 })
  const impText = (await page.getByTestId('hometax-import-result').textContent()) ?? ''
  check('2-1 승인번호 1건 기록 안내', impText.includes('1건'), impText.slice(0, 120))
  check('2-2 짝 없는 1건 안내', impText.includes('짝을 찾지 못한 1건'), impText.slice(0, 200))
  const { data: ti } = await raw.from('tax_invoices').select('bill_id, approval_num, invoice_status, issue_date').in('bill_id', bills)
  const rec = (ti ?? []) as Array<{ bill_id: string; approval_num: string; invoice_status: string; issue_date: string }>
  check('2-3 준비 고객 청구에 승인번호·발행완료', rec.length === 1 && rec[0].bill_id === bills[0] && rec[0].approval_num === APPROVAL && rec[0].invoice_status === '발행완료', JSON.stringify(rec))
  check('2-4 발행일 = 결과 파일 발급일자', rec[0]?.issue_date === '2099-01-15')

  console.log('\n[3] 같은 결과 파일을 다시 올려도 중복 기록하지 않는다')
  await page.locator('[data-testid="hometax-bulk-panel"] input[type=file]').setInputFiles(resPath)
  await page.waitForTimeout(2500)
  const again = (await page.getByTestId('hometax-import-result').textContent()) ?? ''
  check('3-1 이미 기록된 승인번호 건너뜀', again.includes('이미 기록된 승인번호 1건'), again.slice(0, 160))
  const { count } = await raw.from('tax_invoices').select('id', { count: 'exact', head: true }).in('bill_id', bills)
  check('3-2 행 수 그대로 1', count === 1, String(count))
} catch (e) {
  check('예외 없이 완주', false, String(e))
} finally {
  if (bills.length) { await raw.from('tax_invoices').delete().in('bill_id', bills); await raw.from('bills').delete().in('id', bills) }
  for (const c of custs) { await raw.from('billing_profiles').delete().eq('customer_id', c); await cleanupCustomer(c) }
  if (userId) await delUser(userId)
  if (browser) await browser.close()
}
summary()
