/** QR 카드 현장 동작 실주행 (통합 실행계획 C4 2단계 웹 — dev 서버 + 스테이징 176 필요)
 *  실행: npx tsx scripts/test-tag-card-e2e.mts
 *
 *  폰 화면(390×844)으로:
 *   [1] 비로그인 /t/{code} → /login?next=/t/{code} → 로그인 → **그 코드 카드로 복귀**(종전엔 달력으로 가서 코드를 잃었다)
 *       · 열린 리다이렉트 방지: next=//evil.example 로그인은 달력(HOME)으로
 *   [2] 카드를 열면 scan 이벤트 1행 — 다시 열어도 같은 날은 1행
 *   [3] [이상 없음] → inspect·good 이벤트(진행 중 회차에 묶임)
 *   [4] [불량 등록] → 진행 중 회차에 불량 1건 · asset_id · inspect·defect 이벤트(defect_id) · 위치가 상세에
 *   [5] 회차 없는 고객의 설비 → 불량 등록 거절 문구(회차를 만들지 않는다)
 *   [6] 미등록 코드 → 등록 폼 → 고객 검색·품목·위치 → 그 코드의 설비 1대(qty 1) → 카드로 바뀐다
 *   [7] [교체] → status replaced · replace 이벤트 · 버튼 사라짐 */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, mkUser, delUser, mkCustomer, cleanupCustomer, check, summary } from './_e2e-helpers.mjs'
import { chromium } from 'playwright'
import { newTagCode } from '../src/lib/equipment-tag'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `tagcard.${SUF}@e2e.test`
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
let userId = '', custA = '', custB = '', inspId = ''
const assetIds: string[] = []
let browser: import('playwright').Browser | null = null

async function mkAsset(customerId: string, location: string) {
  const code = newTagCode()
  const { data, error } = await raw.from('equipment_assets').insert({
    customer_id: customerId, category: 'powder', location, qty: 1, lifespan_rule: 'legal10', status: 'in_use', tag_code: code, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`설비 생성 실패: ${error.message}`)
  assetIds.push(data!.id)
  return { id: data!.id as string, code }
}
const events = async (assetId: string, type: string) =>
  ((await raw.from('equipment_asset_events').select('id, result, inspection_id, defect_id, event_date').eq('asset_id', assetId).eq('event_type', type)).data ?? []) as Array<{ id: string; result: string | null; inspection_id: string | null; defect_id: string | null; event_date: string }>

async function loginVia(page: Page, url: string) {
  await page.goto(url)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
}

try {
  userId = await mkUser({ email: EMAIL, name: `태그${SUF}`, employeeId: `TG-${SUF}`, role: 'employee' })
  custA = await mkCustomer({ customer_name: `태그카드사${SUF}`, created_by: userId, address: '경기도 양평군 검증면 1', fire_station: '양평' })
  custB = await mkCustomer({ customer_name: `태그회차없음${SUF}`, created_by: userId, address: '경기도 양평군 검증면 2', fire_station: '양평' })
  const { data: insp, error } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', plan_type: 'special_작동', sequence_num: 1,
    inspection_start_date: today, inspection_end_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspId = insp!.id
  const a1 = await mkAsset(custA, '3층 계단 옆')
  const a2 = await mkAsset(custB, '1층 현관')

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)

  console.log('[1] 비로그인 스캔 → 로그인 → 그 코드로 복귀')
  const anon = await page.request.get(`${BASE}/t/${a1.code}`, { maxRedirects: 0 })
  const loc = anon.headers()['location'] ?? ''
  check('비로그인 /t/{code} → /login?next=', anon.status() >= 300 && anon.status() < 400 && loc.includes('/login') && decodeURIComponent(loc).includes(`next=/t/${a1.code}`), `${anon.status()} ${loc}`)
  const cal = await page.request.get(`${BASE}/customers`, { maxRedirects: 0 })
  check('다른 사내 경로는 next 없이 /login(범위 고정)', !(cal.headers()['location'] ?? '').includes('next='), cal.headers()['location'])
  await loginVia(page, `${BASE}/login?next=${encodeURIComponent('//evil.example/x')}`)
  check('next=//evil → 외부로 가지 않음', new URL(page.url()).host === new URL(BASE).host, page.url())
  await ctx.clearCookies()
  await loginVia(page, `${BASE}/t/${a1.code}`)
  check('로그인 뒤 그 코드 카드로 복귀', new URL(page.url()).pathname === `/t/${a1.code}`, page.url())
  await page.getByTestId('tag-card').waitFor()

  console.log('[2] scan 이벤트 — 같은 날 1행')
  for (let i = 0; i < 20 && (await events(a1.id, 'scan')).length === 0; i++) await page.waitForTimeout(250)
  check('카드 열기 → scan 1행', (await events(a1.id, 'scan')).length === 1)
  await page.reload(); await page.getByTestId('tag-card').waitFor(); await page.waitForTimeout(1500)
  check('다시 열어도 같은 날 1행', (await events(a1.id, 'scan')).length === 1)

  console.log('[3] [이상 없음]')
  await page.getByTestId('tag-good').click()
  await page.getByTestId('tag-action-msg').waitFor()
  const good = (await events(a1.id, 'inspect')).filter(e => e.result === 'good')
  check('inspect·good 1행 · 진행 중 회차에 묶임', good.length === 1 && good[0].inspection_id === inspId, JSON.stringify(good))

  console.log('[4] [불량 등록]')
  await page.getByTestId('tag-defect-open').click()
  await page.getByTestId('tag-defect-name').fill('압력 미달')
  await page.getByTestId('tag-defect-submit').click()
  await page.getByTestId('tag-action-msg').filter({ hasText: '불량을 등록했습니다' }).waitFor()
  const { data: defs } = await raw.from('inspection_defects').select('id, asset_id, defect_name, defect_detail').eq('inspection_id', inspId)
  const d = (defs ?? []) as Array<{ id: string; asset_id: string | null; defect_name: string; defect_detail: string | null }>
  check('진행 중 회차에 불량 1건', d.length === 1 && d[0].defect_name === '압력 미달', JSON.stringify(d))
  check('불량 asset_id = 이 설비', d[0]?.asset_id === a1.id)
  check('상세에 위치', (d[0]?.defect_detail ?? '').includes('3층 계단 옆'), d[0]?.defect_detail ?? '')
  const bad = (await events(a1.id, 'inspect')).filter(e => e.result === 'defect')
  check('inspect·defect 이벤트 + defect_id', bad.length === 1 && bad[0].defect_id === d[0]?.id && bad[0].inspection_id === inspId)

  console.log('[5] 회차 없는 고객')
  await page.goto(`${BASE}/t/${a2.code}`); await page.getByTestId('tag-card').waitFor()
  await page.getByTestId('tag-defect-open').click()
  await page.getByTestId('tag-defect-name').fill('핀 탈락')
  await page.getByTestId('tag-defect-submit').click()
  await page.getByTestId('tag-action-msg').waitFor()
  check('거절 문구(회차 먼저)', (await page.getByTestId('tag-action-msg').innerText()).includes('진행 중 점검 회차가 없습니다'))
  const { count: bInsp } = await raw.from('inspections').select('id', { count: 'exact', head: true }).eq('customer_id', custB)
  check('회차를 만들지 않음', bInsp === 0, String(bInsp))

  console.log('[6] 미등록 코드 = 첫 등록')
  const fresh = newTagCode()
  await page.goto(`${BASE}/t/${fresh}`); await page.getByTestId('tag-unknown').waitFor()
  await page.getByTestId('tag-register-q').fill(`태그카드사${SUF}`)
  await page.getByTestId('tag-register-hit').first().click()
  await page.getByTestId('tag-register-location').fill('2층 복도')
  await page.getByTestId('tag-register-ym').fill('2019-05')
  await page.getByTestId('tag-register-submit').click()
  await page.getByTestId('tag-card').waitFor()
  const { data: reg } = await raw.from('equipment_assets').select('id, customer_id, qty, location, manufactured_on, tag_code').eq('tag_code', fresh).maybeSingle()
  if (reg) assetIds.push((reg as { id: string }).id)
  check('그 코드의 설비 1대(qty 1·고객·위치·제조연월)', !!reg && reg.customer_id === custA && reg.qty === 1 && reg.location === '2층 복도' && String(reg.manufactured_on).startsWith('2019-05'), JSON.stringify(reg))
  check('등록 뒤 카드로 바뀜', await page.getByTestId('tag-card-location').innerText().then(t => t.includes('2층 복도')))

  console.log('[7] [교체]')
  await page.goto(`${BASE}/t/${a1.code}`); await page.getByTestId('tag-card').waitFor()
  await page.getByTestId('tag-replace-open').click()
  await page.getByTestId('tag-replace-submit').click()
  await page.getByTestId('tag-card-status').filter({ hasText: '교체됨' }).waitFor()
  const { data: after } = await raw.from('equipment_assets').select('status').eq('id', a1.id).single()
  check('status replaced', (after as { status: string }).status === 'replaced')
  check('replace 이벤트', (await events(a1.id, 'replace')).length === 1)
  check('교체 뒤 버튼 사라짐', await page.getByTestId('tag-actions').count() === 0)
} finally {
  if (browser) await browser.close()
  if (assetIds.length) {
    await raw.from('equipment_asset_events').delete().in('asset_id', assetIds)
    await raw.from('equipment_assets').delete().in('id', assetIds)
  }
  if (inspId) { await raw.from('inspection_defects').delete().eq('inspection_id', inspId); await raw.from('inspection_steps').delete().eq('inspection_id', inspId); await raw.from('inspections').delete().eq('id', inspId) }
  if (custA) await cleanupCustomer(custA)
  if (custB) await cleanupCustomer(custB)
  if (userId) await delUser(userId)
}
summary()
