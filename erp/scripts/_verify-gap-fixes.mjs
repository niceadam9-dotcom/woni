// GAP-1(재활성 복원 시 담당 동기화)·GAP-2(점검 삭제 시 연결 항목 복귀) 수정 검증
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const ADMIN = 'test-gap-admin@erp-test.com', PW = 'GapFix1!'
let ok = true, adminId = '', empAId = '', empBId = '', custId = ''
const check = (n, c, d = '') => { console.log(c ? `  ✅ ${n}` : `  ❌ ${n} ${d}`); if (!c) ok = false }
let browser = null
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if ([ADMIN, 'test-gap-a@erp-test.com', 'test-gap-b@erp-test.com'].includes(u.email)) await raw.auth.admin.deleteUser(u.id)
  const mk = async (email, name, emp, role) => {
    const { data: nu } = await raw.auth.admin.createUser({ email, password: PW, email_confirm: true })
    await raw.from('profiles').upsert({ id: nu.user.id, name, role, is_active: true, employee_id: emp, email })
    return nu.user.id
  }
  adminId = await mk(ADMIN, 'TEST-갭관리자', 'TEST-GAPADM', 'admin')
  empAId = await mk('test-gap-a@erp-test.com', 'TEST-갭직원A', 'TEST-GAPA', 'employee')
  empBId = await mk('test-gap-b@erp-test.com', 'TEST-갭직원B', 'TEST-GAPB', 'employee')

  const { data: cust } = await raw.from('customers').insert({
    customer_code: `TEST-GAP-${Math.random().toString(36).slice(2, 6)}`,
    customer_name: 'TEST-갭-빌딩', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    contract_date: '2026-01-05', is_active: true, created_by: adminId, assigned_employee_id: empAId,
  }).select('id').single()
  custId = cust.id
  const { data: plan } = await raw.from('inspection_plans').select('id').eq('year', 2026).eq('month', 8).single()
  const { data: item } = await raw.from('inspection_plan_items').insert({
    plan_id: plan.id, customer_id: custId, inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    sequence_num: 1, plan_type: 'monthly', planned_date: '2026-08-10',
    scheduled_date: '2026-08-10', status: 'confirmed', assigned_employee_id: empAId,
    step1_date: '2026-08-10', step2_date: '2026-08-14', step3_date: '2026-08-20',
    step4_date: '2026-08-24', step5_date: '2026-09-01', step6_date: '2026-09-10',
  }).select('id').single()
  const itemId = item.id

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  await page.goto('http://localhost:3000/login')
  await page.fill('input[type=email]', ADMIN); await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]'); await page.waitForURL(u => !u.pathname.includes('/login'))

  console.log('[GAP-1] 재활성 복원 시 담당 동기화')
  await page.goto(`http://localhost:3000/customers?q=${encodeURIComponent('TEST-갭')}&active=all`)
  const row = () => page.locator('tr', { has: page.getByText('TEST-갭-빌딩') }).first()
  await row().waitFor()
  await row().getByRole('button', { name: '활성' }).click()
  await row().getByRole('button', { name: '비활성' }).waitFor()
  for (let i = 0; i < 20; i++) {
    const { data } = await raw.from('inspection_plan_items').select('status').eq('id', itemId).single()
    if (data.status === 'cancelled') break
    await new Promise(r => setTimeout(r, 500))
  }
  // 비활성 기간 중 담당 A→B 변경 (취소 항목은 동기화 대상 밖 — GAP-1 조건 재현)
  await raw.from('customers').update({ assigned_employee_id: empBId }).eq('id', custId)
  await row().getByRole('button', { name: '비활성' }).click()
  await row().getByRole('button', { name: '활성' }).waitFor()
  let restored = null
  for (let i = 0; i < 20; i++) {
    const { data } = await raw.from('inspection_plan_items').select('status, assigned_employee_id').eq('id', itemId).single()
    if (data.status !== 'cancelled') { restored = data; break }
    await new Promise(r => setTimeout(r, 500))
  }
  check('복원: 상태 confirmed 복귀', restored?.status === 'confirmed', JSON.stringify(restored))
  check('GAP-1 수정: 복원 항목 담당 = 고객 현재 담당(B)', restored?.assigned_employee_id === empBId,
    restored?.assigned_employee_id === empAId ? '실제: A(옛 담당)' : `실제: ${restored?.assigned_employee_id}`)

  console.log('[GAP-2] 점검 삭제 시 연결 항목 복귀')
  await page.goto('http://localhost:3000/inspection-plans?year=2026&month=8&view=list')
  await page.getByRole('button', { name: /^전체/ }).first().click()
  const planRow = () => page.locator('tr', { has: page.getByText('TEST-갭-빌딩') }).first()
  await planRow().waitFor()
  await planRow().getByText('시작', { exact: false }).click()
  await page.waitForURL(/\/inspections\/[0-9a-f-]+/, { timeout: 20000 })
  await page.getByText('6단계 업무 체크리스트').waitFor()
  await page.getByText('이 점검 삭제').click()
  await page.getByRole('button', { name: '삭제', exact: true }).click()
  await page.waitForURL(u => u.pathname === '/inspections', { timeout: 15000 })
  const { data: after } = await raw.from('inspection_plan_items')
    .select('status, inspection_id').eq('id', itemId).single()
  check('GAP-2 수정: 항목 status=confirmed 복귀', after.status === 'confirmed', JSON.stringify(after))
  check('GAP-2 수정: inspection_id 해제', after.inspection_id === null)
  await page.goto('http://localhost:3000/inspection-plans?year=2026&month=8&view=list')
  await page.getByRole('button', { name: /^전체/ }).first().click()
  await planRow().waitFor()
  check('목록: 시작 버튼 재노출 (재시작 가능)', await planRow().getByText('시작', { exact: false }).isVisible())
} catch (e) { ok = false; console.error('❌ 중단:', e.message) }
finally {
  if (browser) await browser.close()
  if (custId) {
    const inspIds = ((await raw.from('inspections').select('id').eq('customer_id', custId)).data ?? []).map(r => r.id)
    if (inspIds.length) {
      await raw.from('inspection_logs').delete().in('inspection_id', inspIds)
      await raw.from('inspection_steps').delete().in('inspection_id', inspIds)
    }
    await raw.from('inspection_plan_items').delete().eq('customer_id', custId)
    await raw.from('inspections').delete().eq('customer_id', custId)
    await raw.from('activity_logs').delete().in('entity_id', [custId, ...inspIds])
    await raw.from('customers').delete().eq('id', custId)
  }
  for (const id of [adminId, empAId, empBId].filter(Boolean)) {
    await raw.from('profiles').delete().eq('id', id)
    await raw.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('정리 완료')
}
console.log(ok ? '\n🎉 GAP-1·2 수정 검증 통과' : '\n⚠ 실패 있음')
process.exit(ok ? 0 : 1)
