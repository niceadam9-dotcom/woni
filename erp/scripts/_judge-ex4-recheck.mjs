/** [독립 재판정 2026-08-12] EX-4 항목⑥ 갭 수정분 실증 — 저장 경로 4곳의 월 축 일치 검증
 *  실행: node scripts/_judge-ex4-recheck.mjs   (dev :3000 + 스테이징 DB)
 *
 *  1차 판정 반증: 월 축을 넘기는 저장 경로가 7곳 중 1곳(편집기 [저장])뿐이었다.
 *  본 프로브는 구현자 주장 1~3을 **실주행으로** 다시 판정한다:
 *   A) [설치 설비 전체 양호]를 3월에 눌러 채운 뒤 7월로 바꿔 다시 누르면 7월분이 새로 채워지는가
 *      (종전엔 have가 월을 접어 filled=0). filled·kept 문구와 DB 행을 함께 본다.
 *   B) 같은 화면 네 경로(편집기 [저장]·인라인 X·빠른 불량·전체 양호)가 모두 같은 달에 쌓이는가
 *   C) 비외관(자체점검) 건에서 네 경로가 전부 month=0인가 (무오염 회귀)
 *   D) [미수정 주장 검증] 음성 점검표 경로 — 같은 화면에 월 선택기가 있는데도 month=0으로 가는가
 *  정리: finally에서 전 시드 삭제 + 잔존 재조회. 실데이터 무변경.
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = 'judge-ex4rc@erp-test.com'
let userId = '', custA = '', bldA = '', inspA = '', custB = '', bldB = '', inspB = '', browser = null

const seg = (html, re) => (re.exec(html) ?? [])[0] ?? ''
function itemCells(html, snippet) {
  const i = html.indexOf(snippet)
  if (i < 0) return null
  const row = html.slice(i, html.indexOf('</tr>', i))
  return [...row.matchAll(/<td class="mk">([\s\S]*?)<\/td>/g)].map(m => m[1].trim())
}
const rowsOf = async (iid, extra = '') => {
  let q = raw.from('inspection_sheet_responses').select('item_code, month, result, memo').eq('inspection_id', iid)
  if (extra) q = q.eq('item_code', extra)
  const { data } = await q.order('item_code').order('month')
  return data ?? []
}
const countAt = async (iid, m) => (await rowsOf(iid)).filter(r => r.month === m).length

try {
  userId = await mkUser({ email: EMAIL, name: '재판정EX4', employeeId: 'JUDGE-EX4RC' })
  const Y = new Date(Date.now() + 9 * 3600_000).getFullYear()
  const mk = async (name, planType) => {
    const cid = await mkCustomer({ customer_name: name, address: '경기 양평군 재판정로 7', created_by: userId, fire_station: '양평소방서' })
    const { data: b, error: be } = await raw.from('buildings').insert({
      customer_id: cid, building_name: '본관', is_active: true, created_by: userId, purpose: '근린생활시설',
    }).select('id').single()
    if (be) throw new Error(`건물 생성 실패: ${be.message}`)
    // 전체 양호는 설치 시설 매칭이 전제 — 소화기구 1종만 설치(EXT-01 / STD 소화기구 시트만 매칭)
    const { error: fe } = await raw.from('fire_facilities').insert({
      building_id: b.id, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
    })
    if (fe) throw new Error(`설비 생성 실패: ${fe.message}`)
    const { data: i, error: ie } = await raw.from('inspections').insert({
      customer_id: cid, inspection_type: '작동', sequence_num: 1, plan_type: planType,
      inspection_start_date: `${Y}-05-14`, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (ie) throw new Error(`점검 생성 실패: ${ie.message}`)
    return { cid, bid: b.id, iid: i.id }
  }
  { const r = await mk('JUDGEEX4RC외관', 'monthly'); custA = r.cid; bldA = r.bid; inspA = r.iid }
  { const r = await mk('JUDGEEX4RC자체', 'special_작동'); custB = r.cid; bldB = r.bid; inspB = r.iid }
  console.log(`[시드] 외관=${inspA.slice(0, 8)} / 자체=${inspB.slice(0, 8)}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(180000)
  page.on('dialog', d => d.accept().catch(() => {}))
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=점검표 입력')

  const monthSel = page.locator('select').filter({ has: page.locator('option', { hasText: '점검일 기준(기본)' }) }).first()
  const bulkBtn = page.locator('button', { hasText: '설치 설비 전체 양호' })
  const listBtn = page.locator('button', { hasText: '소화기구' }).first()
  const backBtn = page.locator('button', { hasText: '← 설비 목록' })
  const saveBtn = page.locator('div.flex.gap-2.mt-3 button', { hasText: '저장' })
  const notice = async () => (await page.locator('p.text-green-600').allInnerTexts()).join(' | ')
  const waitReady = () => page.waitForFunction(() => {
    const b = [...document.querySelectorAll('div.flex.gap-2.mt-3 button')].find(x => (x.innerText || '').includes('저장'))
    return !!b && !b.disabled
  }, null, { timeout: 120000 })
  const openSheet = async () => {
    if (await backBtn.count() === 0) await listBtn.click()
    await page.waitForSelector('[aria-label$=" O"]')   // 외관(X…)·자체점검(1-A-…) 공용
    await waitReady()
  }
  const closeSheet = async () => {
    if (await backBtn.count() > 0) await backBtn.click()
    await page.waitForSelector('button:has-text("설치 설비 전체 양호")')
  }
  const waitNotice = (sub) => page.waitForFunction(
    s => [...document.querySelectorAll('p.text-green-600')].some(p => (p.innerText || '').includes(s)),
    sub, { timeout: 120000 })

  // ══════════ A) 전체 양호 — 3월에 채운 뒤 7월로 바꿔 다시 누르면? ══════════
  console.log('\n— A) [설치 설비 전체 양호] 월 축 (3월 → 7월)')
  await monthSel.selectOption('3')
  await bulkBtn.click()
  await waitNotice('채웠습니다')
  const nA1 = await notice()
  const at3 = await pollDb(async () => (await countAt(inspA, 3)) > 0 ? await countAt(inspA, 3) : null, 60000)
  check('A-1 3월 전체 양호 → month=3 행 생성', at3 === 13, `month=3 ${at3}행 / 문구: ${nA1}`)
  check('A-1 문구가 13개 채움·기존 유지 0', nA1.includes('13개 항목을 ○로 채웠습니다') && !nA1.includes('유지'), nA1)

  await monthSel.selectOption('7')
  await bulkBtn.click()
  const at7 = await pollDb(async () => (await countAt(inspA, 7)) > 0 ? await countAt(inspA, 7) : null, 60000)
  const nA2 = await notice()
  check('A-2 7월로 바꿔 다시 누르면 7월분이 새로 채워진다(종전 결함: 0건)', at7 === 13, `month=7 ${at7}행 / 문구: ${nA2}`)
  check('A-2 3월분은 그대로 유지', (await countAt(inspA, 3)) === 13, JSON.stringify((await rowsOf(inspA)).map(r => r.month)))
  check('A-2 month=0 오염 0행', (await countAt(inspA, 0)) === 0)

  await bulkBtn.click()   // 같은 달 재클릭 — kept 집계가 월 축인지
  await waitNotice('유지')
  const nA3 = await notice()
  check('A-3 같은 달 재클릭 → 0개 채움 + 기존 13건 유지(kept도 월 축)',
    nA3.includes('0개 항목을 ○로 채웠습니다') && nA3.includes('기존 입력 13건 유지'), nA3)
  check('A-3 재클릭이 행을 늘리지 않음(총 26행)', (await rowsOf(inspA)).length === 26, `${(await rowsOf(inspA)).length}행`)

  // ══════════ B) 같은 화면 네 경로가 모두 같은 달(9월)에 쌓이는가 ══════════
  console.log('\n— B) 네 경로 동일 월(9월) 적재')
  await monthSel.selectOption('9')
  await bulkBtn.click()
  const at9 = await pollDb(async () => (await countAt(inspA, 9)) > 0 ? await countAt(inspA, 9) : null, 60000)
  check('B-1 [전체 양호] → 9월 13행', at9 === 13, `${at9}행`)

  await openSheet()                                   // ② 편집기 [저장]
  await page.locator('[aria-label="X1-05 X"]').click()
  await saveBtn.first().click()
  const b2 = await pollDb(async () => {
    const r = (await rowsOf(inspA, 'X1-05')).find(x => x.result === 'X')
    return r ?? null
  }, 60000)
  check('B-2 편집기 [저장] X1-05 ✕ → month=9', b2?.month === 9, JSON.stringify(await rowsOf(inspA, 'X1-05')))

  await openSheet()                                   // ③ 인라인 X [등록](메모)
  await page.locator('[aria-label="X1-06 X"]').click()
  await page.locator('input[placeholder="불량 메모 (선택)"]').fill('9월 인라인 메모')
  await page.locator('button', { hasText: '등록' }).first().click()
  const b3 = await pollDb(async () => {
    const r = (await rowsOf(inspA, 'X1-06')).find(x => x.memo === '9월 인라인 메모')
    return r ?? null
  }, 60000)
  check('B-3 인라인 X + 메모 → month=9', b3?.month === 9, JSON.stringify(await rowsOf(inspA, 'X1-06')))

  await closeSheet()                                  // ④ 빠른 결과 [✕ 불량 저장]
  await page.locator('input[placeholder="불량 항목 검색 (명칭·코드 2자 이상)"]').fill('X1-03')
  await page.waitForSelector('button:has-text("소화기 표지")', { timeout: 60000 })
  await page.locator('button', { hasText: '소화기 표지' }).first().click()
  await page.locator('input[placeholder="불량 메모 (선택 — 불량내역 상세로 들어감)"]').fill('9월 빠른 불량')
  await page.locator('button', { hasText: '✕ 불량 저장' }).click()
  const b4 = await pollDb(async () => {
    const r = (await rowsOf(inspA, 'X1-03')).find(x => x.memo === '9월 빠른 불량')
    return r ?? null
  }, 60000)
  check('B-4 빠른 결과 [✕ 불량 저장] → month=9', b4?.month === 9, JSON.stringify(await rowsOf(inspA, 'X1-03')))
  {
    const all = await rowsOf(inspA)
    check('B-5 네 경로 후에도 month=0 오염 0행', all.filter(r => r.month === 0).length === 0,
      JSON.stringify(all.filter(r => r.month === 0)))
    check('B-5 달별 행수 3·7·9월 각 13행', [3, 7, 9].every(m => all.filter(r => r.month === m).length === 13),
      JSON.stringify([3, 7, 9].map(m => all.filter(r => r.month === m).length)))
  }

  // ══════════ C) 비외관 무오염 — 네 경로 전부 month=0 ══════════
  console.log('\n— C) 비외관(자체점검) 무오염')
  await page.goto(`${BASE}/inspections/${inspB}`)
  await page.waitForSelector('text=점검표 입력')
  check('C-0 자체점검 건에는 점검 월 선택기 없음', await page.locator('text=점검 월').count() === 0)
  await bulkBtn.click()
  const cN = await pollDb(async () => (await rowsOf(inspB)).length > 0 ? (await rowsOf(inspB)).length : null, 60000)
  check('C-1 [전체 양호] 동작', (cN ?? 0) > 0, `${cN}행`)
  await openSheet()
  const firstCode = await page.locator('[aria-label$=" X"]').first().getAttribute('aria-label')
  const code1 = (firstCode ?? '').replace(' X', '')
  await page.locator(`[aria-label="${code1} X"]`).click()
  await saveBtn.first().click()
  await pollDb(async () => ((await rowsOf(inspB, code1)).some(r => r.result === 'X') ? true : null), 60000)
  await openSheet()
  const codes = await page.locator('[aria-label$=" X"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label').replace(' X', '')))
  const code2 = codes.find(c => c !== code1) ?? code1
  await page.locator(`[aria-label="${code2} X"]`).click()
  await page.locator('input[placeholder="불량 메모 (선택)"]').fill('비외관 인라인')
  await page.locator('button', { hasText: '등록' }).first().click()
  await pollDb(async () => ((await rowsOf(inspB, code2)).some(r => r.memo === '비외관 인라인') ? true : null), 60000)
  await closeSheet()
  {
    const all = await rowsOf(inspB)
    check('C-2 비외관 네 경로 결과 전부 month=0', all.every(r => r.month === 0),
      JSON.stringify(all.filter(r => r.month !== 0)))
    check('C-2 항목 코드 중복 행 0(유니크 분화 없음)',
      new Set(all.map(r => r.item_code)).size === all.length, `${all.length}행 / 고유 ${new Set(all.map(r => r.item_code)).size}`)
  }

  // ══════════ D) 음성 경로 — 3회차 판정에선 **범위 제외**(사용자 지시) ══════════
  // 2회차엔 이 절이 "음성만 month=0으로 샌다"는 반증을 고정했다. 3회차는 음성을 검증 범위에서
  // 빼라는 지시가 있어 기본 건너뛴다 — 단언들이 '미수정' 전제라 지금 돌리면 판정이 아니라 오독이 된다.
  // 이력 보존용으로 코드는 남긴다 (EX4_VOICE=1로 강제 실행 가능).
  if (process.env.EX4_VOICE !== '1') {
    console.log('\n— D) 음성 점검표 경로: [범위 제외] 사용자 지시로 미검증 (EX4_VOICE=1이면 종전 절 실행)')
  } else {
  console.log('\n— D) 음성 점검표 경로 (구현자 주장 4 검증)')
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=점검표 입력')
  check('D-0 외관 건 상세에 음성 점검표 카드가 같은 화면에 존재(월 선택기와 같은 페이지)',
    await page.locator('text=음성 점검표 입력').count() > 0 && await page.locator('text=점검 월').count() > 0,
    JSON.stringify(await page.locator('h2').allInnerTexts()))
  await monthSel.selectOption('7')
  const voiceId = await findActionId(page, 'applyVoiceSheetAction', scriptUrls)
  const previewId = await findActionId(page, 'getAnnexPreviewHtmlAction', scriptUrls)
  check('D-0 액션 id 확보', !!voiceId && !!previewId, `voice=${voiceId} preview=${previewId}`)
  const vres = await callAction(page, voiceId, [inspA, [{ item_code: 'X1-10', result: 'X', memo: '음성 입력분' }], '전사 원문 테스트'])
  check('D-1 applyVoiceSheetAction 호출 성공', vres.status === 200, `HTTP ${vres.status}`)
  const vrow = await pollDb(async () => {
    const r = (await rowsOf(inspA, 'X1-10')).find(x => x.memo === '음성 입력분')
    return r ?? null
  }, 60000)
  check('D-2 화면 선택 월=7월인데 음성 저장은 month=7이 아니다(미수정 확인)', vrow?.month !== 7,
    `실제 month=${vrow?.month}`)
  check('D-2 음성 저장은 month=0(레거시 축)', vrow?.month === 0, JSON.stringify(await rowsOf(inspA, 'X1-10')))
  {
    const res = await callAction(page, previewId, [inspA, 'exterior'])
    const r = parseFlight(res.text)
    const c = itemCells(r.html, '수신부가 설치된 경우 수신부 정상(예비 전원, 음향장치 등) 여부')  // X1-10
    console.log(`  [참고] X1-10 열 분포: ${JSON.stringify(c)}`)
    check('D-3 음성 입력분이 문서에서 7월이 아닌 시작월(5월) 열에 ×로 인쇄 — 사용자 모순 재현',
      c?.[4] === '×' && c?.[6] !== '×', JSON.stringify([c?.[4], c?.[6]]))
    const remark = seg(r.html, /<th>비고<\/th><td[\s\S]{0,2000}?<\/td>/)
    check('D-3 비고칸도 "5월 X1-10 음성 입력분"로 오귀속', remark.includes('5월 X1-10 음성 입력분'), remark)
  }
  }
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 800))
} finally {
  if (browser) await browser.close().catch(() => {})
  for (const iid of [inspA, inspB]) {
    if (!iid) continue
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', iid)
    await raw.from('inspection_defects').delete().eq('inspection_id', iid)
    await raw.from('annex_inputs').delete().eq('inspection_id', iid)
    await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', iid)
  }
  for (const [cid, bid] of [[custA, bldA], [custB, bldB]]) {
    if (!cid) continue
    if (bid) await raw.from('fire_facilities').delete().eq('building_id', bid)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await raw.from('fire_plan_forms').delete().eq('customer_id', cid)
    await raw.from('customer_contacts').delete().eq('customer_id', cid)
    await cleanupCustomer(cid).catch(e => console.error('고객 정리 실패:', e.message))
  }
  await delUser(userId)
  const left = {}
  const { data: lc } = await raw.from('customers').select('id').like('customer_name', 'JUDGEEX4RC%')
  left.고객 = (lc ?? []).length
  for (const iid of [inspA, inspB]) {
    if (!iid) continue
    left[`insp:${iid.slice(0, 8)}`] = `${(await rowsOf(iid)).length}resp`
  }
  const { data: xr } = await raw.from('inspection_sheet_responses').select('id').like('item_code', 'X%')
  const { data: allr } = await raw.from('inspection_sheet_responses').select('id')
  left.실데이터_외관응답 = `${(xr ?? []).length}행(기준 26)`
  left.응답_전체 = `${(allr ?? []).length}행(기준 170)`
  console.log('[정리 확인]', JSON.stringify(left))
  summary()
}
