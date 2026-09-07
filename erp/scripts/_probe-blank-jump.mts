// 2026-09-07 — 미입력 행 강조·카운터 점프 프로브 (규현빌라 14/15 "어디가 비었는지 안 보인다" 재현)
//
// 시나리오: 소화기구 시트에서 **끝의 2개 항목만** 비운다(스크롤 아래라 화면 밖).
//  ① data-blank-item 마커 = 정확히 그 2개  ② 그 행에 amber 배경  ③ 좌 목록 n/N이 amber
//  ④ [미입력만] 필터가 부분 미입력 시트도 잡는다  ⑤ 헤더 [필수 미입력 N건] 클릭 → 첫 공란이 뷰포트로
//
// 실행: npx tsx scripts/_probe-blank-jump.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'blank-jump-probe@erp-test.com'
const FAC = '소화기구 및 자동소화장치'
let userId = ''
let customerId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '점프프로브', employeeId: 'E2E-BJP' })
  customerId = await mkCustomer({ customer_name: '점프프로브고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert([
    { building_id: bld!.id, category: '소화설비', facility_code: FAC, installed: true },
  ])
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id, sheet_code').eq('version', 'v2025').eq('sheet_name', FAC).single()
  const { data: items } = await raw.from('inspection_sheet_items')
    .select('item_code, order_num').eq('sheet_id', sheet!.id).order('order_num')
  const codes = [...new Set((items ?? []).map((i: { item_code: string }) => i.item_code))]
  check('시드 — 항목 4개 이상(끝 2개를 비울 여유)', codes.length >= 4, `${codes.length}개`)
  const blanks = codes.slice(-2)                      // 끝 2개만 공란 — 첫 화면 스크롤 밖
  const filled = codes.slice(0, -2)
  await raw.from('inspection_sheet_responses').insert(
    filled.map(c => ({ inspection_id: inspId, item_code: c, result: 'O' })))

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())

  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')

  // 시트 열기 → 항목 렌더 대기
  await page.click(`[data-testid="sheet-row-${sheet!.sheet_code}"]`)
  await page.waitForSelector('[data-outline-group]')
  await page.waitForFunction(() => document.querySelectorAll('[aria-label$=" O"]').length > 0)

  // ① 마커 = 비운 2개 정확히 (채운 행에 마커가 붙으면 count가 커진다 — 정체 판정)
  const markers = await page.locator('[data-blank-item]').count()
  check('① data-blank-item = 공란 2개 정확히', markers === 2, `count=${markers} 기대=2 (${blanks.join(',')})`)
  const markerCodes = await page.$$eval('[data-blank-item]', els => els.map(e => e.getAttribute('data-blank-item')))
  check('① 마커가 비운 항목코드와 일치', JSON.stringify(markerCodes) === JSON.stringify(blanks),
    `실측=${markerCodes.join(',')}`)

  // ② amber 배경
  const rowCls = (await page.locator('[data-blank-item]').first().getAttribute('class')) ?? ''
  check('② 공란 행 amber 배경', rowCls.includes('bg-amber-50'), rowCls)

  // ③ 좌 목록 n/N amber (부분 미입력인데 회색으로 묻히던 자리)
  const rowHtml = await page.locator(`[data-testid="sheet-row-${sheet!.sheet_code}"]`).innerHTML()
  check('③ 좌 목록 부분 미입력 카운트 amber', rowHtml.includes('text-amber-600'), rowHtml.slice(0, 200))

  // ④ [미입력만] — 부분 미입력 시트도 걸린다 (종전엔 응답 0만)
  await page.check('[data-testid="sheet-entry-blank-only"]')
  check('④ 미입력만 필터에 부분 미입력 시트 잔존',
    await page.locator(`[data-testid="sheet-row-${sheet!.sheet_code}"]`).isVisible())
  await page.uncheck('[data-testid="sheet-entry-blank-only"]')

  // ⑤ 헤더 카운터 = 버튼, 클릭 → 첫 공란이 뷰포트 안으로 (사전: 화면 밖임을 먼저 단언 — 항진명제 방지)
  const cnt = page.locator('[data-testid="sheet-entry-required-blank"]')
  check('⑤ 카운터 문구 유지(필수 미입력 2건)', ((await cnt.textContent()) ?? '').includes('필수 미입력 2건'),
    (await cnt.textContent()) ?? '')
  check('⑤ 카운터가 버튼이다', (await cnt.evaluate(e => e.tagName)) === 'BUTTON')
  const outBefore = await page.evaluate(() => {
    const el = document.querySelector('[data-blank-item]')!
    const r = el.getBoundingClientRect()
    return r.top >= innerHeight || r.bottom <= 0
  })
  check('⑤ 사전 — 공란이 처음엔 화면 밖(점프가 유의미)', outBefore)
  await cnt.click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-blank-item]')
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= innerHeight
  }, undefined, { timeout: 5000 })
  check('⑤ 클릭 → 첫 공란이 뷰포트 안', true)
} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  await browser?.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
  summary()
}
