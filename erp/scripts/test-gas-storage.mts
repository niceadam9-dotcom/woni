/** 가스계 약제저장량 점검리스트 E2E (통합계획 C3 1단계, 2026-10-03)
 *  실행: npx tsx scripts/test-gas-storage.mts   (dev 서버 · 마이그 172 적용 DB)
 *
 *  고정하는 것:
 *   · 9-B-001(CO2)이 든 시트에서만 「약제저장량 점검리스트」 패널 — 묶음 행(qty 2)은 용기 No.1·2로 펼친다
 *   · 화면 판정: 손실 5% 이하 양호 / 초과 불량(빈 칸은 판정 없음)
 *   · 저장 = 회차 단위 measure 이벤트(빈 줄 저장 안 함) · 재저장은 덮어쓰기(누적 X)
 *   · 점검표 응답(9-B-001)은 바뀌지 않는다
 *   · 별지 4호에 「약제저장량 점검리스트」 쪽 — 측정값·손실량·판정·비고(sub_type)
 *   · 가스용기가 없는 시트(1-A-008)엔 패널 없음
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼 — 서버 액션 직접 호출(별지 4호는 UI 미리보기 진입점이 없다)
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = `gas-storage-${Date.now().toString(36)}@erp-test.com`
let userId = '', cust = '', bld = '', insp = '', asset = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
let pg: Awaited<ReturnType<typeof launch>>['page'] | null = null

const sheetOf = async (itemCode: string) => {
  const { data: item } = await raw.from('inspection_sheet_items').select('sheet_id').eq('item_code', itemCode).limit(1).maybeSingle()
  const { data: sheet } = item ? await raw.from('inspection_sheets').select('sheet_code').eq('id', item.sheet_id).maybeSingle() : { data: null }
  return (sheet?.sheet_code as string | undefined) ?? null
}
const measures = async () => {
  const { data } = await raw.from('equipment_asset_events').select('values, result').eq('inspection_id', insp).eq('event_type', 'measure')
  return ((data ?? []) as Array<{ values: Record<string, unknown>; result: string | null }>).sort((a, b) => Number(a.values.cyl_no) - Number(b.values.cyl_no))
}

try {
  console.log('[셋업]')
  userId = await mkUser({ email: EMAIL, name: '가스E2E', employeeId: 'E2E-GAS', role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ가스저장량고객', created_by: userId })
  {
    const { data, error } = await raw.from('buildings').insert({ customer_id: cust, building_name: '본관', is_active: true, created_by: userId, facilities_verified_at: new Date().toISOString() }).select('id').single()
    if (error) throw new Error(`건물: ${error.message}`); bld = data!.id
  }
  {
    const { error } = await raw.from('fire_facilities').insert([
      { building_id: bld, category: '소화설비', facility_code: '이산화탄소소화설비', installed: true },
      { building_id: bld, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true },
    ])
    if (error) throw new Error(`시설: ${error.message}`)
  }
  {
    const { data, error } = await raw.from('equipment_assets').insert({ customer_id: cust, building_id: bld, category: 'gas_cylinder', sub_type: 'CO2 45kg', location: '지하1층 저장실', qty: 2, created_by: userId }).select('id').single()
    if (error) throw new Error(`가스용기: ${error.message}`); asset = data!.id
  }
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
      inspection_start_date: '2026-09-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검: ${error.message}`); insp = data!.id
  }
  const gasSheet = await sheetOf('9-B-001')
  const powderSheet = await sheetOf('1-A-008')
  check('0-1 9-B-001·1-A-008 시트 코드 찾음', !!gasSheet && !!powderSheet, `${gasSheet} / ${powderSheet}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  pg = page
  page.setDefaultTimeout(60000)
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)

  console.log('[1] 패널 노출 · 용기 펼침')
  await page.goto(`${BASE}/inspections/${insp}/sheet?sheet=${gasSheet}`)
  const panel = page.getByTestId('gas-storage')
  await panel.waitFor()
  await page.getByTestId('gas-storage-table').waitFor()
  check('1-1 묶음 qty 2 → 용기 2줄', await page.getByTestId('gas-storage-row').count() === 2)

  console.log('[2] 화면 판정')
  const fill = async (f: string, no: number, v: string) => { await page.locator(`[data-gas="${f}-${no}"]`).fill(v) }
  await fill('tempC', 1, '20'); await fill('heightCm', 1, '110'); await fill('chargeKg', 1, '44'); await fill('nominalKg', 1, '45')   // 2.2% 양호
  await fill('tempC', 2, '20'); await fill('heightCm', 2, '95'); await fill('chargeKg', 2, '42'); await fill('nominalKg', 2, '45')    // 6.7% 불량
  check('2-1 No.1 양호', (await page.locator('[data-gas-result="1"]').textContent())?.trim() === '양호')
  check('2-2 No.2 불량', (await page.locator('[data-gas-result="2"]').textContent())?.trim() === '불량')
  check('2-3 불량 1병 경고', ((await page.getByTestId('gas-storage-defects').textContent()) ?? '').includes('불량 1병'))

  console.log('[3] 저장 · 덮어쓰기')
  await page.getByTestId('gas-storage-save').click()
  await page.getByTestId('gas-storage-msg').filter({ hasText: '2줄 저장' }).waitFor()
  let ms = await measures()
  check('3-1 measure 이벤트 2건', ms.length === 2, JSON.stringify(ms))
  check('3-2 No.2 손실 3kg · result=defect', ms[1]?.values.loss_kg === 3 && ms[1]?.result === 'defect', JSON.stringify(ms[1]))
  check('3-3 No.1 result=good', ms[0]?.result === 'good')
  // 재측정: No.2를 비우고 저장 → 빈 줄은 저장 안 함, 이전 값은 덮어써 사라진다
  for (const f of ['tempC', 'heightCm', 'chargeKg', 'nominalKg']) await fill(f, 2, '')
  await page.getByTestId('gas-storage-save').click()
  await page.getByTestId('gas-storage-msg').filter({ hasText: '1줄 저장' }).waitFor()
  ms = await measures()
  check('3-4 재저장 = 덮어쓰기(1건만 남음)', ms.length === 1 && Number(ms[0].values.cyl_no) === 1, JSON.stringify(ms))
  // 새로고침 뒤 값 복원
  await page.reload()
  await page.getByTestId('gas-storage-table').waitFor()
  check('3-5 새로고침 뒤 No.1 충전량 44 복원', await page.locator('[data-gas="chargeKg-1"]').inputValue() === '44')
  // 다시 불량 줄 넣어 두고 문서 확인
  await fill('tempC', 2, '21'); await fill('heightCm', 2, '95'); await fill('chargeKg', 2, '42'); await fill('nominalKg', 2, '45')
  await page.getByTestId('gas-storage-save').click()
  await page.getByTestId('gas-storage-msg').filter({ hasText: '2줄 저장' }).waitFor()
  const { count: resp } = await raw.from('inspection_sheet_responses').select('id', { count: 'exact', head: true }).eq('inspection_id', insp).eq('item_code', '9-B-001')
  check('3-6 점검표 응답은 자동으로 생기지 않는다', (resp ?? 0) === 0)

  console.log('[4] 별지 4호')
  // 액션 id는 그 액션을 싣는 번들에서만 찾힌다 — 점검 상세(작업대)로 간다(test-pump-test와 같은 진입점)
  await page.goto(`${BASE}/inspections/${insp}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  const html4 = await (async () => {
    const id = await findActionId(page, 'getAnnexPreviewHtmlAction', [...scriptUrls])
    if (!id) return null
    const res = await callAction(page, id, [insp, 'report4', { highlight: false }])
    return parseFlight(res.text) as { html?: string; error?: string } | null
  })()
  const h = html4?.html ?? ''
  check('4-0 별지 4호 렌더', !!h, html4?.error ?? 'no id / empty')
  const tbl = h.slice(h.indexOf('data-gas-storage'), h.indexOf('</table>', h.indexOf('data-gas-storage')))
  check('4-1 약제저장량 점검리스트 표', h.includes('약제저장량 점검리스트') && tbl.length > 0)
  const trs = tbl.split('<tr>').slice(2)  // 머리글 다음 행들
  check('4-2 행 2개(No.1·No.2 순)', trs.length === 2 && trs[0].includes('>1<') && trs[1].includes('>2<'), String(trs.length))
  check('4-3 No.2: 21℃·95cm·42kg·손실 3·불량·비고 CO2 45kg', ['21', '95', '42', '>3<', '불량', 'CO2 45kg', '지하1층 저장실'].every(s => trs[1]?.includes(s)), trs[1])
  check('4-4 No.1 양호', trs[0]?.includes('양호') === true)

  console.log('[5] 가스 없는 시트')
  await page.goto(`${BASE}/inspections/${insp}/sheet?sheet=${powderSheet}`)
  await page.locator('[data-ledger-hint], [data-item-code]').first().waitFor({ timeout: 60000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  check('5-1 1-A-008 시트엔 패널 없음', await page.getByTestId('gas-storage').count() === 0)
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
  if (process.env.SHOT) { try { await pg?.screenshot({ path: process.env.SHOT, fullPage: true }); console.log('screenshot', process.env.SHOT, pg?.url()) } catch { /* */ } }
} finally {
  console.log('[정리]')
  try { await browser?.close() } catch { /* */ }
  try {
    if (cust) {
      if (asset) await raw.from('equipment_asset_events').delete().eq('asset_id', asset)
      await raw.from('equipment_assets').delete().eq('customer_id', cust)
      await cleanupCustomer(cust)
    }
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
