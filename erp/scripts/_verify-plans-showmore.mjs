import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{autoRefreshToken:false,persistSession:false} })
const EMAIL = 'test-plansmore@erp-test.com', PW = 'PlansMore1!'
let ok = true, userId = ''
const custIds = []
const check = (n, c, d='') => { console.log(c ? `  ✅ ${n}` : `  ❌ ${n} ${d}`); if (!c) ok = false }
let browser = null
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-계획더보기', role: 'admin', is_active: true, employee_id: 'TEST-PM', email: EMAIL })

  // 2026-07 플랜에 같은 날(7/21) 항목 4건 (임시 고객 4명)
  const { data: plan } = await raw.from('inspection_plans').select('id').eq('year', 2026).eq('month', 7).single()
  for (let i = 1; i <= 4; i++) {
    const { data: c } = await raw.from('customers').insert({
      customer_code: `TEST-PM-${i}-${Math.random().toString(36).slice(2,6)}`,
      customer_name: `TEST-더보기${i}`, inspection_type: '작동',
      inspection_category: '소방안전관리', inspection_sub_type: '작동',
      contract_date: '2026-01-05', is_active: true, created_by: userId,
    }).select('id').single()
    custIds.push(c.id)
    await raw.from('inspection_plan_items').insert({
      plan_id: plan.id, customer_id: c.id, inspection_type: '작동',
      inspection_category: '소방안전관리', inspection_sub_type: '작동',
      sequence_num: 1, plan_type: 'monthly', planned_date: '2026-07-21',
      scheduled_date: null, status: 'planned',
    })
  }

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  await page.goto('http://localhost:3000/login')
  await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.goto('http://localhost:3000/inspection-plans?year=2026&month=7&view=calendar')
  const more = page.getByText(/\+\d+개 더 보기/).first()
  await more.waitFor({ timeout: 10000 })
  console.log('  💬', await more.textContent())
  await more.click()
  const header = page.getByText(/7월 21일 전체 일정/)
  const visible = await header.isVisible({ timeout: 5000 }).catch(() => false)
  check('더 보기 클릭 → 날짜 전체 팝업 표시', visible)
  if (visible) {
    check('팝업에 4건 표시', await page.getByText('전체 일정 (4건)').isVisible().catch(() => false)
      || (await page.locator('div.fixed .truncate').count()) >= 4)
    // 팝업 항목 클릭 → 슬라이드 패널 열림
    await page.locator('div.fixed .truncate', { hasText: 'TEST-더보기4' }).click()
    const panel = await page.getByText('점검 예정일').first().isVisible({ timeout: 5000 }).catch(() => false)
    check('팝업 항목 클릭 → 상세 슬라이드 패널 열림', panel)
    await page.screenshot({ path: '.test-shots/plans-showmore.png' })
    console.log('  📸 .test-shots/plans-showmore.png')
  }
} catch (e) { ok = false; console.error('❌ 중단:', e.message) }
finally {
  if (browser) await browser.close()
  for (const id of custIds) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', id)
    await raw.from('customers').delete().eq('id', id)
  }
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId) }
  console.log('정리 완료')
}
console.log(ok ? '\n🎉 점검확정 달력 더 보기 검증 통과' : '\n⚠ 실패 있음')
process.exit(ok ? 0 : 1)
