/** 점검일 동기화 단일화 회귀 (소방계획서_24 S12-1 / P-19 · S11-8·S11-13 · 2026-09-12 개편)
 *  실행: npx tsx scripts/test-plan-date-sync.mts   (dev 서버 필요)
 *
 *  왜 이 테스트가 있나 —
 *  점검일을 바꾸는 경로가 여럿인데 `inspections.inspection_start_date` 갱신이 한 곳에만 있으면
 *  나머지 경로가 그 갱신을 우회해, 계획·체크리스트는 새 날짜인데 inspections만 옛 날짜로 남는다.
 *  inspection_start_date는 별지 9호 점검기간·작업대 기간 카드의 원천이라, 화면과 서류가
 *  서로 다른 날짜를 인쇄하게 된다(P-19의 실사고).
 *
 *  2026-09-12 점검확정 화면 폐지로 경로가 줄었다:
 *    · updatePlanItemAction(슬라이드 패널)·bulkConfirmPlanItemsAction(일괄 확정) — 화면과 함께 폐지
 *    · confirmPlanItemStageOneAction·moveMonthlyPlanItemAction — plan-date-actions.ts로 이관(정본 유지)
 *    · 남은 경로: 별지 회차 카드(confirm 직접) · 달력 드래그(moveMonthly) · 데이 패널/문자
 *      일괄 이동(bulkMovePlanDatesAction — 내부에서 위 둘로 태운다)
 *  전건이 확정(confirmed) 상태로 태어나므로(161·162) 셋업도 confirmed로 만든다.
 *
 *  그래서 단언은 여전히 "네 축이 같은 값인가"다:
 *    ① plan_items.scheduled_date  ② plan_items.step1_date
 *    ③ inspection_steps(step 1).due_date  ④ inspections.inspection_start_date
 *
 *  경로는 UI를 흉내내지 않고 **같은 서버 액션을 로그인 세션으로 HTTP 호출**한다
 *  (_judge19-action.mjs) — 코드 경로가 UI와 완전히 동일하다.
 *  액션 id는 점검 달력 번들에서 뽑는다(달력 클라이언트가 moveMonthly·bulkMove를 직접 import).
 *  confirm 경로는 bulkMovePlanDatesAction 1건 호출로 태운다 — 특별점검은 내부에서
 *  confirmPlanItemStageOneAction으로 가므로(sms-actions.ts) 같은 코드 경로다.
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

/** bulkMovePlanDatesAction 반환의 실패 목록(reason들) — 없으면 빈 문자열 */
function failedOf(text: string): string {
  const m = /"failed":(\[[^\]]*\])/.exec(text)
  return m && m[1] !== '[]' ? m[1] : ''
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

    // 액션 id 수집 — 점검 달력 번들에 실려 있다 (점검확정 화면 폐지 후의 유일한 달력 창구)
    await page.goto(`${BASE}/inspections/calendar`, { waitUntil: 'networkidle' })
    const urls = [...scripts]
    const moveId = await findActionId(page, 'moveMonthlyPlanItemAction', urls)
    const bulkMoveId = await findActionId(page, 'bulkMovePlanDatesAction', urls)
    check('서버 액션 id 2종 추출(달력 번들)', !!(moveId && bulkMoveId),
      `move=${!!moveId} bulkMove=${!!bulkMoveId}`)
    if (!moveId || !bulkMoveId) throw new Error('액션 id 추출 실패 — dev 서버인지 확인')

    /** 자체점검 계획 항목 1건 — 전건 확정 체계(161·162)라 confirmed로 태어난다.
     *  점검은 아직 시작 전(미연결) — 날짜 적용(bulkMove→confirm 경유)이 자동 시작까지 민다 */
    async function mkSelfItem(day: number) {
      const cid = await mkCustomer({ customer_name: `동기화${SUF}-${custIds.length + 1}`, created_by: userId, region_si: '양평군', region_myeon: '강하면', region_ri: '전수리' })
      custIds.push(cid)
      const { data, error } = await raw.from('inspection_plan_items').insert({
        plan_id: planId, customer_id: cid, sequence_num: 1,
        inspection_type: '작동', plan_type: 'special_작동',
        scheduled_date: D(day), planned_date: D(day), status: 'confirmed',
      }).select('id').single()
      if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)
      return (data as any).id as string
    }

    /** 특별점검 날짜 적용 — bulkMovePlanDatesAction 1건 호출(내부에서 confirm으로 태운다) */
    async function applyDate(itemId: string, date: string) {
      return await callAction(page, bulkMoveId!, [[itemId], date])
    }

    console.log('\n— ① 특별점검 날짜 적용 (bulkMove → confirmPlanItemStageOneAction 경유) — P-19가 갈라놓던 경로')
    const it1 = await mkSelfItem(10)
    const r1a = await applyDate(it1, D(10))
    check('날짜 적용이 거부되지 않는다', !failedOf(r1a.text), failedOf(r1a.text))
    let a = await axes(it1)
    check('날짜 적용 시 점검이 자동 생성된다(확정=시작, 2026-07-23 규약 유지)', !!a.inspId, JSON.stringify(a))
    allFour('적용 직후 네 축 일치', a, D(10))

    const r1b = await applyDate(it1, D(17))
    check('재적용(이동)이 거부되지 않는다(1단계 미완료)', !failedOf(r1b.text), failedOf(r1b.text))
    a = await axes(it1)
    allFour('★ 이동 후 네 축 일치 — 수정 전에는 inspections.start만 옛 날짜로 남았다', a, D(17))

    console.log('\n— ② 정기 드래그 (moveMonthlyPlanItemAction) — 정기는 6단계가 없어 두 축만 본다')
    const cidM = await mkCustomer({ customer_name: `동기화${SUF}-정기`, created_by: userId, region_si: '양평군', region_myeon: '양평읍' })
    custIds.push(cidM)
    const { data: mItem } = await raw.from('inspection_plan_items').insert({
      plan_id: planId, customer_id: cidM, sequence_num: 1,
      inspection_type: '작동', plan_type: 'monthly',
      scheduled_date: D(14), planned_date: D(14), status: 'confirmed',
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
    await applyDate(it5, D(15))
    const a5 = await axes(it5)
    await raw.from('inspection_steps').update({ status: 'completed' })
      .eq('inspection_id', a5.inspId!).eq('step_num', 1)

    const g1 = await applyDate(it5, D(22))
    check('★ 날짜 적용 경로가 가드에 막힌다 — 수정 전에는 canManage만 검사해 통과했다',
      /1단계.*완료|점검 상세에서 변경/.test(failedOf(g1.text)), failedOf(g1.text) || g1.text.slice(-160))
    const aG = await axes(it5)
    check('막힌 뒤 날짜가 실제로 안 바뀐다', aG.scheduled === D(15) && aG.startDate === D(15),
      `scheduled=${aG.scheduled} start=${aG.startDate}`)

    console.log('\n— 다일 점검 보정: 종료일이 새 시작일보다 앞서면 함께 민다')
    const it6 = await mkSelfItem(16)
    await applyDate(it6, D(16))
    const a6 = await axes(it6)
    await raw.from('inspections').update({ inspection_end_date: D(17) }).eq('id', a6.inspId!)
    await applyDate(it6, D(24))
    const a6b = await axes(it6)
    check('시작일 이동 시 앞선 종료일도 함께 이동',
      a6b.startDate === D(24) && a6b.endDate === D(24), `start=${a6b.startDate} end=${a6b.endDate}`)

    // 종료일이 뒤에 있으면 건드리지 않는다 — 다일 점검 기간을 임의로 줄이면 안 된다
    await raw.from('inspections').update({ inspection_end_date: D(28) }).eq('id', a6.inspId!)
    await applyDate(it6, D(25))
    const a6c = await axes(it6)
    check('종료일이 뒤에 있으면 유지(기간을 임의로 줄이지 않는다)',
      a6c.startDate === D(25) && a6c.endDate === D(28), `start=${a6c.startDate} end=${a6c.endDate}`)

    console.log('\n— 단일 경로 보증(정적): inspections.inspection_start_date를 쓰는 곳이 늘지 않았는가')
    const { readFileSync } = await import('node:fs')
    const startSync = readFileSync('src/lib/inspection-start.ts', 'utf8')
    const planActions = readFileSync('src/app/(dashboard)/inspections/plan-date-actions.ts', 'utf8')
    check('syncInspectionVisitDate가 inspection-start.ts에 있다', /export async function syncInspectionVisitDate/.test(startSync))
    check('plan-date-actions에 inspections 직접 갱신이 남아 있지 않다(동기화는 헬퍼로만)',
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
