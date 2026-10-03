/** 설비 대장 1단계 E2E (통합계획 C3, 2026-10-02)
 *  실행: npx tsx scripts/test-equipment-ledger.mts   (dev 서버 · 마이그 172 적용 DB)
 *
 *  고정하는 것:
 *   · [공통] 탭 1.4 아래 「설비 대장」 패널 — 행 추가(분말 2015-03 4대 → 내용연수 경과 4) · 3-1 수량과 대조 표시(덮어쓰지 않음)
 *   · 엑셀 가져오기 — 머리글로 열을 찾고, 틀린 줄은 건너뛰며 오류로 알린다 · 미리보기 뒤 [n줄 추가]
 *   · 묶음 쪼개기(4대 → 3+1) · 교체됨으로 닫기(행 보존 + replace 이벤트)
 *   · customer_facility_specs(3-1 수량)는 전후 동일
 *   · 점검표 1-A-008 행 아래 「설비 대장: 분말소화기 n대 · 내용연수 경과 m대」 띠 — 응답은 바뀌지 않는다
 */
import * as XLSX from 'xlsx'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'equipment-ledger-e2e@erp-test.com'
let userId = '', cust = '', bld = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  console.log('[셋업]')
  userId = await mkUser({ email: EMAIL, name: '대장E2E', employeeId: 'E2E-EQL', role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ설비대장고객', created_by: userId })
  {
    const { data, error } = await raw.from('buildings').insert({ customer_id: cust, building_name: '본관', is_active: true, created_by: userId, facilities_verified_at: new Date().toISOString() }).select('id').single()
    if (error) throw new Error(`건물: ${error.message}`); bld = data!.id
  }
  { const { error } = await raw.from('fire_facilities').insert({ building_id: bld, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true }); if (error) throw new Error(`시설: ${error.message}`) }
  { const { error } = await raw.from('customer_facility_specs').insert({ customer_id: cust, building_id: null, section_key: 's31_extinguisher', spec: { summary: { types: ['소화기(분말)'], dong_rows: [{ qty_ext_powder: 10 }] } } }); if (error) throw new Error(`3-1: ${error.message}`) }
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-09-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검: ${error.message}`); insp = data!.id
  }
  const specBefore = JSON.stringify((await raw.from('customer_facility_specs').select('spec').eq('customer_id', cust)).data)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  console.log('[1] 행 추가 · 3-1 대조')
  await page.goto(`${BASE}/customers/${cust}?tab=facilities&form=1.4`)
  await page.getByTestId('equipment-ledger').waitFor()
  await page.getByTestId('equipment-add-open').click()
  await page.getByTestId('equipment-add-location').fill('3층')
  await page.getByTestId('equipment-add-qty').fill('4')
  await page.getByTestId('equipment-add-ym').fill('2015-03')
  await page.getByTestId('equipment-add-submit').click()
  await page.getByTestId('equipment-table').waitFor()
  check('1-1 행 1개', await page.getByTestId('equipment-row').count() === 1)
  check('1-2 내용연수 초과 4', (await page.getByTestId('equipment-expired').textContent())?.includes('4') === true)
  const cmp = await page.getByTestId('equipment-s31-compare').textContent() ?? ''
  check('1-3 대장 4대 / 3-1 10대 (차이)', cmp.includes('대장 4대') && cmp.includes('3-1 수량 10대') && cmp.includes('차이'), cmp)

  console.log('[2] 엑셀 가져오기')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['명판 목록'], [],
    ['위치', '품목', '수량', '제조연월', '규격'],
    ['지하1층', '분말소화기', 2, '2014-11', 'ABC 3.3kg'],
    ['1층', 'ABC 분말', 6, '2022.5', ''],
    ['옥상', '물통', 1, '2020-01', ''],
  ]), '시트1')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  await page.getByTestId('equipment-import-file').setInputFiles({ name: 'ledger.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf })
  const prev = page.getByTestId('equipment-import-preview')
  await prev.waitFor()
  const pt = await prev.textContent() ?? ''
  check('2-1 미리보기: 2줄 · 오류 1줄(알 수 없는 품목)', pt.includes('2') && pt.includes('오류 1줄') && pt.includes('물통'), pt)
  await page.getByTestId('equipment-import-apply').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="equipment-row"]').length === 3)
  check('2-2 행 3개', true)
  const { data: rows } = await raw.from('equipment_assets').select('id, location, qty, manufactured_on, building_id, lifespan_rule, sub_type').eq('customer_id', cust).eq('status', 'in_use')
  const b1 = rows?.find(r => r.location === '지하1층')
  check('2-3 지하1층 2대 2014-11-01 · 단일 건물 자동 배정 · 법정 10년 · 규격', !!b1 && b1.qty === 2 && b1.manufactured_on === '2014-11-01' && b1.building_id === bld && b1.lifespan_rule === 'legal10' && b1.sub_type === 'ABC 3.3kg')
  check('2-4 「2022.5」도 2022-05-01로', rows?.some(r => r.location === '1층' && r.manufactured_on === '2022-05-01') === true)

  console.log('[3] 쪼개기 · 교체')
  const r3 = rows!.find(r => r.location === '3층')!
  page.once('dialog', d => d.accept('1'))
  await page.locator('[data-testid="equipment-row"]', { hasText: '3층' }).getByRole('button', { name: '쪼개기' }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="equipment-row"]').length === 4)
  const { data: after3 } = await raw.from('equipment_assets').select('qty').eq('customer_id', cust).eq('location', '3층').eq('status', 'in_use').order('qty')
  check('3-1 3층 4대 → 1+3', JSON.stringify(after3?.map(r => r.qty)) === '[1,3]')
  page.once('dialog', d => d.accept())
  await page.locator('[data-testid="equipment-row"]', { hasText: '지하1층' }).getByTestId('equipment-close').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="equipment-row"]').length === 3)
  const { data: closed } = await raw.from('equipment_assets').select('id, status').eq('customer_id', cust).eq('location', '지하1층').single()
  check('3-2 지하1층 행은 지우지 않고 replaced', closed?.status === 'replaced')
  const { count: ev } = await raw.from('equipment_asset_events').select('id', { count: 'exact', head: true }).eq('asset_id', closed!.id).eq('event_type', 'replace')
  check('3-3 replace 이벤트 1건', ev === 1)
  check('3-4 3-1 수량(customer_facility_specs) 전후 동일', JSON.stringify((await raw.from('customer_facility_specs').select('spec').eq('customer_id', cust)).data) === specBefore)
  void r3

  console.log('[4] 점검표 1-A-008 띠')
  const { data: item } = await raw.from('inspection_sheet_items').select('sheet_id').eq('item_code', '1-A-008').limit(1).maybeSingle()
  const { data: sheet } = item ? await raw.from('inspection_sheets').select('sheet_code').eq('id', item.sheet_id).maybeSingle() : { data: null }
  check('4-0 1-A-008 시트 코드 찾음', !!sheet?.sheet_code, JSON.stringify(item))
  await page.goto(`${BASE}/inspections/${insp}/sheet?sheet=${sheet!.sheet_code}`)
  const hint = page.locator('[data-ledger-hint="1-A-008"]')
  await hint.waitFor()
  const ht = await hint.textContent() ?? ''
  check('4-1 띠: 분말 10대 · 경과 4대(3층 1+3)', ht.includes('분말소화기 10대') && ht.includes('내용연수 경과 4대'), ht)
  const { count: resp } = await raw.from('inspection_sheet_responses').select('id', { count: 'exact', head: true }).eq('inspection_id', insp).eq('item_code', '1-A-008')
  check('4-2 응답은 자동으로 생기지 않는다', (resp ?? 0) === 0)
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await browser?.close() } catch { /* */ }
  try {
    if (cust) {
      await raw.from('equipment_assets').delete().eq('customer_id', cust)
      await raw.from('customer_facility_specs').delete().eq('customer_id', cust)
      await cleanupCustomer(cust)
    }
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
