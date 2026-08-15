// EX-4 재초기화 월 오염 수정 검증 (결정론) — Realtime 없이 같은 effect 경로를 태운다:
// 저장 → router.refresh → responses prop 갱신 → 재초기화 effect(수정 지점).
// 구판: 월 무구분 responses가 부어져 3월 값(X1-01 ○)이 9월 편집기에 주입된다.
// 신판: isExterior면 그 달 스냅샷 재로드 → 주입 없음.
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'ex4-reinit-fix@erp-test.com'
let userId = '', cust = '', insp = ''
let browser = null
try {
  userId = await mkUser({ email: EMAIL, name: '재초기화검증', employeeId: 'E2E-RIF' })
  cust = await mkCustomer({ customer_name: '재초기화검증고객', created_by: userId, inspection_type: '일반관리' })
  const { data, error } = await raw.from('inspections').insert({
    customer_id: cust, inspection_type: '일반관리', sequence_num: 1, plan_type: 'event',
    inspection_start_date: '2026-07-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(error.message)
  insp = data.id
  // 3월분만 존재
  await raw.from('inspection_sheet_responses').insert([
    { inspection_id: insp, item_code: 'X1-01', result: 'O', month: 3, updated_by: userId },
    { inspection_id: insp, item_code: 'X1-02', result: 'X', month: 3, updated_by: userId },
  ])

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}`)
  await page.waitForSelector('text=점검표 입력')
  const monthSel = page.locator('select').filter({ has: page.locator('option', { hasText: '점검일 기준(기본)' }) }).first()
  await monthSel.selectOption('9')
  await page.locator('button', { hasText: '소화기구' }).first().click()
  await page.waitForSelector('[data-testid="sheet-drawer"] [aria-label="X1-01 O"]')
  const activeCls = async (label) => ((await page.locator(`[data-testid="sheet-drawer"] [aria-label="${label}"]`).getAttribute('class')) ?? '')
  check('사전: 9월 편집기 X1-01 공란', !(await activeCls('X1-01 O')).includes('bg-green-500'))

  // 9월에 X1-05만 ○ → 저장 → refresh → 재초기화 effect
  await page.locator('[data-testid="sheet-drawer"] [aria-label="X1-05 O"]').click()
  await page.locator('[data-testid="sheet-drawer"] button:has-text("저장")').click()
  await page.waitForSelector('text=저장했습니다')
  // refresh 반영 대기 — X1-05는 base에 있으니 유지되어야 하고, X1-01(3월분)은 주입되면 안 된다
  await page.waitForTimeout(4000)
  check('저장 후 9월 편집기 X1-05 ○ 유지', (await activeCls('X1-05 O')).includes('bg-green-500'))
  check('★ 저장 후 3월분(X1-01 ○) 미주입', !(await activeCls('X1-01 O')).includes('bg-green-500'), await activeCls('X1-01 O'))
  check('★ 저장 후 3월분(X1-02 ✕) 미주입', !(await activeCls('X1-02 X')).includes('bg-red-500'))

  // DB — 9월엔 X1-05만, 3월 원본 그대로
  const rows = await pollDb(async () => {
    const { data: r } = await raw.from('inspection_sheet_responses')
      .select('item_code, month, result').eq('inspection_id', insp).order('item_code')
    return r?.length ? r : null
  }, 15000)
  const m9 = (rows ?? []).filter(r => r.month === 9)
  check('DB — 9월 행은 X1-05 하나뿐(복제 없음)', m9.length === 1 && m9[0].item_code === 'X1-05', JSON.stringify(m9))
  check('DB — 3월 원본 2행 유지', (rows ?? []).filter(r => r.month === 3).length === 2)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (insp) await raw.from('inspection_sheet_responses').delete().eq('inspection_id', insp)
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
}
summary()
