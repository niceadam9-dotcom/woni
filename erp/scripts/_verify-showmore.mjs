import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{autoRefreshToken:false,persistSession:false} })
mkdirSync('.test-shots', { recursive: true })
const EMAIL = 'test-showmore@erp-test.com', PW = 'ShowMore1!'
let ok = true, userId = ''
const check = (n, c, d='') => { console.log(c ? `  ✅ ${n}` : `  ❌ ${n} ${d}`); if (!c) ok = false }
let browser = null
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-더보기확인', role: 'admin', is_active: true, employee_id: 'TEST-SM', email: EMAIL })

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(15000)
  await page.goto('http://localhost:3000/login')
  await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.goto('http://localhost:3000/inspections/calendar')
  await page.getByText('점검 달력').first().waitFor()
  // 8월로 이동 (다음 달 버튼)
  await page.locator('button[title=다음]').click()
  const more = page.getByText(/\+\d+개 더 보기/).first()
  await more.waitFor({ timeout: 10000 })
  console.log('  💬 더보기 텍스트:', await more.textContent())
  await more.click()
  const overlay = page.locator('.rbc-overlay')
  const visible = await overlay.isVisible({ timeout: 5000 }).catch(() => false)
  check('더 보기 클릭 → 오버레이 팝업 표시', visible)
  if (visible) {
    const text = await overlay.textContent()
    check('오버레이에 접힌 항목(샤브올데이) 표시', (text ?? '').includes('샤브올데이'), text?.slice(0, 120))
    await page.screenshot({ path: '.test-shots/showmore-popup.png' })
    console.log('  📸 .test-shots/showmore-popup.png')
  }
} catch (e) { ok = false; console.error('❌ 중단:', e.message) }
finally {
  if (browser) await browser.close()
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId) }
  console.log('정리 완료')
}
console.log(ok ? '\n🎉 더 보기 팝업 검증 통과' : '\n⚠ 실패 있음')
process.exit(ok ? 0 : 1)
