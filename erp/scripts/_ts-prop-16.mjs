// TS-PROP-16: 공휴일 등록 → 신규 생성 예정일 영업일 회피 + 기존 일정 불변 + 달력 표시 → 삭제 원복
import { readFileSync } from 'fs'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const EMAIL = 'test-tsprop16@erp-test.com'
const HDATE = '2026-08-19' // 수요일 (평일)
let adminId = '', custId = '', cust2Id = '', browser = null, holidayAdded = false
try {
  adminId = await mkUser({ email: EMAIL, name: 'TEST-TS16관리자', employeeId: 'TEST-TS16' })
  // 기존 일정 고객 (공휴일 등록 전부터 8/19 예정) — 불변이어야 함
  cust2Id = await mkCustomer({ customer_name: 'TEST-공휴일-기존일정', created_by: adminId })
  const { id: p08 } = await ensurePlan(2026, 8, adminId)
  await raw.from('inspection_plan_items').insert({
    plan_id: p08, customer_id: cust2Id, inspection_type: '작동', inspection_category: '소방안전관리',
    inspection_sub_type: '작동', sequence_num: 1, plan_type: 'monthly', planned_date: HDATE, status: 'planned',
  })
  // 신규 생성 대상 고객 — 승인일 '일'=19, 승인월 8월 → 특별 8/19가 휴일 회피로 8/20이어야
  custId = await mkCustomer({ customer_name: 'TEST-공휴일-신규생성', created_by: adminId, use_approval_date: '2021-08-19' })

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  // ① 공휴일 추가 (관리자 UI)
  await page.goto(`${BASE}/admin/holidays`)
  await page.getByText('회사 자체 휴무일 추가').waitFor()
  await page.locator('form input[type=date]').fill(HDATE)
  await page.locator('form input[type=text]').fill('TEST-휴무테스트')
  await page.getByRole('button', { name: '추가' }).click()
  const added = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('holidays').select('id').eq('date', HDATE).maybeSingle(); if (data) return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  holidayAdded = added
  check('공휴일 추가 (2026-08-19 TEST-휴무테스트)', added)

  // ② 연간계획 크론 발화 → 신규 고객 8월 특별 예정일이 8/20으로 회피
  const res = await fetch(`${BASE.replace('localhost','localhost')}/api/cron/generate-yearly-plans?year=2026`, {
    headers: env.CRON_SECRET ? { authorization: `Bearer ${env.CRON_SECRET}` } : {},
  }).then(r => r.json())
  check('크론 발화 ok', res.ok === true, JSON.stringify(res))
  const { data: items } = await raw.from('inspection_plan_items')
    .select('plan_type, planned_date, inspection_plans(month)').eq('customer_id', custId)
  const special = items.find(i => i.plan_type === 'special_작동')
  check('신규 생성: 8/19(휴일) 회피 → 8/20', special?.planned_date === '2026-08-20', `실제: ${special?.planned_date}`)

  // ③ 기존 일정 불변
  const { data: old } = await raw.from('inspection_plan_items').select('planned_date').eq('customer_id', cust2Id).single()
  check('🔍 기존 일정 불변 (8/19 유지 — 재계산 없음)', old.planned_date === HDATE, `실제: ${old.planned_date}`)

  // ④ 점검확정 달력에 휴무일 표시
  await page.goto(`${BASE}/inspection-plans?year=2026&month=8&view=calendar`)
  await page.getByText('월간 점검계획 확정').waitFor()
  check('달력: 휴무일 이름 표시', await page.getByText('TEST-휴무테스트').first().isVisible({ timeout: 10000 }).catch(() => false))

  // ⑤ 공휴일 삭제 (원복)
  await page.goto(`${BASE}/admin/holidays`)
  const hRow = page.locator('li', { has: page.getByText('TEST-휴무테스트') }).first()
  await hRow.waitFor()
  await hRow.locator('button[title=삭제]').click()
  const gone = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('holidays').select('id').eq('date', HDATE).maybeSingle(); if (!data) return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  holidayAdded = !gone
  check('공휴일 삭제 원복', gone)
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  if (holidayAdded) await raw.from('holidays').delete().eq('date', HDATE)
  await cleanupCustomer(custId)
  await cleanupCustomer(cust2Id)
  await delUser(adminId)
  console.log('정리 완료')
}
summary()
