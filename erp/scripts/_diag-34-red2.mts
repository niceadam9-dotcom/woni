// 진단 전용(일회성) — test-plan-tab이 재현성 있게 붉은 2건의 성격을 가른다. 소방계획서_34 S7-7 후속(2026-08-30).
//
// 가르려는 것은 하나뿐이다: **테스트가 성급한가, 앱이 실제로 안 되는가.**
//   - 클릭/입력 직후엔 틀리지만 잠깐 기다리면 맞다  → 테스트 축(사용자 영향 없음)
//   - 기다려도 틀리다                              → 앱 축(사용자가 못 쓴다)
// test-plan-tab은 두 자리 모두 대기 없이 즉시 읽는다(:365 inputValue · :417 aria-pressed).
//
// 실행: npx tsx scripts/_diag-34-red2.mts
// @ts-expect-error mjs 헬퍼
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'diag34red2@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const lines: string[] = []
const say = (s: string) => { lines.push(s); console.log(s) }

try {
  userId = await mkUser({ email: EMAIL, name: '진단34', employeeId: 'E2E-D34R' })
  custId = await mkCustomer({ customer_name: '진단34빨강고객', address: '경기 양평군 테스트로 34', created_by: userId })
  // 1.4는 활성 건물이 없으면 아예 안 그려진다 — test-plan-tab:20-23과 같은 픽스처
  const { error: bErr } = await raw.from('buildings').insert({
    customer_id: custId, building_name: '본관', is_active: true, created_by: userId,
    floors_above: 3, floors_below: 1,
  })
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)

  const l = await launch(); browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── ① 1.4 ☑ 토글 — 즉시 vs 대기 ──────────────────────────────
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`)
  await page.waitForSelector('[data-plan-node="1.4"]', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const heading = await page.locator('text=서식 1.4 소방시설 현황').count()
  if (heading === 0) {
    // 왜 안 떴는지 화면이 직접 말하게 한다 — 추측하지 않는다
    const panel = (await page.locator('main').innerText().catch(() => '')).slice(0, 700)
    say(`① 1.4 제목 미노출 — 화면 텍스트:\n${panel}\n`)
  }
  const box = page.locator('[data-testid="form14-check-소화기구 및 자동소화장치"]')
  say(`① 존재=${await box.count()} 클릭전 aria-pressed=${await box.getAttribute('aria-pressed')} aria-disabled=${await box.getAttribute('aria-disabled')}`)

  await box.click()
  const immediate = await box.getAttribute('aria-pressed')          // test-plan-tab:417이 읽는 시점
  await page.waitForTimeout(1500)
  const afterWait = await box.getAttribute('aria-pressed')
  const glyph = (await box.innerText()).trim()
  say(`① 클릭직후=${immediate} · 1.5초후=${afterWait} · 글리프=${glyph}`)
  say(`① 판정 → ${immediate === 'true' ? '통과했어야 함(재현 실패)' : afterWait === 'true' ? '**테스트 축** — 앱은 되는데 읽는 시점이 이르다' : '**앱 축** — 기다려도 체크가 안 된다(사용자 영향)'}`)

  // 패널이 가로채는가 — 클릭이 엉뚱한 데로 떨어졌을 가능성 배제
  const overlay = await page.locator('button[aria-label="닫기"]').count()
  say(`① 참고: 대장 패널 닫기버튼 노출=${overlay} (0이면 패널이 클릭을 가로챈 게 아니다)`)

  // ── ② 2장 성명 입력 — fill 직후 값이 유지되는가 ────────────────
  await page.goto(`${BASE}/customers/${custId}?tab=plan&sub=ch2`)
  await page.waitForSelector('text=2.1 자위소방대 및 초기대응체계 일반현황', { timeout: 30000 })
  await page.click('button:has-text("Type Ⅲ")')
  const nameInput = page.locator('input[placeholder="성명"]').first()
  await nameInput.fill('김대장')
  const v0 = await nameInput.inputValue()                            // test-plan-tab:362가 읽는 시점
  await page.waitForTimeout(1500)
  const v1 = await nameInput.inputValue()
  say(`② fill직후="${v0}" · 1.5초후="${v1}"`)
  say(`② 판정 → ${v0 === '김대장' && v1 === '김대장' ? '값 유지 — 실패는 다른 이유' : v1 === '김대장' ? '**테스트 축** — 읽는 시점이 이르다' : '**앱 축** — 입력이 되돌려진다(사용자 영향)'}`)

  // ── ③ 1.1 계단·피난용승강기 — fill이 React 상태에 남는가 (test-plan-tab:146-151) ──
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.1`)
  await page.waitForSelector('text=① 시설현황', { timeout: 30000 })
  const stairs = page.locator('div:has(> label:text-is("계단")) input')
  const evac = page.locator('div:has(> label:text-is("피난용승강기")) input')
  await stairs.fill('2'); await evac.fill('1')
  const s0 = await stairs.inputValue(), e0 = await evac.inputValue()
  say(`③ fill직후 계단="${s0}" 승강기="${e0}"`)
  await page.click('[data-testid="fp-info-save"]')
  const toast = await page.waitForSelector('text=저장되었습니다', { timeout: 30000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(800)
  const { data: bld } = await raw.from('buildings').select('stairs_count, evac_elevator_count').eq('customer_id', custId).limit(1).single()
  say(`③ 토스트=${toast} · DB=${JSON.stringify(bld)}`)
  say(`③ 판정 → ${bld?.stairs_count === 2 && bld?.evac_elevator_count === 1 ? '통과 — 값이 실제로 저장된다' : toast ? '**저장은 됐는데 값이 안 실렸다**(조용히 null)' : '저장 자체가 응답 없음 — 환경 축'}`)

  say('\n──── 요약 ────')
  say('test-plan-tab은 두 자리 모두 대기 없이 읽는다. 위 판정이 「테스트 축」이면 스위트가 낡은 것이고,')
  say('「앱 축」이면 소방계획서 본문의 실결함이다 — 어느 쪽이든 소방계획서_34와는 무관하다.')
} catch (e) {
  say(`예외: ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (custId) await cleanupCustomer(custId).catch(() => {})
  if (userId) await delUser(userId).catch(() => {})
}
