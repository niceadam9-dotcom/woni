// 확인 — 「사용승인일을 입력하는 순간 입력자에게 알리는가」 / 「변경이 없으면 조용한가」
// 사용자 요구(2026-09-14):
//   ① 사용승인일 입력 즉시, 점검일자 변경이 필요하면 **입력자에게** 알린다
//   ② 정상 입력(일정이 안 바뀜)이면 알림이 안 나와도 된다  ← 여기가 현행과 다를 수 있다
import { launch, login, mkUser, delUser, mkCustomer, cleanupCustomer, check, summary, raw } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-anchor-notice@test.local'
const NAME = `ZZ기산점알림${Math.random().toString(36).slice(2, 6)}`
const uid = await mkUser({ email: EMAIL, name: 'E2EAnc', employeeId: 'EAN', role: 'admin' })
let custId = null
const { browser, page } = await launch()
// ⚠ 헬퍼 기본 15초는 **다른 세션이 동시에 빌드 중일 때** 로그인조차 못 넘긴다(2026-09-14 실측).
page.setDefaultTimeout(60000)
page.setDefaultNavigationTimeout(60000)

// ⚠ DateInput은 입력칸을 **둘** 렌더한다(보이는 텍스트칸 + 숨은 date 피커).
//   `input`만 잡으면 피커가 걸려 값이 안 들어간다 — 실제로 그렇게 한 번 헛돌았다.
const openInline = async (val) => {
  await page.locator('[data-testid="inline-use_approval_date"]').first().click()
  const box = page.locator('[data-testid="inline-use_approval_date-edit"]').first()
  await box.waitFor({ timeout: 8000 })
  const input = box.locator('input:not([type="date"])').first()
  await input.fill(val)
  const got = await input.inputValue()
  if (got !== val) throw new Error(`입력칸에 값이 안 들어갔다: "${got}" ≠ "${val}"`)
  await page.locator('[data-testid="inline-save"]').first().click()
}
// ⚠ `isVisible()`은 **기다리지 않는다**(timeout 인자를 줘도 즉시 판정) — 모달이 뜨기 전에
//   false를 돌려줘 제품이 멀쩡한데 빨강이 났다. 대기는 waitFor로 해야 한다.
const modalVisible = (ms) => page.locator('text=저장하면 이렇게 바뀝니다').first()
  .waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false)
// 확인 버튼 문구는 「이대로 저장」이다(「확인」이 아니다)
const confirmModal = () => page.locator('button:has-text("이대로 저장")').first().click()

try {
  // 사용승인일 없음 + 점검일자 5월 → 지금은 점검일자가 기산점
  custId = await mkCustomer({
    customer_name: NAME, created_by: uid, assigned_employee_id: uid,
    use_approval_date: null, plan_anchor_date: '2026-05-27',
    inspection_type: '종합', inspection_sub_type: '종합',
  })
  await login(page, EMAIL)
  await page.goto(`http://localhost:3000/customers?cols=full&q=${encodeURIComponent(NAME)}`)
  await page.waitForSelector('[data-testid="inline-use_approval_date"]', { timeout: 20000 })

  // ── ① 달이 달라지는 입력 → 알림이 떠야 한다 ──────────────────────────
  await openInline('2020-11-27')
  const shown1 = await modalVisible(10000)
  check('① 사용승인일 입력 즉시 입력자에게 알린다(달 변경)', shown1)
  let body1 = ''
  if (shown1) {
    body1 = await page.locator('.fixed.inset-0').innerText()
    check('   바뀌는 법정 시기를 보여준다(5월 → 11월)', /5월/.test(body1) && /11월/.test(body1), body1.slice(0, 220))
    check('   바뀔 계획 항목을 보여준다', !body1.includes('바뀌는 계획 항목이 없습니다'), body1.slice(0, 220))
    await confirmModal().catch(() => {})
    await page.waitForTimeout(2500)
  }

  // ── ② 일정이 **안 바뀌는** 입력 → 조용해야 한다(사용자 요구 ②) ──────────
  // 연도만 다르고 월·일이 같으면 plannedDateFor 결과가 같다 = 계획 변화 0
  await page.goto(`http://localhost:3000/customers?cols=full&q=${encodeURIComponent(NAME)}`)
  await page.waitForSelector('[data-testid="inline-use_approval_date"]', { timeout: 20000 })
  await openInline('2001-11-27')
  const shown2 = await modalVisible(8000)
  const body2 = shown2 ? await page.locator('.fixed.inset-0').innerText() : ''
  const saysNothing = body2.includes('바뀌는 계획 항목이 없습니다')
  console.log(`\n[②] 모달 표시=${shown2} / "바뀌는 계획 항목이 없습니다"=${saysNothing}`)
  if (shown2) console.log(body2.split('\n').filter(Boolean).slice(0, 6).join(' | '))
  check('② 일정이 안 바뀌면 알림이 뜨지 않는다', !shown2,
    shown2 ? `모달이 떴다${saysNothing ? ' (내용은 "바뀌는 계획 항목이 없습니다")' : ''}` : '')

  // 저장 자체는 되어야 한다(알림 유무와 무관)
  if (shown2) await confirmModal().catch(() => {})
  await page.waitForTimeout(2500)
  const { data: after } = await raw.from('customers').select('use_approval_date').eq('id', custId).single()
  check('   값은 정상 저장된다', after?.use_approval_date === '2001-11-27', after?.use_approval_date)

  // ── ③ 예외 축 — 계획은 안 바뀌지만 **최초점검 창이 새로 열리면** 알린다 ──────────
  //    월·일이 같아 예정일은 그대로인데(ops 0 · 법정 달 동일) 사용승인일+60일이 미래로 열린다.
  //    이 경우까지 조용하면 법정 미이행을 말없이 지나친다 — 예외가 죽은 코드가 아님을 여기서 증명한다.
  await page.goto(`http://localhost:3000/customers?cols=full&q=${encodeURIComponent(NAME)}`)
  await page.waitForSelector('[data-testid="inline-use_approval_date"]', { timeout: 20000 })
  await openInline('2026-11-27')
  const shown3 = await modalVisible(8000)
  const body3 = shown3 ? await page.locator('.fixed.inset-0').innerText() : ''
  console.log(`\n[③] 모달 표시=${shown3}`)
  if (shown3) console.log(body3.split('\n').filter(Boolean).slice(0, 5).join(' | '))
  check('③ 계획은 그대로여도 최초점검 창이 열리면 알린다', shown3)
  check('   계획 변화는 없다고 정직하게 말한다', body3.includes('바뀌는 계획 항목이 없습니다'), body3.slice(0, 200))
  check('   최초점검 기한을 보여준다', /최초점검/.test(body3), body3.slice(0, 200))
} finally {
  await browser.close()
  await cleanupCustomer(custId)
  await delUser(uid)
}
summary()
