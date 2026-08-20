/** [독립 판정] 소방계획서_19 — 별지 4·9·10·11호·외관점검표 실주행 판정
 *  실행: node scripts/_judge19-annex.mjs   (dev 서버 :3000 + 스테이징 DB, 마이그레이션 124 적용 확인됨)
 *  판정자 작성 — 구현 세션 프로브(_probe-soban19-b.mts, 순수 렌더)와 독립. 조립(assemble*) 실주행이 목적.
 *
 *  방식 ① 정석 — 고객 계획 탭 별지 트리 [전체 미리보기] 모달(iframe srcdoc = getAnnexPreviewHtmlAction 실주행)
 *       ② 변주 — 같은 서버 액션을 로그인 세션으로 HTTP 호출(_judge19-action.mjs). 외관점검표는 UI 미리보기
 *          진입점이 없고 [생성]은 GOTENBERG_URL 미설정 로컬에서 불가하므로 이 경로가 유일한 실주행 수단이다.
 *  정리: finally에서 전 시드 삭제 + 잔존 0건 재조회. 실데이터(company_profile·plan_text_library) 미변경.
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = 'judge19-annex@erp-test.com'
let userId = '', custA = '', custB = '', bldA = '', bldB = '', inspA = '', inspB = '', browser = null
let YEAR = 0

const seg = (html, re) => (re.exec(html) ?? [])[0] ?? ''

try {
  // ══════════ 시드 ══════════
  userId = await mkUser({ email: EMAIL, name: '판정19', employeeId: 'JUDGE19-A' })

  // 고객 A — 자체점검(별지 4·9·10·11호). 선임자(김선임) ≠ 대표(홍대표), 대표 전화는 무하이픈(E10-2 검증용)
  custA = await mkCustomer({
    customer_name: 'JUDGE19별지고객', address: '경기 양평군 판정로 19', created_by: userId,
    fire_station: '양평소방서', use_approval_date: '2020-03-02',
    email_delivery_consent: true, report_email: 'judge19@example.com',
    rep_role: '소유자', manager_license_grade: '2급', manager_edu_date: '2025-05-20',
    manager_appointment_type: '겸직',           // B-4d(124)
  })
  await raw.from('customer_contacts').insert({ customer_id: custA, role: '대표', name: '홍대표', phone: '01011112222' })
  {
    const { data, error } = await raw.from('buildings').insert({
      customer_id: custA, building_name: '본관', is_active: true, created_by: userId,
      purpose: '업무시설', total_area: 1234, building_area: 400, permit_date: '2019-01-10',
      parking_summary: '옥내(지하, 필로티), 옥외',   // B-4c
    }).select('id').single()
    if (error) throw new Error(`건물A 생성 실패: ${error.message}`)
    bldA = data.id
  }
  await raw.from('fire_facilities').insert({
    building_id: bldA, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })
  // 1.7 선임현황(1순위=김선임) · 1.11 교육훈련(전년도 교육 실적만 + 계획월)
  const YEAR_GUESS = new Date(Date.now() + 9 * 3600_000).getFullYear()
  const TRAINING_BASE = { headcount: { worker: '9' }, eduMonths: [4], drillMonths: [10] }
  const setSections = async (cid, patch) => {
    const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', cid).maybeSingle()
    const { error } = await raw.from('fire_plan_forms').upsert(
      { customer_id: cid, sections: { ...(data?.sections ?? {}), ...patch }, updated_at: new Date().toISOString() },
      { onConflict: 'customer_id' })
    if (error) throw new Error(`sections 저장 실패: ${error.message}`)
  }
  await setSections(custA, {
    managers: [
      { role: '관리자', affiliation: '자체', name: '김선임', selectedAt: '2026-01-02', eduAt: '', duty: '총괄' },
      { role: '보조자', affiliation: '자체', name: '박보조', selectedAt: '', eduAt: '', duty: '' },
    ],
    training: { ...TRAINING_BASE, records: [{ at: `${YEAR_GUESS - 1}-05-02`, kind: '교육', attendees: '12', content: '전 직원 소방안전교육' }] },
  })
  // A4-3 — 세부현황 수계공통 '설비의 종류'
  {
    const { error } = await raw.from('customer_facility_specs').insert({
      customer_id: custA, building_id: null, section_key: 's32_water_common',
      spec: {
        main_water: { systems: ['옥내소화전설비', '스프링클러설비'] },
        pump_type: { used: true, systems: ['옥내소화전설비'] },
      },
    })
    if (error) throw new Error(`세부제원 저장 실패: ${error.message}`)
  }
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: custA, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: `${YEAR_GUESS}-08-03`, inspection_end_date: `${YEAR_GUESS}-08-04`, inspection_days: 2,
      status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id, year').single()
    if (error) throw new Error(`점검A 생성 실패: ${error.message}`)
    inspA = data.id; YEAR = data.year
  }
  console.log(`[시드] 점검A year=${YEAR} — 교육훈련 판정 축은 전년도 ${YEAR - 1}`)
  // B-3 — 31번(기타사항) 응답: 방화문 X · 비상구 O (방염은 무응답 → 종전 ☐ 유지)
  {
    const { error } = await raw.from('inspection_sheet_responses').insert([
      { inspection_id: inspA, item_code: '31-A-001', result: 'X', updated_by: userId },
      { inspection_id: inspA, item_code: '31-A-002', result: 'O', updated_by: userId },
    ])
    if (error) throw new Error(`응답A 시드 실패: ${error.message}`)
  }
  // 별지 10·11호 — 계획 3건(정상/종료일만/완료)
  {
    const { error } = await raw.from('inspection_defects').insert([
      { inspection_id: inspA, defect_code: '31-A-001', defect_name: '방화문 폐쇄 불량',
        action_plan: '방화문 도어클로저 교체', action_start: `${YEAR}-08-01`, action_end: `${YEAR}-08-20` },
      { inspection_id: inspA, defect_name: '유도등 미점등', action_end: `${YEAR}-09-10` },   // E10-4 종료일만
      { inspection_id: inspA, defect_name: '감지기 불량', action_completed_at: `${YEAR}-08-05` }, // E11-1·E11-3
    ])
    if (error) throw new Error(`불량 시드 실패: ${error.message}`)
  }

  // 고객 B — 정기(monthly) → 외관점검표. 같은 1.7 선임현황(직위 '관리자')
  custB = await mkCustomer({
    customer_name: 'JUDGE19외관고객', address: '경기 양평군 판정로 20', created_by: userId, fire_station: '양평소방서',
  })
  await raw.from('customer_contacts').insert({ customer_id: custB, role: '대표', name: '홍대표', phone: '01011112222' })
  {
    const { data, error } = await raw.from('buildings').insert({
      customer_id: custB, building_name: '본관', is_active: true, created_by: userId, purpose: '근린생활시설',
    }).select('id').single()
    if (error) throw new Error(`건물B 생성 실패: ${error.message}`)
    bldB = data.id
  }
  await setSections(custB, {
    managers: [{ role: '관리자', affiliation: '자체', name: '김선임', selectedAt: '2026-01-02', eduAt: '', duty: '총괄' }],
  })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: custB, inspection_type: '작동', sequence_num: 1, plan_type: 'monthly',
      inspection_start_date: `${YEAR_GUESS}-08-03`, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검B 생성 실패: ${error.message}`)
    inspB = data.id
  }
  {
    const { error } = await raw.from('inspection_sheet_responses').insert([
      { inspection_id: inspB, item_code: 'X1-01', result: 'X', memo: '소화기 압력 미달', updated_by: userId },
      { inspection_id: inspB, item_code: 'X1-02', result: 'O', updated_by: userId },
    ])
    if (error) throw new Error(`응답B 시드 실패: ${error.message}`)
  }

  // ══════════ ① 정석 — 별지 트리 [전체 미리보기] 모달 ══════════
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(180000)   // dev 콜드 컴파일 대비 (고정 대기 금지 — 조건 폴링만)
  const scriptUrls = collectScripts(page)
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${custA}?tab=plan&form=annex`)
  await page.waitForSelector(`text=${YEAR}년 1차`)
  await page.locator('text=🔍 전체 미리보기').first().click()
  await page.waitForSelector('text=— 전체 미리보기')
  const grab = async id => {
    await page.waitForFunction(sel => {
      const f = document.querySelector(sel + ' iframe')
      return !!f && (f.getAttribute('srcdoc') || '').length > 1000
    }, `#fp-${id}`, { timeout: 180000 })
    return await page.evaluate(sel => document.querySelector(sel + ' iframe')?.getAttribute('srcdoc') ?? '', `#fp-${id}`)
  }
  const html9 = await grab('report9')
  const html4 = await grab('report4')
  const html10 = await grab('report10')
  const html11 = await grab('report11')
  console.log(`[UI 미리보기] 9호 ${html9.length}자 / 4호 ${html4.length}자 / 10호 ${html10.length}자 / 11호 ${html11.length}자`)

  // 액션 직접 호출 준비(변주·외관용) — 같은 서버 액션
  const actionId = await findActionId(page, 'getAnnexPreviewHtmlAction', scriptUrls)
  if (!actionId) throw new Error('getAnnexPreviewHtmlAction 액션 id 미발견')
  const preview = async (inspectionId, type) => {
    const res = await callAction(page, actionId, [inspectionId, type])
    if (res.status !== 200) throw new Error(`액션 HTTP ${res.status}`)
    return parseFlight(res.text)
  }
  // UI 모달과 액션 호출이 같은 결과인지 교차 확인(경로 동일성 근거)
  const a9 = await preview(inspA, 'report9')
  check('[방식 검증] 액션 호출 결과 = UI 모달 iframe srcdoc (동일 경로)', a9.html === html9,
    `len ${a9.html.length} vs ${html9.length}`)

  // ══════════ B-1 — 소방안전관리자 = 1.7 선임현황 1순위 (4문서 일치) ══════════
  console.log('\n— B-1: 별지9·10·11호·외관 소방안전관리자 일치 (선임자 김선임 ≠ 대표 홍대표)')
  const ext = await preview(inspB, 'exterior')
  if (ext.error) throw new Error(`외관 미리보기 실패: ${ext.error}`)
  const htmlE = ext.html
  const mgr9 = seg(html9, /성명: [^<]*?, 전화번호: [\s\S]{0,80}?, 최근 교육이수일/)
  const mgr10 = seg(html10, /소방안전관리자<br>\(성명: [\s\S]{0,120}?\)<\/td>/)
  // 별지11호는 headTable(mgrSplit=true) — `소방안전관리자<br>성명: …<br>전화번호: …`
  const mgr11 = seg(html11, /소방안전관리자<br>성명: [\s\S]{0,140}?<\/td>/)
  const mgrE = seg(htmlE, /직위: [\s\S]{0,200}?전화번호: [\s\S]{0,80}?<\/td>/)
  check('별지9호 관리자 = 김선임', mgr9.includes('김선임'), mgr9)
  check('별지10호 관리자 = 김선임', mgr10.includes('김선임'), mgr10)
  check('별지11호 관리자 = 김선임', mgr11.includes('김선임'), mgr11)
  check('외관점검표 관리자 = 김선임', mgrE.includes('김선임'), mgrE)
  check('네 문서 관리자 이름 일치(대표 폴백 잔존 0)',
    [mgr9, mgr10, mgr11, mgrE].every(s => s.includes('김선임') && !s.includes('홍대표')))
  check('보조자(박보조)는 선택 안 됨', ![html9, html10, html11, htmlE].some(h => h.includes('박보조')))
  console.log('  · B-1c 전화 규칙(선임자≠대표 → 공란)')
  check('별지9호 관리자 전화 공란', !/전화번호: [^<]*\d/.test(mgr9), mgr9)
  check('별지10호 관리자 전화 공란', !/전화번호: [^<]*\d/.test(mgr10), mgr10)
  check('별지11호 관리자 전화 공란', !/전화번호: [^<]*\d/.test(mgr11), mgr11)
  check('외관 관리자 전화 공란', !/전화번호: [^<]*\d/.test(mgrE), mgrE)
  check('관계인(대표) 칸은 홍대표·전화 유지 — 10호', /관계인<br>\(성명: 홍대표\s+전화번호: 010-1111-2222\)/.test(html10))
  // E10-2·E11-2 — formatTel
  check('E10-2 관계인 전화 formatTel(01011112222→010-1111-2222) — 10호', html10.includes('010-1111-2222'))
  check('E11-2 동일 — 11호', html11.includes('010-1111-2222'))
  // EX-3 — 직위 = 1.7 role
  check('EX-3 외관 직위 = 1.7 구분(관리자)', /직위: 관리자/.test(htmlE), mgrE)

  // ══════════ B-2 — 교육훈련 '실시' = 전년도 실적 기반 ══════════
  console.log('\n— B-2: 교육훈련 실시 판정 (1.11.4 records 전년도 축)')
  const eduState = h => ({
    edu: /소방안전교육 \(\[√\]실시/.test(h),
    drill: /소방훈련 \(\[√\]실시/.test(h),
  })
  {
    const s = eduState(html9)
    check(`전년도(${YEAR - 1}) 교육 실적만 → 교육 √ · 훈련 ☐`, s.edu && !s.drill, JSON.stringify(s))
  }
  {
    // 계획만(records 없음) → 양쪽 ☐ (종전 결함: !!sections.training 하나로 둘 다 실시)
    await setSections(custA, { training: { ...TRAINING_BASE, records: [] } })
    const s = eduState((await preview(inspA, 'report9')).html)
    check('계획(eduMonths·drillMonths)만 입력 → 양쪽 ☐', !s.edu && !s.drill, JSON.stringify(s))
  }
  {
    // 당해년도 실적 → 여전히 ☐ (B-2b 전년도 축)
    await setSections(custA, { training: { ...TRAINING_BASE, records: [{ at: `${YEAR}-05-02`, kind: '교육' }] } })
    const s = eduState((await preview(inspA, 'report9')).html)
    check(`B-2b 당해년도(${YEAR}) 실적은 미반영 → 양쪽 ☐`, !s.edu && !s.drill, JSON.stringify(s))
  }
  {
    // 전년도 훈련 실적만 → 훈련만 √
    await setSections(custA, { training: { ...TRAINING_BASE, records: [{ at: `${YEAR - 1}-10-11`, kind: '소방훈련' }] } })
    const s = eduState((await preview(inspA, 'report9')).html)
    check('전년도 훈련 실적만 → 훈련 √ · 교육 ☐', !s.edu && s.drill, JSON.stringify(s))
  }
  {
    // B-2c ③ 수동 보정 — annex_inputs eduDone='실시'일 때만 강제
    await setSections(custA, { training: { ...TRAINING_BASE, records: [] } })
    await raw.from('annex_inputs').upsert(
      { inspection_id: inspA, annex_no: 'report9', fields: { eduDone: '실시' } },
      { onConflict: 'inspection_id,annex_no' })
    const s = eduState((await preview(inspA, 'report9')).html)
    check('B-2c ③ 보정 eduDone=실시 → 교육 √ (훈련은 그대로 ☐)', s.edu && !s.drill, JSON.stringify(s))
    await raw.from('annex_inputs').upsert(
      { inspection_id: inspA, annex_no: 'report9', fields: { eduDone: '자동 판정', drillDone: '자동 판정' } },
      { onConflict: 'inspection_id,annex_no' })
    const s2 = eduState((await preview(inspA, 'report9')).html)
    check('③ 보정 해제(자동 판정) → 자동 판정으로 복귀(양쪽 ☐)', !s2.edu && !s2.drill, JSON.stringify(s2))
    await raw.from('annex_inputs').delete().eq('inspection_id', inspA)
  }
  // 시드 원상 복구(교육 실적)
  await setSections(custA, { training: { ...TRAINING_BASE, records: [{ at: `${YEAR - 1}-05-02`, kind: '교육', attendees: '12' }] } })

  // ══════════ B-3 — '기타' 3항목 (별지9호 3쪽 · 별지4호 1쪽 동시) ══════════
  console.log('\n— B-3: 31번 응답 롤업 (X>O>N)')
  for (const [label, h] of [['별지9호 3쪽', html9], ['별지4호 1쪽', html4]]) {
    // 결과칸 class는 'center'로 시작하되 표식이 더 붙는다('mk' = 오버라이드 편집 금지, lib/doc-overrides)
    check(`${label} 방화문(31-A-001 X) → [√] + ×`, /\[√\]방화문, 자동방화셔터[\s\S]{0,200}?<td class="center[^"]*">×<\/td>/.test(h))
    check(`${label} 비상구(31-A-002 O) → [√] + ○`, /\[√\]비상구, 피난통로[\s\S]{0,200}?<td class="center[^"]*">○<\/td>/.test(h))
    check(`${label} 방염(무응답) → ☐ + 공란`, /\[&nbsp;&nbsp;\]방  염/.test(h))
  }

  // ══════════ B-4 — 서식 충실도 ══════════
  console.log('\n— B-4: 조문·9쪽·주차장 하위·선임 형태')
  check('B-4a 유의사항 조문 병기(제58조제1호·제61조제1항제8호)',
    html9.includes('제58조제1호') && html9.includes('제61조제1항제8호'))
  check('B-4b 9쪽 작성방법 출력', html9.includes('작성방법') && html9.includes('교육훈련(전년도)'))
  check('B-4c 주차장 옥내 하위 — parking_summary "옥내(지하, 필로티), 옥외" → 지하·필로티 √, 지상 ☐',
    /\[√\]옥내\(\[√\]지하 \[&nbsp;&nbsp;\]지상 \[√\]필로티/.test(html9),
    seg(html9, /\[[^\]]*\]옥내\([\s\S]{0,160}?옥외/))
  check('B-4d 선임 형태(124 겸직) → [√]겸직만', /\[√\]겸직/.test(html9) && /\[&nbsp;&nbsp;\]소방기술자격/.test(html9))

  // ══════════ A4-3 — 세부현황 '설비의 종류' 5블록 ══════════
  console.log('\n— A4-3: 세부현황 수계공통 설비의 종류')
  for (const [label, h] of [['별지9호', html9], ['별지4호', html4]]) {
    check(`${label} ◦ 설비의 종류 5블록`, (h.match(/◦ 설비의 종류:/g) ?? []).length === 5,
      `실제 ${(h.match(/◦ 설비의 종류:/g) ?? []).length}건`)
    check(`${label} 저장분 √(옥내소화전설비)`, /설비의 종류:[\s\S]{0,120}?\[√\]옥내소화전설비/.test(h))
    check(`${label} 미선택 ☐(옥외소화전설비)`, /\[&nbsp;&nbsp;\]옥외소화전설비/.test(h))
  }

  // ══════════ B-6 — missing 확장 ══════════
  console.log('\n— B-6: missing 확장 (무응답 설비·선임 형태)')
  const m9 = (await preview(inspA, 'report9')).missing
  check('무응답 설비 건수 문구', m9.some(m => /점검표 무응답 \d+건/.test(m)), JSON.stringify(m9))
  check('선임 형태 입력됨 → 해당 문구 없음', !m9.some(m => m.includes('선임 형태')), JSON.stringify(m9))
  await raw.from('customers').update({ manager_appointment_type: null }).eq('id', custA)
  const m9b = (await preview(inspA, 'report9')).missing
  check('선임 형태 미입력 → missing 열거', m9b.some(m => m.includes('선임 형태')), JSON.stringify(m9b))
  const html9b = (await preview(inspA, 'report9')).html
  check('선임 형태 미입력 → 5종 전부 ☐(하위 호환)', !/\[√\]겸직/.test(html9b))
  await raw.from('customers').update({ manager_appointment_type: '겸직' }).eq('id', custA)
  console.log('  · B-6a 결과칸 규약 — 무응답이면 ○·／ 자동 기입 없음')
  check('설치(√) 소화기구인데 응답 없음 → 결과칸 공란(자동 기입 0)',
    /\[√\]소화기구 및 자동소화장치[\s\S]{0,300}?<td class="center[^"]*"><\/td>/.test(html9)
    || /소화기구 및 자동소화장치[\s\S]{0,200}?<td class="center[^"]*">\s*<\/td>/.test(html9),
    seg(html9, /소화기구 및 자동소화장치[\s\S]{0,220}/))

  // ══════════ B-8 — 별지10·11호 감사 후속 ══════════
  console.log('\n— B-8: 별지10·11호 (E10-1·E10-3·E10-4·E10-6·E11-1·E11-3)')
  check('E10-1 표 행 기간 한국어 날짜', html10.includes(`${YEAR}년 8월 1일 ~ ${YEAR}년 8월 20일`),
    seg(html10, /<td class="row-period">[\s\S]{0,60}?<\/td>/))
  check('E10-4 종료일만 입력된 불량도 표에 편입', html10.includes(`~ ${YEAR}년 9월 10일`) && html10.includes('유도등 미점등'))
  check('E10 총 이행기간 한국어 + 총일수', html10.includes(`${YEAR}년 8월 1일 ~ ${YEAR}년 9월 10일`) || html10.includes('(총 '))
  check('E11-1 완료일 한국어 날짜', html11.includes(`${YEAR}년 8월 5일`), seg(html11, /<td class="row-period">[\s\S]{0,60}?<\/td>/))
  const m11 = (await preview(inspA, 'report11')).missing
  check('E11-3 이행조치 내용 미입력 경고', m11.some(m => m.includes('이행조치 내용 미입력')), JSON.stringify(m11))
  {
    // E10-3 — 시작·종료가 모두 있는 건이 없으면 총 이행기간 산출 불가 경고
    await raw.from('inspection_defects').update({ action_start: null, action_end: null }).eq('inspection_id', inspA)
    const r10 = await preview(inspA, 'report10')
    check('E10-3 총 이행기간 산출 불가 → missing', r10.missing.some(m => m.includes('총 이행기간')), JSON.stringify(r10.missing))
    await raw.from('inspection_defects').update({ action_start: `${YEAR}-08-01`, action_end: `${YEAR}-08-20` })
      .eq('inspection_id', inspA).eq('defect_code', '31-A-001')
  }
  {
    // E10-6 — 제출처·관계인 부재 경고
    await raw.from('customers').update({ fire_station: null }).eq('id', custA)
    const r10 = await preview(inspA, 'report10')
    check('E10-6 관할 소방서 미등록 → missing', r10.missing.some(m => m.includes('관할 소방서')), JSON.stringify(r10.missing))
    await raw.from('customers').update({ fire_station: '양평소방서' }).eq('id', custA)
  }

  // ══════════ B-8 — 외관점검표 감사 후속 ══════════
  console.log('\n— B-8: 외관점검표 (EX-1·EX-5·EX-6·EX-7)')
  check('EX-1 X 항목 memo → 표지 비고칸', htmlE.includes('X1-01 소화기 압력 미달'),
    seg(htmlE, /<th>비고<\/th><td[\s\S]{0,120}?<\/td>/))
  check('EX-5 X 있음 → 불량 체크(양호 아님)', /\[&nbsp;&nbsp;\]양호 \[√\]불량/.test(htmlE),
    seg(htmlE, /\[[^\]]*\]양호 \[[^\]]*\]불량/))
  {
    await raw.from('inspection_sheet_responses').update({ result: 'N', memo: null }).eq('inspection_id', inspB)
    const r = await preview(inspB, 'exterior')
    check('EX-5 응답 전부 N → 양호·불량 둘 다 ☐(양호 단정 금지)',
      /\[&nbsp;&nbsp;\]양호 \[&nbsp;&nbsp;\]불량/.test(r.html) && !/\[√\]양호/.test(r.html),
      seg(r.html, /\[[^\]]*\]양호 \[[^\]]*\]불량/))
    check('EX-1 memo 없으면 비고칸 종전 공란', /<th>비고<\/th><td[^>]*>&nbsp;<\/td>/.test(r.html))
    await raw.from('inspection_sheet_responses').update({ result: 'O' }).eq('inspection_id', inspB).eq('item_code', 'X1-02')
    const r2 = await preview(inspB, 'exterior')
    check('EX-5 O만 있으면 양호 √', /\[√\]양호 \[&nbsp;&nbsp;\]불량/.test(r2.html), seg(r2.html, /\[[^\]]*\]양호 \[[^\]]*\]불량/))
  }
  {
    await raw.from('customers').update({ address: null }).eq('id', custB)
    await raw.from('buildings').update({ purpose: null }).eq('id', bldB)
    const r = await preview(inspB, 'exterior')
    check('EX-7 소재지·대상물 구분 미입력 → missing 2건',
      r.missing.some(m => m.includes('소재지')) && r.missing.some(m => m.includes('대상물 구분')), JSON.stringify(r.missing))
    await raw.from('customers').update({ address: '경기 양평군 판정로 20' }).eq('id', custB)
    await raw.from('buildings').update({ purpose: '근린생활시설' }).eq('id', bldB)
  }
  {
    // EX-6 — 도달 가능성 검증: inspections.year는 GENERATED ALWAYS AS (EXTRACT(YEAR FROM inspection_start_date))
    // (002_fire_safety.sql:109). 두 축은 DB가 항상 일치시키므로 불일치 자체가 성립하지 않는다.
    const upd = await raw.from('inspections').update({ year: YEAR - 1 }).eq('id', inspB).select('id')
    check('[EX-6 반증] year는 생성열 — 직접 갱신 불가(428C9)', upd.error?.code === '428C9',
      JSON.stringify(upd.error ?? upd.data))
    await raw.from('inspections').update({ inspection_start_date: `${YEAR - 1}-08-03` }).eq('id', inspB)
    const shifted = await raw.from('inspections').select('year, inspection_start_date').eq('id', inspB).single()
    check('[EX-6 반증] 시작일을 전년으로 바꾸면 year도 같이 이동 — 축 분리 불가',
      shifted.data?.year === YEAR - 1, JSON.stringify(shifted.data))
    const r = await preview(inspB, 'exterior')
    check('[EX-6 반증] 그래서 연도 불일치 missing은 어떤 입력으로도 발생하지 않음(가드 무해·도달 불가)',
      !r.missing.some(m => m.includes('연도 불일치')), JSON.stringify(r.missing))
    await raw.from('inspections').update({ inspection_start_date: `${YEAR}-08-03` }).eq('id', inspB)
  }
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 500))
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
    await raw.from('customer_facility_specs').delete().eq('customer_id', cid)
    if (bid) await raw.from('fire_facilities').delete().eq('building_id', bid)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await raw.from('fire_plan_forms').delete().eq('customer_id', cid)
    await raw.from('customer_contacts').delete().eq('customer_id', cid)
    await cleanupCustomer(cid).catch(e => console.error('고객 정리 실패:', e.message))
  }
  await delUser(userId)
  // 잔존 0건 재조회
  const left = {}
  const { data: lc } = await raw.from('customers').select('id').like('customer_name', 'JUDGE19%')
  left.customers = (lc ?? []).length
  for (const [t, col, v] of [['inspections', 'id', inspA], ['inspections', 'id', inspB]]) {
    if (!v) continue
    const { data } = await raw.from(t).select('id').eq(col, v)
    left[`${t}:${v.slice(0, 8)}`] = (data ?? []).length
  }
  const { data: lr } = inspA ? await raw.from('inspection_sheet_responses').select('item_code').eq('inspection_id', inspA) : { data: [] }
  left.responsesA = (lr ?? []).length
  const { data: lb } = custA ? await raw.from('buildings').select('id').eq('customer_id', custA) : { data: [] }
  left.buildingsA = (lb ?? []).length
  const { data: lf } = custA ? await raw.from('fire_plan_forms').select('customer_id').eq('customer_id', custA) : { data: [] }
  left.formsA = (lf ?? []).length
  console.log('[정리 확인] 잔존:', JSON.stringify(left))
  summary()
}
