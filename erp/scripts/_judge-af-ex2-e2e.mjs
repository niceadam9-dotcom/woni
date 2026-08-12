/** [독립 판정] EX-2 실주행 — 외관점검표 ③ 입력 → 저장(서버 액션) → 미리보기 반영
 *  실행: node scripts/_judge-af-ex2-e2e.mjs   (dev :3000 + 스테이징, 마이그레이션 126 적용 확인 후)
 *  판정자 작성. 저장은 saveAnnexInputsAction, 반영 확인은 getAnnexPreviewHtmlAction('exterior') —
 *  둘 다 UI가 쓰는 바로 그 서버 액션을 로그인 세션으로 호출한다(외관은 미리보기 UI 진입점이 없다).
 *  정리: finally에서 시드 전량 삭제 + 잔존 0건 재조회.
 */
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { findActionId, collectScripts, callAction, parseFlight } from './_judge19-action.mjs'

const EMAIL = 'judge-af-ex2@erp-test.com'
let userId = '', cust = '', bld = '', insp = '', browser = null
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }

try {
  userId = await mkUser({ email: EMAIL, name: '판정AF', employeeId: 'JUDGEAF-1' })
  cust = await mkCustomer({
    customer_name: 'JUDGEAF외관고객', address: '경기 양평군 판정로 2', created_by: userId,
    fire_station: '양평소방서', use_approval_date: '2020-03-02',
  })
  {
    const { data, error } = await raw.from('buildings').insert({
      customer_id: cust, building_name: '본관', is_active: true, created_by: userId, purpose: '업무시설',
    }).select('id').single()
    if (error) throw new Error(`건물 생성 실패: ${error.message}`)
    bld = data.id
  }
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'monthly',
      inspection_start_date: '2026-06-10', inspection_end_date: '2026-06-10',
      status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`정기 점검 생성 실패: ${error.message}`)
    insp = data.id
  }
  // 외관 시트 응답 1건(X) — EX-1 자동 비고 요약이 있는 상태에서 ③ 비고가 어떻게 붙는지 본다
  await raw.from('inspection_sheet_responses').insert(
    { inspection_id: insp, item_code: 'X1-01', result: 'X', memo: '소화기 압력 미달', updated_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  const urls = collectScripts(page)
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}`, { waitUntil: 'networkidle' })

  const saveId = await findActionId(page, 'saveAnnexInputsAction', urls)
  const prevId = await findActionId(page, 'getAnnexPreviewHtmlAction', urls)
  ok('서버 액션 id 추출(save·preview)', !!saveId && !!prevId, `save=${saveId} preview=${prevId}`)
  if (!saveId || !prevId) throw new Error('액션 id 추출 실패 — 이후 단계 생략')

  // ── 기준선: ③ 저장 전 미리보기 ──
  const base = parseFlight((await callAction(page, prevId, [insp, 'exterior'])).text)
  ok('외관 미리보기 렌더(기준선)', !base.error && base.html.includes('외관점검표'), base.error || base.html.slice(0, 120))
  const baseHasNote = base.html.includes('소화기 압력 미달')
  ok('기준선 — EX-1 자동 비고만 인쇄, ③ 값 없음', baseHasNote && !base.html.includes('판정AF 비고'))

  // ── ③ 저장 (앱 화이트리스트 + DB CHECK 둘 다 통과해야 함) ──
  const saveRes = await callAction(page, saveId,
    [insp, 'exterior', { reportDate: '2026-06-22', note: '판정AF 비고' }])
  const saveTxt = saveRes.text
  ok('saveAnnexInputsAction — 오류 없음(화이트리스트 통과)',
    !/알 수 없는 별지 서식/.test(saveTxt) && !/"error":"[^"]+"/.test(saveTxt), saveTxt.slice(-200))

  const { data: row } = await raw.from('annex_inputs').select('fields')
    .eq('inspection_id', insp).eq('annex_no', 'exterior').maybeSingle()
  ok('DB에 exterior 행이 실제로 저장됨', row?.fields?.note === '판정AF 비고', JSON.stringify(row?.fields ?? null))

  // ── 저장분이 미리보기에 반영되는가 ──
  const after = parseFlight((await callAction(page, prevId, [insp, 'exterior'])).text)
  ok('③ 비고가 미리보기에 반영', after.html.includes('판정AF 비고'), after.error || '미반영')
  ok('③ 비고가 EX-1 자동 요약 뒤에 이어붙음',
    /소화기 압력 미달[\s\S]{0,40}판정AF 비고/.test(after.html.replace(/<[^>]+>/g, '')), '순서 불일치')
  // 점검일 6월 22일 → 표지 6월 행의 '6월 n일'이 10일(자동=점검시작일) → 22일로 바뀐다
  ok('기준선 표지 = 자동값 "6월 10일"', base.html.includes('6월 10일'), '자동 일자 없음')
  ok('③ 점검일(2026-06-22) 반영 → "6월 22일"',
    after.html.includes('6월 22일') && !after.html.includes('6월 10일'), '일자 미반영')

  // 잘못된 서식명은 여전히 거부되는가(제약이 통째로 풀리지 않았는지)
  const bad = await callAction(page, saveId, [insp, 'report99', { note: 'x' }])
  ok('미허용 서식은 화이트리스트가 거부', /알 수 없는 별지 서식/.test(bad.text))
} catch (e) {
  fail++
  console.log(`  ❌ 예외 — ${e.message}`)
} finally {
  if (browser) await browser.close()
  if (insp) {
    await raw.from('annex_inputs').delete().eq('inspection_id', insp)
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', insp)
    await raw.from('inspections').delete().eq('id', insp)
  }
  if (bld) await raw.from('buildings').delete().eq('id', bld)
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
  const { count: c1 } = await raw.from('inspections').select('id', { count: 'exact', head: true }).eq('customer_id', cust || '00000000-0000-0000-0000-000000000000')
  const { count: c2 } = await raw.from('annex_inputs').select('id', { count: 'exact', head: true })
  console.log(`\n[정리] 잔존 점검 ${c1 ?? 0}건 · annex_inputs 총 ${c2 ?? 0}건`)
  console.log(`${fail === 0 ? '✅' : '❌'} EX-2 실주행 ${pass}/${pass + fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
