import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{autoRefreshToken:false,persistSession:false} })
const EMAIL = 'test-region@erp-test.com', PW = 'Region1!'
let ok = true, userId = '', custId = ''
const check = (n, c, d='') => { console.log(c ? `  ✅ ${n}` : `  ❌ ${n} ${d}`); if (!c) ok = false }
let browser = null
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-지역확인', role: 'admin', is_active: true, employee_id: 'TEST-RG', email: EMAIL })
  const { data: c } = await raw.from('customers').insert({
    customer_code: `TEST-RG-${Math.random().toString(36).slice(2,6)}`,
    customer_name: 'TEST-지역-빌딩', inspection_type: '작동',
    inspection_category: '소방안전관리', inspection_sub_type: '작동',
    contract_date: '2026-01-05', is_active: true, created_by: userId,
    address: '경기 양평군 양평읍 양근리 123', region_si: '양평군', region_myeon: '양평읍', region_ri: '양근리',
  }).select('id').single()
  custId = c.id

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  page.setDefaultTimeout(15000)
  await page.goto('http://localhost:3000/login')
  await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'))

  await page.goto(`http://localhost:3000/customers/${custId}`)
  await page.getByText('TEST-지역-빌딩').first().waitFor()
  // 정보 수정 폼은 상세 페이지에 인라인으로 렌더됨
  await page.locator('textarea[placeholder="특이사항 메모"]').waitFor({ timeout: 10000 })
  check('지역 입력칸 제거됨', !(await page.getByText('시/군/구').isVisible({ timeout: 2000 }).catch(() => false)))
  check('"주소에서 추출" 버튼 제거됨', !(await page.getByText('주소에서 추출').isVisible({ timeout: 2000 }).catch(() => false)))
  await page.screenshot({ path: '.test-shots/region-hidden.png' })

  // 비고만 수정 후 저장 → 지역 데이터 보존 확인 (저장 버튼은 변경 시에만 나타남)
  const memo = page.locator('textarea[placeholder="특이사항 메모"]')
  await memo.fill('지역 보존 테스트')
  await page.locator('button:has-text("저장"):not([disabled])').first().click()
  await new Promise(r => setTimeout(r, 2000))
  const { data: after } = await raw.from('customers').select('region_si, region_myeon, region_ri, notes').eq('id', custId).single()
  check('🔍 저장 후 지역 데이터 보존 (양평군·양평읍·양근리)',
    after.region_si === '양평군' && after.region_myeon === '양평읍' && after.region_ri === '양근리', JSON.stringify(after))
  check('비고 저장 정상', after.notes === '지역 보존 테스트', after.notes ?? '')
} catch (e) { ok = false; console.error('❌ 중단:', e.message) }
finally {
  if (browser) await browser.close()
  if (custId) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', custId)
    await raw.from('activity_logs').delete().eq('entity_id', custId)
    await raw.from('customers').delete().eq('id', custId)
  }
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId) }
  console.log('정리 완료')
}
console.log(ok ? '\n🎉 지역 필드 숨김 검증 통과' : '\n⚠ 실패 있음')
process.exit(ok ? 0 : 1)
