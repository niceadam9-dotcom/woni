// 소방계획서_28 S1 — 점검표 입력 전용 페이지 E2E
//
// 이 페이지의 존재 이유는 **어느 설비가 비었는지 한 화면에서 보이는 것**이다.
// 2026-08-24 승리주유소 별지 4호에서 물분무소화설비 결과칸이 공란으로 인쇄됐는데(STD-06 응답 0건)
// 사용자가 채울 자리를 찾지 못했다. 그 시나리오를 3)에서 그대로 재현해 못 박는다.
//
// 실행: npx tsx scripts/test-sheet-entry-page.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'sheet-entry-e2e@erp-test.com'
const EMAIL2 = 'sheet-entry-other@erp-test.com'
let userId = ''
let otherId = ''
let customerId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** 설치할 설비 — 3종을 의도적으로 섞는다:
 *  ① 입력할 설비(소화기구)  ② 끝까지 비워 둘 설비(물분무 = 사고 재현)  ③ 덮는 시트가 없는 설비 */
const F_INPUT = '소화기구 및 자동소화장치'
const F_BLANK = '물분무소화설비'
const F_UNCOVERED = '고체에어로졸소화설비'   // F-1e — 고시에 점검표가 없다(시트를 만들 근거 없음)

try {
  userId = await mkUser({ email: EMAIL, name: '입력페이지E2E', employeeId: 'E2E-SEP' })
  otherId = await mkUser({ email: EMAIL2, name: '비담당SEP', employeeId: 'E2E-SEP2', role: 'employee' })
  customerId = await mkCustomer({ customer_name: '입력페이지E2E고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert([
    { building_id: bld!.id, category: '소화설비', facility_code: F_INPUT, installed: true },
    { building_id: bld!.id, category: '소화설비', facility_code: F_BLANK, installed: true },
    { building_id: bld!.id, category: '소화설비', facility_code: F_UNCOVERED, installed: true },
  ])

  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  // 기대값을 DB에서 독립 재계산 — 화면 숫자를 화면 코드로 검산하면 동어반복이 된다
  const { data: sheets } = await raw.from('inspection_sheets').select('id, sheet_code, sheet_name').eq('version', 'v2025')
  const shBlank = (sheets ?? []).find((s: { sheet_name: string }) => s.sheet_name === F_BLANK)
  const shInput = (sheets ?? []).find((s: { sheet_name: string }) => s.sheet_name === F_INPUT)
  check('시드 — 물분무·소화기구 시트 실재', !!shBlank && !!shInput, `${shBlank?.sheet_code} / ${shInput?.sheet_code}`)
  const { data: blankItems } = await raw.from('inspection_sheet_items').select('item_code').eq('sheet_id', shBlank!.id)
  const blankTotal = new Set((blankItems ?? []).map((i: { item_code: string }) => i.item_code)).size
  const { data: inputItems } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', shInput!.id).order('order_num')
  const inputCodes = [...new Set((inputItems ?? []).map((i: { item_code: string }) => i.item_code))]
  check('시드 — 입력 대상 항목 확보', inputCodes.length >= 2, `${inputCodes.length}개`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))

  const URL_ = `${BASE}/inspections/${inspId}/sheet`

  // ── 1) 권한 — 비로그인은 로그인 화면으로 ──
  await page.goto(URL_)
  await page.waitForLoadState('networkidle')
  check('비로그인 → /login', page.url().includes('/login'), page.url())

  await login(page, EMAIL)
  await page.goto(URL_)
  await page.waitForSelector('text=점검표 입력 —')

  // ── 2) 좌 목록 = 단일 원천 ──
  const blankRow = page.locator(`[data-testid="sheet-row-${shBlank!.sheet_code}"]`)
  check('설치 설비 행 노출(물분무)', await blankRow.isVisible())

  // ── 3) ★ 사고 재현 — 설치인데 응답 0건이면 화면이 그걸 말해야 한다 ──
  const blankTxt = (await blankRow.textContent()) ?? ''
  check('★ 미입력 설비가 0/N으로 보인다', blankTxt.includes(`0/${blankTotal}`), `"${blankTxt.trim()}" (기대 0/${blankTotal})`)
  check('★ 미입력 설비에 ⚠ 표기', blankTxt.includes('⚠'), blankTxt.trim())
  const headerTxt = (await page.locator('h1 ~ p, p:has-text("설치 설비 중 미입력")').first().textContent()) ?? ''
  check('★ 헤더가 미입력 개수를 합산 고지', /미입력\s*\d+개/.test(headerTxt), headerTxt.trim().slice(0, 80))

  // ── 4) 덮는 시트가 없는 설비 고지 ──
  check('덮는 점검표 없음 안내', await page.isVisible('text=덮는 점검표 없음'))
  check('그 설비명이 함께 표기', await page.isVisible(`text=${F_UNCOVERED}`))

  // ── 5) [미입력만 보기] — 정렬을 흔들지 않고 거른다 ──
  await page.check('[data-testid="sheet-entry-blank-only"]')
  await page.waitForTimeout(200)
  check('미입력만 보기 — 물분무 유지', await blankRow.isVisible())
  await page.uncheck('[data-testid="sheet-entry-blank-only"]')

  // ── 6) 딥링크 3종 ──
  for (const [label, qs, wantCode] of [
    ['?sheet=코드', `?sheet=${shBlank!.sheet_code}`, shBlank!.sheet_code],
    ['?facility=설비명', `?facility=${encodeURIComponent(F_BLANK)}`, shBlank!.sheet_code],
    ['?sheet=auto', '?sheet=auto', ''],
  ] as const) {
    await page.goto(URL_ + qs)
    await page.waitForSelector('text=점검표 입력 —')
    // 우 패널에 시트 제목이 뜨면 열린 것 — auto는 어느 시트든 하나가 열리면 통과
    const opened = await page.locator('h2').nth(0).textContent().catch(() => '')
    check(`딥링크 ${label} — 시트가 열린다`, !!(opened ?? '').trim(), `열린 시트: ${(opened ?? '').trim()}`)
    if (wantCode) check(`딥링크 ${label} — 지목한 설비가 열렸다`, (opened ?? '').includes(F_BLANK), opened ?? '')
  }

  // ── 7) 자동 저장 4단 (플레이크 방지: 렌더 커밋 → 칩 → DB 재확인) ──
  await page.goto(`${URL_}?facility=${encodeURIComponent(F_INPUT)}`)
  await page.waitForSelector('text=점검표 입력 —')
  // ⚠ `has-text`는 부분일치라 헤더의 [설치 설비 전체 양호 ○]까지 잡는다(실측: 87건 일괄 저장됨).
  //    항목 버튼은 라벨이 정확히 '○'뿐이므로 text-is로 못 박는다.
  await page.waitForSelector('button:text-is("○")', { timeout: 15000 })
  const firstO = page.locator('button:text-is("○")').first()
  await firstO.click()
  // ① 렌더 커밋 보장 — 이걸 빼면 디바운스 타이머가 안 걸린 상태로 ②에 간다
  await page.waitForFunction(() => !!document.querySelector('[data-testid="sheet-autosave"], .animate-spin'), { timeout: 10000 }).catch(() => {})
  // ② 자동저장 칩
  await page.waitForSelector('[data-testid="sheet-autosave"]', { timeout: 20000 })
  check('자동 저장 — ✓ 저장됨 칩', true)
  // ③ DB 값 검증 재입력 루프 — 칩만 믿지 않는다(revalidatePath는 stepsChanged일 때만 돈다)
  let saved = 0
  for (let i = 0; i < 10; i++) {
    const { count } = await raw.from('inspection_sheet_responses')
      .select('*', { count: 'exact', head: true }).eq('inspection_id', inspId).eq('result', 'O')
    saved = count ?? 0
    if (saved > 0) break
    await page.waitForTimeout(300)
  }
  check('자동 저장 — DB에 O 응답 기록', saved > 0, `${saved}건`)

  // ── 8) 좌 목록 즉시 갱신 (새로고침 없이) ──
  const inputRow = page.locator(`[data-testid="sheet-row-${shInput!.sheet_code}"]`)
  const afterTxt = (await inputRow.textContent()) ?? ''
  check('좌 목록이 새로고침 없이 갱신', !afterTxt.includes(`0/${inputCodes.length}`), afterTxt.trim())

  // ── 9) 해제 경로 — clearCodes로 DB 행이 실제로 사라지는가 ──
  await firstO.click()
  await page.waitForTimeout(1800)
  let cleared = -1
  for (let i = 0; i < 10; i++) {
    const { count } = await raw.from('inspection_sheet_responses')
      .select('*', { count: 'exact', head: true }).eq('inspection_id', inspId).eq('result', 'O')
    cleared = count ?? 0
    if (cleared < saved) break
    await page.waitForTimeout(300)
  }
  check('해제 — DB 행이 실제로 삭제(화면만 풀리는 것 아님)', cleared < saved, `${saved} → ${cleared}`)
  // 이 단언은 2026-08-25 기준 **34회 중 1회** `1 → 1`로 붉었고 원인을 찾지 못했다. 배제된 것:
  //   · 지연 — 실측 2.06~2.17초(편차 ±60ms)에 예산 4800ms. 정상 변동으로 넘길 수 없다
  //   · 토글 오해석 — 계측 9회 전부 클릭 전 활성 true → 클릭 후 false
  //   · 콜드 스타트 / HMR 재컴파일 직후 — 둘 다 평시와 같은 지연
  // 남은 유력 후보는 **일시적 저장 실패**(Supabase·네트워크)다. 그러면 훅이 status='error'로 가고
  // 화면은 [저장 실패 — 다시 시도] 칩을 띄우는데, 여기서 칩을 안 보면 흔적이 남지 않는다.
  // → 다음에 붉을 때 스스로 원인을 말하게 한다. 재현을 기다리는 대신 실패를 **이름 붙은 실패**로 만든다.
  if (!(cleared < saved)) {
    const chip = page.locator('[data-testid="sheet-entry-autosave"]')   // data-status = 훅 status의 직역
    const status = await chip.getAttribute('data-status').catch(() => null)
    const chipTxt = (await chip.textContent().catch(() => '')) ?? ''
    const { data: rows } = await raw.from('inspection_sheet_responses')
      .select('item_code, result').eq('inspection_id', inspId)
    console.log(`  [진단] 자동저장 status=${status} · 칩="${chipTxt.trim()}" · 남은 행=${JSON.stringify(rows)}`)
    console.log('  [진단] status가 error면 일시적 저장 실패(코드 결함 아님) · saved/idle이면 clearCodes가 안 나간 것 = 훅·delta 축을 봐야 한다')
  }

  // ── 10) 권한(점검 건 축) — 비담당 employee는 읽기 전용 ──
  const l2 = await launch()
  try {
    const p2 = l2.page
    await login(p2, EMAIL2)
    await p2.goto(URL_)
    await p2.waitForSelector('text=점검표 입력 —')
    check('비담당 — 목록은 보인다', await p2.locator(`[data-testid="sheet-row-${shBlank!.sheet_code}"]`).isVisible())
    check('비담당 — 보기 전용 표기', await p2.isVisible('text=보기 전용'))
    check('비담당 — 일괄 버튼 없음', (await p2.locator('button:has-text("전체 양호")').count()) === 0)
  } finally { await l2.browser.close() }

} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
  if (otherId) await delUser(otherId)
}
summary('점검표 입력 전용 페이지(소방계획서_28 S1)')
