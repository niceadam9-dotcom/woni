// A안 검증 — 점검업무 「시작 대기」.
// 계약: **검색 전에는 나열하지 않는다**(건수 안내만) / **고객명 검색 시 그 고객 건만** + 남은 일수 표기.
// 판정축은 DOM 문자열이 아니라 **DB와의 대조**다(같은 규칙으로 센 값과 맞춘다).
import { launch, login, mkUser, delUser, check, summary, raw } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-pending-plan@test.local'
const WINDOW = 14
const BASE = 'http://localhost:3000'
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const end = new Date(Date.now() + 9 * 3600_000 + WINDOW * 864e5).toISOString().slice(0, 10)

const pendingQ = (extra = q => q) => extra(raw.from('inspection_plan_items')
  .select('id, scheduled_date, plan_type, customer_id, customers:customer_id!inner(customer_name, is_active)')
  .is('inspection_id', null).eq('status', 'confirmed')
  .lte('scheduled_date', end).eq('customers.is_active', true)
  .or('plan_type.is.null,plan_type.neq.monthly'))

const uid = await mkUser({ email: EMAIL, name: 'E2EPend', employeeId: 'EPD', role: 'admin' })
const { browser, page } = await launch()
// ⚠ 헬퍼 기본 15초는 **다른 세션이 동시에 빌드 중일 때** 로그인조차 못 넘긴다(2026-09-14 실측).
page.setDefaultTimeout(60000)
page.setDefaultNavigationTimeout(60000)
try {
  await login(page, EMAIL)

  // ── ① 검색 전 — 나열하지 않는다 ─────────────────────────────────────
  await page.goto(`${BASE}/inspections`)
  await page.waitForSelector('table', { timeout: 20000 })

  const listCount = await page.locator('[data-testid="pending-plan-start"]').count()
  check('검색 전에는 대기 칸이 아예 없다', listCount === 0, `목록 ${listCount}개`)

  // 🚨 혼동의 원인이던 전사 누적 건수가 **화면 어디에도** 없어야 한다(사용자 지적, 2026-09-14)
  const { data: allPending } = await pendingQ(q => q.limit(1000))
  const dbTotal = (allPending ?? []).length
  const bodyText = await page.locator('body').innerText()
  check(`전사 누적 「시작 대기 ${dbTotal}건」이 화면에 없다`, !bodyText.includes(`시작 대기 ${dbTotal}건`),
    bodyText.slice(0, 160))
  check('검색 전에는 「시작 대기」라는 말 자체가 없다', !bodyText.includes('시작 대기'), bodyText.slice(0, 200))

  // ── ② 검색 후 — 그 고객 건만 + 남은 일수 ──────────────────────────────
  // 경과 건이 있는 고객을 DB에서 골라 그 이름으로 검색한다(픽스처 없이 실데이터로)
  const { data: all } = await pendingQ(q => q.order('scheduled_date').limit(200))
  const target = (all ?? []).find(r => r.scheduled_date < today)
  if (!target) { check('경과 표본이 있다(이 검사의 전제)', false, '경과 건 0'); summary() }
  const name = target.customers.customer_name
  // ⚠ 오라클은 화면과 **같은 규칙**이어야 한다 — 페이지의 고객 검색은 `ilike %q%`(부분일치)라
  //   「힘찬해가」로 검색하면 「힘찬해가 (김재식 건물)」도 정당하게 포함된다.
  //   완전일치로 세면 제품이 옳은데 검사가 빨개진다(2026-09-14 실제로 그렇게 한 번 틀렸다).
  const mine = (all ?? []).filter(r => r.customers.customer_name.includes(name))
  const overdueDays = Math.round((Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
    - Date.UTC(+target.scheduled_date.slice(0, 4), +target.scheduled_date.slice(5, 7) - 1, +target.scheduled_date.slice(8, 10))) / 864e5)

  await page.goto(`${BASE}/inspections?q=${encodeURIComponent(name)}`)
  await page.waitForSelector('[data-testid="pending-plan-start"]', { timeout: 20000 })
  const sec = page.locator('[data-testid="pending-plan-start"]')
  const secText = await sec.innerText()
  const rowCount = await sec.locator('tbody tr').count()

  check('검색하면 대기 목록이 펼쳐진다', rowCount > 0, `${rowCount}행`)
  check(`그 고객 건만 나온다 (화면 ${rowCount} / DB ${mine.length})`, rowCount === mine.length)
  check('검색어를 화면이 되비춘다', secText.includes(name), secText.slice(0, 160))
  check('머리글이 그 고객의 건수만 말한다', secText.includes(`시작 대기 ${mine.length}건`), secText.slice(0, 160))
  check(`전사 누적(${dbTotal}건)을 여기서도 말하지 않는다`,
    dbTotal === mine.length || !secText.includes(`시작 대기 ${dbTotal}건`), secText.slice(0, 160))

  // ⭐ 핵심 — 현재 상태(남은 일수·경과 일수)를 사용자가 읽을 수 있는가
  check(`경과 일수를 정확히 표기한다(경과 ${overdueDays}일)`, secText.includes(`경과 ${overdueDays}일`), secText.slice(0, 300))
  check('예정일 자체도 함께 보인다', secText.includes(target.scheduled_date), secText.slice(0, 300))

  // ⑥ 음성 축 — 다른 고객이 섞이지 않았다
  // 음성 축도 같은 규칙으로 — 검색어를 **품지 않는** 고객만이 「섞이면 안 되는 것」이다
  const others = (all ?? []).filter(r => !r.customers.customer_name.includes(name)).slice(0, 8)
  const leaked = others.filter(o => secText.includes(o.customers.customer_name))
  check('다른 고객이 섞이지 않는다', leaked.length === 0, leaked.map(o => o.customers.customer_name).join(','))

  const btns = await page.locator('[data-testid="pending-plan-start-btn"]').count()
  check(`[시작] 버튼이 행마다 있다 (${btns}/${rowCount})`, btns === rowCount)

  console.log(`\n— 검색어「${name}」 ${rowCount}행`)
  console.log(secText.split('\n').filter(Boolean).slice(0, 5).join(' | '))
} finally {
  await browser.close()
  await delUser(uid)
}
summary()
