// 소방계획서 한글파일 E2E — 탭의 [한글] 버튼이 HWPX를 받는가(라우트·버튼·고지 한 바퀴, 2026-10-06)
// 스테이징 고객 한 명(사용승인일 있는 활성 고객) — 읽기만 한다. 실행: node scripts/_verify-fire-plan-hwpx.mjs (dev 서버 필요)
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { launch, login, mkUser, delUser, check, summary, raw, BASE } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-fireplan-hwpx@test.local'
const uid = await mkUser({ email: EMAIL, name: 'E2EFH', employeeId: 'EFH', role: 'admin' })
const { data: cust } = await raw.from('customers').select('id, customer_name')
  .eq('is_active', true).not('use_approval_date', 'is', null).order('customer_name').limit(1).single()
const { browser, page } = await launch()
try {
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${cust.id}?tab=plan`)
  await page.waitForSelector('[data-testid="fire-plan-hwpx"]', { timeout: 60000 })
  check('소방계획서 탭에 [한글] 버튼', await page.isVisible('[data-testid="fire-plan-hwpx"]'))
  check('[엑셀 받기] 버튼도 그대로', await page.isVisible('[data-testid="fire-plan-xlsx"]'))
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('[data-testid="fire-plan-hwpx"]')])
  const name = dl.suggestedFilename()
  check('파일 이름 = {고객}_소방계획서_{연도}.hwpx', name.endsWith('.hwpx') && name.includes('소방계획서'), name)
  const bytes = readFileSync(await dl.path())
  const zip = await JSZip.loadAsync(bytes)
  const x = await zip.file('Contents/section0.xml').async('string')
  check('HWPX 구조(mimetype 첫 항목·표 95)', bytes.subarray(30, 38).toString() === 'mimetype' && (x.match(/<hp:tbl /g) ?? []).length === 95)
  check('고객 이름이 본문에', x.includes(cust.customer_name.replace(/&/g, '&amp;')), cust.customer_name)
  check('흔적 「리젠시빌」 없음', !x.includes('리젠시빌'))
  await page.waitForSelector('[data-testid="plan-bar-xlsx-notice"]', { timeout: 10000 }).catch(() => null)
  const notice = await page.locator('[data-testid="plan-bar-xlsx-notice"]').innerText().catch(() => '')
  check('고지 제목 = 「한글파일 고지」', notice.startsWith('한글파일 고지'), notice.slice(0, 40))
} finally { await browser.close(); await delUser(uid) }
summary()
