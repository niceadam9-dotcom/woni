import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{autoRefreshToken:false,persistSession:false} })
const A_EMAIL = 'test-np-admin@erp-test.com', B_EMAIL = 'test-np-emp@erp-test.com', PW = 'NotifyPref1!'
let ok = true, aId = '', bId = ''
const custIds = []
const check = (n, c, d='') => { console.log(c ? `  ✅ ${n}` : `  ❌ ${n} ${d}`); if (!c) ok = false }
const bNotiCount = async () => {
  const { count } = await raw.from('notifications').select('id', { count: 'exact', head: true })
    .eq('recipient_id', bId).eq('type', 'inspection_assigned')
  return count ?? 0
}
let browser = null
try {
  // 계정 2개 (A: admin, B: employee) + A 담당의 임시 고객 2개
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if ([A_EMAIL, B_EMAIL].includes(u.email)) await raw.auth.admin.deleteUser(u.id)
  for (const [email, name, empId, role] of [[A_EMAIL,'TEST-알림A','TEST-NPA','admin'],[B_EMAIL,'TEST-알림B','TEST-NPB','employee']]) {
    const { data: nu } = await raw.auth.admin.createUser({ email, password: PW, email_confirm: true })
    await raw.from('profiles').upsert({ id: nu.user.id, name, role, is_active: true, employee_id: empId, email })
    if (email === A_EMAIL) aId = nu.user.id; else bId = nu.user.id
  }
  for (let i = 1; i <= 2; i++) {
    const { data: c } = await raw.from('customers').insert({
      customer_code: `TEST-NP-${i}-${Math.random().toString(36).slice(2,6)}`,
      customer_name: `TEST-알림고객${i}`, inspection_type: '작동',
      inspection_category: '소방안전관리', inspection_sub_type: '작동',
      contract_date: '2026-01-05', is_active: true, created_by: aId, assigned_employee_id: aId,
    }).select('id').single()
    custIds.push(c.id)
  }

  browser = await chromium.launch()
  // ── ① B 로그인 → 설정에서 담당 배정 알림 끄기 ──
  const ctxB = await browser.newContext()
  const pB = await ctxB.newPage(); pB.setDefaultTimeout(15000)
  await pB.goto('http://localhost:3000/login')
  await pB.fill('input[type=email]', B_EMAIL); await pB.fill('input[type=password]', PW)
  await pB.click('button[type=submit]'); await pB.waitForURL(u => !u.pathname.includes('/login'))
  await pB.goto('http://localhost:3000/settings')
  await pB.getByText('알림 설정').waitFor()
  check('설정: 알림 설정 카드 + 필수 항목 잠금 표시', await pB.getByText('항상 수신').first().isVisible())
  await pB.getByRole('switch', { name: '담당 배정' }).click()
  await pB.getByRole('button', { name: '저장' }).click()
  await pB.getByText('알림 설정이 저장되었습니다').waitFor()
  const { data: prefs1 } = await raw.from('profiles').select('notification_prefs').eq('id', bId).single()
  check('저장: DB prefs.assignment = false', prefs1.notification_prefs?.assignment === false, JSON.stringify(prefs1))
  await pB.screenshot({ path: '.test-shots/notify-prefs.png' })

  // ── ② A가 임시고객1을 B로 이관 (실제 UI: 직원 관리 > 담당 고객 이관) → B 미수신 ──
  const ctxA = await browser.newContext()
  const pA = await ctxA.newPage(); pA.setDefaultTimeout(15000)
  await pA.goto('http://localhost:3000/login')
  await pA.fill('input[type=email]', A_EMAIL); await pA.fill('input[type=password]', PW)
  await pA.click('button[type=submit]'); await pA.waitForURL(u => !u.pathname.includes('/login'))
  async function doHandover(fromName, toLabel) {
    await pA.goto('http://localhost:3000/admin/users')
    const row = pA.locator('tr', { has: pA.getByText(fromName) }).first()
    await row.locator('button[title="담당 고객 이관"]').click()
    const modal = pA.locator('div.fixed').filter({ hasText: '담당 고객 이관' })
    await modal.waitFor()
    await modal.locator('select').selectOption({ label: toLabel })
    await modal.getByRole('button', { name: /건 이관/ }).click()
    await modal.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 1500))
  }
  await doHandover('TEST-알림A', 'TEST-알림B')
  check('🔍 알림 끈 상태: 담당 이관해도 B에게 알림 미발송', (await bNotiCount()) === 0, `수신 ${await bNotiCount()}건`)

  // ── ③ B가 알림 다시 켜기 → A가 다시 이관(B→A→B 왕복 대신 고객2 사용) → B 수신 ──
  await pB.goto('http://localhost:3000/settings')
  await pB.getByRole('switch', { name: '담당 배정' }).click()
  await pB.getByRole('button', { name: '저장' }).click()
  await pB.getByText('알림 설정이 저장되었습니다').waitFor()
  // 이관은 전체 이관이므로 B→A로 되돌린 뒤 다시 A→B (이번엔 B가 수신해야 함)
  await doHandover('TEST-알림B', 'TEST-알림A')
  await raw.from('notifications').delete().eq('recipient_id', bId) // 카운트 초기화
  await doHandover('TEST-알림A', 'TEST-알림B')
  check('알림 켠 상태: 담당 이관 시 B에게 알림 수신', (await bNotiCount()) >= 1, `수신 ${await bNotiCount()}건`)
} catch (e) { ok = false; console.error('❌ 중단:', e.message) }
finally {
  if (browser) await browser.close()
  for (const id of custIds) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', id)
    await raw.from('activity_logs').delete().eq('entity_id', id)
    await raw.from('customers').delete().eq('id', id)
  }
  if (bId) await raw.from('notifications').delete().eq('recipient_id', bId)
  for (const id of [aId, bId].filter(Boolean)) {
    await raw.from('profiles').delete().eq('id', id)
    await raw.auth.admin.deleteUser(id)
  }
  console.log('정리 완료')
}
console.log(ok ? '\n🎉 알림 수신 설정 검증 통과' : '\n⚠ 실패 있음')
process.exit(ok ? 0 : 1)
