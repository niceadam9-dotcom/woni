/** [독립 재판정 3회차 2026-08-12] EX-4 항목⑥ — RSC 갱신 시 '월 축이 접힌 responses'가 편집기를 덮어쓰는가
 *  실행: node scripts/_judge-ex4-refresh.mjs   (dev :3000 + 스테이징 DB)
 *
 *  발단: _judge-ex4-render.mjs ⑥ 절이 재실행마다 **다른 체크**에서 깨졌다(1회차 X1-01@5월 오초기화 /
 *  2회차 7월·3월 전환 오초기화). 고정 대기 문제가 아니라 원인 후보가 코드에 있다:
 *   - page.tsx:112-118 responses = 이 점검의 **모든 달** 응답을 item_code로 접은 맵(마지막 달이 이김)
 *   - inspection-sheet-client.tsx:133-141 useEffect([responses]) — 편집기가 열려 있고 dirty가 아니면
 *     이 **월 무관 맵**으로 local을 재초기화한다 (외관은 open()에서 loadExteriorMonthResponsesAction으로
 *     그 달만 불러오는데, 갱신 한 번이면 다른 달 값으로 되돌아간다)
 *   - use-sheet-responses-realtime.ts — 원격 INSERT/UPDATE(그 건) 또는 **아무 건의 DELETE**가 오면
 *     dirty가 아닐 때 router.refresh() → responses prop 교체 → 위 useEffect 발화
 *  본 프로브는 이 경로를 **의도적으로** 발화시켜 재현 여부와 DB 오염까지 확인한다.
 *  정리: finally 전 시드 삭제 + 잔존 재조회.
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'
import { findActionId, collectScripts } from './_judge19-action.mjs'

const EMAIL = 'judge-ex4rf@erp-test.com'
let userId = '', cid = '', bid = '', iid = '', browser = null

const rowsOf = async () => {
  const { data } = await raw.from('inspection_sheet_responses')
    .select('item_code, month, result').eq('inspection_id', iid).order('item_code').order('month')
  return data ?? []
}

try {
  userId = await mkUser({ email: EMAIL, name: '재판정EX4갱신', employeeId: 'JUDGE-EX4RF' })
  const Y = new Date(Date.now() + 9 * 3600_000).getFullYear()
  cid = await mkCustomer({ customer_name: 'JUDGEEX4RF외관', address: '경기 양평군 재판정로 11', created_by: userId, fire_station: '양평소방서' })
  const { data: b, error: be } = await raw.from('buildings').insert({
    customer_id: cid, building_name: '본관', is_active: true, created_by: userId, purpose: '근린생활시설',
  }).select('id').single()
  if (be) throw new Error(`건물 생성 실패: ${be.message}`)
  bid = b.id
  await raw.from('fire_facilities').insert({
    building_id: bid, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })
  const { data: i, error: ie } = await raw.from('inspections').insert({
    customer_id: cid, inspection_type: '작동', sequence_num: 1, plan_type: 'monthly',
    inspection_start_date: `${Y}-05-14`, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (ie) throw new Error(`점검 생성 실패: ${ie.message}`)
  iid = i.id
  // 3월분만 존재 — 9월 편집기에는 절대 보이면 안 되는 값들
  await raw.from('inspection_sheet_responses').insert([
    { inspection_id: iid, item_code: 'X1-01', result: 'O', month: 3, updated_by: userId },
    { inspection_id: iid, item_code: 'X1-02', result: 'X', month: 3, updated_by: userId },
  ])
  console.log(`[시드] 점검=${iid.slice(0, 8)} — X1-01 ○@3월 · X1-02 ✕@3월만 존재`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(180000)
  page.on('dialog', d => d.accept().catch(() => {}))
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${iid}`)
  await page.waitForSelector('text=점검표 입력')

  const monthSel = page.locator('select').filter({ has: page.locator('option', { hasText: '점검일 기준(기본)' }) }).first()
  const sheetBtn = page.locator('button', { hasText: '소화기구' }).first()
  const saveBtn = page.locator('div.flex.gap-2.mt-3 button', { hasText: '저장' })
  const waitReady = () => page.waitForFunction(() => {
    const b = [...document.querySelectorAll('div.flex.gap-2.mt-3 button')].find(x => (x.innerText || '').includes('저장'))
    return !!b && !b.disabled
  }, null, { timeout: 120000 })
  const clsOf = (label) => page.locator(`[aria-label="${label}"]`).getAttribute('class')
  const selectedOf = async () => await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label]')]
      .filter(e => /bg-(green|red|gray)-500/.test(e.className))
      .map(e => e.getAttribute('aria-label')))

  // ── 9월 편집기 = 빈 상태여야 한다 ──
  await monthSel.selectOption('9')
  await sheetBtn.click()
  await page.waitForSelector('[aria-label="X1-01 O"]')
  await waitReady()
  const sel0 = await selectedOf()
  check('R-1 9월 편집기 초기 상태 = 선택된 항목 0개(3월분 안 보임)', sel0.length === 0, JSON.stringify(sel0))

  const clobbered = (ms) => page.waitForFunction(() => {
    const b = document.querySelector('[aria-label="X1-01 O"]')
    return !!b && /bg-green-500/.test(b.className)
  }, null, { timeout: ms }).then(() => true).catch(() => false)

  // ── 트리거 ①: 원격 변경(Realtime) → router.refresh() ──
  console.log('— 트리거① 원격 INSERT(X5-01 ○@2월, updated_by=null)')
  await raw.from('inspection_sheet_responses').insert(
    { inspection_id: iid, item_code: 'X5-01', result: 'O', month: 2 })   // updated_by 없음 = 원격 취급
  let clob = await clobbered(15000)
  if (!clob) {
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
    clob = await clobbered(15000)
  }
  console.log(`  트리거① 결과: ${clob ? '덮어씀' : '변화 없음(스테이징 Realtime 미전달로 보임)'}`)

  // ── 트리거 ②: **같은 화면의 형제 카드**가 revalidatePath 액션을 호출 (사용자 실경로) ──
  //    음성 카드 [확정 저장] → applyVoiceSheetAction → revalidatePath → RSC 재렌더 →
  //    page.tsx의 월 무관 responses가 새 prop으로 내려온다. 편집기는 열린 채·dirty 아님.
  //    (AI 구조화 단계만 스텁 — 잔액 부족. 저장 이후는 전부 실제 코드)
  if (!clob) {
    console.log('— 트리거② 음성 카드 [확정 저장](형제 액션 + revalidatePath)')
    const pid = await findActionId(page, 'parseVoiceSheetAction', scriptUrls)
    check('R-2a parseVoiceSheetAction 액션 id 확보(스텁 대상)', !!pid, String(pid))
    await page.route('**/*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.headers()['next-action'] === pid) {
        await route.fulfill({
          status: 200, contentType: 'text/x-component',
          body: '0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:'
            + JSON.stringify({ entries: [{ item_code: 'X5-02', result: 'O', memo: '', sheet_name: '자탐', item_name: '상용전원', conflict: false }], missingSheets: [] }) + '\n',
        })
        return
      }
      await route.continue()
    })
    await page.locator('textarea[placeholder*="발화 규칙"]').fill('자탐 상용전원 정상')
    await page.locator('button', { hasText: 'AI 구조화' }).click()
    await page.locator('button', { hasText: '확정 저장' }).waitFor({ state: 'visible', timeout: 120000 })
    await page.locator('button', { hasText: '확정 저장' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('건 저장됨'), null, { timeout: 120000 })
    clob = await clobbered(20000)
    console.log(`  트리거② 결과: ${clob ? '덮어씀' : '변화 없음'}`)
  }
  const sel1 = await selectedOf()
  console.log(`  [실측] 갱신 후 선택 표시 항목: ${JSON.stringify(sel1)}`)
  check('R-2 [결함 후보] 갱신 후에도 9월 편집기에 3월분이 주입되지 않는다',
    !clob && sel1.length === 0, `X1-01 O class=${await clsOf('X1-01 O')} / 선택=${JSON.stringify(sel1)}`)

  // ── 그 상태에서 [저장]을 누르면 DB가 오염되는가 ──
  if (clob) {
    await saveBtn.first().click()
    // 편집기가 닫힐 때까지(save() 성공 신호) 기다린 뒤, 3월 항목이 9월로 복제됐는지 폴링
    await page.waitForFunction(() => !document.querySelector('[aria-label="X1-01 O"]'), null, { timeout: 60000 }).catch(() => {})
    await pollDb(async () => {
      const r = await rowsOf()
      return r.some(x => x.month === 9 && x.item_code === 'X1-01') ? r : null
    }, 30000)
    const after = await rowsOf()
    console.log(`  [실측] 저장 후 행: ${JSON.stringify(after.map(r => `${r.item_code}:${r.month}:${r.result}`))}`)
    check('R-3 [결함 후보] 9월 저장이 3월 값을 9월로 복제하지 않는다',
      !after.some(r => r.month === 9 && ['X1-01', 'X1-02'].includes(r.item_code)),
      JSON.stringify(after.filter(r => r.month === 9)))
    check('R-3 3월 원본은 유지', after.filter(r => r.month === 3).length === 2,
      JSON.stringify(after.filter(r => r.month === 3)))
  } else {
    check('R-3 (R-2 통과로 저장 오염 검증 불필요)', true)
    check('R-3 3월 원본 유지', (await rowsOf()).filter(r => r.month === 3).length === 2)
  }
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 800))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (iid) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', iid)
    await raw.from('inspection_defects').delete().eq('inspection_id', iid)
    await raw.from('inspections').delete().eq('id', iid)
  }
  if (cid) {
    if (bid) await raw.from('fire_facilities').delete().eq('building_id', bid)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await raw.from('fire_plan_forms').delete().eq('customer_id', cid)
    await cleanupCustomer(cid).catch(e => console.error('고객 정리 실패:', e.message))
  }
  await delUser(userId)
  const { data: lc } = await raw.from('customers').select('id').like('customer_name', 'JUDGEEX4RF%')
  const { data: xr } = await raw.from('inspection_sheet_responses').select('id').like('item_code', 'X%')
  const { data: allr } = await raw.from('inspection_sheet_responses').select('id')
  console.log(`[정리 확인] 고객 잔존 ${(lc ?? []).length} / 외관응답 ${(xr ?? []).length}행(기준 26) / 전체 ${(allr ?? []).length}행(기준 170)`)
  summary()
}
