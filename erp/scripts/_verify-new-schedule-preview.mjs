// A안 ① 검증 — 고객등록 화면 「법정 점검 일정」 미리보기.
// 계약: ⓐ 어느 날짜가 기산점인지 말한다 ⓑ 예정일에 **요일**을 붙이고 밀린 이유를 적는다
//       ⓒ 입력한 점검일자가 안 쓰이면 그 사실을 말한다 ⓓ 예외 체크로 입력값을 쓰게 할 수 있다
//       ⓔ 과거·오늘 점검일자는 「등록 즉시 그 날짜로 1차 시작」을 말한다 (2026-09-20 사용자 확정)
//
// ⚠ 2026-09-20 계약 교체: 종전에는 ⓒ·ⓓ를 **과거** 점검일자(2026-09-11)로 단언했다.
//   과거·오늘 날짜는 이제 「점검 사실」로 그대로 쓰이므로(applyPastAnchorInspection) 무시 고지가
//   서면 화면이 거짓말이 된다 — ⓒ·ⓓ의 표본을 **미래 평일**로 옮기고, 과거는 ⓔ가 새 계약을 문다.
import { launch, login, mkUser, delUser, check, summary } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-newsched@test.local'
const uid = await mkUser({ email: EMAIL, name: 'E2ENS', employeeId: 'ENS', role: 'admin' })
const { browser, page } = await launch()
// ⚠ 헬퍼 기본 15초는 **다른 세션이 동시에 빌드 중일 때** 로그인조차 못 넘긴다(2026-09-14 실측).
page.setDefaultTimeout(60000)
page.setDefaultNavigationTimeout(60000)

const box = () => page.locator('[data-testid="new-schedule-preview"]')
const fillDate = async (label, val) => {
  const f = page.locator(`label:has-text("${label}")`).locator('xpath=..').first()
  await f.locator('input:not([type="date"])').first().fill(val)
}

const WD = ['일', '월', '화', '수', '목', '금', '토']
/** 오늘(KST)+14일 이후의 첫 수요일, 고정 공휴일은 피한다 — 영업일 보정이 안 끼는 미래 표본.
 *  (보정이 끼면 「예정일이 입력값 그대로」 단언이 날짜 산식과 얽혀 검사가 흔들린다) */
function futureWeekday() {
  const FIXED_HOLIDAYS = new Set(['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'])
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setUTCDate(d.getUTCDate() + 14)
  while (d.getUTCDay() !== 3 || FIXED_HOLIDAYS.has(d.toISOString().slice(5, 10))) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const FUT = futureWeekday()
const FUT_WD = WD[new Date(FUT + 'T00:00:00Z').getUTCDay()]

try {
  await login(page, EMAIL)
  await page.goto('http://localhost:3000/customers/new')
  await page.waitForSelector('[data-testid="new-schedule-preview"]', { timeout: 25000 })
  check('미리보기 상자가 처음부터 자리를 잡는다', await box().count() === 1)

  // 지평리56과 같은 조건: 사용승인일 1999-09-26(토) · 종합. 점검일자는 **미래 평일**(계약 교체).
  await fillDate('점검일자', FUT)
  await fillDate('사용승인일', '1999-09-26')
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="new-schedule-preview"]')?.textContent ?? '').includes('1999-09-26'),
    { timeout: 20000 })
  const t = await box().innerText()
  console.log('\n--- 미리보기 ---\n' + t + '\n----------------')

  // ⓐ 기산점
  check('ⓐ 기산점이 사용승인일임을 말한다', /기산점\s*사용승인일\s*1999-09-26/.test(t), t.slice(0, 160))
  check('ⓐ 기산점에 요일이 붙는다(1999-09-26=일)', t.includes('1999-09-26 (일)'), t.slice(0, 160))
  check('ⓐ 법 근거를 적는다', t.includes('별표 3') && t.includes('속하는 달'), t.slice(0, 200))

  // ⓑ 예정일 + 요일 + 밀린 이유 (2026-09-26 토 → 09-28 월)
  check('ⓑ 2026 종합 예정일이 09-28(월)', t.includes('2026-09-28 (월)'), t)
  check('ⓑ 밀린 이유를 적는다(09-26 토요일)', /09-26이 토요일이라 영업일로 옮김/.test(t), t)
  // ⚠ `||`로 느슨하게 두면 어느 해에 앉든 초록이라 **고아 2차**를 못 잡는다.
  //   기산월 9(종합)의 2차는 +6개월이라 **다음 해 3월**이다 — 첫 해 3월에 앉으면 짝이 되는
  //   종합이 없는 고아가 된다(지평리56의 2026-03-26이 그 자리였다).
  check('ⓑ 작동점검(2차)은 다음 해 03-26(금)', t.includes('2027-03-26'), t)
  check('ⓑ 첫 해 3월에 고아 2차를 약속하지 않는다', !t.includes('2026-03-26'), t)

  // ⓒ 입력한 점검일자(미래)가 안 쓰인다는 고지 — 과거가 아니므로 즉시 시작 고지는 없어야 한다
  const notice = await page.locator('[data-testid="anchor-ignored-notice"]').count()
  check('ⓒ 입력값이 안 쓰인다고 알린다', notice === 1)
  check('ⓒ 무시되는 날짜를 요일과 함께 밝힌다', t.includes(`${FUT} (${FUT_WD})`), t)
  check('ⓒ 미래 날짜에는 즉시 시작 고지가 없다',
    await page.locator('[data-testid="past-anchor-start-notice"]').count() === 0)

  // ⓓ 예외 체크 → 기산점이 점검일자로 바뀐다
  await page.locator('[data-testid="anchor-manual-toggle"]').check()
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="new-schedule-preview"]')?.textContent ?? '').includes('기산점 점검일자'),
    { timeout: 20000 }).catch(() => {})
  const t2 = await box().innerText()
  console.log('\n--- 예외 체크 후 ---\n' + t2 + '\n----------------')
  check('ⓓ 체크하면 기산점이 점검일자로 바뀐다', new RegExp(`기산점\\s*점검일자\\s*${FUT}`).test(t2), t2.slice(0, 160))
  check('ⓓ 예정일도 입력값 기준으로 다시 선다', t2.includes(`${FUT} (${FUT_WD})`) && !t2.includes('2026-09-28'), t2)
  check('ⓓ 무시 고지는 사라진다', await page.locator('[data-testid="anchor-ignored-notice"]').count() === 0)

  // 음성 축 — 사용승인일이 없으면 「무시된다」고 말하지 않는다
  await page.locator('[data-testid="anchor-manual-toggle"]').uncheck()
  await fillDate('사용승인일', '')
  // ⚠ 「1999가 사라졌는가」로 기다리면 **계산 중** 상태도 조건을 만족해 빈 문자열을 읽는다.
  //   기다림은 **최종 상태 그 자체**에 건다(2026-09-14에 실제로 그렇게 빨강이 났다).
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="new-schedule-preview"]')?.textContent ?? '').includes('기산점 점검일자'),
    { timeout: 20000 }).catch(() => {})
  const t3 = await box().innerText()
  check('음성축: 사용승인일이 없으면 무시 고지가 없다',
    await page.locator('[data-testid="anchor-ignored-notice"]').count() === 0, t3.slice(0, 160))
  check('음성축: 그때는 점검일자가 기산점이다', /기산점\s*점검일자/.test(t3), t3.slice(0, 160))

  // ⓔ 과거 점검일자 = 점검 사실 — 즉시 시작 고지 + 1차 예정일이 입력값 그대로 (2026-09-20)
  //   2026-09-11(금)은 이 검사가 사는 한 언제나 과거다 — 종전 ⓒ·ⓓ의 표본을 여기로 옮겼다.
  await fillDate('사용승인일', '1999-09-26')
  await fillDate('점검일자', '2026-09-11')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="past-anchor-start-notice"]') !== null,
    { timeout: 20000 }).catch(() => {})
  const t4 = await box().innerText()
  console.log('\n--- 과거 점검일자 ---\n' + t4 + '\n----------------')
  check('ⓔ 즉시 시작 고지가 선다', await page.locator('[data-testid="past-anchor-start-notice"]').count() === 1)
  check('ⓔ 고지가 날짜를 요일과 함께 말한다', t4.includes('2026-09-11 (금)'), t4)
  check('ⓔ 「이 날짜 그대로 1차 점검 시작」을 말한다', t4.includes('이 날짜 그대로') && t4.includes('1차 점검이 시작'), t4)
  check('ⓔ 무시 고지는 서지 않는다 (배타)', await page.locator('[data-testid="anchor-ignored-notice"]').count() === 0)
  check('ⓔ 1차 예정일 행이 입력값으로 바뀐다 — 법정 자리(09-28)를 약속하지 않는다',
    !t4.includes('2026-09-28'), t4)
  check('ⓔ 2차(다음 해 03-26)는 법정 축 그대로', t4.includes('2027-03-26'), t4)
} finally {
  await browser.close()
  await delUser(uid)
}
summary()
