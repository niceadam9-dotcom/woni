/** [보조] 서버 액션 응답 봉투(RSC flight) 실측 — 음성 파싱 단계 스텁을 위해 형식만 확인 */
import { BASE, mkUser, delUser, mkCustomer, cleanupCustomer, raw, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'judge-ex4ev@erp-test.com'
let userId = '', cid = '', bid = '', iid = '', browser = null
try {
  userId = await mkUser({ email: EMAIL, name: '봉투확인', employeeId: 'JUDGE-EX4EV' })
  const Y = new Date(Date.now() + 9 * 3600_000).getFullYear()
  cid = await mkCustomer({ customer_name: 'JUDGEEX4EV외관', address: '경기 양평군 재판정로 13', created_by: userId })
  const { data: b } = await raw.from('buildings').insert({
    customer_id: cid, building_name: '본관', is_active: true, created_by: userId, purpose: '근린생활시설',
  }).select('id').single()
  bid = b.id
  await raw.from('fire_facilities').insert({ building_id: bid, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true })
  const { data: i } = await raw.from('inspections').insert({
    customer_id: cid, inspection_type: '작동', sequence_num: 1, plan_type: 'monthly',
    inspection_start_date: `${Y}-05-14`, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  iid = i.id
  const l = await launch(); browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000)
  const caps = []
  page.on('response', async r => {
    const req = r.request()
    if (req.method() !== 'POST' || !req.headers()['next-action']) return
    let body = ''
    try { body = (await r.text()).slice(0, 900) } catch (e) { body = `[본문 없음: ${e.message}]` }
    caps.push({ id: req.headers()['next-action'], req: (req.postData() ?? '').slice(0, 200), ct: r.headers()['content-type'], hdrs: Object.keys(r.headers()).join(','), body })
  })
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${iid}`)
  await page.waitForSelector('text=점검표 입력')
  await page.locator('button', { hasText: '소화기구' }).first().click()
  await page.waitForSelector('[aria-label="X1-01 O"]')
  await page.waitForTimeout(3000)
  for (const c of caps) console.log('\n=== action ' + c.id + '\n req: ' + c.req + '\n ct: ' + c.ct + '\n hdrs: ' + c.hdrs + '\n body:\n' + c.body)
} catch (e) { console.error(e) } finally {
  if (browser) await browser.close().catch(() => {})
  if (iid) { await raw.from('inspection_sheet_responses').delete().eq('inspection_id', iid); await raw.from('inspections').delete().eq('id', iid) }
  if (bid) await raw.from('fire_facilities').delete().eq('building_id', bid)
  if (cid) { await raw.from('buildings').delete().eq('customer_id', cid); await cleanupCustomer(cid).catch(() => {}) }
  await delUser(userId)
}
