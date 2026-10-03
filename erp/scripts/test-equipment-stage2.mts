/** 설비 대장 2단계 E2E (통합계획 C3, 2026-10-03)
 *  실행: npx tsx scripts/test-equipment-stage2.mts   (dev 서버 · 마이그 172 적용 DB)
 *
 *  고정하는 것:
 *   · 고객 목록 이름 옆 배지 「만료 n」(경과 대수) · 상세 머리 배지 「설비 만료 n」 — 같은 판정(lib/equipment-expiry)
 *   · 주간 브리핑 재료(findEquipmentExpiring) — 이 고객이 경과 4 · 90일 내 2로 잡힌다
 *   · ✕ → 불량 등록: 1-A-008은 defect_detail에 「내용연수 경과 분말소화기 4대: 3층 4대(…)」 + 개체가 하나면 asset_id
 *     9-B-001은 「약제량 손실 5% 초과 1병: …」 + asset_id · 대장 근거 없는 ✕(1-A-001)는 detail null·asset_id null(종전 그대로)
 *   · [기한]: 성능확인 합격 + 연장 만료일 → 경과 0(배지가 「만료 임박 2」로) + perf_check 이벤트 1 · 완강기 완공일 → 하자보수 +2년 표시
 *   · 점검표 응답·3-1 수량은 바뀌지 않는다
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼 — 서버 액션 직접 호출(불량 등록은 점검표 화면 번들에 실린 같은 액션)
import { findActionId, collectScripts, callAction } from './_judge19-action.mjs'
import { findEquipmentExpiring } from '../src/lib/equipment-expiry.ts'

const EMAIL = `equip-s2-${Date.now().toString(36)}@erp-test.com`
const NAME = `ZZ설비2단계${Date.now().toString(36)}`
let userId = '', cust = '', bld = '', insp = '', a3f = '', aGas = '', aDesc = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
// 90일 안에 만료되는 분말: 오늘 + 60일이 속한 달 − 10년(만료 = 제조연월 + 10년, 그 달 1일)
const soonYm = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 60); return `${d.getUTCFullYear() - 10}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01` })()
const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`

try {
  console.log('[셋업]')
  userId = await mkUser({ email: EMAIL, name: '대장2E2E', employeeId: 'E2E-EQ2', role: 'admin' })
  cust = await mkCustomer({ customer_name: NAME, created_by: userId })
  {
    const { data, error } = await raw.from('buildings').insert({ customer_id: cust, building_name: '본관', is_active: true, created_by: userId, facilities_verified_at: new Date().toISOString() }).select('id').single()
    if (error) throw new Error(`건물: ${error.message}`); bld = data!.id
  }
  {
    const { error } = await raw.from('fire_facilities').insert([
      { building_id: bld, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true },
      { building_id: bld, category: '소화설비', facility_code: '이산화탄소소화설비', installed: true },
    ])
    if (error) throw new Error(`시설: ${error.message}`)
  }
  { const { error } = await raw.from('customer_facility_specs').insert({ customer_id: cust, building_id: null, section_key: 's31_extinguisher', spec: { summary: { types: ['소화기(분말)'], dong_rows: [{ qty_ext_powder: 6 }] } } }); if (error) throw new Error(`3-1: ${error.message}`) }
  const ins = async (r: Record<string, unknown>) => {
    const { data, error } = await raw.from('equipment_assets').insert({ customer_id: cust, building_id: bld, created_by: userId, ...r }).select('id').single()
    if (error) throw new Error(`대장: ${error.message}`); return data!.id as string
  }
  a3f = await ins({ category: 'powder', location: '3층', qty: 4, manufactured_on: '2015-03-01', lifespan_rule: 'legal10' })
  await ins({ category: 'powder', location: '1층', qty: 2, manufactured_on: soonYm, lifespan_rule: 'legal10' })
  aGas = await ins({ category: 'gas_cylinder', location: '저장실', qty: 2, sub_type: 'CO2 45kg', lifespan_rule: 'none' })
  aDesc = await ins({ category: 'descender', location: '5층', qty: 1, manufactured_on: '2024-01-01', lifespan_rule: 'rec10' })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
      inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검: ${error.message}`); insp = data!.id
  }
  // 이 회차 가스 측정: No.1 양호(44/45) · No.2 불량(42/45) — 저장 경로는 test-gas-storage가 고정한다
  {
    const ev = (no: number, charge: number) => ({ asset_id: aGas, inspection_id: insp, event_type: 'measure', event_date: today, actor_id: userId,
      result: (45 - charge) / 45 > 0.05 ? 'defect' : 'good', values: { cyl_no: no, location: '저장실', charge_kg: charge, nominal_kg: 45, loss_kg: 45 - charge, loss_rate: (45 - charge) / 45 } })
    const { error } = await raw.from('equipment_asset_events').insert([ev(1, 44), ev(2, 42)])
    if (error) throw new Error(`측정: ${error.message}`)
  }
  // ✕ 응답 셋(사람이 누른 것으로 친다): 대장 근거 2 + 근거 없는 1
  {
    const { error } = await raw.from('inspection_sheet_responses').insert(['1-A-008', '9-B-001', '1-A-001'].map(c => ({ inspection_id: insp, item_code: c, result: 'X' })))
    if (error) throw new Error(`응답: ${error.message}`)
  }
  const respBefore = JSON.stringify((await raw.from('inspection_sheet_responses').select('item_code, result').eq('inspection_id', insp).order('item_code')).data)
  const specBefore = JSON.stringify((await raw.from('customer_facility_specs').select('spec').eq('customer_id', cust)).data)

  console.log('[1] 주간 브리핑 재료')
  {
    const eq = await findEquipmentExpiring(raw, today)
    const me = eq.customers.find(c => c.customer_name === NAME)
    check('1-1 이 고객: 경과 4 · 90일 내 2(완강기·가스는 대상 아님)', me?.expired === 4 && me?.soon === 2, JSON.stringify(me))
    check('1-2 합계는 이 고객 몫 이상', eq.expiredQty >= 4 && eq.soonQty >= 2 && !eq.error, JSON.stringify({ e: eq.expiredQty, s: eq.soonQty, err: eq.error }))
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)

  console.log('[2] 목록·상세 배지')
  await page.goto(`${BASE}/customers?q=${encodeURIComponent(NAME)}`)
  const rowBadge = page.getByTestId('customer-row-equip-expiry').first()
  await rowBadge.waitFor()
  check('2-1 목록 배지 「만료 4」', (await rowBadge.textContent())?.trim() === '만료 4', await rowBadge.textContent() ?? '')
  await page.goto(`${BASE}/customers/${cust}?tab=facilities&form=1.4`)
  const head = page.getByTestId('customer-equip-expiry')
  await head.waitFor()
  check('2-2 상세 머리 배지 「설비 만료 4」', (await head.textContent())?.trim() === '설비 만료 4', await head.textContent() ?? '')

  console.log('[3] ✕ → 불량 자동 문장')
  const { data: item } = await raw.from('inspection_sheet_items').select('sheet_id').eq('item_code', '1-A-008').limit(1).maybeSingle()
  const { data: sheet } = await raw.from('inspection_sheets').select('sheet_code').eq('id', item!.sheet_id).maybeSingle()
  await page.goto(`${BASE}/inspections/${insp}/sheet?sheet=${sheet!.sheet_code}`)
  await page.locator('[data-ledger-hint="1-A-008"]').waitFor()
  const id = await findActionId(page, 'createDefectsFromXAction', [...scriptUrls])
  check('3-0 액션 id', !!id)
  const res = await callAction(page, id, [insp])
  // 응답 본문은 재검증된 화면까지 실려 와 파서(별지 미리보기용)로 반환값을 못 꺼낸다 — 결과는 DB로 판정한다
  const { data: defs } = await raw.from('inspection_defects').select('defect_code, defect_name, defect_detail, asset_id').eq('inspection_id', insp)
  const d = (c: string) => (defs ?? []).find(x => x.defect_code === c)
  check('3-1 불량 3건 등록', res.status === 200 && (defs ?? []).length === 3, `${res.status} ${(defs ?? []).length}`)
  check('3-2 1-A-008 detail = 「내용연수 경과 분말소화기 4대: 3층 4대(2015-03)」', d('1-A-008')?.defect_detail === '내용연수 경과 분말소화기 4대: 3층 4대(2015-03)', d('1-A-008')?.defect_detail ?? 'null')
  check('3-3 1-A-008 asset_id = 3층 행(경과 개체 하나)', d('1-A-008')?.asset_id === a3f)
  check('3-4 9-B-001 detail = 「약제량 손실 5% 초과 1병: 저장실 No.2(손실 6.7%)」', d('9-B-001')?.defect_detail === '약제량 손실 5% 초과 1병: 저장실 No.2(손실 6.7%)', d('9-B-001')?.defect_detail ?? 'null')
  check('3-5 9-B-001 asset_id = 가스 행', d('9-B-001')?.asset_id === aGas)
  check('3-6 근거 없는 1-A-001 — detail·asset_id null(종전 그대로)', d('1-A-001') != null && d('1-A-001')!.defect_detail === null && d('1-A-001')!.asset_id === null, JSON.stringify(d('1-A-001')))
  check('3-7 불량 이름은 종전 사슬(문장이 이름을 차지하지 않음)', !String(d('1-A-008')?.defect_name).includes('내용연수 경과 분말소화기 4대'))
  check('3-8 점검표 응답 불변', JSON.stringify((await raw.from('inspection_sheet_responses').select('item_code, result').eq('inspection_id', insp).order('item_code')).data) === respBefore)

  console.log('[4] 기한 — 성능확인 연장 · 하자보수')
  await page.goto(`${BASE}/customers/${cust}?tab=facilities&form=1.4`)
  await page.getByTestId('equipment-table').waitFor()
  const row3 = page.locator('[data-testid="equipment-row"]', { hasText: '3층' })
  await row3.getByTestId('equipment-terms-open').click()
  await page.getByTestId('equipment-terms-perf').fill(today)
  await page.getByTestId('equipment-terms-ext').fill(nextYear)
  await page.getByTestId('equipment-terms-submit').click()
  // 저장 뒤 목록을 다시 읽어 그린다 — 안내 문구가 먼저 뜨므로 집계가 바뀔 때까지 기다린다
  await page.waitForFunction(() => /초과\s*0/.test(document.querySelector('[data-testid="equipment-expired"]')?.textContent ?? ''))
  const { data: a3 } = await raw.from('equipment_assets').select('extension_until').eq('id', a3f).single()
  check('4-1 3층 extension_until 저장', a3?.extension_until === nextYear, JSON.stringify(a3))
  const { count: pc } = await raw.from('equipment_asset_events').select('id', { count: 'exact', head: true }).eq('asset_id', a3f).eq('event_type', 'perf_check')
  check('4-2 perf_check 이벤트 1건', pc === 1)
  check('4-3 머리 집계 경과 0', ((await page.getByTestId('equipment-expired').textContent()) ?? '').includes('0'))

  const rowD = page.locator('[data-testid="equipment-row"]', { hasText: '5층' })
  await rowD.getByTestId('equipment-terms-open').click()
  await page.getByTestId('equipment-terms-done').fill('2025-05-01')
  check('4-4 완강기 하자보수 칸 = 완공 + 2년 계산 표시', await page.getByTestId('equipment-terms-warranty').inputValue() === '2027-05-01')
  await page.getByTestId('equipment-terms-submit').click()
  // 앞 저장의 안내 문구가 남아 있다 — 행에 하자보수 줄이 그려질 때까지 기다린다
  await page.locator('[data-testid="equipment-row"]', { hasText: '5층' }).getByTestId('equipment-warranty').waitFor()
  const { data: ad } = await raw.from('equipment_assets').select('installed_on, warranty_until').eq('id', aDesc).single()
  check('4-5 완공일 installed_on · warranty_until 2027-05-01', ad?.installed_on === '2025-05-01' && ad?.warranty_until === '2027-05-01', JSON.stringify(ad))
  check('4-6 행에 「하자보수 ~2027-05-01」', ((await page.locator('[data-testid="equipment-row"]', { hasText: '5층' }).getByTestId('equipment-warranty').textContent()) ?? '').includes('2027-05-01'))

  console.log('[5] 배지 갱신')
  await page.reload()
  await head.waitFor()
  check('5-1 상세 배지 「설비 만료 임박 2」(경과 0 · 임박 2)', (await head.textContent())?.trim() === '설비 만료 임박 2', await head.textContent() ?? '')
  check('5-2 3-1 수량 불변', JSON.stringify((await raw.from('customer_facility_specs').select('spec').eq('customer_id', cust)).data) === specBefore)
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await browser?.close() } catch { /* */ }
  try {
    if (cust) {
      if (insp) await raw.from('inspection_defects').delete().eq('inspection_id', insp)
      const { data: as } = await raw.from('equipment_assets').select('id').eq('customer_id', cust)
      const ids = ((as ?? []) as Array<{ id: string }>).map(a => a.id)
      if (ids.length) await raw.from('equipment_asset_events').delete().in('asset_id', ids)
      await raw.from('equipment_assets').delete().eq('customer_id', cust)
      await raw.from('customer_facility_specs').delete().eq('customer_id', cust)
      await cleanupCustomer(cust)
    }
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
