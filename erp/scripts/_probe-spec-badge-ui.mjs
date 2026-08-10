// T-2a 배지 UI 렌더 프로브 — 설비 대장 섹션 헤더에 점검 결과 배지가 실제로 뜨는가 (소방계획서_14_점검업무)
// test-plan-tab은 다른 세션의 개정이력 UI 교체(마이그레이션 120)로 앞단에서 멈춰 1.4까지 도달하지 못한다.
// 실행: node scripts/_probe-spec-badge-ui.mjs   (로컬 dev 서버 + 스테이징 DB)
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'probe-specbadge@erp-test.com'
let userId = '', customerId = '', buildingId = '', inspId = ''
let browser = null
const wait = ms => new Promise(r => setTimeout(r, ms))

try {
  userId = await mkUser({ email: EMAIL, name: '배지프로브', employeeId: 'E2E-SPECBADGE' })
  customerId = await mkCustomer({ customer_name: '배지프로브고객', address: '경기 양평군 테스트로 21', created_by: userId })
  const { data: bld } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId,
  }).select('id').single()
  buildingId = bld.id
  // 소화기구 설치(√) — 3-1 섹션이 배지 대상이 된다
  await raw.from('fire_facilities').insert({
    building_id: buildingId, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: '2026-05-10', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins.id

  // 소화기구 시트 첫 항목에 불량(X) 1건 → 3-1 배지가 '× 불량 1건'이어야 한다
  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id, sheet_name').eq('version', 'v2025').ilike('sheet_name', '%소화기구%').limit(1).maybeSingle()
  check('시드 — v2025 소화기구 시트 존재', !!sheet, '스테이징 시트 카탈로그 확인 필요')
  const { data: item } = await raw.from('inspection_sheet_items')
    .select('item_code').eq('sheet_id', sheet.id).order('order_num').limit(1).maybeSingle()
  await raw.from('inspection_sheet_responses').insert({
    inspection_id: inspId, item_code: item.item_code, result: 'X', updated_by: userId,
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')

  // 설비 대장은 우측 슬라이드 패널 — 푸터 버튼으로 연 뒤 <details>를 펼쳐야 배지 조회(fetchInspected)가 돈다
  await page.click('button:has-text("설비 대장")')
  await page.waitForSelector('summary:has-text("설비 대장")')
  await page.locator('summary:has-text("설비 대장")').scrollIntoViewIfNeeded()
  await page.locator('summary:has-text("설비 대장")').click()
  await page.waitForSelector('[data-spec-section="s31_extinguisher"]')
  let badge = ''
  for (let i = 0; i < 20 && !badge; i++) {          // 응답 조회는 비동기
    badge = (await page.locator('[data-testid="spec-mark-s31_extinguisher"]').textContent().catch(() => '')) ?? ''
    if (!badge) await wait(400)
  }
  check('3-1 소화기구 — 불량 배지 렌더', badge.includes('×') && badge.includes('1건'), `실제: "${badge}"`)

  const title = await page.locator('[data-testid="spec-mark-s31_extinguisher"]').getAttribute('title') ?? ''
  check('배지 툴팁에 회차·설비 표기', title.includes('불량') && title.includes('소화기구'), title)

  // 미설치 설비 섹션은 ／ 해당없음 — 옥내소화전(3-3 계열)을 설치하지 않았다
  const others = await page.locator('[data-testid^="spec-mark-"]').allTextContents()
  check('다른 섹션에도 배지가 렌더된다(해당없음/미입력 포함)', others.length >= 2, JSON.stringify(others))
  check('미설치 섹션은 ／ 해당없음으로 표기', others.some(t => t.includes('해당없음')), JSON.stringify(others))

  // 공통사항(3-2 수계 공통)은 설비 연결이 없어 배지가 없어야 한다 — ○/×를 붙이면 거짓말
  check('공통사항 섹션(3-2)에는 배지 없음',
    (await page.locator('[data-testid="spec-mark-s32_water_common"]').count()) === 0)
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
  if (buildingId) await raw.from('fire_facilities').delete().eq('building_id', buildingId)
  if (customerId) {
    await raw.from('customer_facility_specs').delete().eq('customer_id', customerId)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
  summary()
}
