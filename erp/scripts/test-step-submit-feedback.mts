/** ④⑥ 제출일 기록 — 즉시 피드백 회귀 방어 (2026-08-18)
 *  실행: npx tsx scripts/test-step-submit-feedback.mts  (dev 서버 localhost:3000 또는 TEST_BASE_URL)
 *
 *  배경(실측): 제출일을 기록해도 화면이 **약 5초** 뒤에야 반응해 "눌러도 안 된다"로 읽혔다.
 *  router.refresh()가 무거운 점검 상세를 통째로 다시 그리는 동안 화면이 옛 값을 들고 있었기 때문.
 *  서버가 저장을 확인해 준 값을 화면이 먼저 쓰도록 고쳤다 — 그 개선이 유지되는지 고정한다.
 *
 *  같이 고정하는 것: ⑥ 칸 제목이 '불량 조치'여야 한다. 종전 '이행완료 N/M'은 제출일을 넣어도
 *  안 바뀌는 값(불량 조치 수)인데 단계 이름과 같아 혼동을 만들었다.
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
const EMAIL = 'test-subfeedback@erp-test.com'
const PW = 'SubFb1!'
const TAG = `ZZF${Math.random().toString(36).slice(2, 6).toUpperCase()}`
/** 화면 반영 상한 — 서버 액션(저장+단계 동기화) 자체가 ~2초라 여유를 둔다.
 *  이 값을 넘으면 '느려서 반응이 없어 보이는' 그 상태로 되돌아간 것이다. */
const FEEDBACK_BUDGET_MS = 4000

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

let userId = '', customerId = '', inspectionId = ''
let browser: import('playwright').Browser | null = null

try {
  console.log('[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-제출피드백', role: 'admin', is_active: true, employee_id: 'TEST-SFB', email: EMAIL })

  const { data: cust } = await raw.from('customers').insert({
    customer_code: `${TAG}-${Math.random().toString(36).slice(2, 7)}`, customer_name: `${TAG}피드백고객`,
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    is_active: true, created_by: userId,
  }).select('id').single()
  customerId = cust!.id
  // 자체점검(plan_type null) + 불량 1건 → ⑤⑥ 활성
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, sequence_num: 1, inspection_type: '작동', assigned_employee_id: userId,
    inspection_start_date: '2026-08-01', inspection_end_date: '2026-08-02', status: 'in_progress', created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspectionId = insp!.id
  await raw.from('inspection_defects').insert({
    inspection_id: inspectionId, defect_name: `${TAG}불량`, severity: '보통', action_end: '2026-08-20',
  })
  console.log(`  셋업 완료 (TAG=${TAG})`)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.locator('text=/⑥ 이행완료/').first().waitFor({ timeout: 20000 })

  console.log('[1] ⑥ 선택 — 칸 제목 혼동 해소')
  await page.locator('text=/⑥ 이행완료/').first().click()
  await page.waitForTimeout(1500)
  const body1 = await page.locator('body').innerText()
  check('불량 조치 칸 제목(구 "이행완료 N/M" 아님)', /불량 조치\s*\d+\/\d+/.test(body1), body1.match(/이행완료\s*\d+\/\d+/)?.[0] ?? '')
  check('제출일 미기록 안내 표시', /미기록 — 이 날짜가 ⑥ 완료 조건/.test(body1))
  check('진행률 0/6', /0\/6 단계/.test(body1))

  console.log('[2] 제출일 기록 — 화면이 곧바로 반응하는가')
  const recordBtn = page.getByRole('button', { name: /^기록$/ }).last()
  const container = recordBtn.locator('xpath=..')
  await container.locator('input').first().fill('2026-08-18')
  const t0 = Date.now()
  await recordBtn.click()

  let doneAt: number | null = null
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250)
    const t = await page.locator('body').innerText()
    if (/✓ 기록됨 2026-08-18 — ⑥ 완료/.test(t) && /1\/6 단계/.test(t)) { doneAt = Date.now() - t0; break }
  }
  check(`화면 반영 ${FEEDBACK_BUDGET_MS}ms 이내`, doneAt !== null && doneAt <= FEEDBACK_BUDGET_MS,
    doneAt === null ? '10초 내 미반영' : `${doneAt}ms`)
  console.log(`    (실측 ${doneAt ?? '>10000'}ms — 서버 액션 자체가 ~2초)`)

  const body2 = await page.locator('body').innerText()
  check('제출일 옆 기록 표시', /✓ 기록됨 2026-08-18/.test(body2))
  check('스텝바에 제출일 반영', /제출 2026-08-18/.test(body2))
  check('진행률 1/6', /1\/6 단계/.test(body2))

  console.log('[3] DB 실제 반영 — 화면만 앞서가지 않았는가')
  {
    const { data: row } = await raw.from('inspections').select('report11_submitted_at').eq('id', inspectionId).single()
    check('DB report11_submitted_at 저장', (row as { report11_submitted_at: string | null }).report11_submitted_at === '2026-08-18')
    const { data: st } = await raw.from('inspection_steps').select('status').eq('inspection_id', inspectionId).eq('step_num', 6).maybeSingle()
    check('DB step6 = completed', (st as { status: string } | null)?.status === 'completed')
  }

  console.log('[4] 새로고침해도 유지 — 선반영이 사라지지 않는가')
  await page.reload()
  await page.locator('text=/⑥ 이행완료/').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  const body3 = await page.locator('body').innerText()
  check('새로고침 후에도 1/6', /1\/6 단계/.test(body3))
  // 새로고침 뒤에는 inspection_steps.status가 completed라 '완료 …'로 표기된다(기록 직후엔
  // 그 행이 아직 갱신 전이라 '제출 …'). 둘 다 같은 사실의 표기이므로 어느 쪽이든 통과.
  //
  // ⚠ 날짜를 2026-08-18로 못박으면 **그날에만 통과한다**: '완료' 표기의 날짜는 사용자가 입력한
  //    제출일(2026-08-18)이 아니라 단계를 완료한 날(=오늘)이다. 실제로 날이 바뀌자마자
  //    '완료 2026-08-19'로 나와 실패했다(2026-08-19 실측). 이 절이 지키려는 것은 "새로고침 후에도
  //    날짜 표기가 남아 있는가"이므로, 제출일이든 오늘이든 **둘 중 하나면 통과**로 본다.
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  check('새로고침 후에도 날짜 표시(제출일 또는 완료일)',
    new RegExp(`(제출|완료) (2026-08-18|${todayKst})`).test(body3),
    body3.match(/(제출|완료)\s*20\d\d-\d\d-\d\d/)?.[0] ?? '(날짜 표기 없음)')
} catch (e) {
  fail++
  console.error('ERROR:', e instanceof Error ? e.message : e)
} finally {
  if (browser) await browser.close()
  console.log('[정리]')
  if (inspectionId) {
    await raw.from('inspection_defects').delete().eq('inspection_id', inspectionId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspectionId)
    await raw.from('inspections').delete().eq('id', inspectionId)
  }
  if (customerId) await raw.from('customers').delete().eq('id', customerId)
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId).catch(() => {}) }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
  process.exitCode = fail > 0 ? 1 : 0
}
