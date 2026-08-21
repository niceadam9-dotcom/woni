/** 소방계획서_26 S4 라이브 검증 — 1.4 설비 행 결과 배지 + 입력 패널 (읽기 전용 E2E).
 *
 *  대상: 별그리다(추모공원) — 진행 중(in_progress) 자체점검 회차 + 설치 8종 + '전부 ／' 시트 보유라
 *  배지 4상태(○/×/／/미입력)와 회차 라벨을 실데이터로 한 번에 볼 수 있다.
 *  쓰기 버튼(○/✕/／·일괄)은 누르지 않는다 — 배선 검증이지 데이터 생성이 아니다.
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
  const badges = page.locator('button[title*="점검결과 — "]')
  await badges.first().waitFor({ timeout: 15_000 })
  const n = await badges.count()
  check(`설치 행 결과 배지 ≥ 8 (실제 ${n})`, n >= 8)
  const texts = await badges.allTextContents()
  const dist = { o: 0, x: 0, na: 0, blank: 0 }
  for (const t of texts) { if (t === '○') dist.o++; else if (t === '×') dist.x++; else if (t === '／') dist.na++; else dist.blank++ }
  console.log(`     배지 분포: ○${dist.o} ×${dist.x} ／${dist.na} 미입력${dist.blank}`)
  check('○ 배지 존재 (응답 있는 설치 설비)', dist.o >= 1)
  check('미입력 배지 존재 (별그리다 미분무 — F-1 시트 공백 9종)', dist.blank >= 1)

  // 패널 A — ○ 배지: 항목 목록·일괄 버튼이 펼쳐진다 (쓰기는 안 한다)
  await badges.filter({ hasText: '○' }).first().click()
  await page.waitForSelector('text=/『.*』 · .*에 기록/')
  check('패널 열림 + 시트·회차 표기', true)
  const goodBtn = page.locator('button:has-text("전부 ○")')
  const naBtn = page.locator('button:has-text("전부 ／")')
  check('일괄 ○·／ 버튼 노출', await goodBtn.isVisible() && await naBtn.isVisible())
  // 항목 목록은 loadSheetEditorAction 지연 로드 — 첫 ✕ 버튼이 그려질 때까지 기다린 뒤 센다
  await page.waitForSelector('button:text-is("✕")', { timeout: 15_000 })
  const rows = page.locator('button:text-is("✕")')
  check(`항목별 ✕ 버튼 ≥ 1 (항목 목록이 펼쳐져 보인다 — Q-1 하이브리드)`, await rows.count() >= 1)
  await page.click('button:has-text("닫기")')
  check('패널 닫힘', !(await page.isVisible('text=/『.*』 · .*에 기록/')))

  // 패널 B — 별그리다 미분무: 148 편입 전엔 '시트 없음' 안내였다. 이제 STD-07이 있으므로
  // **진짜 패널이 열려야** 한다 — F-1 해소의 라이브 증거.
  await badges.filter({ hasText: '미입력' }).first().click()
  await page.waitForSelector('text=/『미분무소화설비』 · .*에 기록/')
  check('148 편입 시트 패널 열림 (미분무 — 종전엔 시트 없음 안내였다)', true)
  await page.waitForSelector('button:text-is("✕")', { timeout: 15_000 })
  // 원문 61항목 중 ● 종합전용 27건은 작동점검 회차에서 isItemInScope로 제외된다(의도) —
  // 종합 회차면 61, 작동 회차면 34. 그 외 값이면 시딩·범위 필터 어느 쪽이 틀린 것.
  const mist = await page.locator('button:text-is("✕")').count()
  check(`미분무 항목 목록 전개 — 61(종합) 또는 34(작동), 실제 ${mist}`, mist === 61 || mist === 34)
  await page.click('button:has-text("닫기")')

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
    // 고시 별지4에 점검표가 없는 설비(F-1 잔존 2종의 하나) — 패널이 사실을 안내해야 한다
    { building_id: nb.id, category: '소화설비', facility_code: '고체에어로졸소화설비', installed: true, detail: { note: 'E2E 픽스처' } },
  ])
  const { data: ni, error: niErr } = await raw.from('inspections').insert({
    customer_id: fixtureCustId, inspection_type: '작동', sequence_num: 1,
    plan_type: 'special_작동', inspection_start_date: new Date().toISOString().slice(0, 10),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (niErr || !ni) throw new Error(`픽스처 점검 생성 실패: ${niErr?.message}`)
  fixtureInspId = ni.id as string

  // 확인창·프롬프트 자동 응답 — confirm은 승인, prompt(불량 메모)는 문구 입력
  page.on('dialog', d => { void (d.type() === 'prompt' ? d.accept('E2E 불량 메모') : d.accept()) })

  await page.goto(`${BASE}/customers/${fixtureCustId}`)
  await page.click('text=소방계획서')
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  const fxBadge = page.locator('button[title*="점검결과 — "]')
  await fxBadge.first().waitFor({ timeout: 15_000 })
  check('픽스처: 옥내소화전 배지 = 미입력', (await fxBadge.first().textContent()) === '미입력')

  await fxBadge.first().click()
  await page.waitForSelector('text=/『.*』 · \\d{4}년 1차에 기록/')
  await page.waitForSelector('button:text-is("✕")', { timeout: 15_000 })
  // 일괄 ○ — 신규 bulkSheetGoodAction 실주행
  await page.locator('button:has-text("전부 ○")').first().click()
  await page.waitForSelector('text=/○ \\d+건 기록/', { timeout: 15_000 })
  check('일괄 ○ 기록 응답', true)
  await page.waitForFunction(() => {
    const b = document.querySelector('button[title*="점검결과 — "]')
    return b?.textContent === '○'
  }, undefined, { timeout: 15_000 })
  check('배지 미입력 → ○ 전환 (overview 재수렴)', true)
  // DB 검증 — 미입력만 O로, month=0
  const { data: respRows } = await raw.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', fixtureInspId)
  const rr = (respRows ?? []) as Array<{ item_code: string; result: string }>
  check(`DB: 응답 ${rr.length}건 전부 O`, rr.length > 0 && rr.every(r => r.result === 'O'))

  // 항목 ✕ — 저장 + 불량내역 자동 등록 체인
  await page.locator('button:text-is("✕")').first().click()
  await page.waitForFunction(() => {
    const b = document.querySelector('button[title*="점검결과 — "]')
    return b?.textContent === '×'
  }, undefined, { timeout: 15_000 })
  check('항목 ✕ → 배지 × 전환', true)
  const { data: defRows } = await raw.from('inspection_defects')
    .select('id').eq('inspection_id', fixtureInspId)
  check(`불량내역 자동 등록 ${((defRows ?? []) as unknown[]).length}건 ≥ 1 (별지 10호 원천)`, ((defRows ?? []) as unknown[]).length >= 1)

  // F-1 잔존 2종 — 고체에어로졸은 고시 별지4에 점검표가 없다. 거짓 입력 경로 대신 사실 안내가 떠야 한다
  await page.locator('td:has-text("고체에어로졸소화설비") button[title*="점검결과"]').click()
  await page.waitForSelector('text=점검표 시트가 카탈로그에 없어')
  check('F-1 잔존 설비(고체에어로졸) — 시트 없음 안내 유지', true)
  await page.click('button:has-text("닫기")')

  // 건물 전환 — 패널은 그 건물 설치 설비에 매여 있다. 안 닫으면 새 건물에 없는 설비의 항목 목록이
  // 그대로 떠 있고 거기서 기록까지 된다(독립 검증 지적, 2026-08-21).
  await raw.from('buildings').insert({
    customer_id: fixtureCustId, is_active: true, created_by: userId, building_name: '별관', purpose: '근린생활시설',
  })
  await page.reload()
  // 탭 선택은 클라이언트 상태 — reload 후 기본 탭으로 돌아가므로 다시 들어간다
  await page.click('text=소방계획서')
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  // 화면에 select가 여럿이라(담당자 등) 건물 셀렉트만 특정한다. 설비가 있는 '본관'을 먼저 고른다 —
  // 새 건물이 첫 항목으로 잡히면 설치 0이라 배지 자체가 없다.
  const bldSel = page.locator('select').filter({ has: page.locator('option', { hasText: '본관' }) }).first()
  await bldSel.selectOption({ label: '본관' })
  await page.locator('button[title*="점검결과 — "]').first().waitFor({ timeout: 15_000 })
  await page.locator('button[title*="점검결과 — "]').first().click()
  await page.waitForSelector('text=/『.*』 · \\d{4}년 1차에 기록/')
  await bldSel.selectOption({ label: '별관' })
  await page.waitForTimeout(500)
  check('건물 전환 시 결과 패널이 닫힌다 (이전 건물 설비의 입력창 잔류 금지)',
    !(await page.isVisible('text=/『.*』 · \\d{4}년 1차에 기록/')))

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
