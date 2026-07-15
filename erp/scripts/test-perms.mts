/** 권한 검증 E2E — 직원: 점검대장 계약료 미노출 + 정산현황/안전관리대장/세금계산서 접근 차단,
 *  매니저: 계약료 표시 유지 (2026-07-14)
 *  실행: $env:TEST_BASE_URL='https://staging.sjfire.co.kr'; npx tsx scripts/test-perms.mts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium, type Page } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const PW = 'PermTest1!'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

const users: Array<{ email: string; role: string; id?: string }> = [
  { email: 'test-perm-emp@erp-test.com', role: 'employee' },
  { email: 'test-perm-mgr@erp-test.com', role: 'manager' },
]
let browser: import('playwright').Browser | null = null

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
}

try {
  console.log('\n[셋업] 직원·매니저 테스트 계정')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of users) {
    for (const e of existing?.users ?? []) if (e.email === u.email) await raw.auth.admin.deleteUser(e.id)
    const { data: nu, error } = await raw.auth.admin.createUser({ email: u.email, password: PW, email_confirm: true })
    if (error || !nu?.user) throw new Error(`계정 생성 실패(${u.email}): ${error?.message}`)
    u.id = nu.user.id
    await raw.from('profiles').upsert({
      id: u.id, name: `TEST-권한-${u.role}`, role: u.role, is_active: true,
      employee_id: `TEST-PERM-${u.role.slice(0, 3).toUpperCase()}`, email: u.email,
    })
  }

  browser = await chromium.launch()

  // ── 직원: 계약료 미노출 + 돈 화면 차단 ──
  console.log('\n[직원 계정]')
  const empPage = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  empPage.setDefaultTimeout(15000)
  await login(empPage, users[0].email)
  check('로그인 성공 (직원)', true)

  await empPage.goto(`${BASE}/inspection-ledger`)
  await empPage.getByText('점검 대장').first().waitFor()
  const bodyEmp = (await empPage.textContent('body')) ?? ''
  check('점검대장 접근 가능 (업무 정보)', bodyEmp.includes('점검 대장'))
  check('계약료 컬럼·합계 미노출', !bodyEmp.includes('계약료'), '계약료 텍스트 발견')

  for (const [path, label] of [['/billing/status', '정산현황'], ['/billing/annual', '안전관리 대장'], ['/tax-invoices', '세금계산서']] as const) {
    await empPage.goto(`${BASE}${path}`)
    await empPage.waitForURL(u => u.pathname === '/dashboard', { timeout: 15000 }).catch(() => {})
    check(`${label} 접근 차단 → 대시보드`, empPage.url().endsWith('/dashboard'), empPage.url())
  }
  await empPage.close()

  // ── 매니저: 계약료 표시 유지 + 돈 화면 접근 ──
  console.log('\n[매니저 계정]')
  const mgrPage = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  mgrPage.setDefaultTimeout(15000)
  await login(mgrPage, users[1].email)
  check('로그인 성공 (매니저)', true)

  await mgrPage.goto(`${BASE}/inspection-ledger`)
  await mgrPage.getByText('점검 대장').first().waitFor()
  const bodyMgr = (await mgrPage.textContent('body')) ?? ''
  check('점검대장 계약료 표시 유지', bodyMgr.includes('계약료'))

  await mgrPage.goto(`${BASE}/billing/status`)
  await mgrPage.waitForTimeout(1500)
  check('정산현황 접근 유지', !mgrPage.url().endsWith('/dashboard'), mgrPage.url())
  await mgrPage.close()

  await browser.close(); browser = null
} catch (e) {
  fail++
  console.error('\n❌ 테스트 중단:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  for (const u of users) {
    if (!u.id) continue
    await raw.from('profiles').delete().eq('id', u.id)
    await raw.auth.admin.deleteUser(u.id).catch(() => {})
  }
  console.log('\n[정리] 테스트 계정 삭제 완료')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
