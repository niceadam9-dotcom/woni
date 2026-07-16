/** 사이드바 순서 실측 (2026-07-16 재배열 검증) — 임시 admin으로 로그인해 그룹·소방안전관리 항목 순서 출력 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'test-sidebar-admin@erp-test.com'

let userId = ''
let browser: import('playwright').Browser | null = null
try {
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: 'Sidebar1!', email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-사이드바', role: 'admin', is_active: true, employee_id: 'TEST-SBR', email: EMAIL })

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } })
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', 'Sidebar1!')
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  const groups = await page.locator('aside button').allTextContents()
  console.log('그룹 순서:', groups.map(g => g.trim()).filter(Boolean).join(' → '))
  await page.locator('aside button', { hasText: '소방안전관리' }).click()
  await page.waitForTimeout(500)
  const items = await page.locator('aside a').allTextContents()
  console.log('소방안전관리 펼침 후 링크 순서:', items.map(i => i.trim()).filter(Boolean).join(' → '))
} finally {
  if (browser) await browser.close()
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId).catch(() => {}) }
}
