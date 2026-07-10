import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{autoRefreshToken:false,persistSession:false} })
const EMAIL = 'test-settings@erp-test.com', PW1 = 'Settings1!', PW2 = 'Settings2@'
let ok = true, userId = ''
const check = (n, c, d='') => { console.log(c ? `  ✅ ${n}` : `  ❌ ${n} ${d}`); if (!c) ok = false }
let browser = null
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW1, email_confirm: true })
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-설정확인', role: 'admin', is_active: true, employee_id: 'TEST-SET', email: EMAIL, position: '테스트직책', hire_date: '2026-01-05' })

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  page.setDefaultTimeout(15000)
  await page.goto('http://localhost:3000/login')
  await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', PW1)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })

  // 사이드바 설정 링크 → 페이지 렌더
  await page.goto('http://localhost:3000/settings')
  await page.getByRole('heading', { name: '설정' }).waitFor()
  check('설정 페이지 렌더 (404 해소)', true)
  check('내 정보 카드: 사번 표시', await page.getByText('TEST-SET', { exact: true }).isVisible())
  check('관리 바로가기 표시 (admin)', await page.getByText('관리 바로가기').isVisible())
  check('결재 서명 바로가기 표시', await page.getByText('결재 서명').isVisible())

  // 🔍 프로브: 잘못된 현재 비밀번호
  await page.locator('input[autocomplete=current-password]').fill('WrongPass1!')
  await page.locator('input[autocomplete=new-password]').first().fill(PW2)
  await page.locator('input[autocomplete=new-password]').nth(1).fill(PW2)
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await page.getByText('현재 비밀번호가 올바르지 않습니다').waitFor({ timeout: 10000 })
  check('🔍 잘못된 현재 비밀번호 → 거부', true)

  // 🔍 프로브: 새 비밀번호 불일치
  await page.locator('input[autocomplete=current-password]').fill(PW1)
  await page.locator('input[autocomplete=new-password]').first().fill(PW2)
  await page.locator('input[autocomplete=new-password]').nth(1).fill('Mismatch9!')
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await page.getByText('서로 일치하지 않습니다').waitFor({ timeout: 10000 })
  check('🔍 새 비밀번호 불일치 → 거부', true)

  // 정상 변경
  await page.locator('input[autocomplete=current-password]').fill(PW1)
  await page.locator('input[autocomplete=new-password]').first().fill(PW2)
  await page.locator('input[autocomplete=new-password]').nth(1).fill(PW2)
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await page.getByText('비밀번호가 변경되었습니다').waitFor({ timeout: 10000 })
  check('비밀번호 변경 성공 메시지', true)
  await page.screenshot({ path: '.test-shots/settings-page.png' })
  console.log('  📸 .test-shots/settings-page.png')

  // 새 비밀번호로 재로그인 확인 (새 컨텍스트)
  const ctx2 = await browser.newContext()
  const p2 = await ctx2.newPage()
  await p2.goto('http://localhost:3000/login')
  await p2.fill('input[type=email]', EMAIL); await p2.fill('input[type=password]', PW2)
  await p2.click('button[type=submit]')
  await p2.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  check('새 비밀번호로 로그인 성공', true)
  await ctx2.close()
} catch (e) { ok = false; console.error('❌ 중단:', e.message) }
finally {
  if (browser) await browser.close()
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId) }
  console.log('정리 완료')
}
console.log(ok ? '\n🎉 설정 페이지 검증 통과' : '\n⚠ 실패 있음')
process.exit(ok ? 0 : 1)
