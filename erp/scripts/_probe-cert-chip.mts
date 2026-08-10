// 배치확인서 칩 활성화 프로브 (2026-08-10, 소방계획서_14 #14 개선1)
// 전체 미리보기 요약 바의 배치확인서 칩이 종전엔 클릭 불가 <span>이라 "⚠없음"을 봐도 할 일이 없었다.
// 이제 없으면 [업로드](협회 발급본), 있으면 [열기] 버튼이어야 한다.
// 실행: npx tsx scripts/_probe-cert-chip.mts  (dev 서버 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'cert-chip-e2e@erp-test.com'
let userId = ''
let customerId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const kstShift = (days: number) => {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '배치칩E2E', employeeId: 'E2E-CERT' })
  customerId = await mkCustomer({ customer_name: '배치칩E2E고객', address: '경기 양평군 테스트로 9', created_by: userId })
  const { data: ins, error } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspId = ins!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=annex`)
  await page.locator('text=🔍 전체 미리보기').first().click()
  await page.waitForSelector('text=— 전체 미리보기')

  // ① 없음 상태 — 칩이 버튼이고 업로드를 안내한다
  const missChip = page.getByRole('button', { name: /배치확인서 ⚠없음 — 업로드/ })
  await missChip.waitFor({ state: 'visible', timeout: 30000 })
  // 미리보기가 렌더되는 동안에도 눌려야 한다 — 공용 pending에 묶으면 몇 초간 죽은 버튼이 된다
  check('없음 상태 — 칩이 즉시 클릭 가능(미리보기 렌더 중 포함)', await missChip.isEnabled())
  check('없음 상태 — 업로드 안내 문구', (await missChip.textContent())?.includes('업로드') === true)

  // ② 그 자리에서 업로드 → DB(스토리지) 반영 + 칩이 ✓로 전환
  await page.locator('div.fixed input[type=file]').first().setInputFiles({
    name: 'cert.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e cert'),
  })
  await page.waitForSelector('text=✅ 업로드됨', { timeout: 30000 })
  check('업로드 — 성공 피드백이 미리보기 안에서 표시', true)

  const { data: objs } = await raw.storage.from('fire-plans').list(`${customerId}/inspections/${inspId}`, { limit: 50 })
  check('업로드 — cert_ 슬롯 파일 저장', (objs ?? []).some((o: { name: string }) => /^cert_\d+\./.test(o.name)),
    `실제: ${JSON.stringify((objs ?? []).map((o: { name: string }) => o.name))}`)

  const haveChip = page.getByRole('button', { name: '배치확인서 ✓' })
  await haveChip.waitFor({ state: 'visible', timeout: 30000 })
  // trial 클릭 = 실제 클릭 없이 '클릭 가능해질 때까지' 대기 — 업로드 직후 재조회 중엔 잠시 비활성이다
  await haveChip.click({ trial: true, timeout: 20000 })
  check('보유 상태 — 칩이 ✓ 열기 버튼으로 전환(클릭 가능)', true)
  check('보유 상태 — ⚠없음 문구 사라짐', (await page.getByText('배치확인서 ⚠없음').count()) === 0)
} catch (e) {
  check('예외 없음', false, String((e as Error)?.message ?? e))
} finally {
  if (customerId && inspId) {
    const { data: objs } = await raw.storage.from('fire-plans').list(`${customerId}/inspections/${inspId}`, { limit: 50 })
    const paths = (objs ?? []).map((o: { name: string }) => `${customerId}/inspections/${inspId}/${o.name}`)
    if (paths.length) await raw.storage.from('fire-plans').remove(paths).catch(() => {})
  }
  await cleanupCustomer(customerId).catch(() => {})
  await delUser(userId).catch(() => {})
  if (browser) await browser.close().catch(() => {})
}
summary()
