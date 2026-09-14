// A안 [시작] 동작 검증 — **일회용 픽스처**로만 쓰기를 일으킨다(실데이터 무손상).
// 판정: 시작 대기에 뜬다 → [시작] 클릭 → inspections 생성 + 계획 항목 연결 → 대기 칸에서 사라진다.
import { launch, login, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, pollDb, check, summary, raw } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-pending-click@test.local'
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const NAME = `ZZ테스트시작대기${Math.random().toString(36).slice(2, 6)}`

const uid = await mkUser({ email: EMAIL, name: 'E2EClick', employeeId: 'ECK', role: 'admin' })
let custId = null
const { browser, page } = await launch()
// ⚠ 헬퍼 기본 15초는 **다른 세션이 동시에 빌드 중일 때** 로그인조차 못 넘긴다(2026-09-14 실측).
page.setDefaultTimeout(60000)
page.setDefaultNavigationTimeout(60000)
try {
  custId = await mkCustomer({ customer_name: NAME, assigned_employee_id: uid, use_approval_date: '2020-03-02', created_by: uid })
  const plan = await ensurePlan(Number(today.slice(0, 4)), Number(today.slice(5, 7)), uid)
  // 자체점검(special_작동) 1건을 **오늘 예정**으로 — 시작 대기 창(D-14) 안에 확실히 든다
  const { data: item, error } = await raw.from('inspection_plan_items').insert({
    plan_id: plan.id, customer_id: custId, inspection_type: '작동', sequence_num: 1,
    plan_type: 'special_작동', inspection_sub_type: '작동',
    planned_date: today, scheduled_date: today, status: 'confirmed', assigned_employee_id: uid,
  }).select('id').single()
  if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)

  await login(page, EMAIL)
  await page.goto(`http://localhost:3000/inspections?q=${encodeURIComponent(NAME)}`)
  await page.waitForSelector('[data-testid="pending-plan-start"]', { timeout: 20000 })

  const sec = page.locator('[data-testid="pending-plan-start"]')
  const before = await sec.innerText()
  check('픽스처가 시작 대기에 뜬다', before.includes(NAME), before.slice(0, 200))
  check('오늘 예정이면 「오늘」로 표기', before.includes('오늘'), before.slice(0, 200))

  // 시작 전 상태 — inspections 없음
  const { count: c0 } = await raw.from('inspections').select('id', { count: 'exact', head: true }).eq('customer_id', custId)
  check('시작 전에는 inspections가 없다', c0 === 0, `count=${c0}`)

  await page.locator('[data-testid="pending-plan-start-btn"]').first().click()

  // DB가 실제로 바뀌었는가 — 고정 sleep 대신 폴링(스테이징 지연 내성)
  const created = await pollDb(async () => {
    const { data } = await raw.from('inspections').select('id, status, inspection_start_date, plan_type')
      .eq('customer_id', custId).maybeSingle()
    return data ?? null
  }, 20000)
  check('[시작]이 inspections를 만든다', !!created, JSON.stringify(created))
  if (created) {
    check(`점검일이 오늘(${today})로 기록된다`, created.inspection_start_date === today, created.inspection_start_date)
    check('상태가 진행중', created.status === 'in_progress', created.status)
  }

  const { data: linked } = await raw.from('inspection_plan_items')
    .select('inspection_id, status').eq('id', item.id).single()
  check('계획 항목이 점검에 연결된다', !!linked?.inspection_id, JSON.stringify(linked))
  check("연결 후 계획 항목 status='completed'", linked?.status === 'completed', linked?.status)

  // 화면에서 대기 칸을 떠나 아래 점검 목록으로 옮겨갔는가
  await page.reload()
  await page.waitForSelector('table', { timeout: 20000 })
  const afterSec = await page.locator('[data-testid="pending-plan-start"]').count()
  const afterText = await page.locator('table').last().innerText()
  check('시작 후 대기 칸에서 사라진다', afterSec === 0, `대기칸 ${afterSec}개`)
  check('아래 점검 업무 목록에 나타난다', afterText.includes(NAME), afterText.slice(0, 200))
} finally {
  await browser.close()
  await cleanupCustomer(custId)
  await delUser(uid)
}
summary()
