/** 점검 업무 목록 고객명 검색 + 자동완성 E2E (2026-08-18)
 *  실행: npx tsx scripts/test-inspection-customer-search.mts  (dev 서버 localhost:3000 또는 TEST_BASE_URL)
 *
 *  고정하는 것: 자동완성 제안이 뜬다 / 고르면 목록이 그 고객으로 걸러진다 / 점검 건이 없는
 *  고객은 제안에 없다(고르면 0건이 되는 이름) / 없는 이름은 전체가 아니라 0건 / 페이지 이동에
 *  검색어가 유지된다.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'test-inspsearch-admin@erp-test.com'
const PW = 'InspSearch1!'
const TAG = `ZZQ${Math.random().toString(36).slice(2, 6).toUpperCase()}`

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

let userId = ''
const customerIds: string[] = []
const inspectionIds: string[] = []
let browser: import('playwright').Browser | null = null

try {
  console.log('[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-점검검색관리자', role: 'admin', is_active: true, employee_id: 'TEST-ISR', email: EMAIL })

  // 점검 건이 있는 고객 2명(둘 다 같은 TAG를 포함해 자동완성 제안이 복수로 뜨게) + 점검 없는 고객 1명
  const mkCustomer = async (name: string) => {
    const { data, error } = await raw.from('customers').insert({
      customer_code: `${TAG}-${Math.random().toString(36).slice(2, 7)}`, customer_name: name,
      inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
      is_active: true, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`고객 생성 실패: ${error.message}`)
    customerIds.push(data!.id)
    return data!.id
  }
  const c1 = await mkCustomer(`${TAG}가나빌딩`)
  const c2 = await mkCustomer(`${TAG}다라타워`)
  const c3 = await mkCustomer(`${TAG}점검없는곳`)

  // sequence_num=2는 종합 전용이라 작동 점검 2건은 연도를 달리 만든다(year는 시작일 기반 생성열)
  const mkInspection = async (cid: string, startDate: string) => {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cid, sequence_num: 1, inspection_type: '작동', assigned_employee_id: userId,
      inspection_start_date: startDate, status: 'in_progress', created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    inspectionIds.push(data!.id)
  }
  await mkInspection(c1, '2026-08-18')
  await mkInspection(c1, '2025-08-18')   // c1 = 2건
  await mkInspection(c2, '2026-08-18')   // c2 = 1건
  console.log(`  셋업 완료 (TAG=${TAG})`)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  console.log('[1] 자동완성 제안')
  await page.goto(`${BASE}/inspections`)
  const box = page.getByRole('textbox', { name: '고객명 검색', exact: true })
  await box.waitFor()
  await box.fill(TAG)
  const panel = page.locator('text=고객 (선택 시 목록 필터)')
  await panel.waitFor({ timeout: 15000 })
  check('입력 시 자동완성 드롭다운 표시', await panel.count() === 1)
  check('점검 있는 고객 2건 제안', await page.getByRole('button', { name: new RegExp(`${TAG}(가나빌딩|다라타워)`) }).count() === 2)
  check('점검 없는 고객은 제안 제외', await page.getByRole('button', { name: new RegExp(`${TAG}점검없는곳`) }).count() === 0)
  check('제안에 점검 건수 표시', await page.locator('text=2건').count() > 0)

  console.log('[2] 제안 선택 → 목록 필터')
  await page.getByRole('button', { name: new RegExp(`${TAG}가나빌딩`) }).click()
  await page.waitForURL(u => u.searchParams.get('q') === `${TAG}가나빌딩`, { timeout: 20000 })
  check('선택 시 상세로 이탈하지 않고 목록 유지', new URL(page.url()).pathname === '/inspections')
  const rows = await page.locator('table tbody tr').count()
  check('선택한 고객의 점검 2건만 표시', rows === 2, `${rows}행`)
  check('다른 고객 행 미표시', await page.locator(`text=${TAG}다라타워`).count() === 0)
  check('검색어가 입력창에 유지', await page.getByRole('textbox', { name: '고객명 검색', exact: true }).inputValue() === `${TAG}가나빌딩`)

  console.log('[2-b] 고객코드는 검색 축이 아니다')
  const codeOf = async (cid: string) => {
    const { data } = await raw.from('customers').select('customer_code').eq('id', cid).single()
    return (data as { customer_code: string }).customer_code
  }
  const c1Code = await codeOf(c1)
  await page.goto(`${BASE}/inspections?q=${encodeURIComponent(c1Code)}`)
  await page.locator('text=/해당하는 점검 업무가 없습니다/').waitFor({ timeout: 15000 })
  check('고객코드로는 검색되지 않음(이름 축 전용)', await page.locator('table tbody tr').count() === 0, c1Code)
  const kbCode = page.getByRole('textbox', { name: '고객명 검색', exact: true })
  await kbCode.fill(c1Code)
  await page.waitForTimeout(1200)
  check('고객코드는 자동완성 제안도 없음', await page.locator('text=고객 (선택 시 목록 필터)').count() === 0)

  console.log('[3] 키보드 조작 (↓ Enter)')
  await page.goto(`${BASE}/inspections`)
  const kbBox = page.getByRole('textbox', { name: '고객명 검색', exact: true })
  await kbBox.fill(TAG)
  await page.locator('text=고객 (선택 시 목록 필터)').waitFor({ timeout: 15000 })
  await kbBox.press('ArrowDown')
  await kbBox.press('Enter')
  await page.waitForURL(u => (u.searchParams.get('q') ?? '').startsWith(TAG), { timeout: 20000 })
  check('↓ + Enter로 제안 선택', (new URL(page.url()).searchParams.get('q') ?? '').length > TAG.length)

  await kbBox.fill(TAG)
  await page.locator('text=고객 (선택 시 목록 필터)').waitFor({ timeout: 15000 })
  await kbBox.press('Escape')
  check('Esc로 드롭다운 닫힘', await page.locator('text=고객 (선택 시 목록 필터)').count() === 0)

  console.log('[4] 부분 문자열 · 없는 이름 · 초기화')
  await page.goto(`${BASE}/inspections?q=${encodeURIComponent(TAG)}`)
  await page.locator('table tbody tr').first().waitFor()
  const partial = await page.locator('table tbody tr').count()
  check('부분 문자열은 두 고객 3건 전부', partial === 3, `${partial}행`)

  await page.goto(`${BASE}/inspections?q=${encodeURIComponent(TAG)}없는이름ZZ`)
  await page.locator('text=/해당하는 점검 업무가 없습니다/').waitFor({ timeout: 15000 })
  check('일치 고객 없으면 전체가 아니라 0건', await page.locator('table tbody tr').count() === 0)

  await page.goto(`${BASE}/inspections?q=${encodeURIComponent(TAG)}`)
  await page.getByRole('link', { name: '초기화' }).click()
  await page.waitForURL(u => !u.searchParams.get('q'), { timeout: 20000 })
  check('초기화로 검색어 해제', (await page.locator('table tbody tr').count()) > 3)

  console.log('[5] 페이지 이동 시 검색어 유지')
  await page.goto(`${BASE}/inspections?q=${encodeURIComponent(TAG)}&per_page=1`)
  await page.locator('table tbody tr').first().waitFor()
  check('1건씩 페이지 나눔', await page.locator('table tbody tr').count() === 1)
  await page.getByRole('link', { name: '다음' }).click()
  await page.waitForURL(u => u.searchParams.get('page') === '2', { timeout: 20000 })
  check('다음 페이지에도 q 유지', new URL(page.url()).searchParams.get('q') === TAG)
  check('2페이지도 검색 결과 범위 내', await page.locator('table tbody tr').count() === 1)
} catch (e) {
  fail++
  console.error('ERROR:', e instanceof Error ? e.message : e)
} finally {
  if (browser) await browser.close()
  console.log('[정리]')
  for (const id of inspectionIds) {
    await raw.from('inspection_steps').delete().eq('inspection_id', id)
    await raw.from('inspections').delete().eq('id', id)
  }
  for (const id of customerIds) await raw.from('customers').delete().eq('id', id)
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId).catch(() => {}) }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
}
