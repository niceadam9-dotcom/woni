/** 점검일 동기화 단일화 회귀 (소방계획서_24 S12-1 / P-19 · S11-8·S11-13)
 *  실행: npx tsx scripts/test-plan-date-sync.mts   (dev 서버 필요)
 *
 *  왜 이 테스트가 있나 —
 *  점검일을 바꾸는 경로가 5곳인데 `inspections.inspection_start_date` 갱신은
 *  updatePlanItemAction 한 곳에만 있었다. 점검확정 화면의 **인라인 달력**은
 *  confirmPlanItemStageOneAction을 직접 부르므로 그 갱신을 우회했고, 결과적으로
 *  계획·체크리스트는 새 날짜인데 inspections만 옛 날짜로 남았다.
 *  inspection_start_date는 별지 9호 점검기간(report9-actions.ts:447-449)·작업대 기간 카드의
 *  원천이라, 문자·계획 화면과 서류가 서로 다른 날짜를 인쇄하게 된다.
 *
 *  그래서 단언은 "네 축이 같은 값인가"다:
 *    ① plan_items.scheduled_date  ② plan_items.step1_date
 *    ③ inspection_steps(step 1).due_date  ④ inspections.inspection_start_date
 *
 *  경로는 UI를 흉내내지 않고 **같은 서버 액션을 로그인 세션으로 HTTP 호출**한다
 *  (_judge19-action.mjs) — 코드 경로가 UI와 완전히 동일하다.
 */
import { chromium, type Page } from 'playwright'
import { raw, BASE, PW, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, login, check, summary } from './_e2e-helpers.mjs'
import { findActionId, collectScripts, callAction } from './_judge19-action.mjs'

const SUF = Math.random().toString(36).slice(2, 7)
const EMAIL = `datesync.${SUF}@e2e.test`

/** 액션 반환의 error 문자열(있으면) — flight 응답에서 헐겁게 긁는다.
 *  Next는 undefined를 `"$undefined"`로 직렬화하므로 그건 '에러 없음'이다(오탐 방지) */
function errOf(text: string): string {
  const m = /"error":"((?:[^"\\]|\\.)*)"/.exec(text)
  const v = m ? m[1] : ''
  return v === '$undefined' ? '' : v
}

/** 네 축을 한 번에 읽는다 */
async function axes(itemId: string) {
  const { data: item } = await raw.from('inspection_plan_items')
    .select('scheduled_date, step1_date, status, inspection_id').eq('id', itemId).single()
  const inspId = (item as any)?.inspection_id as string | null
  let startDate: string | null = null, endDate: string | null = null, due1: string | null = null
  if (inspId) {
    const { data: insp } = await raw.from('inspections')
      .select('inspection_start_date, inspection_end_date').eq('id', inspId).single()
    startDate = (insp as any)?.inspection_start_date ?? null
    endDate   = (insp as any)?.inspection_end_date ?? null
    const { data: st } = await raw.from('inspection_steps')
      .select('due_date').eq('inspection_id', inspId).eq('step_num', 1).maybeSingle()
    due1 = (st as any)?.due_date ?? null
  }
  return {
    scheduled: (item as any)?.scheduled_date as string | null,
    step1: (item as any)?.step1_date as string | null,
    status: (item as any)?.status as string,
    inspId, due1, startDate, endDate,
  }
}

/** 네 축이 target과 모두 같은가 — 다르면 어느 축이 어긋났는지 그대로 보여준다 */
function allFour(label: string, a: Awaited<ReturnType<typeof axes>>, target: string) {
  const ok = a.scheduled === target && a.step1 === target && a.due1 === target && a.startDate === target
  check(label, ok,
    ok ? '' : `기대 ${target} / scheduled=${a.scheduled} step1=${a.step1} steps.due=${a.due1} inspections.start=${a.startDate}`)
}

async function main() {
  const browser = await chromium.launch()
  const page: Page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  const scripts = collectScripts(page)

  let userId: string | null = null
  const custIds: string[] = []
  let planCreated: { id: string; created: boolean } | null = null

  try {
    userId = await mkUser({ email: EMAIL, name: `동기화${SUF}`, employeeId: `DS-${SUF}`, role: 'admin' })
    await login(page, EMAIL, PW)

    // 계획 월은 '다음 달' — 오늘 기준 과거로 밀리지 않게
    const now = new Date(Date.now() + 9 * 3600_000)
    const y = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
    const mo = now.getUTCMonth() === 11 ? 1 : now.getUTCMonth() + 2
    const pm = `${y}-${String(mo).padStart(2, '0')}`
    const D = (d: number) => `${pm}-${String(d).padStart(2, '0')}`

    planCreated = await ensurePlan(y, mo, userId)
    const planId = planCreated.id

    // 액션 id 수집 — 점검확정 화면이 쓰는 번들에 실려 있다
    await page.goto(`${BASE}/inspection-plans`, { waitUntil: 'networkidle' })
    const urls = [...scripts]
    const confirmId = await findActionId(page, 'confirmPlanItemStageOneAction', urls)
    const updateId  = await findActionId(page, 'updatePlanItemAction', urls)
    const moveId    = await findActionId(page, 'moveMonthlyPlanItemAction', urls)
    const bulkId    = await findActionId(page, 'bulkConfirmPlanItemsAction', urls)
    check('서버 액션 id 4종 추출', !!(confirmId && updateId && moveId && bulkId),
      `confirm=${!!confirmId} update=${!!updateId} move=${!!moveId} bulk=${!!bulkId}`)
    if (!confirmId || !updateId || !moveId || !bulkId) throw new Error('액션 id 추출 실패 — dev 서버인지 확인')

    /** 자체점검 계획 항목 1건 생성 → 확정(=점검 자동 시작)까지 */
    async function mkSelfItem(day: number) {
      const cid = await mkCustomer({ customer_name: `동기화${SUF}-${custIds.length + 1}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
      custIds.push(cid)
      const { data, error } = await raw.from('inspection_plan_items').insert({
        plan_id: planId, customer_id: cid, sequence_num: 1,
        inspection_type: '작동', plan_type: 'special_작동',
        scheduled_date: D(day), status: 'planned',
      }).select('id').single()
      if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)
      return (data as any).id as string
    }

    console.log('\n— ① 인라인 달력 (confirmPlanItemStageOneAction 직접) — P-19가 갈라놓던 경로')
    const it1 = await mkSelfItem(10)
    await callAction(page, confirmId, [it1, D(10)])          // 확정 → 점검 자동 시작
    let a = await axes(it1)
    check('확정 시 점검이 생성된다', !!a.inspId, JSON.stringify(a))
    allFour('확정 직후 네 축 일치', a, D(10))

    const r1 = await callAction(page, confirmId, [it1, D(17)])  // 인라인 달력으로 이동
    check('인라인 달력 이동이 거부되지 않는다(1단계 미완료)', !errOf(r1.text), errOf(r1.text))
    a = await axes(it1)
    allFour('★ 인라인 달력으로 이동 후 네 축 일치 — 수정 전에는 inspections.start만 옛 날짜로 남았다', a, D(17))

    console.log('\n— ② 슬라이드 패널 (updatePlanItemAction)')
    // 자체점검은 확정=자동 시작이고 startInspectionCore가 plan_item.status를 'completed'로 바꾼다
    // (inspection-start.ts:117). 그래서 **시작된 뒤에는 패널 경로가 날짜 변경을 아예 거부**한다
    // (actions.ts:168). 패널이 의미 있게 동작하는 구간은 '아직 시작 전(planned)'이므로 거기서 검증한다.
    const it2 = await mkSelfItem(11)
    const r2 = await callAction(page, updateId, [{ itemId: it2, scheduledDate: D(18) }])
    check('패널 경로가 planned 항목을 확정한다', !errOf(r2.text), errOf(r2.text))
    allFour('패널 저장 후 네 축 일치(확정=자동 시작 시점)', await axes(it2), D(18))

    // 시작된 뒤의 거부는 기존 설계다 — 사실로 고정해 둔다(나중에 완화하면 이 단언이 알려준다)
    const r2b = await callAction(page, updateId, [{ itemId: it2, scheduledDate: D(19) }])
    check('시작된 항목은 패널에서 날짜 변경 거부(기존 설계)',
      /완료·취소된 항목|1단계.*완료/.test(errOf(r2b.text)), errOf(r2b.text))
    check('거부 후 날짜 불변', (await axes(it2)).scheduled === D(18))

    console.log('\n— ③ 별지 회차 확정 모달 (confirmPlanItemStageOneAction — ①과 같은 액션)')
    const it3 = await mkSelfItem(12)
    await callAction(page, confirmId, [it3, D(12)])
    await callAction(page, confirmId, [it3, D(19)])
    allFour('별지 모달 확정 후 네 축 일치', await axes(it3), D(19))

    console.log('\n— ④ 일괄 확정 (bulkConfirmPlanItemsAction) — 확정=점검 생성 시점의 정합')
    const it4 = await mkSelfItem(13)
    const rb = await callAction(page, bulkId, [[it4]])
    check('일괄 확정이 1건 성공', /"confirmed":1/.test(rb.text), rb.text.slice(-200))
    allFour('일괄 확정 후 네 축 일치', await axes(it4), D(13))

    console.log('\n— ⑤ 정기 드래그 (moveMonthlyPlanItemAction) — 정기는 6단계가 없어 두 축만 본다')
    const cidM = await mkCustomer({ customer_name: `동기화${SUF}-정기`, created_by: userId, region_si: '양평군', region_myeon: '양평읍' })
    custIds.push(cidM)
    const { data: mItem } = await raw.from('inspection_plan_items').insert({
      plan_id: planId, customer_id: cidM, sequence_num: 1,
      inspection_type: '작동', plan_type: 'monthly',
      scheduled_date: D(14), status: 'confirmed',
    }).select('id').single()
    const itM = (mItem as any).id as string
    const rm = await callAction(page, moveId, [itM, D(20)])
    check('정기 같은 달 이동은 허용', !errOf(rm.text), errOf(rm.text))
    const am = await axes(itM)
    check('정기 이동 후 scheduled_date 반영', am.scheduled === D(20), String(am.scheduled))
    const rmBad = await callAction(page, moveId, [itM, `${y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-05`])
    check('정기 다른 달 이동은 거부(같은 달 제약)', /같은 달/.test(errOf(rmBad.text)), errOf(rmBad.text))

    console.log('\n— 가드: 1단계 완료 후에는 어느 경로로도 날짜를 못 바꾼다 (S12-3)')
    const it5 = await mkSelfItem(15)
    await callAction(page, confirmId, [it5, D(15)])
    const a5 = await axes(it5)
    await raw.from('inspection_steps').update({ status: 'completed' })
      .eq('inspection_id', a5.inspId!).eq('step_num', 1)

    const g1 = await callAction(page, confirmId, [it5, D(22)])
    check('★ 인라인 달력 경로가 가드에 막힌다 — 수정 전에는 canManage만 검사해 통과했다',
      /1단계.*완료|점검 상세에서 변경/.test(errOf(g1.text)), errOf(g1.text) || g1.text.slice(-160))
    const g2 = await callAction(page, updateId, [{ itemId: it5, scheduledDate: D(22) }])
    check('패널 경로도 막힌다(시작 시 completed가 되어 :168에서 먼저 걸린다)',
      /1단계.*완료|점검 상세에서 변경|완료·취소된 항목/.test(errOf(g2.text)), errOf(g2.text))
    const aG = await axes(it5)
    check('막힌 뒤 날짜가 실제로 안 바뀐다', aG.scheduled === D(15) && aG.startDate === D(15),
      `scheduled=${aG.scheduled} start=${aG.startDate}`)

    console.log('\n— 다일 점검 보정: 종료일이 새 시작일보다 앞서면 함께 민다')
    const it6 = await mkSelfItem(16)
    await callAction(page, confirmId, [it6, D(16)])
    const a6 = await axes(it6)
    await raw.from('inspections').update({ inspection_end_date: D(17) }).eq('id', a6.inspId!)
    await callAction(page, confirmId, [it6, D(24)])
    const a6b = await axes(it6)
    check('시작일 이동 시 앞선 종료일도 함께 이동',
      a6b.startDate === D(24) && a6b.endDate === D(24), `start=${a6b.startDate} end=${a6b.endDate}`)

    // 종료일이 뒤에 있으면 건드리지 않는다 — 다일 점검 기간을 임의로 줄이면 안 된다
    await raw.from('inspections').update({ inspection_end_date: D(28) }).eq('id', a6.inspId!)
    await callAction(page, confirmId, [it6, D(25)])
    const a6c = await axes(it6)
    check('종료일이 뒤에 있으면 유지(기간을 임의로 줄이지 않는다)',
      a6c.startDate === D(25) && a6c.endDate === D(28), `start=${a6c.startDate} end=${a6c.endDate}`)

    console.log('\n— 단일 경로 보증(정적): inspections.inspection_start_date를 쓰는 곳이 늘지 않았는가')
    const { readFileSync } = await import('node:fs')
    const startSync = readFileSync('src/lib/inspection-start.ts', 'utf8')
    const planActions = readFileSync('src/app/(dashboard)/inspection-plans/actions.ts', 'utf8')
    check('syncInspectionVisitDate가 inspection-start.ts에 있다', /export async function syncInspectionVisitDate/.test(startSync))
    check('updatePlanItemAction에 inspections 직접 갱신이 남아 있지 않다',
      !/from\('inspections'\)\s*\.update/.test(planActions),
      (planActions.match(/from\('inspections'\)\s*\.update/g) ?? []).join(','))
    check('확정 함수가 두 분기(정기·자체점검) 모두에서 방문일을 동기화한다',
      (planActions.match(/syncInspectionVisitDate\(/g) ?? []).length === 2,
      String((planActions.match(/syncInspectionVisitDate\(/g) ?? []).length))
  } finally {
    for (const c of custIds) await cleanupCustomer(c)
    if (planCreated?.created) await raw.from('inspection_plans').delete().eq('id', planCreated.id)
    await delUser(userId)
    await browser.close()
  }
  summary()
}

main().catch(e => { console.error(e); process.exit(1) })
