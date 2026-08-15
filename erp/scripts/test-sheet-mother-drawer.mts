// 소방계획서_23 S8 — 머더 보드 + 시트 단위 드로어 E2E (22프로브, §8 표)
// 실행: npx tsx scripts/test-sheet-mother-drawer.mts   (로컬 dev :3000 + 스테이징 DB, 마이그레이션 134·135 적용 후)
//
// 프로브 번호는 소방계획서_23.md §8 표와 1:1. 필요한 실측 기대값(범위 필터 반영 항목 수)은
// DB에서 직접 계산한다 — 화면 숫자를 화면 숫자로 검증하는 동어반복을 피한다.
//
// ⚠ 프로브 10(dirty 이동 확인창): 드로어는 모달(백드롭)이라 열려 있는 동안 보드 카드를 누를 수 없다 —
//    다른 시트 직행 전환이 아니라 **닫기(ESC)·월 전환** 경로가 guard의 실사용 경로다. 여기서는 ESC 경로로
//    unsaved-nav 3버튼([저장하고 이동] 포함)을 검증한다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'mother-drawer-e2e@erp-test.com'
const EMAIL_VIEWER = 'mother-drawer-viewer@erp-test.com'
let userId = '', viewerId = '', custA = '', custB = '', bldB = ''
let inspA = '', inspB = '', inspC = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const drawer = '[data-testid="sheet-drawer"]'

try {
  // ── 준비 — 계정 2(관리·조회), 고객 2(설비 없음·설비 있음), 점검 3(자체·자체·외관) ──
  userId = await mkUser({ email: EMAIL, name: '드로어E2E', employeeId: 'E2E-MDR' })
  viewerId = await mkUser({ email: EMAIL_VIEWER, name: '드로어조회E2E', employeeId: 'E2E-MDV', role: 'employee' })
  custA = await mkCustomer({ customer_name: '드로어E2E고객A', created_by: userId })
  custB = await mkCustomer({ customer_name: '드로어E2E고객B', created_by: userId })
  {
    const { data: bld, error } = await raw.from('buildings').insert({
      customer_id: custB, building_name: '드로어E2E동', is_active: true, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`건물 생성 실패: ${error.message}`)
    bldB = bld!.id
    // 대장 하위(FIRE_SUB_ITEMS) 1종만 설치 — 1-B 소제목 4종의 대장 코드는 전부 미설치 → 힌트 4그룹(P22).
    // '소화기구 및 자동소화장치'는 시트 installed 매칭용(SHEET_FACILITY_MAP 어휘).
    const { error: fe } = await raw.from('fire_facilities').insert([
      { building_id: bldB, category: '소화설비', facility_code: '소화기(소화기·자동확산·간이)', installed: true },
      { building_id: bldB, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true },
    ])
    if (fe) throw new Error(`설비 생성 실패: ${fe.message}`)
  }
  const mkInsp = async (cust: string, planType: string | null) => {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: planType,
      inspection_start_date: '2026-07-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    return data!.id as string
  }
  inspA = await mkInsp(custA, null)        // 자체점검(작동) — STD v2025 + MU
  inspB = await mkInsp(custB, null)        // 자체점검 + 대장 하위 보유 (P22)
  inspC = await mkInsp(custA, 'monthly')   // 외관 — EXT v2022, 월 축 (P13)

  // ── 기대값 — DB에서 직접 계산 (작동 범위 = 종합전용 ● 제외) ──
  const { data: sheetRows } = await raw.from('inspection_sheets').select('id, sheet_code, sheet_name').eq('version', 'v2025')
  const sheetBy = new Map((sheetRows ?? []).map(s => [s.sheet_code, s]))
  const std02 = sheetBy.get('STD-02')!, std03 = sheetBy.get('STD-03')!
  const { data: it02 } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', std02.id)
  const grpNoncomp = (rows: Array<{ item_code: string; comprehensive_only: boolean }>, pfx: string) =>
    rows.filter(i => i.item_code.startsWith(pfx + '-') && !i.comprehensive_only).length
  const n2F = grpNoncomp(it02 ?? [], '2-F')
  const n2D = grpNoncomp(it02 ?? [], '2-D')
  const nStd02 = (it02 ?? []).filter(i => !i.comprehensive_only).length
  const comp02 = (it02 ?? []).filter(i => i.comprehensive_only).map(i => i.item_code)
  const { data: it03 } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', std03.id)
  const nStd03 = (it03 ?? []).filter(i => !i.comprehensive_only).length
  const comp03 = (it03 ?? []).filter(i => i.comprehensive_only).map(i => i.item_code)

  const l = await launch()
  browser = l.browser
  const page = l.page
  const dialogs: string[] = []
  page.on('dialog', d => { dialogs.push(d.message()); void d.accept() })

  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('[data-testid="sheet-group-board"]')

  // ── P5 사전 측정 — 드로어 열기 전 3칸 폭 ──
  const paneWidths = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="workbench-panes"] > *')].map(el => Math.round(el.getBoundingClientRect().width)))
  const widthsBefore = await paneWidths()

  // ── P1 — 진입 즉시 머더 카드 ≥2 · 아코디언 토글 0 (Q-2) ──
  const cardCount = await page.locator('[data-group-key]').count()
  check('P1 머더 카드 ≥ 2 상시 노출', cardCount >= 2, String(cardCount))
  check('P1 아코디언 토글 0개', await page.locator('[data-testid="sheet-group-board"] [aria-expanded]').count() === 0)

  // ── P2 — 1-A 카드에 중분류 이름 (P-1 회귀) ──
  const card1A = page.locator('[data-group-key$=":1-A"]')
  check('P2 [1-A] 카드에 "소화기구" 표시(코드만 아님)', ((await card1A.textContent()) ?? '').includes('소화기구'))

  // ── P3 — 카드 클릭 → 드로어 + 해당 머더 점프 + 페이지 스크롤 0 (Q-14) ──
  await page.click('[data-group-key$=":2-C"]')
  await page.waitForSelector(`${drawer} [data-outline-group="2-C"]`)
  // 점프는 pendingJump → useLayoutEffect 경로 — 항목 렌더 커밋에 실리므로 잠깐 기다려 시점/불능을 가른다
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="sheet-drawer"] [data-outline-group="2-C"]')
    const box = el?.closest('.overflow-y-auto')
    return !!box && (box as HTMLElement).scrollTop > 0
  }, undefined, { timeout: 4000 }).catch(() => {})
  const jump = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="sheet-drawer"] [data-outline-group="2-C"]')!
    const box = el.closest('.overflow-y-auto')!
    return {
      rel: Math.round(el.getBoundingClientRect().top - box.getBoundingClientRect().top),
      pageTop: document.scrollingElement?.scrollTop ?? 0,
      boxTop: box.scrollTop,
    }
  })
  check('P3 2-C가 스크롤 박스 상단(±40px)', jump.rel >= -5 && jump.rel <= 40, JSON.stringify(jump))
  check('P3 페이지 스크롤 0 유지', jump.pageTop === 0, JSON.stringify(jump))

  // ── P4 — 드로어 열려도 보드 카드 수 불변 (Q-2) ──
  check('P4 카드 수 불변', await page.locator('[data-group-key]').count() === cardCount)

  // ── P5 — 3칸 폭 ±1px 동일 (Q-15 오버레이 증명) ──
  const widthsAfter = await paneWidths()
  check('P5 workbench 3칸 폭 ±1px 동일', widthsBefore.length === widthsAfter.length
    && widthsBefore.every((w, i) => Math.abs(w - widthsAfter[i]) <= 1),
    `${widthsBefore} → ${widthsAfter}`)

  // ── P9 — 포커스 트랩 ──
  for (let i = 0; i < 20; i++) await page.keyboard.press('Tab')
  check('P9 Tab 20회 후에도 포커스가 드로어 안', await page.evaluate(() =>
    !!document.activeElement?.closest('[data-testid="sheet-drawer"]')))

  // ── P6 — 목차 이동 서버 액션 0회 (Q-5). next-action POST만 센다(원시 카운터는 RSC 오탐) ──
  let actionPosts = 0
  const countAction = (r: { method: () => string; headers: () => Record<string, string> }) => {
    if (r.method() === 'POST' && r.headers()['next-action']) actionPosts++
  }
  page.on('request', countAction)
  await page.click('[data-toc-group="2-F"]')
  await page.waitForSelector('[data-toc-group="2-F"][data-toc-active]')
  await page.waitForTimeout(700)
  page.off('request', countAction)
  check('P6 머더 이동 서버 액션 0회', actionPosts === 0, String(actionPosts))

  // ── P7 — [○ 모두 · 2-F]는 활성 머더만 (Q-17) ──
  await page.click('[data-bulk-o="2-F"]')
  const green = (g: string) => page.locator(`${drawer} [data-outline-group="${g}"] button.bg-green-500`).count()
  check(`P7 2-F 전 항목 ○ (${n2F}건)`, await green('2-F') === n2F, `${await green('2-F')}/${n2F}`)
  check('P7 다른 머더(2-A) 미입력 유지', await green('2-A') === 0)

  // ── P21 — 보드 즉시 갱신 (G-9 오버레이): 저장 전인데 카드 responded가 이미 반영 ──
  check('P21 보드 [2-F] 카드 즉시 갱신(저장 전)', await page.locator('[data-group-key$=":2-F"]').getAttribute('data-responded') === String(n2F))

  // ── P19 — 저장 후 드로어 유지 + ● 미저장 소멸 ──
  check('P19 dirty 배지 표시', await page.locator('[data-testid="drawer-dirty"]').isVisible())
  await page.click(`${drawer} button:has-text("저장")`)
  await page.waitForSelector(`${drawer} >> text=저장했습니다`)
  check('P19 저장 후 드로어 유지', await page.locator(drawer).isVisible())
  check('P19 ● 미저장 소멸', await page.locator('[data-testid="drawer-dirty"]').count() === 0)
  const saved2F = await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('item_code, result').eq('inspection_id', inspA).like('item_code', '2-F-%')
    return (data ?? []).length === n2F ? data : null
  }, 15000)
  check('P19 DB — 2-F 전건 O', !!saved2F && (saved2F as Array<{ result: string }>).every(r => r.result === 'O'))

  // ── P11 — ✕ 인라인 메모: ESC는 폼만 닫는다(드로어 유지) + [등록] → X·불량 1건 ──
  await page.click('[data-toc-group="2-A"]')
  await page.click(`${drawer} [aria-label="2-A-001 X"]`)
  const memoInput = page.locator(`${drawer} input[placeholder="불량 메모 (선택)"]`)
  await memoInput.waitFor()
  await memoInput.press('Escape')
  check('P11 인라인 폼 ESC → 폼만 닫힘', await memoInput.count() === 0)
  check('P11 드로어는 유지(ESC 우선순위)', await page.locator(drawer).isVisible())
  await page.click(`${drawer} [aria-label="2-A-001 X"]`)   // 재클릭 = X 해제(공란 복귀)
  await page.click(`${drawer} [aria-label="2-A-002 X"]`)
  await memoInput.fill('드로어 인라인 등록 검증')
  await page.click(`${drawer} button:has-text("등록")`)
  await page.waitForSelector(`${drawer} >> text=불량(✕) 저장`)
  const { data: xr } = await raw.from('inspection_sheet_responses')
    .select('result, memo').eq('inspection_id', inspA).eq('item_code', '2-A-002').single()
  check('P11 X·메모 저장', xr?.result === 'X' && xr?.memo === '드로어 인라인 등록 검증', JSON.stringify(xr))
  const { data: dfs } = await raw.from('inspection_defects')
    .select('id').eq('inspection_id', inspA).eq('defect_code', '2-A-002')
  check('P11 불량내역 자동 등록 1건', (dfs ?? []).length === 1)
  await page.click(`${drawer} button:has-text("저장")`)     // base 동기화(등록분 포함) → dirty 해소
  await page.waitForSelector('[data-testid="drawer-dirty"]', { state: 'detached' })

  // ── P12 — 작동 건: 종합전용(●)이 분모·행에서 빠짐 (S5·S6-3) ──
  const rows2D = await page.locator(`${drawer} [data-outline-group="2-D"] [aria-label$=" O"]`).count()
  check(`P12 2-D 표시 행 ${n2D}건(● 제외, 원본 ${(it02 ?? []).filter(i => i.item_code.startsWith('2-D-')).length}건)`,
    rows2D === n2D, `${rows2D}/${n2D}`)

  // ── P20 — [／ 전체 · 시트] 토글: 빈 칸만 N·○/✕ 보존, 확인창에 대상 수 (Q-20·Q-21) ──
  const filled = n2F + 1   // 2-F 전건 O + 2-A-002 X
  dialogs.length = 0
  await page.click('[data-testid="drawer-sheet-na"]')
  await page.waitForSelector(`${drawer} [data-na-mark]`)
  check('P20 확인창에 대상(미입력) 수', dialogs.length === 1 && dialogs[0].includes(`미입력 ${nStd02 - filled}개`), dialogs[0] ?? '(없음)')
  check('P20 빈 칸만 ／ 채움', await page.locator(`${drawer} [data-na-mark]`).count() === nStd02 - filled)
  check('P20 기존 ○ 보존', await green('2-F') === n2F)
  await page.click(`${drawer} button:has-text("저장")`)
  await page.waitForSelector('[data-testid="drawer-dirty"]', { state: 'detached' })
  const nRows = await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('item_code').eq('inspection_id', inspA).eq('result', 'N').like('item_code', '2-%')
    return (data ?? []).length === nStd02 - filled ? data : null
  }, 15000)
  check('P20 DB — N ' + (nStd02 - filled) + '건', !!nRows)
  const { data: compResp } = await raw.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', inspA).in('item_code', comp02.length ? comp02 : ['-'])
  check('P20 ● 항목에 N 미생성(범위 필터)', (compResp ?? []).length === 0, JSON.stringify(compResp))
  // 토글 해제 — 그 시트의 N만 제거, O/X 보존
  dialogs.length = 0
  await page.click('[data-testid="drawer-sheet-na"]')
  await page.waitForSelector(`${drawer} [data-na-mark]`, { state: 'detached' })
  check('P20 해제 확인창', dialogs.length === 1 && dialogs[0].includes('해제'), dialogs[0] ?? '(없음)')
  check('P20 해제 후에도 ○ 보존', await green('2-F') === n2F)
  await page.click(`${drawer} button:has-text("저장")`)
  await page.waitForSelector('[data-testid="drawer-dirty"]', { state: 'detached' })
  await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('item_code').eq('inspection_id', inspA).eq('result', 'N').like('item_code', '2-%')
    return (data ?? []).length === 0 ? true : null
  }, 15000)
  const { data: afterRel } = await raw.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', inspA).eq('result', 'N').like('item_code', '2-%')
  check('P20 DB — 해제 후 N 0건', (afterRel ?? []).length === 0, String((afterRel ?? []).length))

  // ── P14 — dirty 중 원격 저장 → 드로어 안 stale 배너, 자동 덮어쓰기 없음 (S5-5·R-7) ──
  // ⚠ 코드를 하드코딩하면 작동 범위(● 제외) 밖 항목을 집을 수 있다(1차 실행에서 2-B-001이 그랬다) —
  //    미사용 non-● 코드 2개를 DB에서 고른다
  const used = new Set(['2-A-001', '2-A-002', '2-C-002'])
  const spare = (it02 ?? []).filter(i => !i.comprehensive_only && !i.item_code.startsWith('2-F-') && !used.has(i.item_code))
    .map(i => i.item_code)
  const dirtyCode = spare[0], remoteCode = spare[1]
  await page.click(`${drawer} [aria-label="${dirtyCode} O"]`)   // dirty
  await raw.from('inspection_sheet_responses').insert({
    inspection_id: inspA, item_code: remoteCode, result: 'O', month: 0,
  })
  const staleSeen = await page.waitForSelector(`${drawer} >> text=다른 곳에서 이 점검표가 저장되었습니다`, { timeout: 12000 })
    .then(() => true).catch(() => false)
  check('P14 stale 배너(드로어 안)', staleSeen, 'Realtime(122) 미적용이면 실패')
  check(`P14 자동 덮어쓰기 없음(${remoteCode} 미반영)`, await page.locator(`${drawer} [aria-label="${remoteCode} O"].bg-green-500`).count() === 0)
  if (staleSeen) {
    await page.click(`${drawer} button:has-text("최신 불러오기")`)
    await page.waitForSelector(`${drawer} [aria-label="${remoteCode} O"].bg-green-500`)
    check('P14 [최신 불러오기] → 원격 값 반영', true)
  }
  // P14가 어떻게 끝났든 dirty를 정리하고 다음 프로브로 — 실패 캐스케이드 방지(1차 실행에서 P8이 연쇄 실패했다)
  if (await page.locator('[data-testid="drawer-dirty"]').count() > 0) {
    await page.click(`${drawer} [aria-label="${dirtyCode} O"]`)   // 재클릭 = 해제 → dirty 해소
    await page.waitForSelector('[data-testid="drawer-dirty"]', { state: 'detached' })
  }

  // ── P8 — 닫힘 3경로(ESC·백드롭·✕) + dirty면 백드롭 무시 ──
  await page.keyboard.press('Escape')
  await page.waitForSelector(drawer, { state: 'detached' })
  check('P8 ESC 닫힘(dirty 아님)', true)
  await page.click('[data-group-key$=":2-C"]')
  await page.waitForSelector(drawer)
  await page.mouse.click(120, 500)   // 백드롭(보드 위 오버레이 영역)
  await page.waitForSelector(drawer, { state: 'detached' })
  check('P8 백드롭 닫힘(dirty 아님)', true)
  await page.click('[data-group-key$=":2-C"]')
  await page.waitForSelector(drawer)
  await page.click('[data-testid="sheet-drawer-close"]')
  await page.waitForSelector(drawer, { state: 'detached' })
  check('P8 ✕ 닫힘', true)
  await page.click('[data-group-key$=":2-C"]')
  await page.waitForSelector(`${drawer} [data-outline-group="2-C"]`)
  await page.click(`${drawer} [aria-label="2-C-002 O"]`)   // dirty — 2-C-001은 ●(종합전용)라 작동 건 드로어에 행이 없다
  await page.mouse.click(120, 500)
  await page.waitForTimeout(400)
  check('P8 dirty면 백드롭으로 안 닫힘', await page.locator(drawer).isVisible())

  // ── P10 — dirty 닫기 → unsaved-nav 3버튼, [저장하고 이동] (Q-18. ⚠ 카드 직행은 모달이라 없음 — 파일 머리 주석) ──
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="unsaved-nav-save"]')
  check('P10 unsaved-nav 3버튼 확인창', await page.locator('[data-testid="unsaved-nav-discard"]').count() === 1
    && await page.locator('[data-testid="unsaved-nav-cancel"]').count() === 1)
  await page.click('[data-testid="unsaved-nav-save"]')
  await page.waitForSelector(drawer, { state: 'detached' })
  const savedOn = await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('result').eq('inspection_id', inspA).eq('item_code', '2-C-002')
    return data?.[0]?.result === 'O' ? true : null
  }, 15000)
  check('P10 [저장하고 이동] — 저장 후 닫힘', !!savedOn)

  // ── P20(보드 경로) — 닫힌 시트(STD-03)에 [／ 전체] 1왕복 (S6-6) ──
  dialogs.length = 0
  await page.click(`[data-sheet-na="${std03.id}"]`)
  await page.waitForSelector('text=／로 기록했습니다')
  check('P20 보드 경로 확인창(대상 수)', dialogs.length === 1 && dialogs[0].includes(`미입력 ${nStd03}개`), dialogs[0] ?? '(없음)')
  const na03 = await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('item_code').eq('inspection_id', inspA).eq('result', 'N').like('item_code', '3-%')
    return (data ?? []).length === nStd03 ? data : null
  }, 15000)
  check(`P20 보드 경로 DB — N ${nStd03}건`, !!na03)
  const { data: comp03Resp } = await raw.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', inspA).in('item_code', comp03.length ? comp03 : ['-'])
  check('P20 보드 경로 — ● 항목 N 미생성', (comp03Resp ?? []).length === 0)
  dialogs.length = 0
  await page.click(`[data-sheet-na="${std03.id}"]`)
  await page.waitForSelector('text=해제했습니다')
  await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('item_code').eq('inspection_id', inspA).eq('result', 'N').like('item_code', '3-%')
    return (data ?? []).length === 0 ? true : null
  }, 15000)
  const { data: rel03 } = await raw.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', inspA).eq('result', 'N').like('item_code', '3-%')
  check('P20 보드 경로 해제 — N 0건', (rel03 ?? []).length === 0)

  // ── P15·P16 — MU 시트: 구분 5헤더 + 피난안내도·창문은 '기타' (P-4·P-5, 135) ──
  await page.click('button:has-text("안전시설등(다중이용업소)")')
  await page.waitForSelector(`${drawer} [data-outline-group]`)
  const muGroups = await page.locator(`${drawer} [data-outline-group]`).evaluateAll(els =>
    els.map(el => (el as HTMLElement).dataset.outlineGroup))
  check('P15 MU 구분 5헤더 전부', JSON.stringify(muGroups) === JSON.stringify(['소화설비', '경보설비', '피난구조설비', '비상구', '기타']), JSON.stringify(muGroups))
  const etcText = (await page.locator(`${drawer} [data-outline-group="기타"]`).textContent()) ?? ''
  const evacText = (await page.locator(`${drawer} [data-outline-group="피난구조설비"]`).textContent()) ?? ''
  check('P16 기타에 피난안내도·창 문', etcText.includes('피난안내도ㆍ피난안내영상물') && etcText.includes('창 문'))
  check('P16 피난구조설비에는 없음', !evacText.includes('피난안내도') && !evacText.includes('창 문'))
  await page.keyboard.press('Escape')
  await page.waitForSelector(drawer, { state: 'detached' })

  // ── P18 — 소제목(3층) 렌더: 1-B 소제목 + 9-A 혼재(선행 null run) (Q-13·G-2, 134) ──
  await page.click('[data-group-key$=":1-B"]')
  await page.waitForSelector(`${drawer} [data-subgroup="주거용 주방 자동소화장치"]`)
  check('P18 1-B에 [주거용 주방 자동소화장치] 소제목', true)
  check('P18(P-15) 대장 하위 0건 고객 — 힌트 배너 침묵', await page.locator('[data-testid="ledger-hint-banner"]').count() === 0)
  await page.keyboard.press('Escape')
  await page.waitForSelector(drawer, { state: 'detached' })
  const std09 = sheetBy.get('STD-09')!
  await page.click(`[data-board-sheet="${std09.id}"]`)
  await page.waitForSelector(`${drawer} [data-outline-group="9-A"]`)
  const mixed = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="sheet-drawer"] [data-outline-group="9-A"]')!
    const firstSub = g.querySelector('[data-subgroup]')
    const firstRow = g.querySelector('.border-b')
    if (!firstSub || !firstRow) return { ok: false, why: 'sub/row 없음' }
    return { ok: firstRow.getBoundingClientRect().top < firstSub.getBoundingClientRect().top, why: '' }
  })
  check('P18 9-A 혼재 — 소제목 없는 앞부분이 먼저', mixed.ok, mixed.why)
  await page.keyboard.press('Escape')
  await page.waitForSelector(drawer, { state: 'detached' })

  // ── P13 — 외관(EX-4): 월 3 저장 → 월 7 전환 시 값이 갈림 ──
  await page.goto(`${BASE}/inspections/${inspC}`)
  await page.waitForSelector('[data-testid="sheet-group-board"]')
  await page.selectOption('span:has-text("점검 월") + select', '3')
  const firstSheetBtn = page.locator('[data-board-sheet]').first()
  await firstSheetBtn.click()
  await page.waitForSelector(`${drawer} [aria-label$=" O"]`)
  const firstO = page.locator(`${drawer} [aria-label$=" O"]`).first()
  const extCode = ((await firstO.getAttribute('aria-label')) ?? '').replace(/ O$/, '')
  await firstO.click()
  await page.click(`${drawer} button:has-text("저장")`)
  await page.waitForSelector(`${drawer} >> text=저장했습니다`)
  const extRow = await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('month, result').eq('inspection_id', inspC).eq('item_code', extCode)
    return (data ?? []).length === 1 ? data![0] : null
  }, 15000) as { month: number; result: string } | null
  check('P13 월 3 축으로 저장', extRow?.month === 3 && extRow?.result === 'O', JSON.stringify(extRow))
  await page.selectOption('span:has-text("점검 월") + select', '7')
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel)
    return el && !el.classList.contains('bg-green-500')
  }, `[data-testid="sheet-drawer"] [aria-label="${extCode} O"]`, { timeout: 15000 })
  check('P13 월 7 전환 — 값이 갈림(공란)', true)
  await page.keyboard.press('Escape')
  await page.waitForSelector(drawer, { state: 'detached' })

  // ── P22 — 대장 힌트 배너: 하위 행 보유 고객에서만, [일괄 ／]는 해당 그룹만 (Q-22 ②) ──
  await page.goto(`${BASE}/inspections/${inspB}`)
  await page.waitForSelector('[data-testid="sheet-group-board"]')
  await page.click('[data-group-key$=":1-B"]')
  await page.waitForSelector('[data-testid="ledger-hint-banner"]')
  const hintText = (await page.locator('[data-testid="ledger-hint-banner"]').textContent()) ?? ''
  check('P22 힌트 배너 — 미설치 4그룹', hintText.includes('그룹 4개'), hintText)
  await page.click('[data-testid="ledger-hint-apply"]')
  const na1B = await page.locator(`${drawer} [data-outline-group="1-B"] [data-na-mark]`).count()
  const rows1B = await page.locator(`${drawer} [data-outline-group="1-B"] [aria-label$=" O"]`).count()
  check('P22 [일괄 ／] — 1-B 전 항목 ／', na1B === rows1B && na1B > 0, `${na1B}/${rows1B}`)
  check('P22 다른 그룹(1-A) 무변경', await page.locator(`${drawer} [data-outline-group="1-A"] [data-na-mark]`).count() === 0)
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="unsaved-nav-discard"]')
  await page.click('[data-testid="unsaved-nav-discard"]')   // 버리고 닫기 — inspB 상태는 남기지 않는다
  await page.waitForSelector(drawer, { state: 'detached' })

  // ── P17 — 조회 전용: 드로어는 열리되 ○/✕ 무반응·[저장] 없음 ──
  const page2 = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page2.setDefaultTimeout(15000)
  await login(page2, EMAIL_VIEWER)
  await page2.goto(`${BASE}/inspections/${inspA}`)
  // 진입 pane = 첫 미완료 단계 — 이 시점 inspA는 응답이 있어 ①이 증거완료(responded>0)라
  // 초기 pane이 ②다. ① 점검표 pane으로 명시 전환 후 보드를 기다린다.
  await page2.click('[data-step="checklist"]')
  await page2.waitForSelector('[data-testid="sheet-group-board"]')
  await page2.click('[data-group-key$=":1-A"]')
  await page2.waitForSelector(`${drawer} [aria-label="1-A-001 O"]`)
  check('P17 조회 계정 — 드로어 열림', true)
  await page2.click(`${drawer} [aria-label="1-A-001 O"]`)
  await page2.waitForTimeout(300)
  check('P17 ○ 무반응(읽기 전용)', await page2.locator(`${drawer} [aria-label="1-A-001 O"].bg-green-500`).count() === 0)
  check('P17 dirty 배지 없음', await page2.locator('[data-testid="drawer-dirty"]').count() === 0)
  check('P17 [저장] 버튼 없음', await page2.locator(`${drawer} button:has-text("저장")`).count() === 0)
  check('P17 시트 [／ 전체] 버튼 없음', await page2.locator('[data-testid="drawer-sheet-na"]').count() === 0)
  await page2.close()
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const id of [inspA, inspB, inspC]) {
    if (!id) continue
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', id)
    await raw.from('inspection_defects').delete().eq('inspection_id', id)
  }
  if (bldB) {
    await raw.from('fire_facilities').delete().eq('building_id', bldB)
    await raw.from('buildings').delete().eq('id', bldB)
  }
  if (custA) await cleanupCustomer(custA)
  if (custB) await cleanupCustomer(custB)
  if (userId) await delUser(userId)
  if (viewerId) await delUser(viewerId)
}
summary()
