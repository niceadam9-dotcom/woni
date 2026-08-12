// 소방계획서_20 S2 프로브 — 회차 로더 왕복 상수화 효과 실측.
// 같은 고객·같은 회차 수로 A/B: (A) 전 회차 in_progress = 회차마다 buildInspectionDocs(구 경로와 동일 비용)
//                              (B) 1건만 진행·나머지 완료 = 완료분은 요약 2쿼리로 대체(S2 경로)
// 측정은 페이지 진입 → 회차 카드 표시까지의 벽시계 중앙값(3회).
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, PW } from './_e2e-helpers.mjs'

const EMAIL = `annex-latency-${Date.now().toString(36)}@test.local`
const CUR = new Date().getFullYear()
const ROUNDS = 8
let userId, customerId, inspIds = [], browser

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

try {
  userId = await mkUser({ email: EMAIL, name: '회차지연프로브', employeeId: `E2E-LAT-${Date.now().toString(36)}` })
  customerId = await mkCustomer({ customer_name: '회차지연프로브사', address: '서울 중구 세종대로 110', created_by: userId })
  // 작동은 sequence_num=1만 허용 → 연도로 8회차를 만든다
  for (let k = 0; k < ROUNDS; k++) {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: customerId, sequence_num: 1, inspection_type: '작동', plan_type: 'special_작동',
      status: 'in_progress', inspection_start_date: `${CUR - k}-03-05`,
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    inspIds.push(data.id)
  }
  check(`시드 — 회차 ${ROUNDS}건`, inspIds.length === ROUNDS)

  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 60000 })

  // 페이지 전체 진입 시간으로 재면 SSR 고정비(~2초)와 로컬 편차에 묻혀 A/B 차이가 노이즈에 잠긴다
  // (5회 표본에서 2~22%로 요동). 바뀐 것은 회차 로더뿐이므로 [새로고침]으로 그 액션만 격리해 잰다.
  const spinner = () => page.locator('button:has-text("새로고침") .animate-spin')
  async function measure(label) {
    const runs = []
    for (let i = 0; i < 6; i++) {
      const t0 = Date.now()
      await page.locator('button:has-text("새로고침")').click()
      await spinner().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {})
      await spinner().waitFor({ state: 'detached', timeout: 60000 })
      const ms = Date.now() - t0
      if (i > 0) runs.push(ms)   // i=0은 워밍업
    }
    const m = median(runs)
    console.log(`  · ${label}: ${runs.join('/')}ms → 중앙값 ${m}ms`)
    return m
  }

  // 측정 대상은 회차 로더뿐 — 페이지는 한 번만 열고 이후 [새로고침]으로 잰다
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=annex`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${CUR}년 1차`, { timeout: 60000 })

  // A) 전 회차 진행중 — 회차마다 상세 조립(구 경로와 같은 비용)
  const before = await measure(`A 전 회차 진행중(${ROUNDS}건 전부 상세)`)

  // B) 1건만 진행·7건 완료 — S2 경로 (DB만 바꾸고 같은 화면에서 [새로고침]으로 잰다)
  await raw.from('inspections').update({ status: 'completed', inspection_end_date: `${CUR - 1}-03-06` })
    .in('id', inspIds.slice(1))
  const after = await measure(`B 1건 진행 + ${ROUNDS - 1}건 완료(S2 지연 로드)`)

  check('S2 — 완료 회차 접힘 섹션 표시', await page.isVisible(`text=지난 회차 ${ROUNDS - 1}건`))
  check('S2 — 마운트가 A보다 빠름', after < before, `A=${before}ms B=${after}ms`)
  const gain = Math.round((1 - after / before) * 100)
  console.log(`  · 개선폭: ${before}ms → ${after}ms (${gain}%)`)
  // 로더만 격리하면 A/B 차이가 그대로 드러난다(왕복 3+3N → 상수). 실측 ~26%이며 중앙값이라 이상치에 강하다.
  // 목적은 퇴행 감지이므로 하한은 실측보다 낮은 20%로 둔다(로그의 실제 수치가 정보다).
  check('S2 — 로더 개선폭 20% 이상', gain >= 20, `${gain}%`)

  // 요약 행은 상세 없이 렌더되는가(지연 로드 증거) — 펼치기 전엔 문서 행이 1세트뿐
  await page.click(`button:has-text("지난 회차 ${ROUNDS - 1}건")`)
  await page.waitForSelector(`text=${CUR - 1}년 · 1건`)
  check('S2 — 섹션 펼쳐도 상세는 미로드(문서 행 1세트)', (await page.locator('text=점검표 입력').count()) === 1)
  await page.click(`button:has-text("${CUR - 1}년 1차")`)
  await page.waitForFunction(() =>
    [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent?.includes('점검표 입력')).length >= 2,
    undefined, { timeout: 30000 })
  check('S2 — 요약 행 클릭 시 상세 지연 로드', (await page.locator('text=점검표 입력').count()) === 2)
} catch (e) {
  check('프로브 실행', false, String(e))
} finally {
  if (browser) await browser.close()
  await cleanupCustomer(customerId)
  await delUser(userId)
  summary()
}
