// 소방계획서_20 S4 프로브 — 점검표 자동 저장 + 빠른 입력 + 지난 회차 복사(안전장치 포함)
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, PW } from './_e2e-helpers.mjs'

const EMAIL = `annex-autosave-${Date.now().toString(36)}@test.local`
const CUR = new Date().getFullYear()
const INSTALLED = '소화기구 및 자동소화장치'
let userId, customerId, curInsp, prevInsp, browser

try {
  userId = await mkUser({ email: EMAIL, name: '자동저장프로브', employeeId: `E2E-AS-${Date.now().toString(36)}` })
  customerId = await mkCustomer({ customer_name: '자동저장프로브사', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert({
    building_id: bld.id, category: '소화설비', facility_code: INSTALLED, installed: true,
  })

  // 지난 완료 회차(작년) + 이번 진행 회차(올해)
  for (const [year, status, ref] of [[CUR - 1, 'completed', 'prev'], [CUR, 'in_progress', 'cur']]) {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: customerId, sequence_num: 1, inspection_type: '작동', plan_type: 'special_작동',
      status, inspection_start_date: `${year}-03-05`,
      ...(status === 'completed' ? { inspection_end_date: `${year}-03-06` } : {}),
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    if (ref === 'prev') prevInsp = data.id; else curInsp = data.id
  }

  // 소화기구 시트 작동 범위 항목
  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id').eq('version', 'v2025').ilike('sheet_name', `%${INSTALLED.slice(0, 4)}%`).limit(1).maybeSingle()
  if (!sheet) throw new Error('소화기구 시트를 찾지 못했습니다')
  const { data: itemRaw } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', sheet.id).order('order_num')
  const codes = (itemRaw ?? []).filter(i => !i.comprehensive_only).map(i => i.item_code)
  check('시드 — 작동 범위 항목 3개 이상', codes.length >= 3, `${codes.length}개`)

  // 지난 회차 응답 시드 — O 2건 + X 1건(복사 안전장치 확인용)
  await raw.from('inspection_sheet_responses').insert([
    { inspection_id: prevInsp, item_code: codes[0], result: 'O' },
    { inspection_id: prevInsp, item_code: codes[1], result: 'X', memo: '지난 회차 불량' },
    { inspection_id: prevInsp, item_code: codes[2], result: 'O' },
  ])

  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(60000)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 60000 })
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=annex`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${CUR}년 1차`)

  // ── 1) 자동 저장 — 연속 3입력이 한 번의 저장으로 묶이는가 ──
  await page.locator(`button:has-text("${INSTALLED}")`).first().click()
  await page.waitForSelector('button:text-is("○")', { timeout: 30000 })
  const oBtns = page.locator('button:text-is("○")')
  for (let i = 0; i < 3; i++) await oBtns.nth(i).click()       // 디바운스 안에서 3연타
  await page.waitForSelector('text=✓ 저장됨', { timeout: 30000 })
  check('자동 저장 — [이 설비 저장] 없이 저장됨 칩', true)
  check('자동 저장 — 저장 버튼 미노출', (await page.locator('button:has-text("이 설비 저장")').count()) === 0)

  const { data: saved } = await raw.from('inspection_sheet_responses')
    .select('item_code, result, updated_at').eq('inspection_id', curInsp)
  check('자동 저장 — 3건 저장', (saved ?? []).length === 3, JSON.stringify((saved ?? []).map(r => r.item_code)))
  // 한 번의 upsert면 updated_at이 사실상 동일하다(서버가 같은 타임스탬프를 찍음)
  const stamps = new Set((saved ?? []).map(r => r.updated_at))
  check('자동 저장 — 1회 배치로 묶임(updated_at 동일)', stamps.size === 1, `${stamps.size}종 ${[...stamps].join(',')}`)

  // ── 2) 지난 회차 결과 불러오기 — 안전장치 ──
  page.once('dialog', d => d.accept())
  await page.click('button:has-text("지난 회차 결과 불러오기")')
  await page.waitForSelector('text=에서', { timeout: 30000 })
  const noticeText = await page.locator('text=불러왔습니다').first().innerText().catch(() => '')
  check('복사 — 완료 안내 표시', noticeText.includes('불러왔습니다'), noticeText)

  const { data: afterCopy } = await raw.from('inspection_sheet_responses')
    .select('item_code, result, memo').eq('inspection_id', curInsp)
  const byCode = Object.fromEntries((afterCopy ?? []).map(r => [r.item_code, r]))
  // codes[0..2]는 이미 이번 회차에 O로 입력돼 있었다 — 지난 회차의 X가 덮어쓰면 안 된다
  check('복사 — 이번 회차 기존 입력 보존(X로 덮어쓰지 않음)', byCode[codes[1]]?.result === 'O',
    JSON.stringify(byCode[codes[1]]))
  const { data: defects } = await raw.from('inspection_defects').select('id').eq('inspection_id', curInsp)
  check('복사 — 불량내역 자동 등록 안 함(현장 확인 후 수동)', (defects ?? []).length === 0, `${(defects ?? []).length}건`)
  const { data: logs } = await raw.from('activity_logs')
    .select('action, metadata').eq('entity_id', curInsp).eq('action', 'sheet_copy_previous')
  check('복사 — 감사 로그 기록', (logs ?? []).length === 1, JSON.stringify(logs))
  // S4-10②: 검토 유도 — 복사 후 시트가 자동으로 펼쳐져야 한다(안내 문구 + 실제 항목 노출)
  check('복사 — 검토하도록 시트 자동 펼침(안내)', noticeText.includes('펼쳤습니다'), noticeText)
  check('복사 — 자동 펼침으로 항목 노출', (await page.locator('button:text-is("○")').count()) > 0)

  // ── 3) 전체 양호 — 미입력만 채우고 기존 유지 ──
  const beforeBulk = (afterCopy ?? []).length
  page.once('dialog', d => d.accept())
  await page.click('button:has-text("설치 설비 전체 양호")')
  await page.waitForSelector('text=○로 채웠습니다', { timeout: 30000 })
  const { data: afterBulk } = await raw.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', curInsp)
  check('전체 양호 — 항목이 늘어남', (afterBulk ?? []).length > beforeBulk, `${beforeBulk} → ${(afterBulk ?? []).length}`)
  check('전체 양호 — 기존 입력 유지', (afterBulk ?? []).filter(r => r.item_code === codes[0])[0]?.result === 'O')

  // ── 4) 터치 버튼 크기(S4-8) — 40px 이상 ──
  const box = await page.locator('button:text-is("○")').first().boundingBox()
  check('터치 버튼 40px 이상', (box?.height ?? 0) >= 38, `${Math.round(box?.height ?? 0)}px`)
} catch (e) {
  check('프로브 실행', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const iid of [curInsp, prevInsp]) {
    if (!iid) continue
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', iid)
    await raw.from('inspection_defects').delete().eq('inspection_id', iid)
    await raw.from('activity_logs').delete().eq('entity_id', iid)
  }
  await cleanupCustomer(customerId)
  await delUser(userId)
  summary()
}
