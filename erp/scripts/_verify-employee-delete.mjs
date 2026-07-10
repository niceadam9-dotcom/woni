import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{autoRefreshToken:false,persistSession:false} })
mkdirSync('.test-shots/employee-delete', { recursive: true })

const ADMIN_EMAIL = 'test-deladmin@erp-test.com', PW = 'DelAdmin1!'
const VICTIM_EMAIL = 'test-delete-me@erp-test.com'
let ok = true
const check = (n, c, d='') => { console.log(c ? `  ✅ ${n}` : `  ❌ ${n} ${d}`); if (!c) ok = false }

let adminId = '', victimId = ''
let browser = null
try {
  // 임시 관리자 + 삭제 대상(이력 0건) 계정 생성
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if ([ADMIN_EMAIL, VICTIM_EMAIL].includes(u.email)) await raw.auth.admin.deleteUser(u.id)
  const { data: a } = await raw.auth.admin.createUser({ email: ADMIN_EMAIL, password: PW, email_confirm: true })
  adminId = a.user.id
  await raw.from('profiles').upsert({ id: adminId, name: 'TEST-삭제관리자', role: 'admin', is_active: true, employee_id: 'TEST-DELADM', email: ADMIN_EMAIL })
  const { data: v } = await raw.auth.admin.createUser({ email: VICTIM_EMAIL, password: 'DeleteMe1!', email_confirm: true })
  victimId = v.user.id
  await raw.from('profiles').upsert({ id: victimId, name: 'TEST-삭제대상', role: 'employee', is_active: true, employee_id: 'TEST-DELME', email: VICTIM_EMAIL })

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  page.on('dialog', d => d.accept())
  await page.goto('http://localhost:3000/login')
  await page.fill('input[type=email]', ADMIN_EMAIL); await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })

  // ① 이력 있는 직원(김흥준): 삭제 버튼 비활성 + 사유 표시
  await page.goto('http://localhost:3000/admin/users')
  const kimRow = page.locator('tr', { has: page.getByText('김흥준') }).first()
  await kimRow.waitFor()
  await kimRow.locator('button[title=수정]').click()
  await page.getByText('계정 삭제').waitFor()
  const reason = await page.getByText(/업무 이력이 있어 삭제할 수 없습니다/).isVisible().catch(() => false)
  const disabled = await page.locator('button:has-text("삭제")').last().isDisabled()
  check('🔍 이력 있는 직원: 삭제 버튼 비활성 + 사유 안내', reason && disabled)
  await page.screenshot({ path: '.test-shots/employee-delete/01-guarded.png' })
  await page.locator('button:has-text("취소")').click()

  // ② 이력 없는 계정: 삭제 가능 → 삭제 실행
  const vicRow = page.locator('tr', { has: page.getByText('TEST-삭제대상') }).first()
  await vicRow.waitFor()
  await vicRow.locator('button[title=수정]').click()
  await page.getByText('업무 이력이 없는 계정입니다').waitFor()
  check('이력 없는 계정: 삭제 활성 안내 표시', true)
  await page.screenshot({ path: '.test-shots/employee-delete/02-deletable.png' })
  await page.locator('button:has-text("삭제")').last().click()
  await page.locator('tr', { has: page.getByText('TEST-삭제대상') }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await page.goto('http://localhost:3000/admin/users?active=all')
  const stillThere = await page.getByText('TEST-삭제대상').isVisible({ timeout: 3000 }).catch(() => false)
  check('삭제 후 목록에서 제거됨', !stillThere)
  await page.screenshot({ path: '.test-shots/employee-delete/03-after-delete.png' })

  // ③ DB 확인: 프로필·auth 계정 삭제 + 이력 기록
  const { data: prof } = await raw.from('profiles').select('id').eq('id', victimId)
  const { data: users2 } = await raw.auth.admin.listUsers()
  const authGone = !(users2?.users ?? []).some(u => u.id === victimId)
  check('DB: 프로필 삭제됨', (prof ?? []).length === 0)
  check('DB: auth 계정 삭제됨', authGone)
  const { data: log } = await raw.from('activity_logs').select('id, metadata').eq('action', 'employee_deleted').eq('entity_id', victimId)
  check('DB: employee_deleted 이력 기록', (log ?? []).length === 1, JSON.stringify(log))
  if (authGone) victimId = '' // 정리 불필요
} catch (e) {
  ok = false
  console.error('❌ 중단:', e.message)
} finally {
  if (browser) await browser.close()
  if (victimId) { await raw.from('profiles').delete().eq('id', victimId); await raw.auth.admin.deleteUser(victimId).catch(() => {}) }
  await raw.from('activity_logs').delete().eq('action', 'employee_deleted').eq('actor_id', adminId)
  if (adminId) { await raw.from('profiles').delete().eq('id', adminId); await raw.auth.admin.deleteUser(adminId) }
  console.log('정리 완료')
}
console.log(ok ? '\n🎉 직원 삭제 검증 통과' : '\n⚠ 실패 있음')
process.exit(ok ? 0 : 1)
