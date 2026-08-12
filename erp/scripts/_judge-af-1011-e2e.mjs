/** [독립 판정] E10-5·E10-8 실주행 — 별지10호 ③ 조립(assembleAnnex1011) + 렌더 결합 확인
 *  실행: node scripts/_judge-af-1011-e2e.mjs   (dev :3000 + 스테이징)
 *  판정자 작성. 작성 패널이 쓰는 saveAnnexInputsAction으로 ③을 저장하고,
 *  getAnnexPreviewHtmlAction('report10')으로 실제 문서 HTML을 받아 단언한다.
 *  정리: finally에서 시드 전량 삭제 + 잔존 0건 재조회.
 */
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = 'judge-af-1011@erp-test.com'
let userId = '', cust = '', bld = '', insp = '', browser = null
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }
const strip = s => s.replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ')

try {
  userId = await mkUser({ email: EMAIL, name: '판정AF2', employeeId: 'JUDGEAF-2' })
  cust = await mkCustomer({
    customer_name: 'JUDGEAF10호고객', address: '경기 양평군 판정로 3', created_by: userId,
    fire_station: '양평소방서', use_approval_date: '2020-03-02',
  })
  await raw.from('customer_contacts').insert({ customer_id: cust, role: '대표', name: '홍대표', phone: '010-1111-2222' })
  {
    const { data, error } = await raw.from('buildings').insert({
      customer_id: cust, building_name: '본관', is_active: true, created_by: userId, purpose: '업무시설',
    }).select('id').single()
    if (error) throw new Error(`건물 생성 실패: ${error.message}`)
    bld = data.id
  }
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-08-03', inspection_end_date: '2026-08-04', inspection_days: 2,
      status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data.id
  }
  // 계획 1건 — 날짜 없이 계획 내용만(→ totalPeriod 자동 산출 불가, E10-8 조건 성립)
  {
    const { error } = await raw.from('inspection_defects').insert({
      inspection_id: insp, defect_name: '유도등 미점등', action_plan: '유도등 교체',
    })
    if (error) throw new Error(`불량 시드 실패: ${error.message}`)
  }

  const l = await launch(); browser = l.browser
  const page = l.page
  const urls = collectScripts(page)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}`, { waitUntil: 'networkidle' })
  const saveId = await findActionId(page, 'saveAnnexInputsAction', urls)
  const prevId = await findActionId(page, 'getAnnexPreviewHtmlAction', urls)
  ok('서버 액션 id 추출', !!saveId && !!prevId)
  if (!saveId || !prevId) throw new Error('액션 id 추출 실패')

  // ── 기준선: ③ 없음 ──
  const base = parseFlight((await callAction(page, prevId, [insp, 'report10'])).text)
  ok('별지10호 미리보기 렌더(기준선)', !base.error && base.html.includes('이행계획서'), base.error)
  ok('기준선 — 요약 행 없음', !base.html.includes('계획 요약') && !/class="row-content row-summary"/.test(base.html))
  ok('기준선 — 계획 행은 그대로', base.html.includes('유도등 교체'))
  ok('기준선 — 총 이행기간 자동 산출 불가(공란)', !/총 \d+일/.test(base.html), '예상 밖 총일수')

  // ── ③ summary + totalDays만 저장 ──
  const saveRes = await callAction(page, saveId,
    [insp, 'report10', { summary: '3분기 내 일괄 정비', totalDays: '7' }])
  ok('saveAnnexInputsAction 오류 없음', !/"error":"[^"]+"/.test(saveRes.text), saveRes.text.slice(-160))

  const after = parseFlight((await callAction(page, prevId, [insp, 'report10'])).text)
  const flat = strip(after.html)

  // E10-5 — 요약 행이 계획 행과 구분되는가
  ok('E10-5 요약 행에 [계획 요약] 태그', /계획 요약\|? ?3분기 내 일괄 정비/.test(flat), flat.slice(flat.indexOf('요약') - 80, flat.indexOf('요약') + 120))
  ok('E10-5 요약 행 배경 구분(row-summary)', /class="row-content row-summary"/.test(after.html))
  ok('E10-5 요약 행 기간칸 = —', /class="row-period row-summary">—</.test(after.html))
  ok('E10-5 요약 행에 날짜 자리표 없음', !/row-summary">\.\s+\./.test(after.html))
  ok('E10-5 계획 행은 태그·배경 없음', /class="row-content">유도등 교체/.test(after.html))

  // E10-8 — 기간 없이 총일수만
  ok('E10-8 "총 7일"이 값 자체로 인쇄', />총 7일</.test(after.html), '미출력')
  ok('E10-8 빈 괄호 "(총" 없음', !after.html.includes('(총'))

  // 기간까지 넣으면 종전 표기로 복귀
  await callAction(page, saveId,
    [insp, 'report10', { summary: '3분기 내 일괄 정비', totalDays: '7', totalPeriod: '2026-08-01 ~ 2026-08-07' }])
  const both = parseFlight((await callAction(page, prevId, [insp, 'report10'])).text)
  ok('E10-8 기간+총일수 → "… (총 7일)"', /2026년 8월 7일 \(총 7일\)/.test(both.html), '표기 불일치')
} catch (e) {
  fail++
  console.log(`  ❌ 예외 — ${e.message}`)
} finally {
  if (browser) await browser.close()
  if (insp) {
    await raw.from('annex_inputs').delete().eq('inspection_id', insp)
    await raw.from('inspection_defects').delete().eq('inspection_id', insp)
    await raw.from('inspections').delete().eq('id', insp)
  }
  if (bld) await raw.from('buildings').delete().eq('id', bld)
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
  const { count: c2 } = await raw.from('annex_inputs').select('id', { count: 'exact', head: true })
  const { data: left } = await raw.from('customers').select('id').eq('customer_name', 'JUDGEAF10호고객')
  console.log(`\n[정리] 잔존 고객 ${left?.length ?? 0}건 · annex_inputs 총 ${c2 ?? 0}건`)
  console.log(`${fail === 0 ? '✅' : '❌'} E10-5·E10-8 실주행 ${pass}/${pass + fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
