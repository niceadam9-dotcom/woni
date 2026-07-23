// §9-4 A안 E2E — 빠른 결과 입력: 불량 검색 태깅(X+메모→자동 등록) + 설치 설비 전체 양호(기존 응답 보존)
// 실행: npx tsx scripts/test-quick-defect.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'quick-defect-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '빠른입력E2E', employeeId: 'E2E-QD' })
  custId = await mkCustomer({ customer_name: '빠른입력E2E고객', created_by: userId, inspection_type: '작동' })
  const { data: bld, error: bErr } = await raw.from('buildings')
    .insert({ customer_id: custId, building_name: '빠른입력동', is_active: true, created_by: userId }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  // 설치 시설 2종 — 시트 STD-01·STD-02와 이름 매칭 (전체 양호 대상 = 이 2개 시트만)
  const { error: fErr } = await raw.from('fire_facilities').insert([
    { building_id: bld!.id, facility_code: '소화기구 및 자동소화장치', category: '소화설비', installed: true },
    { building_id: bld!.id, facility_code: '옥내소화전설비', category: '소화설비', installed: true },
  ])
  if (fErr) throw new Error(`시설 생성 실패: ${fErr.message}`)
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: '2026-07-20', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
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
  check('빠른 결과 입력 블록 노출', true)

  // ① 불량 검색 태깅 — '소화기' 검색 → 첫 항목 X + 메모 → 자동 등록
  await page.fill('input[placeholder*="불량 항목 검색"]', '소화기')
  await page.waitForSelector('button:has-text("1-A-001"), button:has-text("1-")', { timeout: 15000 })
  const first = page.locator('div.divide-y > button').first()
  const pickedCode = ((await first.locator('span').first().textContent()) ?? '').trim()
  await first.click()
  await page.fill('input[placeholder*="불량 메모"]', '압력 미달 — 교체 필요')
  await page.click('button:has-text("불량 저장")')
  await page.waitForSelector('text=불량(✕) 저장')
  const { data: xResp } = await raw.from('inspection_sheet_responses')
    .select('result, memo').eq('inspection_id', inspId).eq('item_code', pickedCode).single()
  check('불량 응답 저장(X+메모)', xResp?.result === 'X' && xResp?.memo === '압력 미달 — 교체 필요', JSON.stringify(xResp))
  const { data: defects } = await raw.from('inspection_defects')
    .select('defect_code, defect_detail').eq('inspection_id', inspId)
  check('불량내역 자동 등록', (defects ?? []).some(d => d.defect_code === pickedCode && d.defect_detail === '압력 미달 — 교체 필요'), JSON.stringify(defects))

  // ② 설치 설비 전체 양호 — 미입력만 채움, 기존 X 보존
  await page.click('button:has-text("설치 설비 전체 양호 ○")')
  await page.waitForSelector('text=항목을 ○로 채웠습니다', { timeout: 20000 })
  check('전체 양호 완료 안내(시트 2개)', await page.isVisible('text=설비 시트 2개'))
  const { data: all } = await raw.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', inspId)
  const rows = (all ?? []) as Array<{ item_code: string; result: string }>
  // 기대 개수 = STD-01·STD-02 항목(작동 → 종합전용 제외) 전부
  const { data: sheetIds } = await raw.from('inspection_sheets').select('id').eq('version', 'v2025').in('sheet_code', ['STD-01', 'STD-02'])
  const { data: items } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').in('sheet_id', (sheetIds ?? []).map((s: { id: string }) => s.id))
  const expected = ((items ?? []) as Array<{ item_code: string; comprehensive_only: boolean }>).filter(i => !i.comprehensive_only)
  check('응답 수 = 두 시트 작동 항목 전부', rows.length === expected.length, `resp=${rows.length} expect=${expected.length}`)
  check('기존 불량(X) 보존', rows.find(r => r.item_code === pickedCode)?.result === 'X')
  check('나머지 전부 ○', rows.filter(r => r.item_code !== pickedCode).every(r => r.result === 'O'))
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
