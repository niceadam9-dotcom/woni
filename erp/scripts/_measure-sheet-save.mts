// 점검표 드로어 저장 속도 실측 — 저장 버튼 클릭 → ①완료 알림(액션 응답) → ②버튼 재활성(트랜지션 종료: refresh 포함)
// 실행: npx tsx scripts/_measure-sheet-save.mts   (로컬 dev :3000 + 스테이징 DB)
// E2E 전용 고객·점검을 만들고 끝나면 지운다 — 실데이터 무오염.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'save-perf-e2e@erp-test.com'
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '저장측정E2E', employeeId: 'E2E-SAV' })
  cust = await mkCustomer({ customer_name: '저장측정E2E고객', created_by: userId })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: null,
      inspection_start_date: '2026-07-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}`)
  await page.waitForSelector('[data-testid="sheet-group-board"]')

  // 첫 시트 카드 → 드로어
  await page.locator('[data-group-key]').first().click()
  await page.waitForSelector('[data-testid="sheet-drawer"]')
  const saveBtn = page.getByTestId('sheet-drawer').getByRole('button', { name: '저장', exact: true })

  // 서버 액션 POST 왕복도 별도 계측 (next-action 헤더 요청)
  const actionMs: number[] = []
  const started = new Map<string, number>()
  page.on('request', r => { if (r.method() === 'POST' && r.headers()['next-action']) started.set(r.url() + r.headers()['next-action'], Date.now()) })
  page.on('response', async r => {
    const req = r.request()
    if (req.method() === 'POST' && req.headers()['next-action']) {
      const k = req.url() + req.headers()['next-action']
      const t0 = started.get(k)
      if (t0) { actionMs.push(Date.now() - t0); started.delete(k) }
    }
  })

  async function measureSave(label: string, mutate: () => Promise<void>) {
    await mutate()
    actionMs.length = 0
    const t0 = Date.now()
    await saveBtn.click()
    await page.waitForSelector('text=저장했습니다', { timeout: 30000 })
    const tNotice = Date.now() - t0
    // 트랜지션 종료(= router.refresh 포함) — 버튼 재활성까지
    await page.waitForFunction(() => {
      const btns = [...document.querySelectorAll('[data-testid="sheet-drawer"] button')]
      const b = btns.find(x => x.textContent?.trim() === '저장')
      return b ? !(b as HTMLButtonElement).disabled : false
    }, { timeout: 30000 })
    const tIdle = Date.now() - t0
    // 잔여 refresh 렌더가 네트워크에 남아있을 수 있어 잠시 정리
    await page.waitForTimeout(1500)
    console.log(`${label}: 액션응답(알림) ${tNotice}ms · 완전종료(버튼 재활성) ${tIdle}ms · 액션POST ${actionMs.join('/') || '-'}ms`)
    return { tNotice, tIdle }
  }

  const oBtn = (i: number) => page.locator('[data-testid="sheet-drawer"] button[aria-label$=" O"]').nth(i)
  const xBtn = (i: number) => page.locator('[data-testid="sheet-drawer"] button[aria-label$=" X"]').nth(i)

  const r1 = await measureSave('save#1 (O 10건 신규)', async () => {
    for (let i = 0; i < 10; i++) await oBtn(i).click()
  })
  const r2 = await measureSave('save#2 (5건 O→X 변경)', async () => {
    for (let i = 0; i < 5; i++) await xBtn(i).click()
  })
  const r3 = await measureSave('save#3 (5건 X→O 복귀)', async () => {
    for (let i = 0; i < 5; i++) await oBtn(i).click()
  })

  const avgN = Math.round((r1.tNotice + r2.tNotice + r3.tNotice) / 3)
  const avgI = Math.round((r1.tIdle + r2.tIdle + r3.tIdle) / 3)
  console.log(`\n평균: 액션응답 ${avgN}ms · 완전종료 ${avgI}ms`)
} finally {
  if (browser) await browser.close()
  if (insp) await raw.from('inspection_sheet_responses').delete().eq('inspection_id', insp)
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
}
