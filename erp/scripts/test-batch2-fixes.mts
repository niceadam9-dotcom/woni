/** 2차 배치 발견 버그 3건 수정 검증 (2026-07-16) — HR-5 급여, HR-6 증명서, EX-R3 부서삭제 가드
 *  실행: npx tsx scripts/test-batch2-fixes.mts  (dev 서버 localhost:3000)
 */
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
const EMAIL = 'test-b2fix-admin@erp-test.com'
const PW = 'B2Fix1!'

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

let adminId = '', empId = '', deptId = '', certId = ''
let browser: import('playwright').Browser | null = null

try {
  console.log('[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email?.endsWith('b2fix-admin@erp-test.com') || u.email === 'test-b2fix-emp@erp-test.com') await raw.auth.admin.deleteUser(u.id)
  const { data: au } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  adminId = au!.user!.id
  await raw.from('profiles').upsert({ id: adminId, name: 'TEST-B2관리자', role: 'admin', is_active: true, employee_id: 'TEST-B2A', email: EMAIL })
  const { data: eu } = await raw.auth.admin.createUser({ email: 'test-b2fix-emp@erp-test.com', password: PW, email_confirm: true })
  empId = eu!.user!.id
  const { data: dept } = await raw.from('departments').insert({ name: 'TEST-B2부서' }).select('id').single()
  deptId = dept!.id
  await raw.from('profiles').upsert({ id: empId, name: 'TEST-B2직원', role: 'employee', is_active: true, employee_id: 'TEST-B2E', email: 'test-b2fix-emp@erp-test.com', department_id: deptId })

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  const dialogs: string[] = []
  page.on('dialog', d => { dialogs.push(d.message().slice(0, 80)); d.accept().catch(() => {}) })
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  console.log('[HR-5] 급여 등록 페이지 — 직원 드롭다운·부서명')
  await page.goto(`${BASE}/hr/payroll`)
  await page.waitForSelector('h1:has-text("급여 등록")')
  await page.getByRole('button', { name: /급여 등록/ }).click()   // 등록 모달 열기 (select는 모달 안)
  await page.waitForSelector('select')
  const opts = await page.locator('select option').allTextContents()
  check('직원 드롭다운에 직원 노출', opts.some(o => o.includes('TEST-B2직원')), JSON.stringify(opts.slice(0, 8)))
  await page.keyboard.press('Escape')
  await page.locator('button:has-text("×")').first().click().catch(() => {})

  console.log('[HR-6] 증명서 발급')
  await page.goto(`${BASE}/hr/certificates`)
  await page.waitForTimeout(1500)
  const { data: certIns, error: cErr } = await raw.from('certificates').insert({
    employee_id: empId, cert_type: 'employment', purpose: 'TEST-발급검증', issued_by: adminId,
  }).select('id').single()
  check('certificates 테이블 insert 성공', !cErr && !!certIns, cErr?.message ?? '')
  certId = certIns?.id ?? ''
  await page.goto(`${BASE}/hr/certificates`)
  await page.waitForTimeout(1500)
  check('발급 목록에 표시', await page.getByText('TEST-B2직원').count() > 0)

  console.log('[EX-R3] 부서 삭제 가드')
  // 행의 두 번째 아이콘 버튼(Trash2) 클릭 → 확인 모달의 삭제 버튼
  async function tryDeleteDept() {
    await page.goto(`${BASE}/admin/departments`)
    const row = page.locator('div').filter({ hasText: /^TEST-B2부서/ }).locator('..').last()
    const trash = page.locator('div.flex.items-center.justify-between', { hasText: 'TEST-B2부서' }).locator('button').nth(1)
    await trash.waitFor()
    await trash.click()
    await page.waitForTimeout(500)
    const confirmBtn = page.getByRole('button', { name: /^삭제/ }).last()
    await confirmBtn.click().catch(() => {})
    await page.waitForTimeout(2000)
    void row
  }
  await tryDeleteDept()
  const { data: deptKept } = await raw.from('departments').select('id').eq('id', deptId)
  check('소속 직원 있는 부서 삭제 차단', (deptKept ?? []).length === 1, JSON.stringify(dialogs))

  // 직원 소속 제거 후엔 삭제 가능해야 함
  await raw.from('profiles').update({ department_id: null }).eq('id', empId)
  await tryDeleteDept()
  const { data: deptGone } = await raw.from('departments').select('id').eq('id', deptId)
  check('빈 부서는 삭제 가능', (deptGone ?? []).length === 0)
  if ((deptGone ?? []).length === 0) deptId = ''
} catch (e) {
  fail++
  console.error('ERROR:', e instanceof Error ? e.message : e)
} finally {
  if (browser) await browser.close()
  console.log('[정리]')
  if (certId) await raw.from('certificates').delete().eq('id', certId)
  if (deptId) await raw.from('departments').delete().eq('id', deptId)
  for (const id of [empId, adminId].filter(Boolean)) { await raw.from('profiles').delete().eq('id', id); await raw.auth.admin.deleteUser(id).catch(() => {}) }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
}
