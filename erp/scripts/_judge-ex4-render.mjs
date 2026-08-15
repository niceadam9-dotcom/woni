/** [독립 판정] 소방계획서_19 EX-4 — 외관점검표 연간 누적본 실주행 판정
 *  실행: node scripts/_judge-ex4-render.mjs   (dev :3000 + 스테이징 DB, 마이그레이션 125 적용 확인됨)
 *  판정자 작성 — 구현 세션 프로브(_probe-soban19-b.mts, 순수 렌더)와 독립. 조립·저장·UI 실주행이 목적.
 *
 *  경로: 외관점검표는 UI 미리보기 진입점이 없고 로컬 PDF 생성은 GOTENBERG_URL 미설정으로 불가 →
 *        선행 판정 세션(_judge19-annex.mjs)과 동일하게 getAnnexPreviewHtmlAction을 로그인 세션으로 HTTP 호출.
 *  정리: finally에서 전 시드 삭제 + 잔존 0건 재조회. 실데이터(기존 외관 26행 등) 미변경.
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = 'judge-ex4@erp-test.com'
let userId = '', custA = '', custB = '', custC = '', bldA = '', bldB = '', bldC = ''
let inspA = '', inspB = '', inspC = '', browser = null, YEAR = 0

const seg = (html, re) => (re.exec(html) ?? [])[0] ?? ''
const BLANK = '월&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;일'

/** 표지 12행 파싱 → [{ md, mark, inspector }] */
function coverRows(html) {
  const tbl = seg(html, /소방시설등<br>점검내역[\s\S]*?<th>비고<\/th>/)
  const re = /<td class="center">([\s\S]*?)<\/td>\s*<td class="center">([\s\S]*?)<\/td>\s*<td class="center">([\s\S]*?)<\/td>/g
  const out = []
  let m
  while ((m = re.exec(tbl)) !== null) out.push({ md: m[1].trim(), mark: m[2].trim(), inspector: m[3].trim() })
  return out
}
/** 섹션 표에서 특정 항목 행의 12개월 결과셀 배열 (index 0 = 1월) */
function itemCells(html, contentSnippet) {
  const i = html.indexOf(contentSnippet)
  if (i < 0) return null
  const row = html.slice(i, html.indexOf('</tr>', i))
  return [...row.matchAll(/<td class="mk">([\s\S]*?)<\/td>/g)].map(m => m[1].trim())
}
const cellState = c => (c === '' ? 'empty' : c.includes('missing') ? 'blank(점검월)' : c)

try {
  // ══════════ 시드 ══════════
  userId = await mkUser({ email: EMAIL, name: '판정EX4', employeeId: 'JUDGE-EX4' })
  const Y = new Date(Date.now() + 9 * 3600_000).getFullYear()

  const mkExtCustomer = async (name, addr, purpose, startDate, planType) => {
    const cid = await mkCustomer({ customer_name: name, address: addr, created_by: userId, fire_station: '양평소방서' })
    await raw.from('customer_contacts').insert({ customer_id: cid, role: '대표', name: '홍대표', phone: '01011112222' })
    const { data: b, error: be } = await raw.from('buildings').insert({
      customer_id: cid, building_name: '본관', is_active: true, created_by: userId, purpose,
    }).select('id').single()
    if (be) throw new Error(`건물 생성 실패: ${be.message}`)
    const { data: ins, error: ie } = await raw.from('inspections').insert({
      customer_id: cid, inspection_type: '작동', sequence_num: 1, plan_type: planType,
      inspection_start_date: startDate, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id, year').single()
    if (ie) throw new Error(`점검 생성 실패: ${ie.message}`)
    return { cid, bid: b.id, iid: ins.id, year: ins.year }
  }

  // A — 연간 누적 대상(정기 monthly), 시작월 5월(14일)
  {
    const r = await mkExtCustomer('JUDGEEX4연간고객', '경기 양평군 판정로 41', '근린생활시설', `${Y}-05-14`, 'monthly')
    custA = r.cid; bldA = r.bid; inspA = r.iid; YEAR = r.year
  }
  // B — 레거시 폴백(month=0) 대상, 시작월 9월(8일)
  {
    const r = await mkExtCustomer('JUDGEEX4레거시고객', '경기 양평군 판정로 42', '업무시설', `${Y}-09-08`, 'event')
    custB = r.cid; bldB = r.bid; inspB = r.iid
  }
  // C — 자체점검(비외관) — 일반 점검표 무오염·선택기 비노출 확인용
  {
    const r = await mkExtCustomer('JUDGEEX4일반고객', '경기 양평군 판정로 43', '업무시설', `${Y}-06-10`, 'special_작동')
    custC = r.cid; bldC = r.bid; inspC = r.iid
  }
  console.log(`[시드] year=${YEAR} / A(연간, 시작 5-14)=${inspA.slice(0, 8)} / B(레거시, 시작 9-8)=${inspB.slice(0, 8)} / C(자체)=${inspC.slice(0, 8)}`)

  // ══════════ ② 잠금 해제 — 같은 건·같은 항목의 다른 달 공존 / 같은 달 중복 거부 ══════════
  console.log('\n— ② 잠금 해제(직접 삽입·삭제 실증)')
  const ins = (rows) => raw.from('inspection_sheet_responses').insert(rows).select('id, month')
  {
    const r3 = await ins([{ inspection_id: inspA, item_code: 'X1-01', result: 'O', month: 3, updated_by: userId }])
    check('같은 건·X1-01 @3월 저장 성공', !r3.error && r3.data?.length === 1, JSON.stringify(r3.error))
    const r7 = await ins([{ inspection_id: inspA, item_code: 'X1-01', result: 'X', memo: '7월 소화기 압력 미달', month: 7, updated_by: userId }])
    check('같은 건·같은 항목 X1-01 @7월 공존 성공 (구 UNIQUE(건,항목) 해제 실증)', !r7.error && r7.data?.length === 1, JSON.stringify(r7.error))
    const dup = await ins([{ inspection_id: inspA, item_code: 'X1-01', result: 'N', month: 7, updated_by: userId }])
    check('같은 달 중복은 23505로 거부', dup.error?.code === '23505', JSON.stringify(dup.error))
    const zero = await ins([{ inspection_id: inspA, item_code: 'X1-01', result: 'O', month: 0, updated_by: userId }])
    check('month=0(레거시 축)도 별도 행으로 공존', !zero.error, JSON.stringify(zero.error))
    if (!zero.error) await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspA).eq('item_code', 'X1-01').eq('month', 0)
    const { data: left } = await raw.from('inspection_sheet_responses')
      .select('month').eq('inspection_id', inspA).eq('item_code', 'X1-01').order('month')
    check('삭제 후 X1-01 잔존 = [3, 7]', JSON.stringify((left ?? []).map(r => r.month)) === '[3,7]', JSON.stringify(left))
  }

  // 나머지 연간 시드 — 3월(전부 O) · 7월 · 9월(전부 N) · 11월
  {
    const { error } = await ins([
      { inspection_id: inspA, item_code: 'X1-02', result: 'O', month: 3, updated_by: userId },
      { inspection_id: inspA, item_code: 'X1-02', result: 'O', month: 7, updated_by: userId },
      { inspection_id: inspA, item_code: 'X2-01', result: 'N', month: 9, updated_by: userId },
      { inspection_id: inspA, item_code: 'X2-02', result: 'N', month: 9, updated_by: userId },
      { inspection_id: inspA, item_code: 'X1-01x', result: 'O', month: 11, updated_by: userId },  // 무효 코드(파싱 제외 확인)
      { inspection_id: inspA, item_code: 'X1-03', result: 'X', memo: '11월 유도등 미점등', month: 11, updated_by: userId },
    ])
    if (error) throw new Error(`연간 시드 실패: ${error.message}`)
    // X1-01 @11월 = O (같은 항목 3개 달)
    const e11 = await ins([{ inspection_id: inspA, item_code: 'X1-01', result: 'O', month: 11, updated_by: userId }])
    if (e11.error) throw new Error(`11월 시드 실패: ${e11.error.message}`)
  }
  // B — 레거시(month=0) 응답
  {
    const { error } = await ins([
      { inspection_id: inspB, item_code: 'X1-01', result: 'X', memo: '레거시 압력 미달', month: 0, updated_by: userId },
      { inspection_id: inspB, item_code: 'X1-02', result: 'O', month: 0, updated_by: userId },
    ])
    if (error) throw new Error(`레거시 시드 실패: ${error.message}`)
  }

  // ══════════ 브라우저 + 액션 준비 ══════════
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(180000)
  page.on('dialog', d => d.accept().catch(() => {}))
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=점검표 입력')
  const previewId = await findActionId(page, 'getAnnexPreviewHtmlAction', scriptUrls)
  const saveId = await findActionId(page, 'saveSheetResponsesAction', scriptUrls)
  check('[방식] 서버 액션 id 확보(getAnnexPreviewHtmlAction·saveSheetResponsesAction)', !!previewId && !!saveId,
    `preview=${previewId} save=${saveId}`)
  const preview = async (iid) => {
    const res = await callAction(page, previewId, [iid, 'exterior'])
    if (res.status !== 200) throw new Error(`액션 HTTP ${res.status}`)
    return parseFlight(res.text)
  }

  // ══════════ ③ 연간 누적 렌더 ══════════
  console.log('\n— ③ 연간 누적 렌더 (3·7·9·11월)')
  const rA = await preview(inspA)
  if (rA.error) throw new Error(`외관 미리보기 실패: ${rA.error}`)
  const hA = rA.html
  const rows = coverRows(hA)
  check('표지 점검내역 12행', rows.length === 12, `실제 ${rows.length}행`)
  const filledMonths = [3, 7, 9, 11]
  for (const m of filledMonths) {
    const r = rows[m - 1]
    check(`③-① ${m}월 행 점검월일 '${m}월 14일'(점검 시작일)`, r?.md === `${m}월 14일`, JSON.stringify(r))
    check(`③-① ${m}월 행 점검자 = 판정EX4`, r?.inspector === '판정EX4', JSON.stringify(r))
  }
  check('③-① 3월(전부 O) → [√]양호', rows[2]?.mark === '[√]양호 [&nbsp;&nbsp;]불량', rows[2]?.mark)
  check('③-① 7월(X 포함) → [√]불량', rows[6]?.mark === '[&nbsp;&nbsp;]양호 [√]불량', rows[6]?.mark)
  check('③-① 11월(X 포함) → [√]불량', rows[10]?.mark === '[&nbsp;&nbsp;]양호 [√]불량', rows[10]?.mark)
  check('⑦ EX-5 9월(전부 N) → 양호·불량 양쪽 미체크', rows[8]?.mark === '[&nbsp;&nbsp;]양호 [&nbsp;&nbsp;]불량', rows[8]?.mark)
  {
    const others = [1, 2, 4, 5, 6, 8, 10, 12].filter(m => !filledMonths.includes(m))
    const allBlank = others.every(m => rows[m - 1]?.md === BLANK && rows[m - 1]?.inspector === ''
      && rows[m - 1]?.mark === '[&nbsp;&nbsp;]양호 [&nbsp;&nbsp;]불량')
    check(`③-③ 미점검 8개 달(${others.join('·')}) 행은 종전 빈 행`, allBlank,
      JSON.stringify(others.map(m => rows[m - 1])))
  }
  {
    // 같은 항목이 여러 달 열에 각각 결과 — X1-01: 3월 ○ / 7월 × / 11월 ○
    const c = itemCells(hA, '거주자 등이 손쉽게 사용할 수 있는 장소에 설치되어 있는지 여부')
    check('③-② X1-01 셀 12칸', c?.length === 12, `실제 ${c?.length}`)
    check('③-② X1-01 3월 열 = ○', c?.[2] === '○', cellState(c?.[2] ?? ''))
    check('③-② X1-01 7월 열 = ×', c?.[6] === '×', cellState(c?.[6] ?? ''))
    check('③-② X1-01 11월 열 = ○', c?.[10] === '○', cellState(c?.[10] ?? ''))
    check('③-② X1-01 9월 열(점검한 달·이 항목은 무응답) = 공란', (c?.[8] ?? '').includes('missing') || c?.[8] === '',
      cellState(c?.[8] ?? ''))
    check('③-③ X1-01 미점검 달(1·2·4·5·6·8·10·12월) 열 전부 빈칸',
      [0, 1, 3, 4, 5, 7, 9, 11].every(i => c?.[i] === ''), JSON.stringify(c))
    const c2 = itemCells(hA, '구획된 거실(바닥면적 33㎡ 이상)마다 소화기 설치 여부')  // X1-02
    check('③-② X1-02 3월·7월 열 = ○ ○ / 11월 공란', c2?.[2] === '○' && c2?.[6] === '○' && !['○', '×', '/'].includes(c2?.[10] ?? ''),
      JSON.stringify([c2?.[2], c2?.[6], c2?.[10]]))
    const c3 = itemCells(hA, '소화기 표지 설치 여부')  // X1-03
    // 점검한 달인데 이 항목만 무응답이면 미리보기 하이라이트(공란) — 마크(○×/)는 없어야 한다
    const noMark = v => !['○', '×', '/'].includes(v)
    check('③-② X1-03 11월 열 = × / 3·7월(점검한 달·무응답)은 마크 없음',
      c3?.[10] === '×' && noMark(c3?.[2]) && noMark(c3?.[6]), JSON.stringify([c3?.[2], c3?.[6], c3?.[10]]))
    const c4 = itemCells(hA, '주된수원의 유효수량 적정여부 (겸용설비 포함)')  // X2-01
    check('③-② X2-01 9월 열 = / (해당없음)', c4?.[8] === '/', cellState(c4?.[8] ?? ''))
  }
  {
    const remark = seg(hA, /<th>비고<\/th><td[\s\S]{0,300}?<\/td>/)
    check('④ 비고칸 = "{월}월 {코드} {메모}" 집계 — 7월분', remark.includes('7월 X1-01 7월 소화기 압력 미달'), remark)
    check('④ 비고칸 11월분도 함께 집계', remark.includes('11월 X1-03 11월 유도등 미점등'), remark)
    check('④ O·N 항목 메모는 비고 미포함(X만)', !remark.includes('X1-02'), remark)
  }
  check('③ missing에 연간 누적 안내(4개월 기록·응답 있는 달 3개월)',
    rA.missing.some(m => m.includes(`${YEAR}년 4개월 기록`) && m.includes('응답 있는 달 3개월')), JSON.stringify(rA.missing))

  // ══════════ ④ 레거시 폴백(month=0) 무회귀 ══════════
  console.log('\n— ④ 레거시 폴백 — month=0 응답이 점검 시작월(9월)로 인쇄')
  const rB = await preview(inspB)
  if (rB.error) throw new Error(`레거시 미리보기 실패: ${rB.error}`)
  {
    const rowsB = coverRows(rB.html)
    check('④ 9월 행만 채워짐(점검 시작월)', rowsB[8]?.md === '9월 8일' && rowsB[8]?.inspector === '판정EX4', JSON.stringify(rowsB[8]))
    check('④ 나머지 11개 달은 빈 행(종전과 동일)',
      rowsB.filter((r, i) => i !== 8).every(r => r.md === BLANK && r.inspector === ''), JSON.stringify(rowsB.map(r => r.md)))
    check('④ 9월 행 X 포함 → [√]불량', rowsB[8]?.mark === '[&nbsp;&nbsp;]양호 [√]불량', rowsB[8]?.mark)
    const c = itemCells(rB.html, '거주자 등이 손쉽게 사용할 수 있는 장소에 설치되어 있는지 여부')
    check('④ X1-01 9월 열 = × · 나머지 11칸 공란', c?.[8] === '×' && c?.filter((v, i) => i !== 8).every(v => v === ''), JSON.stringify(c))
    check('④ 비고칸도 시작월로 집계("9월 X1-01 …")', rB.html.includes('9월 X1-01 레거시 압력 미달'),
      seg(rB.html, /<th>비고<\/th><td[\s\S]{0,200}?<\/td>/))
  }

  // ══════════ ⑤ 일반 점검표 무오염 — month를 넘겨도 비-X는 항상 0 ══════════
  console.log('\n— ⑤ 일반 점검표 무오염 (saveSheetResponsesAction 실호출)')
  {
    const call = async (m) => await callAction(page, saveId, [inspC,
      [{ item_code: '1-A-001', result: 'O' }, { item_code: '1-A-002', result: 'X', memo: '테스트' }, { item_code: 'X1-05', result: 'O' }], m])
    const r1 = await call(7)
    check('⑤ month=7로 저장 호출 성공', r1.status === 200, `HTTP ${r1.status}`)
    const r2 = await call(11)
    check('⑤ month=11로 재저장 호출 성공', r2.status === 200, `HTTP ${r2.status}`)
    const { data: after } = await raw.from('inspection_sheet_responses')
      .select('item_code, month, result').eq('inspection_id', inspC).order('item_code').order('month')
    const g = code => (after ?? []).filter(r => r.item_code === code)
    check('⑤ 비-X 1-A-001 → 1행·month=0', g('1-A-001').length === 1 && g('1-A-001')[0]?.month === 0, JSON.stringify(g('1-A-001')))
    check('⑤ 비-X 1-A-002 → 1행·month=0 (중복 0)', g('1-A-002').length === 1 && g('1-A-002')[0]?.month === 0, JSON.stringify(g('1-A-002')))
    check('⑤ X 항목 X1-05만 월 축 분기 → 7·11월 2행', JSON.stringify(g('X1-05').map(r => r.month)) === '[7,11]', JSON.stringify(g('X1-05')))
  }

  // ══════════ ⑥ 입력 UI — 점검 월 선택기 ══════════
  console.log('\n— ⑥ 입력 UI (dev 서버 + Playwright 실조작)')
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=점검표 입력')
  check('⑥ 외관 건(plan_type=monthly) → 점검 월 선택기 노출', await page.locator('text=점검 월').count() > 0)
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: '점검일 기준(기본)' }) }).first()
  check('⑥ 선택기 기본값 = 0(점검일 기준)', (await sel.inputValue()) === '0')
  // 외관 시트 목록에서 소화기구 시트 열기 — 저장 버튼은 전환 중 스피너·disabled라 활성 조건을 폴링(고정 대기 금지)
  const sheetBtn = page.locator('button', { hasText: '소화기구' }).first()
  // 23 개편: 시트 = 포털 드로어. '열려 있음' 판정은 드로어 존재로
  const backBtn = page.locator('[data-testid="sheet-drawer"]')
  const saveBtn = page.locator('div.flex.gap-2.mt-3 button', { hasText: '저장' })
  const waitReady = () => page.waitForFunction(() => {
    const b = [...document.querySelectorAll('div.flex.gap-2.mt-3 button')].find(x => (x.innerText || '').includes('저장'))
    return !!b && !b.disabled
  }, null, { timeout: 120000 })
  const openSheet = async () => {
    if (await backBtn.count() === 0) await sheetBtn.click()
    await page.waitForSelector('[aria-label="X1-01 O"]')
    await waitReady()
  }
  {
    // 5월 선택 → 그 달 응답 없음 → 전부 미선택
    await sel.selectOption('5')
    await openSheet()
    const cls = await page.locator('[aria-label="X1-01 O"]').getAttribute('class')
    check('⑥ 5월(응답 없음) → X1-01 미선택 상태로 초기화', !cls.includes('bg-green-500'), cls)
    await page.locator('[aria-label="X1-04 O"]').click()
    await saveBtn.first().click()
    const saved = await pollDb(async () => {
      const { data } = await raw.from('inspection_sheet_responses')
        .select('month, result').eq('inspection_id', inspA).eq('item_code', 'X1-04')
      return data?.length ? data : null
    }, 30000)
    check('⑥ 5월 선택 후 저장 → X1-04가 month=5로 기록', saved?.[0]?.month === 5 && saved?.[0]?.result === 'O', JSON.stringify(saved))
  }
  {
    // 7월로 전환 → 그 달 응답으로 재초기화 (X1-01 = ×)
    await sel.selectOption('7')
    await openSheet()
    const x = await page.locator('[aria-label="X1-01 X"]').getAttribute('class')
    const o = await page.locator('[aria-label="X1-01 O"]').getAttribute('class')
    check('⑥ 7월 전환 → X1-01이 ✕(그 달 값)로 재초기화', x.includes('bg-red-500') && !o.includes('bg-green-500'), `${x} | ${o}`)
    // 3월로 전환 → 같은 항목이 ○로 다시 초기화
    await sel.selectOption('3')
    await page.waitForFunction(() => {
      const b = document.querySelector('[aria-label="X1-01 O"]')
      return !!b && b.className.includes('bg-green-500')
    }, null, { timeout: 60000 }).catch(() => {})
    const o3 = await page.locator('[aria-label="X1-01 O"]').getAttribute('class')
    const x3 = await page.locator('[aria-label="X1-01 X"]').getAttribute('class')
    check('⑥ 3월 전환 → 같은 항목이 ○(그 달 값)로 재초기화', o3.includes('bg-green-500') && !x3.includes('bg-red-500'), `${o3} | ${x3}`)
    const c3 = await page.locator('[aria-label="X1-03 X"]').getAttribute('class')
    check('⑥ 3월엔 X1-03 응답 없음 → 미선택', !c3.includes('bg-red-500'), c3)
  }
  {
    // 인라인 X 등록(메모)이 선택한 달로 가는가 — 7월 선택 상태에서 등록
    await sel.selectOption('7')
    await openSheet()
    await waitReady()
    await page.locator('[aria-label="X1-06 X"]').click()
    await page.locator('input[placeholder="불량 메모 (선택)"]').fill('7월 내용연수 초과')
    await page.locator('[data-testid="sheet-drawer"] button', { hasText: '등록' }).first().click()
    const got = await pollDb(async () => {
      const { data } = await raw.from('inspection_sheet_responses')
        .select('month, memo').eq('inspection_id', inspA).eq('item_code', 'X1-06')
      return data?.length ? data : null
    }, 30000)
    check('⑥-b 인라인 X 메모 등록이 선택한 달(7월)로 저장', got?.[0]?.month === 7,
      `실제 month=${got?.[0]?.month} memo=${got?.[0]?.memo}`)
  }
  {
    await page.goto(`${BASE}/inspections/${inspC}`)
    // 진입 pane = 첫 미완료 단계 — ⑤에서 inspC에 응답이 쌓여 ①이 증거완료(responded>0)라 초기 pane이 ②다.
    // ① 점검표 pane으로 명시 전환(스텝바는 항상 보인다).
    await page.click('[data-step="checklist"]')
    await page.waitForSelector('text=점검표 입력')
    check('⑥ 자체점검 건(special_작동) → 점검 월 선택기 미노출', await page.locator('text=점검 월').count() === 0)
  }
  {
    // UI 저장분이 문서에 반영되는가 (5월 열 신규)
    const r = await preview(inspA)
    const c = itemCells(r.html, '소화기의 변형‧손상 또는 부식이 있는지 여부')  // X1-04(1번 섹션 첫 등장)
    check('⑥→③ UI로 저장한 5월분이 문서 5월 열에 ○로 인쇄', c?.[4] === '○', JSON.stringify(c))
    const rowsU = coverRows(r.html)
    check('⑥→③ 표지 5월 행도 새로 채워짐', rowsU[4]?.md === '5월 14일', JSON.stringify(rowsU[4]))
    check('⑥→③ missing 연간 누적 개월 수 5개월로 증가',
      r.missing.some(m => m.includes(`${YEAR}년 5개월 기록`)), JSON.stringify(r.missing))
    const c6 = itemCells(r.html, '수동식 분말소화기 내용연수(10년) 적정 여부')  // X1-06
    console.log(`  [참고] X1-06(UI 7월에서 인라인 X 등록) 열 분포: ${JSON.stringify(c6?.map(cellState))}`)
    // [재판정 2026-08-12] 1차 판정에서는 이 2건이 **결함 재현**(5월 오귀속)을 단언했다.
    // 구현자가 인라인 X 경로에 월 축을 배선했다고 주장 → 올바른 기대(7월 열 ×·5월 열 공란)로 뒤집어 재확인한다.
    check('⑥-b [재판정] 인라인 X(7월 입력)가 7월 열에 ×로 인쇄',
      c6?.[6] === '×', JSON.stringify([c6?.[4], c6?.[6]]))
    check('⑥-b [재판정] 5월 열은 ×가 아님(오귀속 없음)',
      c6?.[4] !== '×', JSON.stringify([c6?.[4], c6?.[6]]))
    const remark2 = seg(r.html, /<th>비고<\/th><td[\s\S]{0,400}?<\/td>/)
    check('⑥-b [재판정] 비고칸이 "7월 X1-06 …"로 집계(5월 오귀속 없음)',
      remark2.includes('7월 X1-06') && !remark2.includes('5월 X1-06'), remark2)
  }
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 800))
} finally {
  if (browser) await browser.close().catch(() => {})
  for (const iid of [inspA, inspB, inspC]) {
    if (!iid) continue
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', iid)
    await raw.from('inspection_defects').delete().eq('inspection_id', iid)
    await raw.from('annex_inputs').delete().eq('inspection_id', iid)
    await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', iid)
  }
  for (const [cid, bid] of [[custA, bldA], [custB, bldB], [custC, bldC]]) {
    if (!cid) continue
    if (bid) await raw.from('fire_facilities').delete().eq('building_id', bid)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await raw.from('fire_plan_forms').delete().eq('customer_id', cid)
    await raw.from('customer_contacts').delete().eq('customer_id', cid)
    await cleanupCustomer(cid).catch(e => console.error('고객 정리 실패:', e.message))
  }
  await delUser(userId)
  const left = {}
  const { data: lc } = await raw.from('customers').select('id').like('customer_name', 'JUDGEEX4%')
  left.customers = (lc ?? []).length
  for (const iid of [inspA, inspB, inspC]) {
    if (!iid) continue
    const { data: li } = await raw.from('inspections').select('id').eq('id', iid)
    const { data: lr } = await raw.from('inspection_sheet_responses').select('id').eq('inspection_id', iid)
    const { data: ld } = await raw.from('inspection_defects').select('id').eq('inspection_id', iid)
    left[`insp:${iid.slice(0, 8)}`] = `${(li ?? []).length}/${(lr ?? []).length}resp/${(ld ?? []).length}def`
  }
  const { data: xr } = await raw.from('inspection_sheet_responses').select('id').like('item_code', 'X%')
  left.실데이터_외관응답_총계 = (xr ?? []).length   // 판정 전 26행이어야 한다
  console.log('[정리 확인] 잔존:', JSON.stringify(left))
  summary()
}
