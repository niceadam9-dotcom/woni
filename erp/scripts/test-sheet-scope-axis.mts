// 점검표 시트 범위 판정 축 E2E — 일반관리 자체점검(inspection_type='일반관리' + plan_type='special_작동')에서
// 화면(v2025 STD)과 서버 액션([전체 양호 ○]·불량 검색)이 같은 버전을 쓰는지 검증한다.
// 회귀 이력: 액션들이 customers.inspection_type 축을 쓰던 시절 화면은 STD인데 저장은 EXT(v2022) 코드였다 (sheet-scope.ts).
// 실행: npx tsx scripts/test-sheet-scope-axis.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'sheet-axis-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '축E2E', employeeId: 'E2E-AX' })
  // 핵심 조건: 관리유형은 '일반관리'(자체점검 아님으로 오판되던 값) + 점검은 special_작동
  custId = await mkCustomer({ customer_name: '축E2E고객', created_by: userId, inspection_type: '일반관리' })
  const { data: bld, error: bErr } = await raw.from('buildings')
    .insert({ customer_id: custId, building_name: '축E2E동', is_active: true, created_by: userId }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  const { error: fErr } = await raw.from('fire_facilities').insert([
    { building_id: bld!.id, facility_code: '소화기구 및 자동소화장치', category: '소화설비', installed: true },
  ])
  if (fErr) throw new Error(`시설 생성 실패: ${fErr.message}`)
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', plan_type: 'special_작동', sequence_num: 1,
    inspection_start_date: '2026-08-10', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = insp!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('text=빠른 결과 입력')
  check('화면: 작동점검(소방시설등점검표 v2025) 렌더', await page.isVisible('text=작동점검 (○항목)'))

  // ① [설치 설비 전체 양호 ○] — 저장된 코드의 버전이 화면과 같은지
  await page.click('button:has-text("설치 설비 전체 양호 ○")')
  await page.waitForSelector('text=항목을 ○로 채웠습니다', { timeout: 20000 })
  const { data: all } = await raw.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', inspId)
  const codes = ((all ?? []) as Array<{ item_code: string }>).map(r => r.item_code)
  check('전체 양호가 항목을 저장함', codes.length > 0, `saved=${codes.length}`)
  // STD(v2025)는 숫자 시작('1-A-001'), EXT(v2022)는 'X1-01' — 축이 어긋나면 X 코드가 저장된다
  check('저장 코드 = STD(v2025) 축', codes.length > 0 && codes.every(c => /^\d/.test(c)),
    JSON.stringify(codes.slice(0, 5)))

  // ② 저장된 코드가 실제로 v2025 시트 소속인지 (코드 형식이 아니라 카탈로그로 확인)
  const { data: stdSheets } = await raw.from('inspection_sheets').select('id').eq('version', 'v2025')
  const stdIds = ((stdSheets ?? []) as Array<{ id: string }>).map(s => s.id)
  const { data: stdItems } = await raw.from('inspection_sheet_items')
    .select('item_code').in('sheet_id', stdIds).in('item_code', codes.slice(0, 200))
  const stdSet = new Set(((stdItems ?? []) as Array<{ item_code: string }>).map(i => i.item_code))
  check('저장 코드가 v2025 카탈로그에 존재', codes.slice(0, 200).every(c => stdSet.has(c)))

  // ③ 종합전용(●) 항목은 작동점검에서 제외 — 화면 필터와 액션 필터가 같은 축인지
  const { data: compItems } = await raw.from('inspection_sheet_items')
    .select('item_code').in('sheet_id', stdIds).eq('comprehensive_only', true)
  const compSet = new Set(((compItems ?? []) as Array<{ item_code: string }>).map(i => i.item_code))
  check('종합전용 항목 미저장(작동 범위)', !codes.some(c => compSet.has(c)),
    JSON.stringify(codes.filter(c => compSet.has(c)).slice(0, 5)))

  // ④ 불량 검색도 같은 축인지 — 제안 코드가 STD여야 한다
  await page.fill('input[placeholder*="불량 항목 검색"]', '소화기')
  await page.waitForSelector('div.divide-y > button', { timeout: 15000 })
  const suggested = ((await page.locator('div.divide-y > button').first().locator('span').first().textContent()) ?? '').trim()
  check('불량 검색 제안 = STD 축', /^\d/.test(suggested), suggested)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  }
  if (custId) {
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', custId)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', custId)
    await cleanupCustomer(custId)
  }
  if (userId) await delUser(userId)
}
summary()
