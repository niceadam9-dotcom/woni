// TS-PROP-15: 회사 정보(업체명) 변경 → 로그인 화면·사이드바 반영 → 원복 (운영 값 — 원복 필수)
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'test-tsprop15@erp-test.com'
let adminId = '', browser = null, originalName = null
const SUFFIX = '·검증T'
try {
  adminId = await mkUser({ email: EMAIL, name: 'TEST-TS15관리자', employeeId: 'TEST-TS15' })
  const { data: comp } = await raw.from('company_profile').select('company_name').limit(1).single()
  originalName = comp.company_name
  const testName = originalName + SUFFIX

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  // ① 회사 정보에서 업체명 변경
  await page.goto(`${BASE}/company`)
  const nameInput = page.locator('input:visible').first()
  await nameInput.waitFor()
  check('회사 정보 폼: 현재 업체명 로드', (await nameInput.inputValue()) === originalName)
  await nameInput.fill(testName)
  await page.locator('button:has-text("저장"):not([disabled])').first().click()
  const saved = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('company_profile').select('company_name').limit(1).single(); if (data.company_name === testName) return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  check('업체명 변경 저장', saved)

  // ② 사이드바 브랜드 반영
  await page.goto(`${BASE}/dashboard`)
  check('사이드바: 변경된 업체명 표시', await page.getByText(testName).first().isVisible({ timeout: 10000 }).catch(() => false))

  // ③ 로그인 화면 반영 (비로그인 컨텍스트)
  const ctx2 = await browser.newContext()
  const p2 = await ctx2.newPage()
  await p2.goto(`${BASE}/login`)
  check('로그인 화면: 변경된 업체명 표시', await p2.getByText(testName).first().isVisible({ timeout: 10000 }).catch(() => false))
  await ctx2.close()

  // ④ 원복
  await page.goto(`${BASE}/company`)
  await nameInput.waitFor()
  await page.locator('input:visible').first().fill(originalName)
  await page.locator('button:has-text("저장"):not([disabled])').first().click()
  const reverted = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('company_profile').select('company_name').limit(1).single(); if (data.company_name === originalName) return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  check('원복 완료', reverted)
  if (reverted) originalName = null // finally에서 재원복 불필요
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  // 안전망: 원복 실패 시 DB 직접 원복
  if (originalName) {
    await raw.from('company_profile').update({ company_name: originalName }).neq('company_name', originalName)
    console.log('  ⚠ DB 직접 원복 실행')
  }
  await delUser(adminId)
  console.log('정리 완료')
}
summary()
