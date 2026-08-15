/** [독립 판정] EX-4 항목⑥ — 점검 월 선택기 UI 실조작 진단/판정 (dev :3000 + 스테이징 DB)
 *  실행: node scripts/_judge-ex4-ui.mjs
 *  _judge-ex4-render.mjs의 UI 절을 분리해 로케이터를 정밀화하고 실패 원인을 계측한다. */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'judge-ex4ui@erp-test.com'
let userId = '', cust = '', bld = '', insp = '', custS = '', bldS = '', inspS = '', browser = null

try {
  userId = await mkUser({ email: EMAIL, name: '판정EX4U', employeeId: 'JUDGE-EX4U' })
  const Y = new Date(Date.now() + 9 * 3600_000).getFullYear()
  const mk = async (name, planType) => {
    const cid = await mkCustomer({ customer_name: name, address: '경기 양평군 판정로 44', created_by: userId, fire_station: '양평소방서' })
    const { data: b } = await raw.from('buildings').insert({
      customer_id: cid, building_name: '본관', is_active: true, created_by: userId, purpose: '근린생활시설',
    }).select('id').single()
    const { data: i, error } = await raw.from('inspections').insert({
      customer_id: cid, inspection_type: '작동', sequence_num: 1, plan_type: planType,
      inspection_start_date: `${Y}-05-14`, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(error.message)
    return { cid, bid: b.id, iid: i.id }
  }
  { const r = await mk('JUDGEEX4UI외관', 'monthly'); cust = r.cid; bld = r.bid; insp = r.iid }
  { const r = await mk('JUDGEEX4UI자체', 'special_작동'); custS = r.cid; bldS = r.bid; inspS = r.iid }
  {
    const { error } = await raw.from('inspection_sheet_responses').insert([
      { inspection_id: insp, item_code: 'X1-01', result: 'O', month: 3, updated_by: userId },
      { inspection_id: insp, item_code: 'X1-01', result: 'X', memo: '7월 압력 미달', month: 7, updated_by: userId },
      { inspection_id: insp, item_code: 'X1-02', result: 'O', month: 7, updated_by: userId },
    ])
    if (error) throw new Error(`시드 실패: ${error.message}`)
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(180000)
  page.on('dialog', d => { console.log(`  [dialog] ${d.message().slice(0, 40)}…`); d.accept().catch(() => {}) })
  page.on('pageerror', e => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log(`  [nav] ${f.url()}`) })
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}`)
  await page.waitForSelector('text=점검표 입력')

  const monthSel = page.locator('select').filter({ has: page.locator('option', { hasText: '점검일 기준(기본)' }) }).first()
  check('⑥ 외관 건 → 점검 월 선택기 노출', await page.locator('text=점검 월').count() > 0)
  check('⑥ 기본값 0(점검일 기준)', (await monthSel.inputValue()) === '0')

  const listBtn = page.locator('button', { hasText: '소화기구' }).first()
  // 23 개편: 시트 = 포털 드로어. '열려 있음' 판정은 [← 설비 목록]이 아니라 드로어 존재로
  const backBtn = page.locator('[data-testid="sheet-drawer"]')
  const saveBtn = page.locator('div.flex.gap-2.mt-3 button', { hasText: '저장' })
  // 편집기 저장 버튼은 전환(isPending) 동안 스피너·disabled — 고정 대기 대신 활성화 조건 폴링
  const waitReady = () => page.waitForFunction(() => {
    const b = [...document.querySelectorAll('div.flex.gap-2.mt-3 button')].find(x => (x.innerText || '').includes('저장'))
    return !!b && !b.disabled
  }, null, { timeout: 120000 })
  const openSheet = async () => {
    if (await backBtn.count() === 0) {
      await listBtn.click()
    }
    await page.waitForSelector('[aria-label="X1-01 O"]')
    await waitReady()
  }
  const active = async (code, r) => ((await page.locator(`[aria-label="${code} ${r}"]`).getAttribute('class')) ?? '').includes('bg-')
    && !((await page.locator(`[aria-label="${code} ${r}"]`).getAttribute('class')) ?? '').includes('bg-[#f5f4ff]')

  // ── 1) 5월 선택 → 저장 ──
  await monthSel.selectOption('5')
  await openSheet()
  check('⑥ 5월(응답 없음) → X1-01 미선택', !(await active('X1-01', 'O')))
  await page.locator('[aria-label="X1-04 O"]').click()
  check('⑥ 클릭 후 X1-04 ○ 활성(로컬 상태 반영)', await active('X1-04', 'O'))
  console.log(`  [진단] 편집기 저장 버튼 후보 ${await saveBtn.count()}개 / 페이지 전체 '저장' 버튼 ${await page.locator('button', { hasText: '저장' }).count()}개`)
  page.on('response', r => {
    if (r.request().method() === 'POST' && r.url().includes(`/inspections/${insp}`))
      console.log(`  [action POST] ${r.status()}`)
  })
  console.log('  [진단] 편집기 하단 버튼(텍스트/disabled/class): ' + JSON.stringify(
    await page.evaluate(() => {
      const cancel = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '취소')
      const foot = cancel?.parentElement
      return {
        footClass: foot?.className ?? null,
        buttons: [...(foot?.querySelectorAll('button') ?? [])].map(b => ({
          text: (b.innerText || '').trim().replace(/\s+/g, ' '), disabled: b.disabled, cls: b.className.slice(0, 60),
          html: b.innerHTML.slice(0, 80),
        })),
      }
    })))
  const realSave = saveBtn.first()
  console.log(`  [진단] 클릭 대상 버튼 텍스트: ${JSON.stringify((await realSave.innerText()).slice(0, 20))} class=${(await realSave.getAttribute('class') ?? '').slice(0, 60)}`)
  await realSave.click()
  await page.waitForSelector('button:has-text("소화기구")', { timeout: 60000 }).catch(() => {})
  console.log(`  [진단] 저장 후 편집기 열림=${await backBtn.count() > 0} / 오류문구=${JSON.stringify(await page.locator('p.text-red-600').allInnerTexts())}`)
  const saved = await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('month, result').eq('inspection_id', insp).eq('item_code', 'X1-04')
    return data?.length ? data : null
  }, 60000)
  check('⑥ 5월 선택 후 저장 → X1-04 month=5 기록', saved?.[0]?.month === 5 && saved?.[0]?.result === 'O', JSON.stringify(saved))
  {
    const { data: all } = await raw.from('inspection_sheet_responses')
      .select('item_code, month, result').eq('inspection_id', insp).order('item_code').order('month')
    console.log(`  [진단] 저장 후 응답: ${JSON.stringify(all)}`)
  }

  // ── 2) 월 전환 재초기화 ──
  await monthSel.selectOption('7')
  await openSheet()
  await page.waitForFunction(() => (document.querySelector('[aria-label="X1-01 X"]')?.className ?? '').includes('bg-red-500'),
    null, { timeout: 60000 }).catch(() => {})
  check('⑥ 7월 → X1-01이 ✕(그 달 값)', await active('X1-01', 'X') && !(await active('X1-01', 'O')),
    await page.locator('[aria-label="X1-01 X"]').getAttribute('class'))
  check('⑥ 7월 → X1-02 ○', await active('X1-02', 'O'))
  check('⑥ 7월 → X1-04(5월분)는 미선택 — 달이 갈린다', !(await active('X1-04', 'O')))
  await monthSel.selectOption('3')
  await page.waitForFunction(() => (document.querySelector('[aria-label="X1-01 O"]')?.className ?? '').includes('bg-green-500'),
    null, { timeout: 60000 }).catch(() => {})
  check('⑥ 3월 전환 → 같은 항목이 ○로 재초기화', await active('X1-01', 'O') && !(await active('X1-01', 'X')))
  check('⑥ 3월 → X1-02 미선택(7월 전용)', !(await active('X1-02', 'O')))

  // ── 3) 인라인 X 메모 등록이 선택한 달로 가는가 ──
  await monthSel.selectOption('7')
  await page.waitForFunction(() => (document.querySelector('[aria-label="X1-01 X"]')?.className ?? '').includes('bg-red-500'),
    null, { timeout: 60000 }).catch(() => {})
  await waitReady()
  await page.locator('[aria-label="X1-06 X"]').click()
  await page.locator('input[placeholder="불량 메모 (선택)"]').fill('7월 내용연수 초과')
  // 23 개편: 인라인 [등록]은 포털 드로어 안 — 무스코프 first()는 페이지 뒤(불량내역 패널)의
  // [불량 등록]을 집어 모달에 가로막힌다. 드로어 스코프 필수.
  await page.locator('[data-testid="sheet-drawer"] button', { hasText: '등록' }).first().click()
  const got = await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('month, memo').eq('inspection_id', insp).eq('item_code', 'X1-06')
    return data?.length ? data : null
  }, 60000)
  check('⑥-b 인라인 X 메모 등록이 선택한 달(7월)에 저장', got?.[0]?.month === 7,
    `실제 month=${got?.[0]?.month} memo=${got?.[0]?.memo}`)

  // ── 4) 비외관 건에는 선택기 없음 ──
  await page.goto(`${BASE}/inspections/${inspS}`)
  await page.waitForSelector('text=점검표 입력')
  check('⑥ 자체점검(special_작동) → 점검 월 선택기 미노출', await page.locator('text=점검 월').count() === 0)
  {
    // [대조군] 비외관(v2025) 시트에서도 편집기 저장 버튼이 같은 상태인가 — EX-4 특이 여부 판별
    await page.locator('[data-group-key]').first().click()
    await page.waitForSelector('[data-testid="sheet-drawer"]')
    await page.waitForSelector('div.flex.gap-2.mt-3 button')
    console.log('  [대조군] 비외관 편집기 하단 버튼: ' + JSON.stringify(
      await page.evaluate(() => {
        const cancel = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '취소')
        return [...(cancel?.parentElement?.querySelectorAll('button') ?? [])].map(b => ({
          text: (b.innerText || '').trim(), disabled: b.disabled,
        }))
      })))
  }
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 600))
} finally {
  if (browser) await browser.close().catch(() => {})
  for (const iid of [insp, inspS]) {
    if (!iid) continue
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', iid)
    await raw.from('inspection_defects').delete().eq('inspection_id', iid)
    await raw.from('annex_inputs').delete().eq('inspection_id', iid)
  }
  for (const [cid, bid] of [[cust, bld], [custS, bldS]]) {
    if (!cid) continue
    if (bid) await raw.from('buildings').delete().eq('customer_id', cid)
    await raw.from('customer_contacts').delete().eq('customer_id', cid)
    await cleanupCustomer(cid).catch(e => console.error('고객 정리 실패:', e.message))
  }
  await delUser(userId)
  const { data: lc } = await raw.from('customers').select('id').like('customer_name', 'JUDGEEX4UI%')
  const { data: lr } = insp ? await raw.from('inspection_sheet_responses').select('id').eq('inspection_id', insp) : { data: [] }
  const { data: xr } = await raw.from('inspection_sheet_responses').select('id').like('item_code', 'X%')
  console.log(`[정리 확인] 고객 잔존 ${(lc ?? []).length} / 응답 잔존 ${(lr ?? []).length} / 실데이터 외관응답 총계 ${(xr ?? []).length}(기준 26)`)
  summary()
}
