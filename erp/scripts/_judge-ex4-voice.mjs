/** [독립 재판정 3회차 2026-08-12] EX-4 음성 경로 월 축 갭 해소 실증
 *  실행: node scripts/_judge-ex4-voice.mjs   (dev :3000 + 스테이징 DB + ANTHROPIC_API_KEY)
 *
 *  2회차 판정: 저장 경로 7곳 중 음성만 월 축을 안 넘겨, 화면에서 7월을 골라도 month=0으로 저장되고
 *  (문서에서 시작월 열로 오귀속) 달을 바꿔 반복하면 UNIQUE(건,항목,0)를 덮어써 이전 입력이 사라졌다.
 *  본 프로브는 구현자 주장(provider 공유 + applyVoiceSheetAction(month))을 **실제 UI 주행**으로 재판정한다.
 *   E) 외관 건: 점검표 카드에서 7월 선택 → 음성 카드에서 AI 구조화 → 확정 저장
 *      E-1 전송된 서버 액션 인자 4번째 = 7 / E-2 성공문구 (7월분) / E-3 DB month=7 / E-4 문서 7월 열·비고
 *      E-5 **같은 전사**로 9월 재저장 → 9월 신규 + 7월분 생존(2회차 데이터 소실 미재현) / E-6 문서 누적 2열
 *   F) 비외관(자체점검) 무회귀 — 선택기 없음·month=0·항목 중복 행 0
 *   G) provider 정적 안전성 — 밖에서는 {month:0,isExterior:false}, 두 클라이언트는 provider 안에서만 렌더
 *  정리: finally 전 시드 삭제 + 잔존 재조회. 실데이터 무변경.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = 'judge-ex4vc@erp-test.com'
let userId = '', custA = '', bldA = '', inspA = '', custB = '', bldB = '', inspB = '', browser = null

const seg = (html, re) => (re.exec(html) ?? [])[0] ?? ''
function itemCells(html, snippet) {
  const i = html.indexOf(snippet)
  if (i < 0) return null
  const row = html.slice(i, html.indexOf('</tr>', i))
  return [...row.matchAll(/<td class="mk">([\s\S]*?)<\/td>/g)].map(m => m[1].trim())
}
const rowsOf = async (iid) => {
  const { data } = await raw.from('inspection_sheet_responses')
    .select('item_code, month, result, memo').eq('inspection_id', iid).order('item_code').order('month')
  return data ?? []
}
const nameOf = async (code) => {
  const { data } = await raw.from('inspection_sheet_items').select('item_name').eq('item_code', code).limit(1)
  return data?.[0]?.item_name ?? ''
}

// ── G) provider 정적 안전성 (src 읽기 전용) ──────────────────────────────
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
try {
  const SRC = join(process.cwd(), 'src')
  const files = walk(SRC)
  const ctx = readFileSync(join(SRC, 'components/inspections/exterior-month.tsx'), 'utf8')
  check('G-1 useExteriorMonth가 provider 밖에서 {month:0,isExterior:false} 폴백',
    /useContext\(ExteriorMonthContext\)\s*\?\?\s*\{\s*month:\s*0[\s\S]{0,80}isExterior:\s*false/.test(ctx),
    ctx.split('\n').slice(27, 31).join(' / '))
  for (const comp of ['InspectionSheetClient', 'InspectionVoiceSheetClient']) {
    const users = files.filter(f => !f.endsWith(`${comp === 'InspectionSheetClient' ? 'inspection-sheet-client' : 'inspection-voice-sheet-client'}.tsx`))
      .filter(f => new RegExp(`<${comp}[\\s/>]`).test(readFileSync(f, 'utf8')))
    check(`G-2 ${comp} 렌더 지점은 1곳(=provider 내부)뿐`, users.length === 1,
      JSON.stringify(users.map(u => u.replace(SRC, 'src'))))
  }
  const pg = readFileSync(join(SRC, 'app/(dashboard)/inspections/[id]/page.tsx'), 'utf8')
  const block = seg(pg, /<ExteriorMonthProvider[\s\S]*?<\/ExteriorMonthProvider>/)
  check('G-3 두 클라이언트가 같은 provider 블록 안에 함께 있다',
    block.includes('<InspectionSheetClient') && block.includes('<InspectionVoiceSheetClient'),
    `블록 ${block.length}자`)
} catch (e) {
  check('G 정적 점검 예외 없음', false, String(e).slice(0, 400))
}

const TRANSCRIPT = '소화기 지시압력계가 녹색범위를 벗어나 있어 불량입니다'

try {
  userId = await mkUser({ email: EMAIL, name: '재판정EX4음성', employeeId: 'JUDGE-EX4VC' })
  const Y = new Date(Date.now() + 9 * 3600_000).getFullYear()
  const mk = async (name, planType) => {
    const cid = await mkCustomer({ customer_name: name, address: '경기 양평군 재판정로 9', created_by: userId, fire_station: '양평소방서' })
    const { data: b, error: be } = await raw.from('buildings').insert({
      customer_id: cid, building_name: '본관', is_active: true, created_by: userId, purpose: '근린생활시설',
    }).select('id').single()
    if (be) throw new Error(`건물 생성 실패: ${be.message}`)
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
  { const r = await mk('JUDGEEX4VC외관', 'monthly'); custA = r.cid; bldA = r.bid; inspA = r.iid }
  { const r = await mk('JUDGEEX4VC자체', 'special_작동'); custB = r.cid; bldB = r.bid; inspB = r.iid }
  console.log(`[시드] 외관=${inspA.slice(0, 8)} / 자체=${inspB.slice(0, 8)}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(240000)
  page.on('dialog', d => d.accept().catch(() => {}))
  const scriptUrls = collectScripts(page)
  // 서버 액션 전송 본문 캡처 — 음성 확정 저장이 어떤 인자로 나가는지 (월 축 실증)
  const posts = []
  page.on('request', r => {
    if (r.method() !== 'POST') return
    const h = r.headers()
    if (!h['next-action']) return
    posts.push({ id: h['next-action'], body: r.postData() ?? '' })
  })
  await login(page, EMAIL)

  const monthSel = page.locator('select').filter({ has: page.locator('option', { hasText: '점검일 기준(기본)' }) }).first()
  const ta = page.locator('textarea[placeholder*="발화 규칙"]')
  const parseBtn = page.locator('button', { hasText: 'AI 구조화' })
  const applyBtn = page.locator('button', { hasText: '확정 저장' })
  /** 음성 카드 안의 메시지 문단만 (카드 밖 안내문과 섞이지 않게) */
  const voiceMsg = () => page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find(h => (h.innerText || '').includes('음성 점검표 입력'))
    const card = h2?.closest('div.bg-white')
    return [...(card?.querySelectorAll('p') ?? [])].map(p => p.innerText).join(' | ')
  })

  // ── AI 구조화(parseVoiceSheetAction)만 스텁 ─────────────────────────────
  // 2026-08-12 현재 ANTHROPIC_API_KEY 잔액 부족(400 credit balance too low)으로 실호출이 불가하다.
  // 월 축과 무관한 '전사 → 항목 제안' 단계만 실측 봉투(text/x-component)로 대체하고,
  // **확정 저장 이후(applyVoiceSheetAction → 저장 → 문서)** 는 전부 실제 코드로 돌린다.
  const ENV_HEAD = '0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n'
  const ENT_EXT = [
    { item_code: 'X1-05', result: 'X', memo: '음성 확정 압력 미달', sheet_name: '소화기구 및 자동소화장치', item_name: '지시압력계(녹색범위)의 적정 여부', conflict: false },
    { item_code: 'X1-03', result: 'O', memo: '', sheet_name: '소화기구 및 자동소화장치', item_name: '소화기 표지 설치 여부', conflict: false },
  ]
  const ENT_STD = [
    { item_code: '1-A-001', result: 'O', memo: '', sheet_name: '소화기구 및 자동소화장치', item_name: '표준 항목', conflict: false },
  ]
  let stubEntries = ENT_EXT
  let parseId = ''
  /** 점검 상세 청크가 로드된 뒤에만 액션 id를 뽑을 수 있다 — goto 직후 1회 호출 */
  async function installParseStub() {
    if (parseId) return
    parseId = await findActionId(page, 'parseVoiceSheetAction', scriptUrls)
    check('E-0 parseVoiceSheetAction 액션 id 확보(스텁 대상)', !!parseId, String(parseId))
    await page.route('**/*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.headers()['next-action'] === parseId) {
        await route.fulfill({
          status: 200, contentType: 'text/x-component',
          body: ENV_HEAD + '1:' + JSON.stringify({ entries: stubEntries, missingSheets: [] }) + '\n',
        })
        return
      }
      await route.continue()
    })
  }

  /** 전사 붙여넣기 → (스텁) AI 구조화 → 확정 저장 */
  async function voiceSave(label) {
    await ta.fill(TRANSCRIPT)
    await parseBtn.click()
    try {
      await applyBtn.waitFor({ state: 'visible', timeout: 120000 })
    } catch {
      console.log(`  [${label}] 제안 0건 (${await voiceMsg()})`)
      return { proposed: 0, sent: [] }
    }
    const proposed = await page.locator('label:has(input[type="checkbox"])').count()
    const before = posts.length
    await applyBtn.click()
    await page.waitForFunction(() => document.body.innerText.includes('건 저장됨'), null, { timeout: 240000 })
    return { proposed, sent: posts.slice(before) }
  }
  /** 캡처한 서버 액션 POST 중 applyVoiceSheetAction 호출(=[점검id, rows, 전사, month]) 찾기 */
  const argOf = (sent) => {
    for (const p of sent) {
      try {
        const a = JSON.parse(p.body)
        if (Array.isArray(a) && a.length === 4 && (a[0] === inspA || a[0] === inspB) && a[2] === TRANSCRIPT) return a
      } catch { /* 다음 */ }
    }
    return null
  }

  // ══════════ E) 외관 건 — 음성 저장이 화면에서 고른 달로 가는가 ══════════
  console.log('\n— E) 외관 건 음성 저장 월 축 (7월)')
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=점검표 입력')
  check('E-0 외관 상세에 음성 카드 + 점검 월 선택기 공존', await ta.count() === 1 && await monthSel.count() === 1,
    `textarea=${await ta.count()} / select=${await monthSel.count()}`)
  check('E-0 음성 카드에 별도 월 선택기 없음(선택기는 페이지에 1개 = 공유 원천)',
    await page.locator('text=점검 월').count() === 1, `${await page.locator('text=점검 월').count()}개`)
  await installParseStub()

  await monthSel.selectOption('7')
  const r7 = await voiceSave('7월')
  check('E-1 AI 구조화 제안 ≥1건 → 확정 저장 실행', r7.proposed > 0, `제안 ${r7.proposed}건`)
  const a7 = argOf(r7.sent)
  check('E-1 전송된 applyVoiceSheetAction 인자 4개 · 4번째(month)=7', a7?.length === 4 && a7[3] === 7,
    JSON.stringify(a7 ? [a7[0].slice(0, 8), a7[1], String(a7[2]).slice(0, 20), a7[3]] : r7.sent.map(s => s.body.slice(0, 120))))
  const m7 = await voiceMsg()
  check('E-2 성공 문구에 (7월분) 표기', m7.includes('(7월분)'), m7)

  const rows7 = await pollDb(async () => { const r = await rowsOf(inspA); return r.length ? r : null }, 60000) ?? []
  check('E-3 저장 행 ≥1 · 전부 month=7', rows7.length > 0 && rows7.every(r => r.month === 7),
    JSON.stringify(rows7.map(r => `${r.item_code}:${r.month}:${r.result}`)))
  check('E-3 month=0 오염 0행 (2회차 결함 미재현)', rows7.filter(r => r.month === 0).length === 0,
    JSON.stringify(rows7.filter(r => r.month === 0)))

  const code = rows7[0]?.item_code ?? ''
  const itemName = await nameOf(code)
  const previewId = await findActionId(page, 'getAnnexPreviewHtmlAction', scriptUrls)
  check('E-4 미리보기 액션 id 확보', !!previewId, String(previewId))
  {
    const res = await callAction(page, previewId, [inspA, 'exterior'])
    const r = parseFlight(res.text)
    const c = itemCells(r.html, itemName)
    console.log(`  [문서] ${code} 열 분포: ${JSON.stringify(c)}`)
    check('E-4 7월 열(7번째)에 인쇄', !!c && c[6] !== '', JSON.stringify(c?.[6]))
    check('E-4 시작월(5월) 열 오귀속 없음', !!c && c[4] === '', JSON.stringify(c?.[4]))
    const remark = seg(r.html, /<th>비고<\/th><td[\s\S]{0,3000}?<\/td>/)
    check('E-4 비고칸이 "7월 …"로 귀속', /7월\s/.test(remark) && !/5월\s/.test(remark), remark.slice(0, 400))
  }

  // ── E-5) 달을 바꿔 같은 전사로 재저장 — 7월분이 살아있는가 ──
  console.log('\n— E-5) 9월로 바꿔 같은 전사 재저장 (데이터 소실 재현 시도)')
  await monthSel.selectOption('9')
  const r9 = await voiceSave('9월')
  const a9 = argOf(r9.sent)
  check('E-5 점검표 카드에서 바꾼 달이 음성 저장에 반영(month=9) — provider 공유 실증',
    a9?.[3] === 9, JSON.stringify(a9?.[3] ?? r9.sent.map(s => s.body.slice(0, 120))))
  const m9 = await voiceMsg()
  check('E-5 성공 문구에 (9월분) 표기', m9.includes('(9월분)'), m9)
  const rowsAll = await pollDb(async () => {
    const r = await rowsOf(inspA)
    return r.some(x => x.month === 9) ? r : null
  }, 60000) ?? await rowsOf(inspA)
  check('E-5 9월 행 생성', rowsAll.filter(r => r.month === 9).length > 0, JSON.stringify(rowsAll.map(r => `${r.item_code}:${r.month}`)))
  check('E-5 7월분 전량 생존(덮어쓰기 없음)',
    rows7.every(o => rowsAll.some(n => n.item_code === o.item_code && n.month === 7 && n.result === o.result)),
    JSON.stringify(rowsAll.filter(r => r.month === 7).map(r => `${r.item_code}:${r.result}`)))
  check('E-5 같은 항목이 7월·9월 두 행으로 공존(UNIQUE 월 축 분화)',
    rowsAll.filter(r => r.item_code === code).map(r => r.month).sort().join(',') === '7,9',
    JSON.stringify(rowsAll.filter(r => r.item_code === code)))
  check('E-5 month=0 오염 0행', rowsAll.filter(r => r.month === 0).length === 0,
    JSON.stringify(rowsAll.filter(r => r.month === 0)))
  {
    const res = await callAction(page, previewId, [inspA, 'exterior'])
    const r = parseFlight(res.text)
    const c = itemCells(r.html, itemName)
    console.log(`  [문서] ${code} 열 분포(2회 저장 후): ${JSON.stringify(c)}`)
    check('E-6 문서에 7월·9월 두 열 누적 인쇄', !!c && c[6] !== '' && c[8] !== '', JSON.stringify([c?.[6], c?.[8]]))
    check('E-6 나머지 달은 공란·미점검 표기 유지', !!c && c.filter(x => x === '×' || x === '○').length === 2,
      JSON.stringify(c))
  }

  // ── E-7) 스텁 없는 순수 서버 경로 — applyVoiceSheetAction(…, month) 인자 자체의 효력 ──
  {
    const voiceId = await findActionId(page, 'applyVoiceSheetAction', scriptUrls)
    const res = await callAction(page, voiceId,
      [inspA, [{ item_code: 'X1-11', result: 'X', memo: '서버 인자 직접 11월' }], '직접 호출 전사', 11])
    check('E-7 applyVoiceSheetAction 4번째 인자 직접 호출 성공(스텁 없음)', res.status === 200, `HTTP ${res.status}`)
    const r11 = await pollDb(async () => {
      const r = (await rowsOf(inspA)).find(x => x.item_code === 'X1-11')
      return r ?? null
    }, 60000)
    check('E-7 서버가 month 인자를 그대로 반영(month=11)', r11?.month === 11, JSON.stringify(r11))
  }

  // ══════════ F) 비외관(자체점검) 무회귀 ══════════
  console.log('\n— F) 비외관 무회귀')
  stubEntries = ENT_STD
  await page.goto(`${BASE}/inspections/${inspB}`)
  await page.waitForSelector('text=점검표 입력')
  check('F-0 자체점검 건에는 점검 월 선택기 없음', await page.locator('text=점검 월').count() === 0)
  check('F-0 음성 카드는 그대로 존재', await ta.count() === 1)
  const rB = await voiceSave('비외관')
  check('F-1 비외관 음성 저장 성공', rB.proposed > 0, `제안 ${rB.proposed}건`)
  const aB = argOf(rB.sent)
  check('F-1 전송 인자 month=0 (provider isExterior=false)', aB?.[3] === 0,
    JSON.stringify(aB?.[3] ?? rB.sent.map(s => s.body.slice(0, 120))))
  const mB = await voiceMsg()
  check('F-1 성공 문구에 "월분" 표기 없음(종전과 동일)', mB.includes('건 저장됨') && !mB.includes('월분'), mB)
  {
    const all = await pollDb(async () => { const r = await rowsOf(inspB); return r.length ? r : null }, 60000) ?? []
    check('F-2 비외관 저장분 전부 month=0', all.length > 0 && all.every(r => r.month === 0),
      JSON.stringify(all.filter(r => r.month !== 0)))
    check('F-2 항목 코드 중복 행 0(유니크 분화 없음)',
      new Set(all.map(r => r.item_code)).size === all.length,
      `${all.length}행 / 고유 ${new Set(all.map(r => r.item_code)).size}`)
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
  const { data: lc } = await raw.from('customers').select('id').like('customer_name', 'JUDGEEX4VC%')
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
