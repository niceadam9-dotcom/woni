/** 소방계획서_26 S4 → 28 S4 라이브 검증 — 1.4 설비 행 결과 배지 **딥링크** (읽기 전용 E2E).
 *
 *  대상: 별그리다(추모공원) — 진행 중(in_progress) 자체점검 회차 + 설치 8종 + '전부 ／' 시트 보유라
 *  배지 4상태(○/×/／/미입력)와 회차 라벨을 실데이터로 한 번에 볼 수 있다.
 *
 *  ⚠ 계약이 바뀌었다(9e45d23) — 1.4의 입력 패널·일괄 버튼·항목 목록은 **삭제됐다**.
 *     배지는 결과를 보여주고 `/inspections/{id}/sheet?facility={설비}`로 보내는 링크일 뿐이다.
 *     그래서 이 스위트가 보는 것은 **배지 판정 + 배선**이다:
 *       ① 배지 라벨이 실데이터와 맞는가  ② 링크가 딥링크 계약을 지키는가
 *       ③ 눌러서 도착하는가  ④ **지목한 설비가 열린 채로** 도착하는가
 *     항목 입력·자동저장·불량 등록의 단언은 test-sheet-entry-page.mts(22검사)가 덮는다 — 중복 금지.
 *     쓰기 버튼은 여전히 누르지 않는다 — 배선 검증이지 데이터 생성이 아니다.
 *
 *  ⚠ 1.4 탭은 클라이언트 상태라 goBack·재goto로 복원되지 않는다(둘 다 타임아웃 실측).
 *     화면을 떠나기 전에 필요한 href를 전부 걷어두고, 이후 블록은 새 goto로 시작한다.
 *
 *  실행: npx tsx scripts/_probe-form14-result-badge.mts  (dev 서버 필요) */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'form14-badge-e2e@erp-test.com'
const PW = 'Badge26!'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`); ok ? pass++ : fail++
}

let browser: Browser | null = null
let userId = ''
let fixtureCustId = ''
let fixtureInspId = ''
try {
  // 관리자 시험 계정 (기존 스위트 패턴 — 소유 계정만 만들고 지운다)
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST배지26', role: 'admin', is_active: true, employee_id: 'E2E-B26', email: EMAIL })

  const { data: custs, error: cErr } = await raw.from('customers').select('id').eq('customer_name', '별그리다(추모공원)')
  if (cErr || (custs ?? []).length !== 1) throw new Error(`대상 고객 조회 실패: ${cErr?.message} ${(custs ?? []).length}건`)
  const custId = (custs as Array<{ id: string }>)[0].id

  browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
  page.setDefaultTimeout(30_000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(x => !x.pathname.includes('/login'))
  check('로그인', true)

  await page.goto(`${BASE}/customers/${custId}`)
  await page.click('text=소방계획서')
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  check('1.4 화면 도달', true)

  // 회차 라벨 안내 — 지연 로드라 대기
  const label = page.locator('text=/점검결과\\(○×／\\)는 .*에 기록됩니다/')
  await label.waitFor({ timeout: 15_000 })
  check('회차 라벨 안내 노출', await label.isVisible(), await label.textContent() ?? '')

  // 설치 행 배지 — 별그리다 8종 설치·응답 있는 시트 다수. 배지가 하나 이상 그려져야 한다
  const badges = page.locator('a[title*="점검결과 — "]')
  await badges.first().waitFor({ timeout: 15_000 })
  const n = await badges.count()
  check(`설치 행 결과 배지 ≥ 8 (실제 ${n})`, n >= 8)
  const texts = await badges.allTextContents()
  const dist = { o: 0, x: 0, na: 0, blank: 0 }
  for (const t of texts) { if (t === '○') dist.o++; else if (t === '×') dist.x++; else if (t === '／') dist.na++; else dist.blank++ }
  console.log(`     배지 분포: ○${dist.o} ×${dist.x} ／${dist.na} 미입력${dist.blank}`)
  check('○ 배지 존재 (응답 있는 설치 설비)', dist.o >= 1)
  check('미입력 배지 존재 (별그리다 미분무 — F-1 시트 공백 9종)', dist.blank >= 1)

  // ── 소방계획서_28 S4-2로 계약이 바뀐 자리 ──────────────────────────────────
  // 종전: 배지 클릭 → 이 화면에서 패널을 열어 직접 입력.
  // 현재: 배지는 **결과를 보여주고** 전용 입력 화면의 그 설비로 보낸다(입력구 단일화).
  // 항목 입력 자체의 단언은 test-sheet-entry-page.mts가 덮는다 — 여기선 배선만 본다
  // (링크가 있는가 · 눌러서 도착하는가 · 지목한 설비가 열려 있는가).
  //
  // ⚠ 1.4는 클라이언트 탭 상태라 goBack·재goto로는 복원되지 않는다(둘 다 타임아웃 실측).
  //    그래서 이 화면을 떠나기 **전에** 뒤에서 쓸 링크를 미리 다 걷어둔다.
  const oBadge = badges.filter({ hasText: '○' }).first()
  const href = await oBadge.getAttribute('href')
  const mistBadge = page.locator('[data-testid="form14-result-link-미분무소화설비"]')
  const mistHref = await mistBadge.getAttribute('href')
  const mistLbl = ((await mistBadge.textContent()) ?? '').trim()
  check('배지가 전용 입력 화면 링크', !!href && /\/inspections\/[0-9a-f-]+\/sheet\?facility=/.test(href), href ?? '(href 없음)')
  await oBadge.click()
  await page.waitForURL(/\/inspections\/[0-9a-f-]+\/sheet/, { timeout: 15_000 })
  await page.waitForSelector('text=점검표 입력 —', { timeout: 15_000 })
  check('배지 클릭 → 입력 화면 도달', true, page.url())
  // ?facility=가 서버에서 시트로 해석돼 그 설비가 열려 있어야 한다(매핑 규칙 단일화의 실증)
  const opened = (await page.locator('h2').first().textContent().catch(() => '')) ?? ''
  check('지목한 설비가 열린 상태로 도착', !!opened.trim(), opened.trim())
  // 1.4로 되돌아가지 않는다 — 아래 블록들은 전부 새로 goto한다.

  // 미분무(별그리다 설치) — 148 편입 전엔 '시트 없음'이라 입력 자체가 불가능했다.
  // 종전엔 '패널이 열리는가'로 봤지만 패널이 사라졌으므로, 같은 사실을 **딥링크가 STD-07을 실제로 연다**로 본다.
  // 시트가 없으면 initialSheetId가 null이 되어 우측이 비고 h2가 아예 없다 — 퇴행이 즉시 드러나는 축이다.
  check('미분무 배지 = 미입력 (STD-07 응답 0건)', mistLbl === '미입력', mistLbl || '(배지 없음)')
  check('미입력 배지도 같은 딥링크 계약', !!mistHref && mistHref.includes(encodeURIComponent('미분무소화설비')), mistHref ?? '(href 없음)')
  await page.goto(`${BASE}${mistHref}`)
  await page.waitForSelector('text=점검표 입력 —', { timeout: 15_000 })
  const mistOpened = ((await page.locator('h2').first().textContent({ timeout: 15_000 }).catch(() => '')) ?? '').trim()
  check('148 편입 시트(STD-07)가 실제로 열린다 — 종전엔 시트 없음 안내였다',
    mistOpened === '미분무소화설비', mistOpened || '(열린 시트 없음 = F-1 퇴행)')

  // ── 쓰기 경로 — 전용 픽스처(TEST 고객)에서만. 실고객 데이터에는 쓰지 않는다 ──
  // inspection_type은 enum('종합·최초·기타·작동' — 002/034)이고 '소방안전관리'는 category 축 값이다.
  // 축을 섞으면 조용히 거절당한다 — 기존 test-doc-generation 픽스처와 같은 조합을 쓴다.
  const { data: nc, error: ncErr } = await raw.from('customers')
    .insert({
      customer_code: `TEST-B26-${Math.random().toString(36).slice(2, 8)}`,
      customer_name: 'TEST배지26', inspection_type: '작동',
      inspection_category: '소방안전관리', inspection_sub_type: '작동',
      address: '세종특별자치시 배지로 26',
      is_active: true, created_by: userId, assigned_employee_id: userId,
    })
    .select('id').single()
  if (ncErr || !nc) throw new Error(`픽스처 고객 생성 실패: ${ncErr?.message}`)
  fixtureCustId = nc.id as string
  const { data: nb, error: nbErr } = await raw.from('buildings')
    .insert({ customer_id: fixtureCustId, is_active: true, created_by: userId, building_name: '본관', purpose: '근린생활시설' })
    .select('id').single()
  if (nbErr || !nb) throw new Error(`픽스처 건물 생성 실패: ${nbErr?.message}`)
  await raw.from('fire_facilities').insert([
    { building_id: nb.id, category: '소화설비', facility_code: '옥내소화전설비', installed: true, detail: { note: 'E2E 픽스처' } },
    // 고시 별지4에 점검표가 없는 설비(F-1 잔존 2종의 하나) — 화면이 사실을 안내해야 한다
    { building_id: nb.id, category: '소화설비', facility_code: '고체에어로졸소화설비', installed: true, detail: { note: 'E2E 픽스처' } },
    // F-1f 전용 시트 분리 — 할론은 150 편입 STD-10을 열어야 한다(묶음 할로겐 시트가 아니라)
    { building_id: nb.id, category: '소화설비', facility_code: '할론소화설비', installed: true, detail: { note: 'E2E 픽스처' } },
  ])
  const { data: ni, error: niErr } = await raw.from('inspections').insert({
    customer_id: fixtureCustId, inspection_type: '작동', sequence_num: 1,
    plan_type: 'special_작동', inspection_start_date: new Date().toISOString().slice(0, 10),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (niErr || !ni) throw new Error(`픽스처 점검 생성 실패: ${niErr?.message}`)
  fixtureInspId = ni.id as string

  // ── 픽스처 — 여기서 보는 것은 **1.4가 만든 링크가 옳은 시트로 보내는가**뿐이다.
  //    쓰기(일괄 ○ · 항목 ✕ · 불량내역 자동 등록)는 신규 test-sheet-entry-page.mts가 덮으므로
  //    여기서 중복 단언하지 않는다(입력구가 하나가 된 이상 두 스위트가 같은 것을 볼 이유가 없다).
  await page.goto(`${BASE}/customers/${fixtureCustId}`)
  await page.click('text=소방계획서')
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  const hydBadge = page.locator('[data-testid="form14-result-link-옥내소화전설비"]')
  await hydBadge.waitFor({ timeout: 15_000 })
  check('픽스처: 옥내소화전 배지 = 미입력', ((await hydBadge.textContent()) ?? '').trim() === '미입력')
  // 떠나기 전에 나머지 링크를 미리 걷는다 — 1.4는 클라이언트 탭 상태라 되돌아올 수 없다
  const aeroHref = await page.locator('[data-testid="form14-result-link-고체에어로졸소화설비"]').getAttribute('href')
  const hallonHref = await page.locator('[data-testid="form14-result-link-할론소화설비"]').getAttribute('href')

  await hydBadge.click()
  await page.waitForURL(/\/inspections\/[0-9a-f-]+\/sheet/, { timeout: 15_000 })
  await page.waitForSelector('text=점검표 입력 —', { timeout: 15_000 })
  const hydOpened = ((await page.locator('h2').first().textContent({ timeout: 15_000 }).catch(() => '')) ?? '').trim()
  check('픽스처: 배지 클릭 → 옥내소화전 시트가 열린 채 도착', hydOpened === '옥내소화전설비', hydOpened || '(열린 시트 없음)')
  // 뒤로가기 복귀(?from=) — 1.4에서 왔으면 1.4로 돌아가야 한다(종전엔 점검 상세로 떨어졌다, 2026-08-28)
  const backHref = await page.locator('[data-testid="sheet-entry-back"]').getAttribute('href')
  check('픽스처: 뒤로가기 = 1.4 소방시설로 복귀', backHref === `/customers/${fixtureCustId}?tab=plan&form=1.4`,
    backHref ?? '(back 링크 없음)')

  // F-1 잔존 2종 — 고체에어로졸은 고시 별지4에 점검표가 없다(시트를 만들 근거가 없다).
  // 종전엔 패널이 '시트 없음'을 안내했다. 패널이 사라진 지금의 등가 축은
  // ①딥링크가 **아무 시트도 열지 않는다**(거짓 입력 경로 없음) ②좌 목록이 그 사실을 고지한다.
  check('고체에어로졸 배지도 같은 딥링크 계약',
    !!aeroHref && aeroHref.includes(encodeURIComponent('고체에어로졸소화설비')), aeroHref ?? '(href 없음)')
  await page.goto(`${BASE}${aeroHref}`)
  await page.waitForSelector('text=점검표 입력 —', { timeout: 15_000 })
  check('F-1 잔존 설비(고체에어로졸) — 여는 시트가 없다(거짓 입력 경로 없음)',
    (await page.locator('h2').count()) === 0)
  check('F-1 잔존 설비 — 「덮는 점검표 없음」으로 사실 고지 유지',
    (await page.isVisible('text=덮는 점검표 없음')) && (await page.isVisible('text=고체에어로졸소화설비')))

  // ── F-1f 무퇴행(이 스위트의 핵심) — 할론은 **전용 시트 STD-10**을 열어야 한다.
  //    150 적용 전엔 '시트 없음'이었고, 이중 귀속 분리 전엔 묶음 시트(STD-11 할로겐화합물 및
  //    불활성기체소화설비)가 열렸을 자리다. 패널이 사라져도 '어느 시트가 열리는가'라는 축은 그대로
  //    살아 있다 — 우측 제목(h2)이 곧 열린 시트명이다.
  await page.goto(`${BASE}${hallonHref}`)
  await page.waitForSelector('text=점검표 입력 —', { timeout: 15_000 })
  const hallonOpened = ((await page.locator('h2').first().textContent({ timeout: 15_000 }).catch(() => '')) ?? '').trim()
  check('F-1f: 할론 딥링크가 전용 시트 「할론소화설비」를 연다', hallonOpened === '할론소화설비',
    hallonOpened || '(열린 시트 없음 = 150 미적용 퇴행)')
  check('F-1f: 묶음 할로겐 시트가 아니다', !!hallonOpened && !hallonOpened.includes('할로겐'), hallonOpened)
  // 전용 귀속이면 형제 설비 고지가 붙지 않는다 — 묶음 시트였다면
  // '이 점검표는 ☑A · ☐B의 결과에 함께 반영됩니다'가 떴을 자리다(이중 귀속 재발의 조기 경보).
  check('F-1f: 형제 설비 고지 없음 — 할론은 단독 귀속',
    (await page.locator('text=결과에 함께 반영됩니다').count()) === 0)

  // 건물 전환 — 배지는 **선택한 건물의 설치 설비**에 매인다. 종전엔 패널이 열린 채 남아 새 건물에
  // 없는 설비를 그 자리에서 기록할 수 있었다(독립 검증 지적, 2026-08-21). 입력이 전용 화면으로
  // 빠진 지금의 등가 축은 '배지 집합이 건물 전환을 따라가는가'다 — 설비 0종인 별관엔 배지가 없어야 한다.
  await raw.from('buildings').insert({
    customer_id: fixtureCustId, is_active: true, created_by: userId, building_name: '별관', purpose: '근린생활시설',
  })
  await page.goto(`${BASE}/customers/${fixtureCustId}`)
  await page.click('text=소방계획서')
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  // 화면에 select가 여럿이라(담당자 등) 건물 셀렉트만 특정한다. 설비가 있는 '본관'을 먼저 고른다 —
  // 새 건물이 첫 항목으로 잡히면 설치 0이라 배지 자체가 없다.
  const bldSel = page.locator('select').filter({ has: page.locator('option', { hasText: '본관' }) }).first()
  await bldSel.selectOption({ label: '본관' })
  await page.locator('a[title*="점검결과 — "]').first().waitFor({ timeout: 15_000 })
  const mainBadges = await page.locator('a[title*="점검결과 — "]').count()
  await bldSel.selectOption({ label: '별관' })
  await page.waitForFunction(
    () => document.querySelectorAll('a[title*="점검결과 — "]').length === 0,
    undefined, { timeout: 10_000 },
  ).catch(() => {})
  check(`건물 전환 시 배지가 그 건물 설비만 따라간다 (본관 ${mainBadges}종 → 별관 0종)`,
    (await page.locator('a[title*="점검결과 — "]').count()) === 0)

  // ── F-1f 무퇴행 — 서림사(할론 단독 설치, 응답은 2026 완료 회차의 묶음 할로겐 시트 27건뿐).
  //    ⚠ 서림사는 진행 중 회차가 없어 **설계상 입력 배지를 그리지 않는다**(resultBadge 규약) —
  //    배지를 기다리면 soban24의 '없는 DOM 대기' 오검이 된다. 무퇴행은 실데이터를 실코드
  //    (foldSheetResult·rollUpForm3Results — 문서·배지가 쓰는 그 함수)로 굴려 단언하고,
  //    UI는 '입력 배지 없음 + 사유 안내'라는 설계 사실을 단언한다.
  {
    const { foldSheetResult, rollUpForm3Results } = await import('../src/lib/sheet-facility-map.ts')
    const { ALL_STANDARD_CODES } = await import('../src/lib/facility-codes.ts')
    const { data: sr } = await raw.from('customers').select('id').eq('customer_name', '서림사')
    const srId = ((sr ?? []) as Array<{ id: string }>)[0]?.id
    if (!srId) throw new Error('서림사 고객 없음')
    const { data: srInsp } = await raw.from('inspections').select('id').eq('customer_id', srId)
    const { data: srResp } = await raw.from('inspection_sheet_responses')
      .select('item_code, result').eq('inspection_id', ((srInsp ?? []) as Array<{ id: string }>)[0].id)
    const rrows = (srResp ?? []) as Array<{ item_code: string; result: string }>
    const { data: srItems } = await raw.from('inspection_sheet_items')
      .select('item_code, sheet_id').in('item_code', [...new Set(rrows.map(r => r.item_code))])
    const { data: srSheets } = await raw.from('inspection_sheets').select('id, sheet_name')
      .in('id', [...new Set(((srItems ?? []) as Array<{ sheet_id: string }>).map(i => i.sheet_id))])
    const shName = new Map(((srSheets ?? []) as Array<{ id: string; sheet_name: string }>).map(s => [s.id, s.sheet_name]))
    const shOf = new Map(((srItems ?? []) as Array<{ item_code: string; sheet_id: string }>)
      .map(i => [i.item_code, shName.get(i.sheet_id)!]))
    const stats = new Map<string, ReturnType<typeof foldSheetResult>>()
    for (const r of rrows) {
      const sh = shOf.get(r.item_code)
      if (sh) stats.set(sh, foldSheetResult(stats.get(sh), r.result))
    }
    const { data: srBld } = await raw.from('buildings').select('id').eq('customer_id', srId).eq('is_active', true)
    const { data: srFac } = await raw.from('fire_facilities').select('facility_code')
      .in('building_id', ((srBld ?? []) as Array<{ id: string }>).map(b => b.id)).eq('installed', true)
    const installedSr = ((srFac ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code)
    const { resultMarks } = rollUpForm3Results(stats, ALL_STANDARD_CODES, installedSr)
    // 서림사 할로겐 시트 27건은 실측 **전부 N(해당없음)** — 분리 전에도 이 칸은 ／였다.
    // 퇴행의 방향은 '공란'(레거시 간선이 끊겨 귀속 자체가 사라짐 — 설치+무응답)이다.
    // 그래서 단언은 'N 유지'(키 존재 = 귀속 유지)이지 ○가 아니다 — ○ 가정은 데이터 미확인 오검이었다.
    check('F-1f 무퇴행: 서림사 실데이터 롤업 — 할론 ／ 유지(귀속 유지, 공란 아님)',
      resultMarks['할론소화설비'] === 'N', `실제 ${JSON.stringify(resultMarks['할론소화설비'] ?? '(공란=퇴행)')}`)

    await page.goto(`${BASE}/customers/${srId}`)
    await page.click('text=소방계획서')
    await page.click('button:has-text("1.4 소방시설")')
    await page.waitForSelector('text=서식 1.4 소방시설 현황')
    await page.waitForSelector('text=/진행 중인 자체점검 회차가 없/', { timeout: 15_000 })
    check('F-1f: 서림사는 진행 중 회차 없음 — 입력 배지 미렌더 + 사유 안내(설계 사실)',
      (await page.locator('a[title*="점검결과 — "]').count()) === 0)
  }

  await page.screenshot({ path: 'scripts/_shots/form14-result-badge.png', fullPage: false })
  console.log('  (스크린샷: scripts/_shots/form14-result-badge.png)')
} catch (e) {
  console.log(`❌ 중단: ${e instanceof Error ? e.message : e}`)
  fail++
} finally {
  if (browser) await browser.close()
  // 픽스처 정리 — 실패해도 이름이 TEST라 cleanup-test-leftovers가 다음 회귀에서 걷는다
  if (fixtureInspId) {
    await raw.from('inspection_defects').delete().eq('inspection_id', fixtureInspId)
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', fixtureInspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', fixtureInspId)
    await raw.from('inspections').delete().eq('id', fixtureInspId)
  }
  if (fixtureCustId) {
    const { data: bs } = await raw.from('buildings').select('id').eq('customer_id', fixtureCustId)
    for (const b of ((bs ?? []) as Array<{ id: string }>)) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', fixtureCustId)
    await raw.from('customers').delete().eq('id', fixtureCustId)
  }
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId).catch(() => {}) }
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
