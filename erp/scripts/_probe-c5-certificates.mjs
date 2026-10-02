// C5 실보행 — /hr/certificates가 렌더되고, 인쇄 영역 하단 명의가 회사정보에서 오는가(종전 '(주) 승진소방 대표' 고정 문구 0)
import { raw, mkUser, delUser, launch, login, check, summary, BASE } from './_e2e-helpers.mjs'
const tag = Date.now().toString(36)
let userId, empId, certId, browser
try {
  userId = await mkUser({ email: `c5-${tag}@e2e.test`, name: `C5관리자${tag}`, employeeId: `C5${tag}`, role: 'manager' })
  // 발급 이력 1건을 심어 인쇄 버튼을 띄운다(본인 사번으로)
  empId = userId
  const { data: cert, error } = await raw.from('certificates')
    .insert({ employee_id: empId, cert_type: 'employment', purpose: 'C5 실보행', issued_by: userId }).select('id').single()
  if (error) throw new Error('certificates insert: ' + error.message)
  certId = cert.id
  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, `c5-${tag}@e2e.test`)
  const res = await page.goto(`${BASE}/hr/certificates`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByRole('heading', { name: '증명서 발급' }).waitFor({ timeout: 60000 })
  check('페이지 200', res?.status() === 200, String(res?.status()))
  check('제목 렌더', await page.getByRole('heading', { name: '증명서 발급' }).isVisible())
  // window.print를 막고 인쇄 버튼 클릭 → 인쇄 영역 DOM 확인
  await page.evaluate(() => { window.print = () => {} })
  const row = page.locator('tr', { hasText: `C5관리자${tag}` }).first()
  await row.locator('button').first().click()
  await page.waitForSelector('#print-area', { state: 'attached', timeout: 5000 })
  const txt = await page.locator('#print-area').innerText().catch(async () => page.locator('#print-area').textContent())
  check('하단 명의에 고정 문구 없음', !txt.includes('(주) 승진소방 대표'), txt.slice(-60))
  check('하단 명의 = 회사정보(대표이사 + (인))', /대표이사 .+ \(인\)/.test(txt), txt.slice(-60).replace(/\s+/g, ' '))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  // 정리는 서로 독립 — 하나가 던져도 나머지가 돈다(첫 실행에서 close 실패로 사용자가 남았다)
  try { if (certId) await raw.from('certificates').delete().eq('id', certId) } catch {}
  try { if (browser) await browser.close() } catch {}
  try { if (userId) await delUser(userId) } catch {}
}
summary()
