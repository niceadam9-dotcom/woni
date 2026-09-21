// 회차 탭 점검표 미입력 축 (구 test-annex-sheet-inline — 2026-09-21 계약 교체)
//
// ⚠ 계약이 두 번 바뀌었다.
//   ① 16 S4 — 회차 트리에서 항목을 인라인으로 펼쳐 입력했다. 같은 데이터를 입력하는 화면이 넷으로
//      늘고 저장 규칙이 셋으로 갈리면서 정본이 사라졌고, 그 대가가 2026-08-24 물분무 공란 사고였다.
//   ② 28 S4 — 트리는 **조회 + 딥링크 전용**이 됐다(입력은 /inspections/{id}/sheet 한 곳).
//   ③ **2026-09-21(여기) — 사용자 확정으로 트리·머리줄을 통째로 없앴다.** 회차 탭은 문서 축이다.
//
// 그래서 이 스위트가 보는 것이 뒤집혔다. 종전엔 "트리가 제대로 그려지는가"였고 지금은
//   ㄱ) 트리·머리줄이 **없는가**(되살아나면 정본이 다시 갈라진다 — ①의 재발)
//   ㄴ) 그 트리가 올려 주던 **미입력 수를 서버가 대신 싣는가**(docs-actions loadSheetBlanks)
//   ㄲ) 그 수로 **발행 가드가 실제로 서는가** — 이게 트리를 없앨 때 유일하게 끊길 뻔한 줄이다.
//       (미입력분은 2026-09-02 정책으로 **기본 ○(양호)**로 인쇄된다. 가드가 조용히 통과하면
//        점검하지 않은 설비가 양호로 찍혀 나간다.)
//   ㄴ) 수는 DB에서 **독립 재계산**한 값과 맞댄다 — 서버가 0을 고정으로 실어도 초록이 되지 않게.
//
// 항목 입력·자동저장·일괄 버튼·권한 게이트의 단언은 test-sheet-entry-page.mts가 덮는다(중복 금지).
// 권한 축은 여기서 뺐다 — 물을 대상(트리)이 없어졌고, 정본은 전용 화면이다.
//
// 실행: npx tsx scripts/test-annex-sheet-blanks.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-sheet-e2e@erp-test.com'
let userId = ''
let customerId = ''
let inspId = ''
let planId = ''
let planCreated = false
let planItemId = ''
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
    // 전건 확정 체계(2026-09-12, 161·162) — planned는 enum에서 빠졌다
    inspection_type: '작동', scheduled_date: kstShift(30), planned_date: kstShift(30), status: 'confirmed',
  }).select('id').single()
  if (piErr) throw new Error(`계획 항목 생성 실패: ${piErr.message}`)
  planItemId = pItem!.id

  // 기대 분모 — 설치 시트(소화기구)의 작동 범위 항목 수. 화면 숫자를 화면 코드로 검산하면 동어반복이라
  // DB에서 독립 재계산한다. 이 수가 곧 '필수 미입력 N건'의 기대값이다(응답 0건일 때).
  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id, sheet_code, sheet_name').eq('version', 'v2025').ilike('sheet_name', '%소화기구%').limit(1).maybeSingle()
  const { data: sItems } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', sheet!.id)
  const opCodes = [...new Set(((sItems ?? []) as Array<{ item_code: string; comprehensive_only: boolean }>)
    .filter(i => !i.comprehensive_only).map(i => i.item_code))]
  check('시드 — 소화기구 시트 작동 범위 항목 존재', opCodes.length >= 2, `${opCodes.length}개`)
  const SHEET_CODE = sheet!.sheet_code as string

  const l = await launch()
  browser = l.browser
  const page = l.page
  // 발행 가드 팝업을 **읽어야** 하므로 자동 수락에 맡기지 않고 메시지를 모은다.
  const dialogs: string[] = []
  let dialogAction: 'accept' | 'dismiss' = 'dismiss'
  page.on('dialog', async d => { dialogs.push(d.message()); await (dialogAction === 'accept' ? d.accept() : d.dismiss()) })
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await login(page, EMAIL)

  const ANNEX = `${BASE}/customers/${customerId}?tab=annex`   // 소방계획서_34 — 별지가 최상위 탭(51에서 「회차」로 개명)
  await page.goto(ANNEX)
  // 🚨 구계약 주의: 회차 알약의 「N차」 표기는 2026-09-14에 폐지됐다(연도만 남았다). 종전 이 파일의
  //   `text=${CUR_YEAR}년 1차` 대기는 그 구계약이라, 타임라인의 **숨은** 점검 링크를 물고 멈춰 섰다
  //   (test-annex-interaction은 이미 카드 캡션으로 갈아끼운 뒤였다 — 여기만 남아 썩고 있었다).
  await page.waitForSelector('text=사용승인일 기준으로 ERP가 자동 판정', { timeout: 20000 })
  // 별지 블록 본문이 곧 '카드가 펼쳐졌다'의 마커다(구 마커 '점검표 입력'은 이 화면에서 사라졌다)
  await page.waitForSelector('text=입력된 점검표에서 자동 생성', { timeout: 20000 })

  // ── 1) 현재 회차 자동 판정 (2026-09-02 재편) — 진행 중 회차가 현재로 선택돼 항상 펼쳐진다 ──
  check('현재 회차 — 자동 판정 캡션', await page.isVisible('text=자동 판정'))
  check('현재 회차 — 카드 1장뿐(미시작 2차는 안 그린다)',
    (await page.locator('text=입력된 점검표에서 자동 생성').count()) === 1)

  // ── 2) ★ 점검표 블록 부재 — 되살아나면 입력 정본이 다시 갈라진다(16 S4 재발) ──
  check('🚨 점검표 진행 블록 없음', !(await page.isVisible('text=현장 결과를 설비별로 입력')))
  check('🚨 점검표 머리줄 없음 — 「점검표 입력」 라벨 0개',
    (await page.locator('text=점검표 입력').count()) === 0)
  check('🚨 설비별 진행 트리 없음', (await page.locator('text=설비별 진행').count()) === 0)
  check('🚨 시트 딥링크 0개', (await page.locator(`[data-testid="annex-sheet-link-${SHEET_CODE}"]`).count()) === 0)
  check('🚨 머리줄 입력 링크 0개', (await page.locator('[data-testid="annex-sheet-entry-link"]').count()) === 0)
  check('🚨 [설치 설비만 보기] 필터 없음', !(await page.isVisible('text=설치 설비만 보기')))

  // ── 3) ★ 미입력 수는 **서버가** 싣는다 (docs-actions loadSheetBlanks) ──
  //    트리가 없어졌으므로 이 두 줄이 화면에 남은 유일한 미입력 신호다.
  //    수는 DB 독립 계산과 맞댄다 — 서버가 0을 고정으로 실으면 여기서 빨개진다(변이 M-a).
  const cardText = async () => (await page.locator('[data-testid="round-card"], body').first().innerText())
  check('설비 층 — 설치 설비 중 미입력 1개(서버 집계)',
    await page.isVisible('text=/⚠ 설치 설비 중 미입력 1개/'), (await cardText()).slice(0, 400))
  check('항목 층 — 필수 미입력 = DB 독립 계산치',
    await page.isVisible(`text=/필수 미입력 ${opCodes.length}건/`),
    `기대 ${opCodes.length}건 · 실제=${(await cardText()).match(/필수 미입력 \d+건/)?.[0] ?? '(없음)'}`)

  // ── 4) ★ 발행 가드 — 트리를 없앨 때 유일하게 끊길 뻔한 줄 ──
  //    [엑셀]을 누르면 팝업이 서고, [확인]은 입력 화면으로 보낸다. 분모가 0이면 팝업 자체가 없다.
  dialogs.length = 0
  dialogAction = 'accept'
  await page.locator('[data-testid="round-workbook-download"]').first().click()
  await page.waitForURL(u => u.pathname === `/inspections/${inspId}/sheet`, { timeout: 20000 })
  check('발행 가드 — [엑셀]에 팝업이 선다', dialogs.length === 1, `${dialogs.length}건`)
  check('발행 가드 — 설비 층을 말한다', (dialogs[0] ?? '').includes('점검표 미입력 1개'), dialogs[0] ?? '')
  check('발행 가드 — 항목 층을 함께 말한다',
    (dialogs[0] ?? '').includes(`필수 미입력 항목 ${opCodes.length}건`), dialogs[0] ?? '')
  check('발행 가드 — [확인]이 입력 화면으로 보낸다', page.url().includes(`/inspections/${inspId}/sheet`), page.url())
  check('입력 진입구 생존 — 전용 화면이 열린다', await page.isVisible('text=점검표 입력 —'))

  // ── 5) 분모가 살아 움직이는가 — 전건 입력하면 두 경고가 사라져야 한다 ──
  //    (여기서 [엑셀]을 다시 누르지는 않는다 — 가드가 통과하면 **진짜 워크북 생성**이 돌아
  //     검사가 무거워진다. 가드와 경고는 같은 두 값을 읽으므로 경고 소멸이 곧 분모 0의 증거다.)
  for (const code of opCodes) {
    await raw.from('inspection_sheet_responses').insert({ inspection_id: inspId, item_code: code, result: 'O' })
  }
  await page.goto(ANNEX)
  await page.waitForSelector('text=입력된 점검표에서 자동 생성', { timeout: 20000 })
  check('전건 입력 후 — 설비 층 경고 소멸', !(await page.isVisible('text=/⚠ 설치 설비 중 미입력/')), (await cardText()).slice(0, 400))
  check('전건 입력 후 — 항목 층 경고 소멸', !(await page.isVisible('text=/필수 미입력 \\d+건/')), (await cardText()).slice(0, 400))

  // ── 6) 입력 진입구는 다른 표면이 책임진다 — 회차 탭에서 뺀 대가가 '막힘'이 아님을 못박는다 ──
  //    정본 진입구는 점검 상세의 **작업대 ① 칸**이다. 스텝바로 ①을 골라야 그 칸이 뜬다
  //    (전건 입력으로 ①이 완료되면 스텝바가 다른 단계를 펼쳐 둘 수 있다 — 화면 기본값에 기대지 않는다).
  await page.goto(`${BASE}/inspections/${inspId}`)
  const stepbar = page.locator('[data-testid="workbench-stepbar"]')
  await stepbar.waitFor({ timeout: 30000 })
  await stepbar.locator('button[data-step="checklist"]').click()
  await page.waitForSelector('text=점검표 입력', { timeout: 20000 })
  check('작업대 ①에 점검표 입력 진입구가 살아 있다', await page.isVisible('text=점검표 입력'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  }
  if (planItemId) await raw.from('inspection_plan_items').delete().eq('id', planItemId)
  if (planCreated && planId) await raw.from('inspection_plans').delete().eq('id', planId)
  if (customerId) {
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', customerId)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
}
summary()
