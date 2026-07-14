/** 沅뚰븳 寃利?E2E ??吏곸썝: ?먭????怨꾩빟猷?誘몃끂異?+ ?뺤궛?꾪솴/?덉쟾愿由щ????멸툑怨꾩궛???묎렐 李⑤떒,
 *  留ㅻ땲?: 怨꾩빟猷??쒖떆 ?좎? (2026-07-14)
 *  ?ㅽ뻾: $env:TEST_BASE_URL='https://staging.sjfire.co.kr'; npx tsx scripts/test-perms.mts
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
  if (cond) { pass++; console.log(`  ??${name}`) }
  else { fail++; console.log(`  ??${name} ${detail}`) }
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
  console.log('\n[?뗭뾽] 吏곸썝쨌留ㅻ땲? ?뚯뒪??怨꾩젙')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of users) {
    for (const e of existing?.users ?? []) if (e.email === u.email) await raw.auth.admin.deleteUser(e.id)
    const { data: nu, error } = await raw.auth.admin.createUser({ email: u.email, password: PW, email_confirm: true })
    if (error || !nu?.user) throw new Error(`怨꾩젙 ?앹꽦 ?ㅽ뙣(${u.email}): ${error?.message}`)
    u.id = nu.user.id
    await raw.from('profiles').upsert({
      id: u.id, name: `TEST-沅뚰븳-${u.role}`, role: u.role, is_active: true,
      employee_id: `TEST-PERM-${u.role.slice(0, 3).toUpperCase()}`, email: u.email,
    })
  }

  browser = await chromium.launch()

  // ?? 吏곸썝: 怨꾩빟猷?誘몃끂異?+ ???붾㈃ 李⑤떒 ??
  console.log('\n[吏곸썝 怨꾩젙]')
  const empPage = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  empPage.setDefaultTimeout(15000)
  await login(empPage, users[0].email)
  check('濡쒓렇???깃났 (吏곸썝)', true)

  await empPage.goto(`${BASE}/inspection-ledger`)
  await empPage.getByText('?먭? ???).first().waitFor()
  const bodyEmp = (await empPage.textContent('body')) ?? ''
  check('?먭?????묎렐 媛??(?낅Т ?뺣낫)', bodyEmp.includes('?먭? ???))
  check('怨꾩빟猷?而щ읆쨌?⑷퀎 誘몃끂異?, !bodyEmp.includes('怨꾩빟猷?), '怨꾩빟猷??띿뒪??諛쒓껄')

  for (const [path, label] of [['/billing/status', '?뺤궛?꾪솴'], ['/billing/annual', '?덉쟾愿由????], ['/tax-invoices', '?멸툑怨꾩궛??]] as const) {
    await empPage.goto(`${BASE}${path}`)
    await empPage.waitForURL(u => u.pathname === '/dashboard', { timeout: 15000 }).catch(() => {})
    check(`${label} ?묎렐 李⑤떒 ????쒕낫??, empPage.url().endsWith('/dashboard'), empPage.url())
  }
  await empPage.close()

  // ?? 留ㅻ땲?: 怨꾩빟猷??쒖떆 ?좎? + ???붾㈃ ?묎렐 ??
  console.log('\n[留ㅻ땲? 怨꾩젙]')
  const mgrPage = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  mgrPage.setDefaultTimeout(15000)
  await login(mgrPage, users[1].email)
  check('濡쒓렇???깃났 (留ㅻ땲?)', true)

  await mgrPage.goto(`${BASE}/inspection-ledger`)
  await mgrPage.getByText('?먭? ???).first().waitFor()
  const bodyMgr = (await mgrPage.textContent('body')) ?? ''
  check('?먭????怨꾩빟猷??쒖떆 ?좎?', bodyMgr.includes('怨꾩빟猷?))

  await mgrPage.goto(`${BASE}/billing/status`)
  await mgrPage.waitForTimeout(1500)
  check('?뺤궛?꾪솴 ?묎렐 ?좎?', !mgrPage.url().endsWith('/dashboard'), mgrPage.url())
  await mgrPage.close()

  await browser.close(); browser = null
} catch (e) {
  fail++
  console.error('\n???뚯뒪??以묐떒:', (e as Error).message)
} finally {
  if (browser) await browser.close()
  for (const u of users) {
    if (!u.id) continue
    await raw.from('profiles').delete().eq('id', u.id)
    await raw.auth.admin.deleteUser(u.id).catch(() => {})
  }
  console.log('\n[?뺣━] ?뚯뒪??怨꾩젙 ??젣 ?꾨즺')
}

console.log(`\n寃곌낵: ${pass} ?듦낵 / ${fail} ?ㅽ뙣`)
process.exit(fail > 0 ? 1 : 0)
