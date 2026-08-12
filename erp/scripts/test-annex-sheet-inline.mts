// 소방계획서_16 S4/S6 — 회차별 작성·조회 트리의 점검표 인라인 조회·입력 E2E
// 설비별 요약 상시 표시 · 설치 필터 · lazy 확장 · 저장 반영 · X 인라인 등록 · 분모 정합성 · 권한 · 미시작 회차
// 실행: npx tsx scripts/test-annex-sheet-inline.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, PW } from './_e2e-helpers.mjs'

const EMAIL = 'annex-sheet-e2e@erp-test.com'
const EMAIL2 = 'annex-sheet-other@erp-test.com'
let userId = ''
let otherId = ''
let customerId = ''
let inspId = ''
let planId = ''
let planCreated = false
let planItemId = ''
const notifIds: string[] = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
const CUR_YEAR = Number(kstShift(-1).slice(0, 4))
const INSTALLED = '소화기구 및 자동소화장치'

try {
  userId = await mkUser({ email: EMAIL, name: '트리점검표E2E', employeeId: 'E2E-AST' })
  otherId = await mkUser({ email: EMAIL2, name: '비담당E2E', employeeId: 'E2E-AST2', role: 'employee' })
  customerId = await mkCustomer({ customer_name: '트리점검표E2E고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert({
    building_id: bld!.id, category: '소화설비', facility_code: INSTALLED, installed: true,
  })

  // 시작된 회차 (담당자 = userId)
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  // 미시작 회차 (계획만 — inspection_id 없음)
  // inspection_plans는 연/월 단위(고객 축 없음, year+month UNIQUE) — 있으면 재사용하고 정리 때 지우지 않는다
  const { data: exPlan } = await raw.from('inspection_plans')
    .select('id').eq('year', CUR_YEAR).eq('month', 12).maybeSingle()
  if (exPlan) { planId = exPlan.id }
  else {
    const { data: plan, error: plErr } = await raw.from('inspection_plans')
      .insert({ year: CUR_YEAR, month: 12, status: 'confirmed', created_by: userId }).select('id').single()
    if (plErr) throw new Error(`계획 생성 실패: ${plErr.message}`)
    planId = plan!.id
    planCreated = true
  }
  const { data: pItem, error: piErr } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: customerId, sequence_num: 2, plan_type: 'special_작동',
    inspection_type: '작동', scheduled_date: kstShift(30), planned_date: kstShift(30), status: 'planned',
  }).select('id').single()
  if (piErr) throw new Error(`계획 항목 생성 실패: ${piErr.message}`)
  planItemId = pItem!.id

  // 기대 분모 — 설치 시트(소화기구)의 작동 범위 항목 수
  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id, sheet_name').eq('version', 'v2025').ilike('sheet_name', '%소화기구%').limit(1).maybeSingle()
  const { data: sItems } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', sheet!.id)
  const opCodes = [...new Set(((sItems ?? []) as Array<{ item_code: string; comprehensive_only: boolean }>)
    .filter(i => !i.comprehensive_only).map(i => i.item_code))]
  check('시드 — 소화기구 시트 작동 범위 항목 존재', opCodes.length >= 2, `${opCodes.length}개`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await login(page, EMAIL)

  const ANNEX = `${BASE}/customers/${customerId}?tab=plan&form=annex`
  await page.goto(ANNEX)
  await page.waitForSelector(`text=${CUR_YEAR}년 1차`)

  // ── 8) 미시작 회차 — 자동 펼침되는 최신(2차, 계획만)에는 점검표 노드가 없고 시작 CTA만 ──
  check('미시작 회차 — 시작 CTA 표시', await page.isVisible('text=아직 점검 미시작'))
  check('미시작 회차 — 점검표 노드 없음', (await page.locator('text=설비별 진행').count()) === 0)

  // 시작된 1차 카드를 펼친다 (2차가 최신이라 자동 펼침 대상이 아님)
  await page.click(`button:has-text("${CUR_YEAR}년 1차")`)

  // ── 1) 설비별 요약 행 상시 표시 ──
  await page.waitForSelector('text=설비별 진행', { timeout: 20000 })
  check('설비별 진행 요약 표시', true)
  const sheetRow = page.locator(`button:has-text("${INSTALLED}")`).first()
  await sheetRow.waitFor({ timeout: 15000 })
  check('설치 설비 시트 행 노출', await sheetRow.isVisible())
  check('미입력 진행률 0/N 표시', (await sheetRow.textContent() ?? '').includes(`0/${opCodes.length}`),
    (await sheetRow.textContent() ?? '').trim())
  check('미입력 경고 표기', (await sheetRow.textContent() ?? '').includes('미입력'))

  // ── 2) 설치 설비만 보기 기본 ON ──
  const otherSheetVisible = await page.locator('button:has-text("유도등 및 유도표지")').count()
  check('설치 설비만 보기 기본 ON — 미설치 시트 숨김', otherSheetVisible === 0)
  await page.uncheck('input[type="checkbox"]:near(:text("설치 설비만 보기"))').catch(async () => {
    await page.locator('label:has-text("설치 설비만 보기") input[type="checkbox"]').uncheck()
  })
  await page.waitForTimeout(300)
  check('필터 해제 — 미설치 시트 노출', (await page.locator('button:has-text("유도등 및 유도표지")').count()) > 0)
  await page.locator('label:has-text("설치 설비만 보기") input[type="checkbox"]').check()
  await page.waitForTimeout(300)

  // ── 3) 인라인 lazy 확장 — 펼치기 전에는 항목 DOM 0개 ──
  check('확장 전 항목 미로드(상시 펼침 아님)', (await page.locator('button:text-is("○")').count()) === 0)
  await sheetRow.click()
  // 편집기 하단 [닫기]는 항목 로드 전에도 렌더된다 — 실제 항목 버튼이 뜰 때까지 기다린다
  await page.waitForSelector('button:text-is("○")', { timeout: 20000 })
  const oCount = await page.locator('button:text-is("○")').count()
  check('클릭 후 항목 로드 — ○ 버튼 존재', oCount >= opCodes.length, `${oCount}개`)

  // ── 6) 분모 정합성 — 트리 분모 == 점검 상세의 같은 시트 항목 수 ──
  check('트리 분모 = 독립 계산 항목 수', oCount === opCodes.length, `tree=${oCount} expect=${opCodes.length}`)

  // ── 4) 자동 저장(소방계획서_20 S4) → DB 반영 + 새로고침 없이 요약 갱신 ──
  // [이 설비 저장]은 폐지 — 결과를 누르면 ~1초 뒤 스스로 저장되고 칩으로 알린다
  await page.locator('button:text-is("○")').first().click()
  await page.waitForSelector('text=✓ 저장됨', { timeout: 20000 })
  const { data: saved } = await raw.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', inspId)
  check('DB 저장 — 1건 O', (saved ?? []).length === 1 && saved![0].result === 'O', JSON.stringify(saved))
  const summaryOk = await page.waitForSelector(`text=1/${opCodes.length}`, { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('새로고침 없이 요약 갱신(1/N)', summaryOk)

  // ── 5) X 인라인 등록 → 불량내역 자동 등록 ──
  await page.locator('button:text-is("✕")').nth(1).click()
  await page.waitForSelector('input[placeholder="불량 메모 (선택)"]')
  await page.fill('input[placeholder="불량 메모 (선택)"]', '트리 인라인 불량')
  // 화면에 '등록'을 포함한 버튼이 여럿이라 인라인 메모 행으로 스코프
  await page.locator('div:has(> input[placeholder="불량 메모 (선택)"]) button:text-is("등록")').click()
  await page.waitForSelector('text=불량(✕) 저장', { timeout: 20000 })
  const { data: dfs } = await raw.from('inspection_defects')
    .select('defect_code, defect_detail').eq('inspection_id', inspId)
  check('X 인라인 → 불량내역 자동 등록', (dfs ?? []).length === 1 && dfs![0].defect_detail === '트리 인라인 불량',
    JSON.stringify(dfs))

  // 두 회차를 모두 펼쳐도 점검표 노드는 시작된 회차에만 (요약 1세트 유지)
  check('두 회차 펼침 — 설비별 진행 1세트', (await page.locator('text=설비별 진행').count()) === 1)

  // ── 9) Realtime (S5·S6-3) — 원격 저장이 새로고침 없이 반영 ──
  // '원격'은 service role DB 쓰기(updated_by 없음 → 에코 억제 대상 아님)로 재현한다.
  // publication 미등록(122 미적용)이면 아래 체크만 실패해 K-3을 정확히 지목한다.
  {
    // 시트 편집기가 열려 있으면 dirty 보호 경로로 빠지므로 먼저 닫는다 (블록 5가 열어둔 상태).
    // 자동 저장 전환(S4) 이후 편집기 하단 버튼은 [닫기] 하나다.
    const closeBtn = page.locator('button:text-is("닫기")').last()
    if (await closeBtn.count()) await closeBtn.click().catch(() => {})
    await page.waitForTimeout(800)   // 닫기 flush + 요약 재조회
    const respondedCodes = new Set((
      (await raw.from('inspection_sheet_responses').select('item_code').eq('inspection_id', inspId)).data ?? []
    ).map(r => (r as { item_code: string }).item_code))
    const freshCodes = opCodes.filter(c => !respondedCodes.has(c))
    check('시드 — Realtime용 미응답 코드 2개 이상', freshCodes.length >= 2, `${freshCodes.length}개`)

    // 9-a) 비편집 상태 — 자동 갱신
    await raw.from('inspection_sheet_responses')
      .insert({ inspection_id: inspId, item_code: freshCodes[0], result: 'O' })
    const autoOk = await page.waitForSelector(`text=${respondedCodes.size + 1}/${opCodes.length}`, { timeout: 20000 })
      .then(() => true).catch(() => false)
    check('Realtime — 원격 저장이 새로고침 없이 요약 반영', autoOk)

    // 9-b) 편집 중(dirty) — 자동 덮어쓰기 대신 배너 (S5-5)
    await sheetRow.click()
    // 편집기 하단 [닫기]는 항목 로드 전에도 렌더된다 — 실제 항목 버튼이 뜰 때까지 기다린다
    await page.waitForSelector('button:text-is("○")', { timeout: 20000 })
    await page.locator('button:text-is("✕")').last().click()   // 마지막 행(미응답)을 X로 → dirty
    // 클릭이 화면에 반영되기 전에 원격 변경을 넣으면 '편집 중 아님'으로 판정돼 경합이 난다 —
    // ✕ 버튼이 활성(빨강)으로 바뀐 걸 확인해 렌더·이펙트 커밋을 보장한 뒤 원격 저장을 재현한다
    await page.waitForFunction(() => {
      const bs = [...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === '✕')
      return bs.length > 0 && bs[bs.length - 1].className.includes('bg-red-500')
    }, undefined, { timeout: 10000 })
    await raw.from('inspection_sheet_responses')
      .insert({ inspection_id: inspId, item_code: freshCodes[1], result: 'O' })
    const bannerOk = await page.waitForSelector('text=자동 갱신을 멈췄습니다', { timeout: 20000 })
      .then(() => true).catch(() => false)
    check('Realtime — dirty 중엔 배너로 대기(자동 덮어쓰기 금지)', bannerOk)
    await page.click('button:has-text("최신 불러오기")')
    const freshOk = await page.waitForSelector(`text=${respondedCodes.size + 2}/${opCodes.length}`, { timeout: 20000 })
      .then(() => true).catch(() => false)
    check('Realtime — [최신 불러오기] 후 요약 최신화', freshOk)
    // 요약 갱신(setOv)이 배너 해제(setStale)보다 한 틱 먼저 커밋된다 — 사라질 때까지 대기
    const bannerGone = await page.locator('text=자동 갱신을 멈췄습니다').waitFor({ state: 'detached', timeout: 10000 })
      .then(() => true).catch(() => false)
    check('Realtime — 배너 해제', bannerGone)

    // 9-c) 알림 벨 (S5-8) — K-3 해소로 실시간 수신이 처음 동작하는지
    const { data: notif } = await raw.from('notifications')
      .insert({ recipient_id: userId, title: 'RT-BELL', message: 'Realtime 스모크', type: 'approved' })
      .select('id').single()
    notifIds.push(notif!.id)
    // 1차: 미읽음 배지 등장 — 2차(진단 겸 폴백): 벨을 열어 실시간 prepend된 RT-BELL 확인
    // (벨 목록은 마운트 시 1회 조회라, 삽입 후 목록에 있으면 실시간 수신이 유일한 경로)
    let bellOk = await page.waitForSelector('button[aria-label="알림"] span', { timeout: 25000 })
      .then(() => true).catch(() => false)
    let bellDetail = bellOk ? '배지' : ''
    if (!bellOk) {
      await page.click('button[aria-label="알림"]')
      bellOk = await page.waitForSelector('text=RT-BELL', { timeout: 5000 }).then(() => true).catch(() => false)
      bellDetail = bellOk ? '드롭다운(배지 셀렉터 재점검 필요)' : `버튼존재=${await page.locator('button[aria-label="알림"]').count()}`
      await page.keyboard.press('Escape').catch(() => {})
      await page.mouse.click(5, 5)   // 드롭다운 닫기 (외부 클릭)
    }
    check('Realtime — 알림 벨 실시간 수신(S5-8)', bellOk, bellDetail)
  }

  // ── 7) 권한 — 비담당 employee는 보기 전용 ──
  const { data: preAuthRows } = await raw.from('inspection_sheet_responses').select('item_code').eq('inspection_id', inspId)
  const preAuthCnt = (preAuthRows ?? []).length
  await page.context().clearCookies()
  await login(page, EMAIL2)
  await page.goto(ANNEX)
  await page.waitForSelector(`text=${CUR_YEAR}년 1차`)
  await page.click(`button:has-text("${CUR_YEAR}년 1차")`)   // 자동 펼침은 최신(2차)이라 직접 펼친다
  // '설비별 진행'은 로딩 문구('…불러오는 중')에도 들어 있어 즉시 매칭된다 — 실제 시트 행이 뜰 때까지 기다린다
  await page.locator(`button:has-text("${INSTALLED}")`).first().waitFor({ timeout: 40000 })
  check('비담당 — 요약은 보임', true)
  check('비담당 — 보기 전용 안내', await page.isVisible('text=보기 전용'))
  await page.locator(`button:has-text("${INSTALLED}")`).first().click()
  await page.waitForTimeout(1500)
  // 자동 저장 전환(S4) 후 저장 버튼 자체가 없다 — 편집 불가는 결과 버튼 미노출로 판정
  check('비담당 — 결과 입력 버튼 미노출', (await page.locator('button:text-is("○")').count()) === 0)
  const { data: after } = await raw.from('inspection_sheet_responses').select('item_code').eq('inspection_id', inspId)
  check('비담당 — DB 무변화', (after ?? []).length === preAuthCnt, `${(after ?? []).length} != ${preAuthCnt}`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  }
  for (const nid of notifIds) await raw.from('notifications').delete().eq('id', nid)
  if (planItemId) await raw.from('inspection_plan_items').delete().eq('id', planItemId)
  if (planCreated && planId) await raw.from('inspection_plans').delete().eq('id', planId)
  if (customerId) {
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', customerId)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
  if (otherId) await delUser(otherId)
}
summary()
