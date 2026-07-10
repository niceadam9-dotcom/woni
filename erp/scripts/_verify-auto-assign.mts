/** 일회성 검증: 미배정 계획 항목 점검 시작 → 시작한 직원 자동 배정 (수정사항리스트 2번 A안) */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'
import gen from '../src/lib/inspection-plan-generator.ts'
const { generateYearlyPlanItems, loadHolidaySet } = gen as unknown as typeof import('../src/lib/inspection-plan-generator.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = raw as never as Parameters<typeof generateYearlyPlanItems>[0]
const EMAIL = 'test-autoassign@erp-test.com', PW = 'AutoAssign1!'
const NAME = 'TEST-자동배정-빌딩'
const YEAR = new Date().getFullYear()

let customerId = '', userId = ''
let ok = true
function check(n: string, c: boolean, d = '') { console.log(c ? `  ✅ ${n}` : `  ❌ ${n} ${d}`); if (!c) ok = false }

let browser: import('playwright').Browser | null = null
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-자동배정관리자', role: 'admin', is_active: true, employee_id: 'TEST-AA', email: EMAIL })

  const { data: cust } = await raw.from('customers').insert({
    customer_code: `TEST-AA-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: NAME, inspection_type: '종합', inspection_category: '소방안전관리',
    inspection_sub_type: '종합', use_approval_date: '2018-07-15', contract_date: '2026-01-05',
    is_active: true, created_by: userId, assigned_employee_id: null, // 고객도 미배정
  }).select('id').single()
  customerId = (cust as { id: string }).id
  const hdSet = await loadHolidaySet(admin, YEAR)
  await generateYearlyPlanItems(admin, { id: customerId, inspection_type: '종합', use_approval_date: '2018-07-15', assigned_employee_id: null }, YEAR, userId, hdSet)

  // 7월 특별 항목: 미배정 + 예정일만 확정 (직접 세팅)
  const { data: it } = await raw.from('inspection_plan_items')
    .select('id, assigned_employee_id, inspection_plans!inner(year, month)')
    .eq('customer_id', customerId).eq('plan_type', 'special_종합')
    .eq('inspection_plans.year', YEAR).eq('inspection_plans.month', 7).single()
  const itemId = (it as { id: string }).id
  await raw.from('inspection_plan_items').update({ scheduled_date: `${YEAR}-07-15` }).eq('id', itemId)
  check('셋업: 미배정 + 예정일 설정', (it as { assigned_employee_id: string | null }).assigned_employee_id === null)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  page.on('dialog', d => { console.log('  💬 confirm:', d.message().slice(0, 60)); d.accept() })
  await page.goto('http://localhost:3000/login')
  await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })

  await page.goto(`http://localhost:3000/inspection-plans?year=${YEAR}&month=7&view=list`)
  await page.getByRole('button', { name: /^전체/ }).first().click()
  const row = page.locator('tr', { has: page.getByText(NAME) }).first()
  await row.waitFor()
  check('목록: 미배정 항목에 시작 버튼 노출', await row.getByText('시작', { exact: false }).isVisible())
  await row.getByText('시작', { exact: false }).click()
  await page.waitForURL(/\/inspections\/[0-9a-f-]+/, { timeout: 20000 })
  check('시작: 점검 상세로 이동 (confirm 통과)', true)
  check('상세: 담당자 = 시작한 직원', await page.getByText('TEST-자동배정관리자').first().isVisible())

  const inspectionId = page.url().split('/inspections/')[1].split('?')[0]
  const { data: insp } = await raw.from('inspections').select('assigned_employee_id').eq('id', inspectionId).single()
  const { data: itemAfter } = await raw.from('inspection_plan_items').select('assigned_employee_id').eq('id', itemId).single()
  check('DB: 점검 담당 = 시작 직원', (insp as { assigned_employee_id: string }).assigned_employee_id === userId)
  check('DB: 계획 항목 담당도 동기화', (itemAfter as { assigned_employee_id: string }).assigned_employee_id === userId)
} catch (e) {
  ok = false
  console.error('❌ 중단:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  if (customerId) {
    const inspIds = ((await raw.from('inspections').select('id').eq('customer_id', customerId)).data ?? []).map(r => (r as { id: string }).id)
    if (inspIds.length) {
      await raw.from('inspection_logs').delete().in('inspection_id', inspIds)
      await raw.from('inspection_steps').delete().in('inspection_id', inspIds)
    }
    await raw.from('inspection_plan_items').delete().eq('customer_id', customerId)
    await raw.from('inspections').delete().eq('customer_id', customerId)
    await raw.from('activity_logs').delete().in('entity_id', [customerId, ...inspIds])
    await raw.from('customers').delete().eq('id', customerId)
  }
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId) }
  console.log('정리 완료')
}
console.log(ok ? '\n🎉 A안 검증 통과' : '\n⚠ 실패 있음')
process.exit(ok ? 0 : 1)
