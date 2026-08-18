/** 최근 본 고객 스트립 E2E (2026-08-18)
 *  실행: npx tsx scripts/test-recent-customers.mts  (dev 서버 localhost:3000 또는 TEST_BASE_URL)
 *
 *  고정하는 것: 고객 상세를 열면 기록된다 / 두 목록에 칩이 뜬다 / 최근 순으로 앞에 온다 /
 *  중복 없이 한 번만 / **어느 화면에서 눌러도 고객 상세로 간다**(2026-08-18 사용자 확정 —
 *  종전엔 점검업무에서만 ?q= 목록 필터라 같은 칩이 화면마다 다르게 동작했다) /
 *  **기본 목록 정렬은 바뀌지 않는다**(이번 설계의 핵심 — 스트립은 얹기만 한다) /
 *  계정이 다르면 기록이 섞이지 않는다 / 지우기.
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
const TAG = `ZZR${Math.random().toString(36).slice(2, 6).toUpperCase()}`
const USERS = [
  { email: 'test-recent-a@erp-test.com', pw: 'Recent1!', name: 'TEST-최근A', empId: 'TEST-RCA' },
  { email: 'test-recent-b@erp-test.com', pw: 'Recent2!', name: 'TEST-최근B', empId: 'TEST-RCB' },
]

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

const userIds: string[] = []
const customerIds: string[] = []
let inspectionId = ''
let browser: import('playwright').Browser | null = null

try {
  console.log('[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (USERS.some(x => x.email === u.email)) await raw.auth.admin.deleteUser(u.id)
  for (const u of USERS) {
    const { data: nu } = await raw.auth.admin.createUser({ email: u.email, password: u.pw, email_confirm: true })
    userIds.push(nu!.user!.id)
    await raw.from('profiles').upsert({
      id: nu!.user!.id, name: u.name, role: 'admin', is_active: true, employee_id: u.empId, email: u.email,
    })
  }

  const names = [`${TAG}첫째빌딩`, `${TAG}둘째타워`, `${TAG}셋째상가`]
  for (const n of names) {
    const { data, error } = await raw.from('customers').insert({
      customer_code: `${TAG}-${Math.random().toString(36).slice(2, 7)}`, customer_name: n,
      inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
      is_active: true, created_by: userIds[0],
    }).select('id').single()
    if (error) throw new Error(`고객 생성 실패: ${error.message}`)
    customerIds.push(data!.id)
  }
  // 점검업무 칩 필터 확인용 — 첫째빌딩에 점검 1건
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: customerIds[0], sequence_num: 1, inspection_type: '작동', assigned_employee_id: userIds[0],
      inspection_start_date: '2026-08-18', status: 'in_progress', created_by: userIds[0],
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    inspectionId = data!.id
  }
  console.log(`  셋업 완료 (TAG=${TAG})`)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  const login = async (u: typeof USERS[number]) => {
    await page.goto(`${BASE}/login`)
    await page.fill('input[type=email]', u.email)
    await page.fill('input[type=password]', u.pw)
    await page.click('button[type=submit]')
    await page.waitForURL(x => !x.pathname.includes('/login'), { timeout: 30000 })
  }
  // 고객명은 아래 표에도 링크로 있다 — 칩은 반드시 스트립 안으로 범위를 좁혀 찾는다
  const strip = () => page.locator('[data-recent-strip]')
  const chip = (name: string) => strip().getByRole('link', { name, exact: true })
  const chipTexts = () => strip().getByRole('link').allInnerTexts()

  await login(USERS[0])

  console.log('[1] 기록 전 — 스트립 없음')
  await page.goto(`${BASE}/customers`)
  await page.locator('table tbody tr').first().waitFor()
  check('조회 이력 없으면 스트립 미표시', await strip().count() === 0)
  // 기본 정렬 기준선 — 스트립 도입 후에도 이 순서가 유지돼야 한다
  const firstRowBefore = (await page.locator('table tbody tr').first().innerText()).slice(0, 40)

  console.log('[2] 고객 상세 방문 → 기록')
  for (const id of customerIds) {
    await page.goto(`${BASE}/customers/${id}`)
    await page.locator('h1').first().waitFor()
  }
  await page.goto(`${BASE}/customers`)
  await strip().waitFor({ timeout: 15000 })
  check('방문 후 스트립 표시', await strip().count() === 1)
  check('방문한 3개 고객 전부 칩으로', (await Promise.all(names.map(n => chip(n).count()))).every(c => c === 1))

  const order = await chipTexts()
  check('최근 방문이 맨 앞', order[0]?.trim() === names[2], JSON.stringify(order.slice(0, 3)))

  console.log('[3] 기본 정렬 불변 (설계 핵심)')
  const firstRowAfter = (await page.locator('table tbody tr').first().innerText()).slice(0, 40)
  check('스트립이 생겨도 목록 첫 행은 그대로', firstRowAfter === firstRowBefore, `${firstRowBefore} → ${firstRowAfter}`)

  console.log('[4] 중복 방지 · 재방문 시 앞으로')
  await page.goto(`${BASE}/customers/${customerIds[0]}`)
  await page.locator('h1').first().waitFor()
  await page.goto(`${BASE}/customers`)
  await strip().waitFor()
  check('재방문해도 칩은 1개(중복 없음)', await chip(names[0]).count() === 1)
  const reordered = await chipTexts()
  check('재방문 고객이 맨 앞으로', reordered[0]?.trim() === names[0], JSON.stringify(reordered.slice(0, 3)))

  console.log('[5] 고객관리 칩 → 상세 이동')
  await chip(names[1]).click()
  await page.waitForURL(u => u.pathname === `/customers/${customerIds[1]}`, { timeout: 20000 })
  check('칩 클릭 시 고객 상세로', page.url().includes(customerIds[1]))

  console.log('[6] 점검업무 칩 → 고객 상세 이동 (2026-08-18 사용자 확정, 고객관리와 동일)')
  await page.goto(`${BASE}/inspections`)
  await strip().waitFor({ timeout: 15000 })
  check('점검업무에도 스트립 표시', await strip().count() === 1)
  await chip(names[0]).click()
  await page.waitForURL(u => u.pathname === `/customers/${customerIds[0]}`, { timeout: 20000 })
  check('점검업무 칩도 고객 상세로 이동', page.url().includes(customerIds[0]))
  // 종전 규약(?q= 목록 필터)으로 되돌아가지 않았는지 — 화면마다 다르게 동작하던 것을 없앤 것이 이번 변경이다
  check('목록 필터(?q=)로 가지 않는다', !page.url().includes('q='), page.url())
  // 고객으로 거르는 동선은 검색창이 그대로 담당한다(칩이 빠져나간 자리를 대신하는지 확인)
  await page.goto(`${BASE}/inspections?q=${encodeURIComponent(names[0])}`)
  await page.locator('table tbody tr').first().waitFor({ timeout: 20000 })
  const rows = await page.locator('table tbody tr').count()
  check('검색창 축은 그대로 — 그 고객의 점검 1건만', rows === 1, `${rows}행`)
  check('검색창에도 값 반영', await page.getByRole('textbox', { name: '고객명 검색', exact: true }).inputValue() === names[0])

  console.log('[7] 계정 분리')
  await login(USERS[1])
  await page.goto(`${BASE}/customers`)
  await page.locator('table tbody tr').first().waitFor()
  check('다른 계정은 기록이 섞이지 않음', await strip().count() === 0)

  console.log('[8] 지우기')
  await login(USERS[0])
  await page.goto(`${BASE}/customers`)
  await strip().waitFor({ timeout: 15000 })
  check('재로그인해도 기록 유지', await strip().count() === 1)
  await page.getByRole('button', { name: '최근 본 고객 지우기' }).click()
  await page.waitForTimeout(500)
  check('지우기 후 스트립 사라짐', await strip().count() === 0)
} catch (e) {
  fail++
  console.error('ERROR:', e instanceof Error ? e.message : e)
} finally {
  if (browser) await browser.close()
  console.log('[정리]')
  if (inspectionId) {
    await raw.from('inspection_steps').delete().eq('inspection_id', inspectionId)
    await raw.from('inspections').delete().eq('id', inspectionId)
  }
  for (const id of customerIds) await raw.from('customers').delete().eq('id', id)
  for (const id of userIds) {
    await raw.from('profiles').delete().eq('id', id)
    await raw.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
  process.exitCode = fail > 0 ? 1 : 0
}
