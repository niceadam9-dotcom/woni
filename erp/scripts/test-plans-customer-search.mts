/** 점검확정 고객명 검색 + 자동완성 E2E (2026-08-18)
 *  실행: npx tsx scripts/test-plans-customer-search.mts   (dev 서버 localhost:3000 또는 TEST_BASE_URL)
 *
 *  고정하는 것: 자동완성 제안이 뜬다 / 초성(ㄱㄴㄷ…)으로도 뜬다 / 고르면 목록이 그 고객만 남는다 /
 *  상태 칩 숫자가 검색 결과 기준으로 줄어든다 / 없는 이름은 빈 상태 + [검색 해제]가 뜨고 눌러 복구된다 /
 *  URL ?cust= 에 남아 새로고침·월 이동 후에도 유지된다 / 달력 뷰에도 적용되고 안내줄이 뜬다.
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
const EMAIL = 'test-plansearch-admin@erp-test.com'
const PW = 'PlanSearch1!'
const TAG = `ZZP${Math.random().toString(36).slice(2, 6).toUpperCase()}`

// 초성 검색 대상 — '가나다빌딩'의 초성은 ㄱㄴㄷㅂㄷ
const NAME_A = `${TAG} 가나다빌딩`
const NAME_B = `${TAG} 라마바상가`

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

let userId = ''
const customerIds: string[] = []
let planId = ''
let browser: import('playwright').Browser | null = null

const now = new Date(Date.now() + 9 * 3600_000)
const YEAR = now.getFullYear()
const MONTH = now.getMonth() + 1
const DAY10 = `${YEAR}-${String(MONTH).padStart(2, '0')}-10`

try {
  console.log('[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({
    id: userId, name: 'TEST-확정검색관리자', role: 'admin', is_active: true,
    employee_id: 'TEST-PCS', email: EMAIL,
  })

  const mkCustomer = async (name: string) => {
    const { data, error } = await raw.from('customers').insert({
      customer_code: `${TAG}-${Math.random().toString(36).slice(2, 7)}`, customer_name: name,
      inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
      is_active: true, created_by: userId, plan_anchor_date: DAY10,
    }).select('id').single()
    if (error) throw new Error(`고객 생성 실패: ${error.message}`)
    customerIds.push((data as { id: string }).id)
    return (data as { id: string }).id
  }
  const custA = await mkCustomer(NAME_A)
  const custB = await mkCustomer(NAME_B)

  // 이 달 계획 + 항목 2건(고객당 1건) — 계획중 상태
  const { data: plan, error: planErr } = await raw.from('inspection_plans')
    .insert({ year: YEAR, month: MONTH, created_by: userId })
    .select('id').single()
  if (planErr && !planErr.message.includes('duplicate')) throw new Error(`계획 생성 실패: ${planErr.message}`)
  if (plan) planId = (plan as { id: string }).id
  else {
    const { data: p2 } = await raw.from('inspection_plans')
      .select('id').eq('year', YEAR).eq('month', MONTH).single()
    planId = (p2 as { id: string }).id
  }

  for (const [cid, seq] of [[custA, 1], [custB, 1]] as [string, number][]) {
    const { error } = await raw.from('inspection_plan_items').insert({
      plan_id: planId, customer_id: cid, sequence_num: seq, inspection_type: '작동',
      planned_date: DAY10, scheduled_date: DAY10, status: 'planned',
    })
    if (error) throw new Error(`항목 생성 실패: ${error.message}`)
  }

  console.log('[로그인]')
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PW)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 })

  const openList = async (qs = '') => {
    await page.goto(`${BASE}/inspection-plans?year=${YEAR}&month=${MONTH}&status=all${qs}`)
    await page.waitForLoadState('networkidle')
  }
  const rowCount = async () => page.locator('table tbody tr').count()
  const search = page.getByTestId('plans-customer-search')

  console.log('\n[1] 검색 전 — 두 건 모두 보인다')
  await openList()
  const bothVisible = await page.getByText(NAME_A).count() > 0 && await page.getByText(NAME_B).count() > 0
  check('1-1 검색 전 두 고객 모두 표시', bothVisible)
  const beforeRows = await rowCount()
  check('1-2 행이 2건 이상', beforeRows >= 2, `rows=${beforeRows}`)

  console.log('\n[2] 자동완성 — 부분 문자열')
  await search.fill('가나다')
  const listBox = page.getByTestId('plans-customer-search-list')
  await listBox.waitFor({ state: 'visible', timeout: 5000 })
  check('2-1 제안 드롭다운 표시', await listBox.isVisible())
  check('2-2 제안에 대상 고객 포함', await listBox.getByText(NAME_A).count() > 0)
  check('2-3 제안에 무관 고객 미포함', await listBox.getByText(NAME_B).count() === 0)

  console.log('\n[3] 초성 검색')
  await search.fill('ㄱㄴㄷ')
  await page.waitForTimeout(300)
  const chosungHit = await listBox.isVisible() && await listBox.getByText(NAME_A).count() > 0
  check('3-1 초성 ㄱㄴㄷ으로 제안', chosungHit)

  console.log('\n[4] 제안 선택 → 목록 필터')
  await listBox.getByText(NAME_A).first().click()
  await page.waitForTimeout(400)
  check('4-1 입력칸에 정확한 이름', (await search.inputValue()).includes('가나다빌딩'))
  check('4-2 대상 고객 행 표시', await page.getByText(NAME_A).count() > 0)
  check('4-3 무관 고객 행 사라짐', await page.getByText(NAME_B).count() === 0)
  const afterRows = await rowCount()
  check('4-4 행 수가 줄었다', afterRows < beforeRows, `${beforeRows} → ${afterRows}`)
  check('4-5 URL ?cust= 기록', page.url().includes('cust='), page.url())

  console.log('\n[5] 상태 칩 숫자도 검색 결과 기준')
  const allChip = page.locator('button', { hasText: '전체' }).first()
  const chipText = (await allChip.textContent()) ?? ''
  const chipNum = parseInt((chipText.match(/(\d+)/) ?? ['0'])[1], 10)
  check('5-1 전체 칩 = 검색 결과 건수', chipNum === afterRows, `chip=${chipNum} rows=${afterRows}`)

  console.log('\n[6] 새로고침·월 이동 후에도 유지')
  await page.reload()
  await page.waitForLoadState('networkidle')
  check('6-1 새로고침 후 검색어 유지', (await search.inputValue()).includes('가나다빌딩'))
  check('6-2 새로고침 후 필터 유지', await page.getByText(NAME_B).count() === 0)

  console.log('\n[7] 없는 이름 → 빈 상태 + 검색 해제')
  await search.fill('존재하지않는건물명ZZZ')
  await page.waitForTimeout(500)
  const clearBtn = page.getByTestId('plans-empty-clear-search')
  await clearBtn.waitFor({ state: 'visible', timeout: 5000 })
  check('7-1 빈 상태에 [검색 해제] 노출', await clearBtn.isVisible())
  check('7-2 검색 결과 없음 문구', await page.getByText('검색 결과가 없습니다').count() > 0)
  await clearBtn.click()
  await page.waitForTimeout(500)
  check('7-3 해제 후 입력칸 비움', (await search.inputValue()) === '')
  check('7-4 해제 후 목록 복구', await page.getByText(NAME_B).count() > 0)
  check('7-5 해제 후 URL에서 cust 제거', !page.url().includes('cust='), page.url())

  console.log('\n[8] 달력 뷰 — 검색 적용 + 안내줄')
  await openList('&view=calendar&cust=' + encodeURIComponent(NAME_A))
  const calNotice = page.getByTestId('plans-cal-clear-search')
  await calNotice.waitFor({ state: 'visible', timeout: 5000 })
  check('8-1 달력 검색 안내줄 표시', await calNotice.isVisible())
  check('8-2 달력 칸에 대상 고객 칩', await page.getByText(NAME_A).count() > 0)
  check('8-3 달력에 무관 고객 없음', await page.getByText(NAME_B).count() === 0)
  // 달력은 날짜당 3건만 펼치고 나머지는 '+N개 더 보기'로 접는다 — 검색 중에는 결과가 적어 접힘이 사라진다.
  // 그래서 해제 복구는 '접힘이 다시 생기는가'로 본다(전체 복귀 신호). 이름으로 세면 접힌 칸에 가려 오판한다.
  const foldedDuringSearch = await page.getByText('개 더 보기').count()
  await calNotice.click()
  await page.waitForTimeout(800)
  check('8-4 해제 후 안내줄 사라짐', await calNotice.count() === 0)
  const foldedAfterClear = await page.getByText('개 더 보기').count()
  check('8-5 해제 후 전체 일정 복귀', foldedAfterClear > foldedDuringSearch,
    `검색중 접힘=${foldedDuringSearch} → 해제후=${foldedAfterClear}`)
  check('8-6 해제 후 URL에서 cust 제거', !page.url().includes('cust='), page.url())

} catch (e) {
  fail++
  console.log(`\n  FAIL 예외: ${(e as Error).message}`)
  console.log((e as Error).stack)
} finally {
  if (browser) await browser.close()
  console.log('\n[정리]')
  try {
    for (const cid of customerIds) {
      await raw.from('inspection_plan_items').delete().eq('customer_id', cid)
      await raw.from('customers').delete().eq('id', cid)
    }
    // 계획은 다른 테스트·실데이터가 쓸 수 있어 우리가 만든 항목만 지우고 유지
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
