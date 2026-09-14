/** 선임일 유실 회귀 검사 (2026-09-14) — 실사고 재현에서 승격.
 *  실행: node scripts/test-selected-at-preserve.mjs   (dev 서버 :3000)
 *
 *  ── 무엇이 터졌었나 ─────────────────────────────────────────────
 *  고객 상세 탭 셸은 패널을 `hidden`으로 **마운트한 채** 둔다(customer-tabs.tsx). 1.1 패널은
 *  `useState(initial)`로 마운트 시점 값을 한 번만 심는데, 사람 축(선임일 등)은 2026-08-20에
 *  입력칸이 관계인 탭으로 옮겨간 뒤에도 **저장 payload에는 남아 있었다**. 그래서 관계인 탭에서
 *  선임일을 채우고 1.1에서 아무 칸이나 저장하면, 1.1의 낡은 ''가 방금 넣은 값을 null로 지웠다.
 *  운영 활성 고객 305곳 중 선임일이 남아 있던 곳이 5곳뿐이었다.
 *
 *  ── 이 검사가 붙드는 계약 ────────────────────────────────────────
 *  "입력칸이 없는 화면은 그 컬럼을 쓰지 않는다."
 *    · 사람 축 6종 → 관계인 탭이 정본, 1.1은 안 쓴다
 *    · 급수        → 1.1이 정본(대상물 속성), 관계인 탭은 안 쓴다   ← 반대 방향도 같이 막는다
 *
 *  ⚠ 음성 단언만 두면 안 된다("안 지워졌다"는 저장이 통째로 실패해도 초록이다).
 *    그래서 매 저장마다 **그 저장이 의도한 값은 실제로 들어갔는지**를 대조군으로 함께 잰다.
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'test-seldate@erp-test.com'
const DATE = '2026-03-15'
let userId = '', cust = '', browser = null

const cols = async () => {
  const { data } = await raw.from('customers')
    .select('manager_selected_at, manager_license_grade, manager_edu_date, manager_appointment_type, rep_role, building_grade, op_hours_weekday')
    .eq('id', cust).single()
  return data ?? {}
}

/** 저장이 **DB에 착지할 때까지** 기다린다.
 *  고정 sleep으로 두면 dev 서버가 느려진 날(재시작 직후 재컴파일 등) 저장이 아직 날아가는 중인데
 *  다음 단계로 넘어가, 제품이 멀쩡한데도 빨개진다 — 실제로 2026-09-14에 그렇게 한 번 속았다.
 *  더 나쁜 건 그 다음이다: 뒤늦게 도착한 저장이 그 사이 심어 둔 값을 덮어써 **엉뚱한 항목**이 빨개진다. */
const waitCol = (key, want) => pollDb(async () => (await cols())[key] === want, 45000)

try {
  userId = await mkUser({ email: EMAIL, name: '선임일회귀', employeeId: 'TSD-1', role: 'admin' })
  cust = await mkCustomer({
    customer_name: 'TEST선임일보존', address: '경기 양평군 선임로 1', created_by: userId,
    fire_station: '양평소방서', use_approval_date: '2020-03-02',
  })
  await raw.from('customer_contacts').insert(
    { customer_id: cust, role: '대표', name: '홍대표', phone: '01011112222' })
  await raw.from('buildings').insert({
    customer_id: cust, building_name: '본관', is_active: true, created_by: userId,
    purpose: '업무시설', total_area: 1234, building_area: 400, permit_date: '2019-01-10',
  })

  const launched = await launch(); browser = launched.browser
  const page = launched.page
  await login(page, EMAIL)

  // ── ① 소방계획서 1.1을 먼저 연다 = 1.1 패널이 사람 축 '' 인 채로 마운트된다 (사고 재현 조건) ──
  await page.goto(`${BASE}/customers/${cust}?tab=plan`)
  await page.locator('[data-testid="fp-info-save"]').waitFor({ timeout: 60000 })
  await page.locator('[role=tab]:has-text("관계인")').waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)   // 하이드레이션 — 이르면 클릭이 씹혀 탭이 안 바뀐다

  // ── ② 관계인 탭에서 선임일 입력·저장 ──
  await page.locator('#fp-manager-date a').click()
  try {
    await page.locator('#c-fire-safety-manager').waitFor({ state: 'visible', timeout: 10000 })
  } catch {
    await page.locator('[role=tab]:has-text("관계인")').click()
    await page.locator('#c-fire-safety-manager').waitFor({ state: 'visible', timeout: 30000 })
  }
  const panel = page.locator('#c-fire-safety-manager')
  await panel.locator('input[placeholder="YYYY-MM-DD"]').first().fill(DATE)
  await panel.locator('button:has-text("저장")').click()
  await waitCol('manager_selected_at', DATE)
  check('A 관계인 탭 선임일 저장 → DB 반영', (await cols()).manager_selected_at === DATE,
    `DB=${(await cols()).manager_selected_at}`)

  // 급수는 관계인 탭에 더 이상 없다 (1.1이 정본).
  // ⚠ '특급' 버튼 유무로 물으면 안 된다 — **자격구분**(사람 축, 여기 남는 게 맞다)이 같은 4개
  //   라벨을 쓴다. 종전엔 등급+자격구분 두 벌이라 2개였고 지금은 자격구분 한 벌만 남아야 한다.
  const gradeBtns = await panel.locator('button:text-is("특급")').count()
  check('A-2 관계인 탭 급수 세그먼트 제거 (자격구분 한 벌만 남음)', gradeBtns === 1, `'특급' 버튼 ${gradeBtns}개`)
  check('A-3 급수는 1.1로 보내는 링크가 대신 있다',
    await panel.locator('a[href*="form=1.1"]').count() > 0, '1.1 링크 없음')

  // ── ③ 사람 축 나머지도 '마운트 이후'에 생기게 한다 (관계인 탭 UI와 동일한 조건) ──
  await raw.from('customers').update({
    manager_license_grade: '1급', manager_edu_date: '2026-02-02',
    manager_appointment_type: '겸직', rep_role: '소유자',
  }).eq('id', cust)

  // ── ④ 1.1로 돌아가 **다른 칸**을 고치고 저장한다 (사람 축은 건드리지 않는다) ──
  await page.locator('[role=tab]:has-text("소방계획서")').click()
  await page.locator('[data-testid="fp-info-save"]').waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)

  // 1.1 카드가 방금 저장된 선임일을 **표시**하는가 — 안 보이면 사용자는 계속 '누락'으로 읽는다.
  // dev에서 이 페이지의 RSC 재조회는 수 초 걸린다(첫 컴파일은 수십 초) → 고정 대기 대신 폴링한다.
  const shown = await page.locator('#fp-manager-date').filter({ hasText: DATE })
    .waitFor({ timeout: 60000 }).then(() => true).catch(() => false)
  const cardText = await page.locator('#fp-manager-date').innerText().catch(() => '')
  check('B 1.1 카드가 현재 선임일을 표시한다', shown, JSON.stringify(cardText.slice(0, 120)))

  await page.locator('#fp-ophours').fill('09:00~18:00')
  await page.locator('[data-testid="fp-info-save"]').click()
  await waitCol('op_hours_weekday', '09:00~18:00')

  const after = await cols()
  check('C 1.1 저장이 선임일을 지우지 않는다', after.manager_selected_at === DATE,
    `기대=${DATE} 실제=${after.manager_selected_at}`)
  const wiped = ['manager_license_grade', 'manager_edu_date', 'manager_appointment_type', 'rep_role']
    .filter(k => after[k] == null)
  check('C-2 1.1 저장이 사람 축 나머지도 지우지 않는다', wiped.length === 0, `지워짐=[${wiped.join(', ')}]`)
  // 대조군 — 이 저장이 실제로 일어났다는 증거(없으면 위 두 줄은 공허하게 초록이다)
  check('C-대조 같은 저장의 운영시간은 반영됨', after.op_hours_weekday === '09:00~18:00',
    `op_hours_weekday=${after.op_hours_weekday}`)

  // ── ⑤ 반대 방향: 급수는 1.1이 정본 — 관계인 탭 저장이 급수를 지우면 안 된다 ──
  await page.locator('#fp-grade button:text-is("2급")').click()
  await page.locator('[data-testid="fp-info-save"]').click()
  await waitCol('building_grade', '2급')
  check('D 1.1에서 급수 저장 → DB 반영', (await cols()).building_grade === '2급',
    `building_grade=${(await cols()).building_grade}`)

  await page.locator('[role=tab]:has-text("관계인")').click()
  await page.locator('#c-fire-safety-manager').waitFor({ state: 'visible', timeout: 30000 })
  await panel.locator('input[placeholder="YYYY-MM-DD"]').nth(1).fill('2026-04-04')  // 교육이수일
  await panel.locator('button:has-text("저장")').click()
  await waitCol('manager_edu_date', '2026-04-04')

  const back = await cols()
  check('E 관계인 탭 저장이 급수를 지우지 않는다', back.building_grade === '2급',
    `기대=2급 실제=${back.building_grade}`)
  check('E-대조 같은 저장의 교육이수일은 반영됨', back.manager_edu_date === '2026-04-04',
    `manager_edu_date=${back.manager_edu_date}`)
} finally {
  if (browser) await browser.close()
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
}
summary()
