// 재현 — 관계인 카드 [구분]과 소방안전관리 [대표자 구분]은 **같은 컬럼**(customers.rep_role)인데
// 두 화면이 살아서 동기화되는가? 그리고 패널 [저장]이 방금 고른 값을 덮어쓰지 않는가?
import { launch, login, mkUser, delUser, mkCustomer, cleanupCustomer, pollDb, check, summary, raw } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-reprole@test.local'
const NAME = `ZZ대표자구분${Math.random().toString(36).slice(2, 6)}`
const uid = await mkUser({ email: EMAIL, name: 'E2ERR', employeeId: 'ERR', role: 'admin' })
let custId = null
const { browser, page } = await launch()
// ⚠ 헬퍼 기본값 15초는 **다른 세션이 동시에 빌드 중일 때** 로그인조차 못 넘긴다(2026-09-14 실측).
//   서버는 200을 주는데 페이지 load가 늦는 것이므로, 대기만 늘린다.
page.setDefaultTimeout(60000)
page.setDefaultNavigationTimeout(60000)
// ⚠ 선택 판정을 `bg-brand`로 하면 **미선택의 `hover:bg-brand-tint`가 함께 걸린다** —
//   처음에 그렇게 해서 세 칸이 전부 「선택됨」으로 읽혔다(계측기가 먼저 틀린 경우).
//   두 세그먼트 모두 선택 시에만 `text-white`가 붙으므로 그것만 본다.
const onOf = bs => bs.filter(b => b.className.split(/\s+/).includes('text-white')).map(b => b.textContent.trim())
const segOf = async (label) => {
  const box = page.locator(`label:has-text("${label}")`).locator('xpath=..').first()
  return (await box.locator('button').evaluateAll(onOf)).join(',')
}
const cardSeg = async () => {
  const box = page.locator('span:text-is("구분")').first().locator('xpath=..')
  return (await box.locator('button').evaluateAll(onOf)).join(',')
}
try {
  custId = await mkCustomer({
    customer_name: NAME, created_by: uid, assigned_employee_id: uid,
    use_approval_date: '2020-05-10', plan_anchor_date: '2026-05-10',
    inspection_type: '종합', inspection_sub_type: '종합', rep_role: null,
  })
  await raw.from('customer_contacts').insert({
    customer_id: custId, role: '대표', name: '홍대표', phone: '010-1111-2222',
  })
  await login(page, EMAIL)
  await page.goto(`http://localhost:3000/customers/${custId}?tab=contacts`)
  await page.waitForSelector('[data-testid="fsm-save"]', { timeout: 25000 })

  const before = await segOf('대표자 구분')
  check('시작 상태: 대표자 구분 비어 있다', before === '', `"${before}"`)

  // ① 관계인 카드에서 [관리자] 클릭 (클릭 즉시 저장 규약)
  // 대표 카드의 「구분」은 <span>구분</span> 옆 세그먼트다(대표 역할 카드에만 있다)
  const card = page.locator('span:text-is("구분")').first().locator('xpath=..')
  console.log('  카드 세그먼트 개수:', await card.locator('button').count(), '| 현재 선택:', await cardSeg())
  await card.locator('button:text-is("관리자")').first().click()
  console.log('  클릭 후 카드 선택:', await cardSeg())
  // ⚠ 고정 sleep으로 재면 경합에 걸린다 — 저장은 서버 왕복이라 2.5초로는 못 잡는다(실측)
  const saved = await pollDb(async () => {
    const { data } = await raw.from('customers').select('rep_role').eq('id', custId).single()
    return data?.rep_role === '관리자' ? data : null
  }, 15000)
  check('① 카드 클릭이 DB에 저장된다', !!saved, '15초 내 rep_role=관리자 아님')

  // ② 같은 화면의 [대표자 구분]이 따라오는가 — 여기가 사용자가 말한 「자동입력」이다
  const panelNow = await segOf('대표자 구분')
  check('② 소방안전관리 [대표자 구분]도 즉시 관리자가 된다', panelNow === '관리자', `"${panelNow}"`)

  // ③ 그 상태에서 패널을 저장하면 방금 고른 값이 살아남는가 (덮어쓰기 사고 여부)
  await page.locator('label:has-text("최근 교육이수일")').locator('xpath=..').first()
    .locator('input:not([type="date"])').first().fill('2026-08-01')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="fsm-save"]').click()
  // 저장 완료를 **교육이수일이 들어온 것**으로 확인한 뒤 rep_role을 본다(저장 자체를 기다린다)
  const done = await pollDb(async () => {
    const { data } = await raw.from('customers').select('rep_role, manager_edu_date').eq('id', custId).single()
    return data?.manager_edu_date === '2026-08-01' ? data : null
  }, 15000)
  check('패널 저장이 실제로 끝났다(전제)', !!done, '교육이수일이 15초 내 안 들어옴')
  check('③ 패널 저장이 rep_role을 덮어쓰지 않는다', done?.rep_role === '관리자',
    `rep_role=${done?.rep_role} (edu=${done?.manager_edu_date})`)
  // ④ 역방향 — 패널에서 누르면 카드가 따라오고, 그 자리에서 저장되는가(클릭 즉시 저장 규약)
  const panelBox = page.locator('label:has-text("대표자 구분")').locator('xpath=..').first()
  await panelBox.locator('button:text-is("점유자")').first().click()
  const back = await pollDb(async () => {
    const { data } = await raw.from('customers').select('rep_role').eq('id', custId).single()
    return data?.rep_role === '점유자' ? data : null
  }, 15000)
  check('④ 패널에서 눌러도 [저장] 없이 바로 저장된다', !!back, '15초 내 rep_role=점유자 아님')
  check('④ 카드 세그먼트도 즉시 따라온다', (await cardSeg()) === '점유자', await cardSeg())

  // ⑤ 음성 축 — 같은 값 재클릭은 해제(빈 값)다. 한쪽에서 해제하면 다른 쪽도 비어야 한다.
  await panelBox.locator('button:text-is("점유자")').first().click()
  const cleared = await pollDb(async () => {
    const { data } = await raw.from('customers').select('rep_role').eq('id', custId).single()
    return data?.rep_role === null ? data : null
  }, 15000)
  check('⑤ 재클릭 해제가 양쪽에 반영된다', !!cleared && (await cardSeg()) === '', `card="${await cardSeg()}"`)
} finally {
  await browser.close()
  await cleanupCustomer(custId)
  await delUser(uid)
}
summary()
