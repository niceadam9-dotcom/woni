// mark2 체크쌍(실시/미실시) 왕복 프로브 (2026-09-05) — 별지 9호 ③ 고유값의
// 자체점검·교육훈련 칸이 select→체크쌍으로 바뀐 뒤에도 3상태(''/실시/미실시)가
// 클릭→blur 저장→재로드 복원까지 유지되는지, DB(annex_inputs)에 종전 어휘 그대로 남는지 실측.
// 실행: npx tsx scripts/_probe-mark2-annex.mts  (로컬 dev 서버 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'mark2-annex-probe@erp-test.com'
let userId = ''
let customerId = ''
let inspectionId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '체크쌍프로브', employeeId: 'E2E-MK2' })
  customerId = await mkCustomer({ customer_name: '체크쌍프로브고객', address: '경기 양평군 테스트로 2', created_by: userId })
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-2), inspection_end_date: kstShift(-2),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspectionId = insp!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  await page.click('[data-testid="workbench-stepbar"] button[data-step="submit9"]')
  const p9 = page.locator('[data-annex-fields="report9"]')
  await p9.waitFor({ timeout: 60000 })

  const opGroup = p9.locator('[role="group"][aria-label="자체점검(전년도) 작동점검"]')
  const eduGroup = p9.locator('[role="group"][aria-label="소방안전교육 (전년도)"]')
  await opGroup.waitFor({ timeout: 30000 })

  // ── 1. 초기 상태 — 둘 다 해제(자동 판정) ──
  check('작동점검 [실시] 초기 해제', (await opGroup.locator('button', { hasText: '실시' }).first().getAttribute('aria-pressed')) === 'false')

  // ── 2. 클릭 → blur 저장 → DB 어휘 확인 ──
  await opGroup.locator('button', { hasText: '실시' }).first().click()
  await eduGroup.locator('button', { hasText: '미실시' }).click()
  await page.click('text=제출 전제')   // blur → 저장
  await p9.locator('text=저장됨').waitFor({ timeout: 30000 })
  // 컨테이너 blur는 버튼 사이 포커스 이동에도 발생한다 — 1차 저장(작동점검만)의 '저장됨'을 보고
  // 2차 저장 전에 읽으면 경합 오탐. 두 키가 다 남을 때까지 폴링한다.
  let f: Record<string, string> = {}
  for (let i = 0; i < 30; i++) {
    const { data: saved } = await raw.from('annex_inputs')
      .select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'report9').maybeSingle()
    f = (saved?.fields ?? {}) as Record<string, string>
    if (f.prevOpDone && f.eduDone) break
    await new Promise(r => setTimeout(r, 500))
  }
  check('DB에 prevOpDone=실시 (종전 어휘)', f.prevOpDone === '실시', JSON.stringify(f))
  check('DB에 eduDone=미실시 (종전 어휘)', f.eduDone === '미실시', JSON.stringify(f))

  // ── 3. 재로드 복원 ──
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  await page.click('[data-testid="workbench-stepbar"] button[data-step="submit9"]')
  await opGroup.waitFor({ timeout: 60000 })
  check('재로드 후 [√]실시 유지', (await opGroup.locator('button', { hasText: '실시' }).first().getAttribute('aria-pressed')) === 'true')
  check('재로드 후 교육 [√]미실시 유지', (await eduGroup.locator('button', { hasText: '미실시' }).getAttribute('aria-pressed')) === 'true')

  // ── 4. 다시 누르면 해제 → 자동 판정('')으로 돌아간다 ──
  await opGroup.locator('button', { hasText: '실시' }).first().click()
  await page.click('text=제출 전제')
  await p9.locator('text=저장됨').waitFor({ timeout: 30000 })
  let f2: Record<string, string> = { prevOpDone: '실시' }
  for (let i = 0; i < 30; i++) {
    const { data: saved2 } = await raw.from('annex_inputs')
      .select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'report9').maybeSingle()
    f2 = (saved2?.fields ?? {}) as Record<string, string>
    if ((f2.prevOpDone ?? '') === '') break
    await new Promise(r => setTimeout(r, 500))
  }
  check('해제 시 자동 판정(빈 값) 복귀', (f2.prevOpDone ?? '') === '', JSON.stringify(f2))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspectionId) await raw.from('annex_inputs').delete().eq('inspection_id', inspectionId)
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
}

summary()
