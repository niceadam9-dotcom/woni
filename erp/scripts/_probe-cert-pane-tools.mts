/** 2026-10-06 프로브 — ② 「배치 요약」 칸·페이지 하단 「기타 도구 · 점검 삭제」 폐지 확인 + 화면 캡처
 *  실행: SHOT_DIR=<폴더> npx tsx scripts/_probe-cert-pane-tools.mts   (dev 서버 localhost:3000) */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'cert-pane-probe@erp-test.com'
let userId = '', cust = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
try {
  userId = await mkUser({ email: EMAIL, name: '배치칸프로브', employeeId: 'E2E-CPT', role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ배치칸프로브', created_by: userId, address: '서울시 시험구 3' })
  const { data, error } = await raw.from('inspections').insert({
    customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: '2026-09-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  const insp = data!.id as string
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}?step=2`)
  await page.getByText('점검인력 배치신고').first().waitFor()
  check('② 「점검인력 배치신고」 칸 존속', (await page.getByText('점검인력 배치신고').count()) > 0)
  check('② 「배치 요약」 칸 없음', (await page.getByText('배치 요약', { exact: true }).count()) === 0)
  check('② 「협회 입력값 (복사)」 칸 없음', (await page.getByText('협회 입력값 (복사)').count()) === 0)
  check('② 칸 조정 라벨 = 2칸(왼쪽·오른쪽)', (await page.getByText('왼쪽 칸').count()) > 0 && (await page.getByText('가운데 칸').count()) === 0)
  check('하단 「기타 도구」 없음', (await page.getByText('기타 도구').count()) === 0)
  check('「이 점검 삭제」 없음', (await page.getByText('이 점검 삭제').count()) === 0)
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/cert-step.png` })
} finally {
  try { await browser?.close() } catch { /* ignore */ }
  try {
    if (cust) await cleanupCustomer(cust)
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
