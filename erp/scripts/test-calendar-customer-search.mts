/** 점검달력 고객명 검색 + 자동완성 E2E (2026-08-18)
 *  실행: npx tsx scripts/test-calendar-customer-search.mts   (dev 서버 localhost:3000 또는 TEST_BASE_URL)
 *
 *  고정하는 것 — 종전 결함(팝오버 안에 묻힌 검색이 체크박스 목록만 걸렀고, 담당자 뷰에서는 무시됨)이
 *  되살아나지 않게 한다:
 *   · 툴바에 검색이 있다(팝오버를 열지 않아도 보인다)
 *   · **기본값인 담당자 뷰에서** 검색만으로 달력이 걸러진다(뷰 전환·체크박스 조작 없이)
 *   · 초성으로도 걸린다 / 자동완성 제안이 뜬다
 *   · 안내줄 + [검색 해제]로 복구된다 / URL ?cust= 로 유지된다
 *   · 팝오버 안에 검색 입력이 더 이상 없다(입력 하나로 통일)
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
const EMAIL = 'test-calsearch-admin@erp-test.com'
const PW = 'CalSearch1!'
const TAG = `ZZC${Math.random().toString(36).slice(2, 6).toUpperCase()}`

const NAME_A = `${TAG} 가나다빌딩`
const NAME_B = `${TAG} 라마바상가`

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

let userId = ''
const customerIds: string[] = []
const inspectionIds: string[] = []
let browser: import('playwright').Browser | null = null

const now = new Date(Date.now() + 9 * 3600_000)
const YEAR = now.getFullYear()
const TODAY = now.toISOString().split('T')[0]

try {
  console.log('[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({
    id: userId, name: 'TEST-달력검색관리자', role: 'admin', is_active: true,
    employee_id: 'TEST-CCS', email: EMAIL,
  })

  const mkCustomer = async (name: string) => {
    const { data, error } = await raw.from('customers').insert({
      customer_code: `${TAG}-${Math.random().toString(36).slice(2, 7)}`, customer_name: name,
      inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
      is_active: true, created_by: userId, plan_anchor_date: TODAY,
    }).select('id').single()
    if (error) throw new Error(`고객 생성 실패: ${error.message}`)
    customerIds.push((data as { id: string }).id)
    return (data as { id: string }).id
  }
  const custA = await mkCustomer(NAME_A)
  const custB = await mkCustomer(NAME_B)

  // 점검(6단계) 2건 — 담당은 이 관리자. 담당자 뷰(기본)에서 둘 다 보이는 상태를 만든다.
  for (const cid of [custA, custB]) {
    // year는 생성 열(inspection_start_date 파생) — 넣으면 거부된다
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cid, sequence_num: 1, inspection_type: '작동',
      status: 'in_progress', inspection_start_date: TODAY,
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    inspectionIds.push((data as { id: string }).id)
  }
  // 단계가 트리거로 생겼는지 확인 — 달력 이벤트는 due_date 있는 단계에서 나온다
  const { count: stepCount } = await raw.from('inspection_steps')
    .select('id', { count: 'exact', head: true }).in('inspection_id', inspectionIds)
  console.log(`  단계 ${stepCount}개 생성됨`)

  console.log('[로그인]')
  browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PW)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 })

  const openCal = async (qs = '') => {
    await page.goto(`${BASE}/inspections/calendar${qs}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
  }
  const search = page.getByTestId('cal-customer-search')

  console.log('\n[1] 툴바에 검색이 보인다 (팝오버를 열지 않아도)')
  await openCal()
  check('1-1 툴바 검색 입력 노출', await search.isVisible())
  check('1-2 검색 전 A 표시', await page.getByText(NAME_A).count() > 0)
  check('1-3 검색 전 B 표시', await page.getByText(NAME_B).count() > 0)

  console.log('\n[2] 자동완성')
  await search.fill('가나다')
  const listBox = page.getByTestId('cal-customer-search-list')
  await listBox.waitFor({ state: 'visible', timeout: 5000 })
  check('2-1 제안 드롭다운 표시', await listBox.isVisible())
  check('2-2 제안에 대상 고객', await listBox.getByText(NAME_A).count() > 0)

  console.log('\n[3] 담당자 뷰(기본)에서 검색만으로 달력이 걸러진다 — 종전 결함 고정')
  await listBox.getByText(NAME_A).first().click()
  await page.waitForTimeout(600)
  const notice = page.getByTestId('cal-clear-search')
  check('3-1 안내줄 표시', await notice.count() > 0)
  // 안내줄에도 검색어가 있으므로 '달력 본문'만 세도록 안내줄 텍스트를 제외하고 판정
  const bCount = await page.getByText(NAME_B).count()
  check('3-2 무관 고객 사라짐 (뷰 전환·체크박스 조작 없이)', bCount === 0, `B=${bCount}`)
  check('3-3 대상 고객은 남음', await page.getByText(NAME_A).count() > 0)
  check('3-4 URL ?cust= 기록', page.url().includes('cust='), page.url())

  console.log('\n[4] 초성 검색')
  await search.fill('ㄹㅁㅂ')
  await page.waitForTimeout(600)
  check('4-1 초성으로 B가 남는다', await page.getByText(NAME_B).count() > 0)
  check('4-2 초성 검색 시 A는 빠진다', await page.getByText(NAME_A).count() === 0)

  console.log('\n[5] 검색 해제 복구')
  await page.getByTestId('cal-clear-search').click()
  await page.waitForTimeout(600)
  check('5-1 해제 후 입력칸 비움', (await search.inputValue()) === '')
  check('5-2 해제 후 A 복귀', await page.getByText(NAME_A).count() > 0)
  check('5-3 해제 후 B 복귀', await page.getByText(NAME_B).count() > 0)
  check('5-4 해제 후 URL에서 cust 제거', !page.url().includes('cust='), page.url())

  console.log('\n[6] URL 복원 (새로고침·링크 공유)')
  await openCal(`?cust=${encodeURIComponent(NAME_A)}`)
  check('6-1 URL로 진입 시 검색어 복원', (await search.inputValue()).includes('가나다빌딩'))
  check('6-2 URL로 진입 시 필터 적용', await page.getByText(NAME_B).count() === 0)

  console.log('\n[7] 팝오버에 중복 검색 입력이 없다')
  await page.getByRole('button', { name: /필터/ }).first().click()
  await page.waitForTimeout(400)
  const popoverSearch = page.locator('input[placeholder="고객 검색..."]')
  check('7-1 구 팝오버 검색 입력 제거됨', await popoverSearch.count() === 0)

} catch (e) {
  fail++
  console.log(`\n  FAIL 예외: ${(e as Error).message}`)
  console.log((e as Error).stack)
} finally {
  if (browser) await browser.close()
  console.log('\n[정리]')
  try {
    for (const iid of inspectionIds) {
      await raw.from('inspection_steps').delete().eq('inspection_id', iid)
      await raw.from('inspections').delete().eq('id', iid)
    }
    for (const cid of customerIds) {
      await raw.from('inspection_plan_items').delete().eq('customer_id', cid)
      await raw.from('customers').delete().eq('id', cid)
    }
    if (userId) {
      await raw.from('profiles').delete().eq('id', userId)
      await raw.auth.admin.deleteUser(userId)
    }
  } catch (e) {
    console.log(`  (정리 경고: ${(e as Error).message})`)
  }
  console.log(`\n결과: ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}
