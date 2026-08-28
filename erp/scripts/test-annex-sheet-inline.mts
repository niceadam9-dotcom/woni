// 소방계획서_16 S4/S6 → 28 S4 — 회차별 작성·조회 트리의 점검표 노드 (**조회 + 딥링크 전용**)
//
// ⚠ 계약이 바뀌었다(9e45d23). 종전 이 트리는 시트 행을 눌러 항목을 인라인으로 펼치고 자동 저장까지
//    했다(16 S4). 같은 데이터를 입력하는 화면이 넷으로 늘고 저장 규칙이 셋으로 갈리면서
//    "어디가 정본인가"가 사라졌고, 그 대가가 2026-08-24 물분무 결과칸 공란 사고였다.
//    지금 트리는 **진행률을 보여주고 전용 입력 화면으로 보내는 일**만 한다:
//      시트 행 = <Link href="/inspections/{id}/sheet?sheet={코드}" data-testid="annex-sheet-link-{코드}">
//      머리줄  = <Link data-testid="annex-sheet-entry-link">입력 화면 열기 →</Link>
//    인라인 에디터·자동저장·빠른입력·stale 배너는 삭제됐다.
//
// 그래서 이 스위트가 보는 것: 미시작 회차 CTA · 설비별 진행 요약(분모 정합성) · 설치 필터 ·
//   입력 UI 부재 · Realtime 요약 반영 · **시트 행이 딥링크로 전용 화면의 그 설비에 도달** · 권한 표기.
// 항목 입력·자동저장·해제·일괄 버튼의 단언은 test-sheet-entry-page.mts(22검사)가 덮는다 — 중복 금지.
//
// 실행: npx tsx scripts/test-annex-sheet-inline.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-sheet-e2e@erp-test.com'
const EMAIL2 = 'annex-sheet-other@erp-test.com'
let userId = ''
let otherId = ''
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

  // 기대 분모 — 설치 시트(소화기구)의 작동 범위 항목 수. 화면 숫자를 화면 코드로 검산하면 동어반복이라
  // DB에서 독립 재계산한다. sheet_code는 딥링크 계약(?sheet=코드)의 기대값이기도 하다.
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
  page.on('dialog', d => d.accept())
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await login(page, EMAIL)

  const ANNEX = `${BASE}/customers/${customerId}?tab=plan&form=annex`
  await page.goto(ANNEX)
  await page.waitForSelector(`text=${CUR_YEAR}년 1차`)

  // ── 1) 미시작 회차 — 자동 펼침되는 최신(2차, 계획만)에는 점검표 노드가 없고 시작 CTA만 ──
  check('미시작 회차 — 시작 CTA 표시', await page.isVisible('text=아직 점검 미시작'))
  check('미시작 회차 — 점검표 노드 없음', (await page.locator('text=설비별 진행').count()) === 0)

  // 시작된 1차 카드를 펼친다 (2차가 최신이라 자동 펼침 대상이 아님)
  await page.click(`button:has-text("${CUR_YEAR}년 1차")`)

  // ── 2) 설비별 요약 행 상시 표시 + 분모 정합성 ──
  await page.waitForSelector('text=설비별 진행', { timeout: 20000 })
  check('설비별 진행 요약 표시', true)
  const sheetRow = page.locator(`[data-testid="annex-sheet-link-${SHEET_CODE}"]`)
  await sheetRow.waitFor({ timeout: 15000 })
  const rowText = async () => ((await sheetRow.textContent()) ?? '').trim()
  check('설치 설비 시트 행 노출', await sheetRow.isVisible(), await rowText())
  check('시트 행이 설비명을 보여준다', (await rowText()).includes(INSTALLED), await rowText())
  // 분모는 DB에서 독립 계산한 opCodes.length와 같아야 한다(트리가 제 숫자로 제 숫자를 검산하지 않도록)
  check('미입력 진행률 0/N + 분모 = 독립 계산 항목 수', (await rowText()).includes(`0/${opCodes.length}`),
    `${await rowText()} (기대 0/${opCodes.length})`)
  check('미입력 경고 표기', (await rowText()).includes('미입력'))
  check('설치 설비 중 미입력 합산 고지', await page.isVisible('text=/⚠ 설치 설비 중 미입력 \\d+개/'))

  // ── 3) 설치 설비만 보기 기본 ON ──
  check('설치 설비만 보기 기본 ON — 미설치 시트 숨김',
    (await page.locator('text=유도등 및 유도표지').count()) === 0)
  await page.uncheck('input[type="checkbox"]:near(:text("설치 설비만 보기"))').catch(async () => {
    await page.locator('label:has-text("설치 설비만 보기") input[type="checkbox"]').uncheck()
  })
  await page.locator('text=유도등 및 유도표지').first().waitFor({ timeout: 10000 }).catch(() => {})
  check('필터 해제 — 미설치 시트 노출', (await page.locator('text=유도등 및 유도표지').count()) > 0)
  await page.locator('label:has-text("설치 설비만 보기") input[type="checkbox"]').check()
  await sheetRow.waitFor({ timeout: 10000 })

  // ── 4) 입력 UI 부재 — 28 S4의 본질(입력구 4개→2개). 여기서 입력할 수 있으면 정본이 다시 갈라진다 ──
  check('인라인 결과 버튼 없음(○)', (await page.locator('button:text-is("○")').count()) === 0)
  check('인라인 결과 버튼 없음(✕)', (await page.locator('button:text-is("✕")').count()) === 0)
  check('자동저장 칩 없음 — 저장 규칙이 이 화면에 없다', (await page.locator('[data-testid="sheet-autosave"]').count()) === 0)
  check('stale 배너 없음 — dirty 개념 자체가 사라졌다', (await page.locator('text=자동 갱신을 멈췄습니다').count()) === 0)

  // ── 5) 머리줄 딥링크 — '어디서 채우나'에 답하는 자리 ──
  const entry = page.locator('[data-testid="annex-sheet-entry-link"]')
  check('머리줄 입력 화면 링크 1개(시작된 회차에만)', (await entry.count()) === 1, `${await entry.count()}개`)
  check('머리줄 링크 문구', ((await entry.first().textContent()) ?? '').includes('입력 화면 열기'),
    ((await entry.first().textContent()) ?? '').trim())
  // ?from= — 입력 화면의 뒤로가기가 이 별지 화면으로 돌아오게 하는 복귀 경로 (2026-08-28)
  const FROM_Q = `from=${encodeURIComponent(`/customers/${customerId}?tab=plan&form=annex`)}`
  check('머리줄 링크 href = 전용 화면 + 복귀 경로', (await entry.first().getAttribute('href')) === `/inspections/${inspId}/sheet?${FROM_Q}`,
    (await entry.first().getAttribute('href')) ?? '')

  // 두 회차를 모두 펼쳐도 점검표 노드는 시작된 회차에만 (요약 1세트 유지)
  check('두 회차 펼침 — 설비별 진행 1세트', (await page.locator('text=설비별 진행').count()) === 1)

  // ── 6) Realtime (S5·S6-3) — 원격 저장이 새로고침 없이 반영 ──
  // '원격'은 service role DB 쓰기(updated_by 없음 → 에코 억제 대상 아님)로 재현한다.
  // publication 미등록(122 미적용)이면 이 체크만 실패해 K-3을 정확히 지목한다.
  // 편집 상태가 사라져 dirty 배너·[최신 불러오기] 경합 처리는 계약에서 삭제됐다(9e45d23) — 남은 축은 이 하나.
  {
    await raw.from('inspection_sheet_responses')
      .insert({ inspection_id: inspId, item_code: opCodes[0], result: 'O' })
    let rtOk = false
    for (let i = 0; i < 40; i++) {
      if ((await rowText()).includes(`1/${opCodes.length}`)) { rtOk = true; break }
      await page.waitForTimeout(500)
    }
    check('Realtime — 원격 저장이 새로고침 없이 요약 반영', rtOk, await rowText())
  }

  // ── 7) ★ 시트 행 딥링크 — 이 트리가 존재하는 이유. 눌러서 **그 설비가 열린 채** 도착해야 한다 ──
  const rowHref = await sheetRow.getAttribute('href')
  check('시트 행 href = ?sheet=코드 + 복귀 경로 딥링크 계약',
    rowHref === `/inspections/${inspId}/sheet?sheet=${SHEET_CODE}&${FROM_Q}`, rowHref ?? '(href 없음)')
  await sheetRow.click()
  await page.waitForURL(u => u.pathname === `/inspections/${inspId}/sheet`, { timeout: 20000 })
  await page.waitForSelector('text=점검표 입력 —', { timeout: 20000 })
  check('시트 행 클릭 → 전용 입력 화면 도달', true, page.url())
  // 우 패널 제목(h2)이 곧 열린 시트다 — 코드 해석이 틀리면 아무것도 안 열려 h2가 아예 없다
  const opened = ((await page.locator('h2').first().textContent({ timeout: 15000 }).catch(() => '')) ?? '').trim()
  check('지목한 설비가 열린 채로 도착', opened === INSTALLED, opened || '(열린 시트 없음 — 코드 해석 실패)')

  // ── 8) 권한 — 비담당 employee는 보기 전용 ──
  // 트리는 조회 전용이라 애초에 쓰기 경로가 없다. 권한 게이트의 정본은 전용 화면(canEdit)이고
  // 여기서는 **그 사실을 사용자에게 알리는 표기**와 DB 무변화를 본다.
  const { data: preAuthRows } = await raw.from('inspection_sheet_responses').select('item_code').eq('inspection_id', inspId)
  const preAuthCnt = (preAuthRows ?? []).length
  await page.context().clearCookies()
  await login(page, EMAIL2)
  await page.goto(ANNEX)
  await page.waitForSelector(`text=${CUR_YEAR}년 1차`)
  await page.click(`button:has-text("${CUR_YEAR}년 1차")`)   // 자동 펼침은 최신(2차)이라 직접 펼친다
  // '설비별 진행'은 로딩 문구에도 들어 있어 즉시 매칭된다 — 실제 시트 행이 뜰 때까지 기다린다
  const otherRow = page.locator(`[data-testid="annex-sheet-link-${SHEET_CODE}"]`)
  await otherRow.waitFor({ timeout: 40000 })
  check('비담당 — 요약은 보임', true)
  check('비담당 — 보기 전용 안내', await page.isVisible('text=보기 전용'))
  check('비담당 — 결과 입력 버튼 미노출', (await page.locator('button:text-is("○")').count()) === 0)
  await otherRow.click()
  await page.waitForSelector('text=점검표 입력 —', { timeout: 20000 })
  const { data: after } = await raw.from('inspection_sheet_responses').select('item_code').eq('inspection_id', inspId)
  check('비담당 — 트리 열람·이동만으로 DB 무변화', (after ?? []).length === preAuthCnt,
    `${(after ?? []).length} != ${preAuthCnt}`)
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
  if (otherId) await delUser(otherId)
}
summary()
