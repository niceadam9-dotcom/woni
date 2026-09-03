// 중분류 회색 축(2026-09-03, image-55 강순건물) — 점검표에서 **입력해야 할 것만 활성**.
//
// 유도등만 설치한 고객의 STD-21(유도등 및 유도표지)에서:
//  ① 좌 목록 분모가 21-A(유도등)만 — 미설치 형제(21-B 유도표지·21-C 피난유도선)는 안 센다
//  ② 형제 항목 행은 회색 + [／ 자동] (입력 버튼 없음) + 그룹 헤더 [대장 미체크] 칩
//  ③ [설치 설비 전체 양호 ○](서버 bulkAllGoodAction)가 회색 항목에 ○를 **저장하지 않는다**
//  ④ 1.4 대장에 유도표지를 체크하면 다음 로드부터 21-B가 열린다(복구 경로)
//
// 실행: npx tsx scripts/test-sheet-group-gray.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'sheet-gray-e2e@erp-test.com'
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
  userId = await mkUser({ email: EMAIL, name: '회색축E2E', employeeId: 'E2E-GRAY' })
  customerId = await mkCustomer({ customer_name: '회색축E2E고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert([
    { building_id: bld!.id, category: '피난구조설비', facility_code: '유도등', installed: true },
  ])
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  // 기대값은 DB에서 독립 재계산 — 화면 숫자를 화면 코드로 검산하면 동어반복이 된다
  const { data: s21 } = await raw.from('inspection_sheets')
    .select('id, sheet_code').eq('version', 'v2025').eq('sheet_code', 'STD-21').single()
  const { data: itemsRaw } = await raw.from('inspection_sheet_items')
    .select('item_code, group_code').eq('sheet_id', s21!.id)
  const rows = (itemsRaw ?? []) as Array<{ item_code: string; group_code: string | null }>
  const codeOf = (r: { item_code: string; group_code: string | null }) => r.group_code ?? r.item_code.replace(/-\d+$/, '')
  const uniq = (xs: string[]) => [...new Set(xs)]
  const aCodes = uniq(rows.filter(r => codeOf(r) === '21-A').map(r => r.item_code))
  const bCodes = uniq(rows.filter(r => codeOf(r) === '21-B').map(r => r.item_code))
  const cCodes = uniq(rows.filter(r => codeOf(r) === '21-C').map(r => r.item_code))
  check('시드 — 21-A/B/C 항목 실재', aCodes.length > 0 && bCodes.length > 0 && cCodes.length > 0,
    `A=${aCodes.length} B=${bCodes.length} C=${cCodes.length}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))

  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')

  // ── ① 분모 = 활성(21-A)만 ──
  const row = page.locator(`[data-testid="sheet-row-${s21!.sheet_code}"]`)
  const rowTxt = (await row.textContent()) ?? ''
  check('① 좌 목록 분모 = 21-A만', rowTxt.includes(`0/${aCodes.length}`),
    `"${rowTxt.trim()}" (기대 0/${aCodes.length}, 시트 전개면 0/${aCodes.length + bCodes.length + cCodes.length})`)
  const reqTxt = (await page.locator('[data-testid="sheet-entry-required-blank"]').textContent()) ?? ''
  check('① 필수 미입력 = 활성 항목 수', reqTxt.includes(`필수 미입력 ${aCodes.length}건`), reqTxt.trim())

  // ── ② 회색 행·칩 — 형제는 ／ 자동, 입력 버튼 없음 ──
  await row.click()
  await page.waitForSelector('[data-outline-group="21-A"]')
  check('② 회색(／ 자동) 행 수 = 미설치 형제 항목 수',
    await page.locator('[data-ni-mark]').count() === bCodes.length + cCodes.length,
    `ni=${await page.locator('[data-ni-mark]').count()} 기대=${bCodes.length + cCodes.length}`)
  check('② 21-B 그룹 헤더 [대장 미체크] 칩', await page.locator('[data-group-ni="21-B"]').isVisible())
  check('② 활성 21-A엔 일괄 버튼 있음', await page.locator('[data-bulk-o="21-A"]').isVisible())
  check('② 회색 21-B엔 일괄 버튼 없음', await page.locator('[data-bulk-o="21-B"]').count() === 0)
  check('② 회색 행엔 ○ 버튼 없음', await page.locator(`button[aria-label="${bCodes[0]} O"]`).count() === 0)

  // ── ③ 서버 일괄이 회색 항목을 저장하지 않는다 ──
  // 판정은 화면 문구가 아니라 **DB**다(문구는 스타일 리팩터로 흔들린다) — 행이 생길 때까지 폴링
  await page.click('text=설치 설비 전체 양호 ○')
  let responded = new Set<string>()
  for (let i = 0; i < 30 && responded.size === 0; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const { data: respRaw } = await raw.from('inspection_sheet_responses')
      .select('item_code').eq('inspection_id', inspId)
    responded = new Set(((respRaw ?? []) as Array<{ item_code: string }>).map(r => r.item_code))
  }
  if (responded.size === 0) {
    // 저장이 아예 안 됐다 — 화면의 오류·알림 문구를 증거로 남긴다
    const msgs = await page.locator('p.text-red-600, p.text-green-600').allTextContents()
    check('③ 셋업 — ○ 일괄이 저장을 만들었다', false, `30s 내 응답 0행, 화면: ${JSON.stringify(msgs)}`)
  }
  check('③ ○ 일괄 — 활성(21-A) 전건 저장', aCodes.every(c => responded.has(c)), `saved=${responded.size}`)
  check('③ ○ 일괄 — 회색(21-B/C)엔 한 건도 저장 안 됨',
    [...bCodes, ...cCodes].every(c => !responded.has(c)),
    JSON.stringify([...bCodes, ...cCodes].filter(c => responded.has(c))))

  // ── ④ 복구 경로 — 대장에 유도표지 체크 → 21-B 활성 ──
  await raw.from('fire_facilities').insert([
    { building_id: bld!.id, category: '피난구조설비', facility_code: '유도표지', installed: true },
  ])
  await page.goto(`${BASE}/inspections/${inspId}/sheet`)
  await page.waitForSelector('text=점검표 입력 —')
  const rowTxt2 = (await page.locator(`[data-testid="sheet-row-${s21!.sheet_code}"]`).textContent()) ?? ''
  check('④ 대장 체크 후 분모에 21-B 합류', rowTxt2.includes(`${aCodes.length}/${aCodes.length + bCodes.length}`),
    `"${rowTxt2.trim()}" (기대 ${aCodes.length}/${aCodes.length + bCodes.length})`)
  await page.locator(`[data-testid="sheet-row-${s21!.sheet_code}"]`).click()
  await page.waitForSelector('[data-outline-group="21-A"]')
  check('④ 회색 행 = 21-C만 남음', await page.locator('[data-ni-mark]').count() === cCodes.length,
    `ni=${await page.locator('[data-ni-mark]').count()} 기대=${cCodes.length}`)
  check('④ 21-B 입력 버튼 열림', await page.locator(`button[aria-label="${bCodes[0]} O"]`).count() === 1)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  }
  if (customerId) {
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', customerId)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
}
summary()
