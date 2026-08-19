/** 지역 묶음 일괄 날짜 이동 — 건별 실패 반환 (소방계획서_24 S11-9 / Q-16 · S12②)
 *  실행: npx tsx scripts/test-sms-bulk-move.mts   (dev 서버 필요)
 *
 *  왜 이 테스트가 있나 —
 *  "다음 주 강하면 5곳을 하루에" 몰아 도는 실무를 위해 일괄 이동을 만들었다. 이때
 *  **건별 실패를 삼키면** 담당자는 5건이 다 옮겨진 줄 알고 안 옮겨진 곳에 안 간다.
 *  그래서 이 기능의 계약은 "몇 건 옮겼고 **무엇이 왜 실패했는지**"를 돌려주는 것이다.
 *
 *  단언 대상(S11-9):
 *    ① 5건 중 1건이 1단계 완료 → 4건 이동 · 1건 실패(사유 포함)
 *    ② 정기(monthly)가 다른 달로 섞이면 그 건만 실패
 *    ③ 이동 후 기발송 건은 다시 '미발송'으로 잡힌다(재안내 판단 — 발송 판정이 고객×방문일 쌍이므로)
 *
 *  경로는 UI를 흉내내지 않고 **같은 서버 액션을 로그인 세션으로 HTTP 호출**한다
 *  (_judge19-action.mjs) — 코드 경로가 화면과 동일하다.
 */
import { chromium, type Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, login, check, summary } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼
import { findActionId, collectScripts, callAction } from './_judge19-action.mjs'

const SUF = Math.random().toString(36).slice(2, 7)
const EMAIL = `bulkmove.${SUF}@e2e.test`

/** 액션 반환에서 moved / failed 를 긁는다 */
function movedOf(text: string): number {
  const m = /"moved":(\d+)/.exec(text)
  return m ? Number(m[1]) : -1
}
function failedReasons(text: string): string[] {
  // failed 배열의 reason 값들만 — 순서는 요청 순서를 따른다
  return [...text.matchAll(/"reason":"((?:[^"\\]|\\.)*)"/g)].map(m => m[1])
}

async function main() {
  const browser = await chromium.launch()
  const page: Page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  const scripts = collectScripts(page)

  let userId: string | null = null
  const custIds: string[] = []
  const plansCreated: Array<{ id: string; created: boolean }> = []

  try {
    userId = await mkUser({ email: EMAIL, name: `일괄이동${SUF}`, employeeId: `BM-${SUF}`, role: 'admin' })
    await login(page, EMAIL, PW)

    // 계획 월 = 다음 달(과거로 밀리지 않게), 비교용으로 그 다음 달도 만든다
    const now = new Date(Date.now() + 9 * 3600_000)
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    const y = base.getUTCFullYear(), mo = base.getUTCMonth() + 1
    const nxt = new Date(Date.UTC(y, mo, 1))            // 그 다음 달
    const y2 = nxt.getUTCFullYear(), mo2 = nxt.getUTCMonth() + 1
    const D  = (d: number) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const D2 = (d: number) => `${y2}-${String(mo2).padStart(2, '0')}-${String(d).padStart(2, '0')}`

    const p1 = await ensurePlan(y, mo, userId); plansCreated.push(p1)
    const planId = p1.id

    // 액션 id는 **그 화면 번들**에만 실린다 — 두 화면을 모두 훑어야 둘 다 잡힌다
    // (bulkMove=문자 발송 / confirm=점검확정)
    await page.goto(`${BASE}/inspections/sms`, { waitUntil: 'networkidle' })
    await page.goto(`${BASE}/inspection-plans`, { waitUntil: 'networkidle' })
    const urls = [...scripts]
    const bulkMoveId = await findActionId(page, 'bulkMovePlanDatesAction', urls)
    const confirmId  = await findActionId(page, 'confirmPlanItemStageOneAction', urls)
    check('서버 액션 id 추출(bulkMove·confirm)', !!(bulkMoveId && confirmId),
      `bulkMove=${!!bulkMoveId} confirm=${!!confirmId}`)
    if (!bulkMoveId || !confirmId) throw new Error('액션 id 추출 실패 — dev 서버인지 확인')

    /** 계획 항목 1건 — planType 지정 가능(자체점검 / 정기) */
    async function mkItem(day: number, planType: 'special_작동' | 'monthly', name: string) {
      const cid = await mkCustomer({
        customer_name: `일괄이동${SUF}-${name}`, created_by: userId,
        region_si: '양평군', region_myeon: '강하면', region_ri: '전수리',
      })
      custIds.push(cid)
      const { data, error } = await raw.from('inspection_plan_items').insert({
        plan_id: planId, customer_id: cid, sequence_num: 1,
        inspection_type: planType === 'monthly' ? '작동' : '작동',
        plan_type: planType,
        scheduled_date: D(day), status: 'planned',
      }).select('id').single()
      if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)
      return { itemId: (data as { id: string }).id, custId: cid }
    }

    console.log('\n— ① 5건 중 1건이 1단계 완료 → 4건 이동 · 1건 실패')
    const five: Array<{ itemId: string; custId: string }> = []
    for (let i = 0; i < 5; i++) five.push(await mkItem(10 + i, 'special_작동', `A${i + 1}`))

    // 전부 확정 → 점검 자동 시작(자체점검은 확정=시작)
    for (const f of five) await callAction(page, confirmId, [f.itemId, D(10)])

    // 5건 중 1건만 1단계 완료로 — 가드에 걸릴 건
    const blocked = five[2]
    const { data: bItem } = await raw.from('inspection_plan_items')
      .select('inspection_id').eq('id', blocked.itemId).single()
    const blockedInspId = (bItem as { inspection_id: string | null } | null)?.inspection_id
    check('가드 대상 건에 점검이 생성됐다', !!blockedInspId, String(blockedInspId))
    await raw.from('inspection_steps')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('inspection_id', blockedInspId).eq('step_num', 1)

    const target = D(20)
    const r1 = await callAction(page, bulkMoveId, [five.map(f => f.itemId), target])
    check('★ 5건 중 4건 이동', movedOf(r1.text) === 4, `moved=${movedOf(r1.text)} | ${r1.text.slice(-300)}`)
    const reasons1 = failedReasons(r1.text)
    check('★ 실패 1건이 사유와 함께 반환된다', reasons1.length === 1, JSON.stringify(reasons1))
    check('실패 사유가 1단계 완료를 가리킨다', /1단계|점검일/.test(reasons1[0] ?? ''), reasons1[0] ?? '(없음)')

    // 실제 DB에서도 4건만 옮겨졌는가 — 반환값과 데이터가 갈라지지 않는지
    const { data: after1 } = await raw.from('inspection_plan_items')
      .select('id, scheduled_date').in('id', five.map(f => f.itemId))
    const movedRows = (after1 ?? []).filter((r: { scheduled_date: string | null }) => r.scheduled_date === target)
    check('DB 실측도 4건만 이동(반환값과 일치)', movedRows.length === 4, `${movedRows.length}건`)
    const blockedRow = (after1 ?? []).find((r: { id: string }) => r.id === blocked.itemId) as { scheduled_date: string } | undefined
    check('가드에 막힌 건의 날짜는 그대로', blockedRow?.scheduled_date !== target, String(blockedRow?.scheduled_date))

    console.log('\n— ② 정기(monthly)가 다른 달로 섞이면 그 건만 실패')
    const mon = await mkItem(15, 'monthly', 'M1')
    const self = await mkItem(16, 'special_작동', 'A6')
    const crossMonth = D2(10)                       // 계획 월(mo)이 아닌 다음 달
    const r2 = await callAction(page, bulkMoveId, [[mon.itemId, self.itemId], crossMonth])
    const reasons2 = failedReasons(r2.text)
    check('★ 정기는 다른 달로 이동되지 않는다', movedOf(r2.text) === 1,
      `moved=${movedOf(r2.text)} (기대 1 — 자체점검만) | ${r2.text.slice(-300)}`)
    check('★ 정기 실패 사유가 같은 달 제약을 가리킨다',
      reasons2.length === 1 && /같은 달/.test(reasons2[0] ?? ''), JSON.stringify(reasons2))
    const { data: monAfter } = await raw.from('inspection_plan_items')
      .select('scheduled_date').eq('id', mon.itemId).single()
    check('정기 항목 날짜 불변(DB 실측)',
      (monAfter as { scheduled_date: string }).scheduled_date !== crossMonth,
      String((monAfter as { scheduled_date: string }).scheduled_date))
    const { data: selfAfter } = await raw.from('inspection_plan_items')
      .select('scheduled_date').eq('id', self.itemId).single()
    check('같은 요청의 자체점검은 이동됐다(부분 성공)',
      (selfAfter as { scheduled_date: string }).scheduled_date === crossMonth,
      String((selfAfter as { scheduled_date: string }).scheduled_date))

    console.log('\n— ③ 이동 후 기발송 건은 다시 미발송으로 잡힌다(재안내 판단)')
    // 발송 판정은 (고객, 방문일) 쌍이다 — 날짜가 바뀌면 옛 쌍의 sent 이력이 새 날짜를 덮지 않는다
    const moved0 = five[0]
    // kind는 CHECK(pre_visit|manual|adhoc) — 다른 값을 넣으면 조용히 실패한다(최초 작성 시 'notice'로 헛발질)
    const { error: logErr } = await raw.from('sms_send_log').insert({
      kind: 'pre_visit', customer_id: moved0.custId, visit_date: D(10),
      status: 'sent', to_phone: '010-0000-0000', trigger: 'manual',
      content: '[E2E] 사전 안내 문자 본문',   // NOT NULL
    })
    check('발송 이력 심기 성공', !logErr, logErr?.message ?? '')
    const { data: pairOld } = await raw.from('sms_send_log')
      .select('id').eq('customer_id', moved0.custId).eq('visit_date', D(10)).eq('status', 'sent')
    const { data: pairNew } = await raw.from('sms_send_log')
      .select('id').eq('customer_id', moved0.custId).eq('visit_date', target).eq('status', 'sent')
    check('옛 방문일에는 발송 이력이 있다', (pairOld ?? []).length === 1, `${(pairOld ?? []).length}건`)
    check('★ 새 방문일에는 발송 이력이 없다 → 재안내 대상으로 되돌아온다',
      (pairNew ?? []).length === 0, `${(pairNew ?? []).length}건`)

    console.log('\n— ④ 입력 가드')
    const r4a = await callAction(page, bulkMoveId, [[], target])
    check('빈 목록은 조용히 0건', movedOf(r4a.text) === 0, r4a.text.slice(-160))
    const r4b = await callAction(page, bulkMoveId, [[five[0].itemId], '2020-01-01'])
    check('지난 날짜로는 이동 불가', /지난 날짜/.test(failedReasons(r4b.text)[0] ?? ''), JSON.stringify(failedReasons(r4b.text)))
    const r4c = await callAction(page, bulkMoveId, [[five[0].itemId], '20260101'])
    check('잘못된 날짜 형식 거부', /형식/.test(failedReasons(r4c.text)[0] ?? ''), JSON.stringify(failedReasons(r4c.text)))
  } finally {
    // 정리 — 고객 그래프를 먼저 지워야 계정이 지워진다
    for (const cid of custIds) { try { await cleanupCustomer(cid) } catch { /* 무시 */ } }
    for (const p of plansCreated) { if (p.created) { try { await raw.from('inspection_plans').delete().eq('id', p.id) } catch { /* 무시 */ } } }
    if (userId) { try { await delUser(userId) } catch { /* 무시 */ } }
    await browser.close()
  }
  summary()
}

main().catch(e => { console.error(e); process.exit(1) })
