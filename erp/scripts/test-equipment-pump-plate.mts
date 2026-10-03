/** 설비 대장 4단계 E2E — 펌프 명판 → 펌프성능시험 판정 ② 자동 (통합계획 C3, 2026-10-03)
 *  실행: npx tsx scripts/test-equipment-pump-plate.mts   (dev 서버 · 마이그 172·177 적용 DB)
 *
 *  고정하는 것:
 *   · 대장 펌프 행 [명판]: 설비·주/예비·정격 토출량·양정 저장(specs) · 행 아래 명판 줄 · 형식 틀리면 거절
 *   · 점검 작업대 펌프성능시험 패널: 명판이 있으면 ② 「자동 O」·안내에 명판 값 / 명판 미달이면 「자동 X」
 *   · 별지 4호(같은 판정 함수): ② 칸이 자동값으로 찍힌다 · 사람이 누른 값(judge2)이 여전히 이긴다
 *   · 같은 설비·구분 명판이 둘이면 판정하지 않는다(종전처럼 수동 안내)
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼 — 서버 액션 직접 호출(별지 4호는 UI 미리보기 진입점이 없다)
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = `pump-plate-${Date.now().toString(36)}@erp-test.com`
let userId = '', cust = '', insp = '', pumpId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const day = (n: number) => { const d = new Date(Date.now() + 9 * 3600_000); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const J2 = /정격운전 시 토출량과 토출압이 규정치 이상일 것 \( ([OX ]?) \)/

try {
  console.log('[셋업]')
  { const p = await raw.from('equipment_assets').select('specs').limit(1); if (p.error) throw new Error(`마이그 177 미적용: ${p.error.message}`) }
  userId = await mkUser({ email: EMAIL, name: '명판E2E', employeeId: `E2E-PLATE-${Date.now().toString(36)}`, role: 'admin' })
  cust = await mkCustomer({ customer_name: 'ZZ펌프명판고객', created_by: userId })
  {
    const { data, error } = await raw.from('equipment_assets').insert({ customer_id: cust, created_by: userId, category: 'pump', location: '지하 펌프실', qty: 1, lifespan_rule: 'none' }).select('id').single()
    if (error) throw new Error(`펌프 행: ${error.message}`); pumpId = data!.id
  }
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, inspection_start_date: day(-1), inspection_end_date: day(-1),
      status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검: ${error.message}`); insp = data!.id
  }
  // 정격운전 실측 1200ℓ/min · 0.80MPa (명판 1200ℓ·80m ≈ 0.7845MPa 이상 → O)
  { const { error } = await raw.from('inspection_pump_tests').insert({ inspection_id: insp, sheet_no: 2, pump_kind: '주', rated_flow: 1200, rated_press: 0.8, updated_by: userId }); if (error) throw new Error(`실측: ${error.message}`) }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)

  console.log('[1] 대장 [명판]')
  await page.goto(`${BASE}/customers/${cust}?tab=facilities&form=1.4`)
  await page.getByTestId('equipment-table').waitFor()
  check('1-0 명판 없으면 「판정 ②가 수동」 안내', ((await page.getByTestId('equipment-row').first().textContent()) ?? '').includes('명판 없음'))
  await page.getByTestId('equipment-plate-open').click()
  await page.getByTestId('equipment-plate-sheet').selectOption('2')
  await page.getByTestId('equipment-plate-kind').selectOption('주')
  await page.getByTestId('equipment-plate-flow').fill('0')
  await page.getByTestId('equipment-plate-head').fill('80')
  await page.getByTestId('equipment-plate-submit').click()
  await page.getByTestId('equipment-msg').filter({ hasText: '모두 바르게' }).waitFor()
  check('1-1 토출량 0은 거절', true)
  await page.getByTestId('equipment-plate-flow').fill('1200')
  await page.getByTestId('equipment-plate-submit').click()
  await page.getByTestId('equipment-pump-plate').waitFor()
  const { data: a } = await raw.from('equipment_assets').select('specs').eq('id', pumpId).single()
  const sp = (a?.specs ?? {}) as Record<string, unknown>
  check('1-2 specs 저장(2·주·1200·80)', sp.pump_sheet_no === 2 && sp.pump_kind === '주' && sp.rated_flow_lpm === 1200 && sp.rated_head_m === 80, JSON.stringify(sp))
  check('1-3 행 아래 명판 줄', ((await page.getByTestId('equipment-pump-plate').textContent()) ?? '').includes('옥내소화전설비 주펌프 · 1,200ℓ/min · 양정 80m'))

  console.log('[2] 작업대 펌프성능시험 패널')
  await page.goto(`${BASE}/inspections/${insp}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  const panel = page.locator('[data-testid="pump-test-panel"]')
  await panel.waitFor()
  const note = await panel.getByTestId('pump-plate-note').first().textContent() ?? ''
  check('2-1 안내에 명판 값(1,200ℓ/min · 양정 80m)', note.includes('1,200ℓ/min') && note.includes('양정 80m'), note)
  const j2row = panel.locator('div', { hasText: '2. 정격운전 시 토출량과 토출압이 규정치 이상일 것' }).last()
  check('2-2 ② 「자동 O」', ((await j2row.textContent()) ?? '').includes('자동 O'), await j2row.textContent() ?? '')

  console.log('[3] 별지 4호')
  const html4 = async () => {
    const id = await findActionId(page, 'getAnnexPreviewHtmlAction', [...scriptUrls])
    if (!id) return ''
    return ((parseFlight((await callAction(page, id, [insp, 'report4', { highlight: false }])).text) as { html?: string } | null)?.html) ?? ''
  }
  let h = await html4()
  check('3-1 ② 칸 = O(명판 자동)', J2.exec(h)?.[1] === 'O', J2.exec(h)?.[0] ?? (h ? 'no match' : 'empty'))
  // 명판을 1300ℓ로 — 실측 1200 < 1300 → X
  await raw.from('equipment_assets').update({ specs: { pump_sheet_no: 2, pump_kind: '주', rated_flow_lpm: 1300, rated_head_m: 80 } }).eq('id', pumpId)
  h = await html4()
  check('3-2 명판 미달 → ② X', J2.exec(h)?.[1] === 'X', J2.exec(h)?.[0] ?? '')
  // 사람이 누른 값이 이긴다
  await raw.from('inspection_pump_tests').update({ judge2: 'O' }).eq('inspection_id', insp).eq('sheet_no', 2).eq('pump_kind', '주')
  h = await html4()
  check('3-3 수동 O가 자동 X를 이긴다', J2.exec(h)?.[1] === 'O', J2.exec(h)?.[0] ?? '')
  await raw.from('inspection_pump_tests').update({ judge2: null }).eq('inspection_id', insp)
  // 같은 설비·구분 명판 둘 → 판정 안 함(빈 칸)
  await raw.from('equipment_assets').insert({ customer_id: cust, created_by: userId, category: 'pump', location: '옥상', qty: 1, lifespan_rule: 'none', specs: { pump_sheet_no: 2, pump_kind: '주', rated_flow_lpm: 900, rated_head_m: 60 } })
  h = await html4()
  const m4 = J2.exec(h)
  check('3-4 명판 둘 → ② 칸은 있고 비어 있음(사람 몫)', !!m4 && m4[1].trim() === '', m4?.[0] ?? (h ? 'no match' : 'empty'))
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  console.log('[정리]')
  try { await browser?.close() } catch { /* */ }
  try {
    if (insp) await raw.from('inspection_pump_tests').delete().eq('inspection_id', insp)
    if (cust) { await raw.from('equipment_assets').delete().eq('customer_id', cust); await cleanupCustomer(cust) }
    if (userId) await delUser(userId)
  } catch (e) { console.log('정리 실패:', e instanceof Error ? e.message : String(e)) }
  summary()
}
