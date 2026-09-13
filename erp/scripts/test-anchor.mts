// 점검일자(기산일) 변경 → 계획 재계산 E2E — 화면→DB 왕복 (2026-07-14 신설 → 2026-09-13 재작성)
//
// 왜 이 검사가 있나: 점검일자(`plan_anchor_date`)는 연간 계획 전체의 기산점이다. 한 칸을 고치면
// 그 고객의 모든 미시작 계획 항목이 새 날로 옮겨간다 — 그런데 **이미 시작한 점검은 옮기면 안 된다**.
// 수행한 점검의 날짜를 나중에 바꾸면 법정 서식(별지 9호 점검기간 등)이 사실과 달라지기 때문이다.
// 그래서 이 축의 핵심 단언은 「옮기는가」가 아니라 **「옮기면 안 될 것을 안 옮기는가」**다.
//
// ⚠ 2026-09-13 재작성 — 종전 판은 폐지된 점검확정 화면(/inspection-plans)의 컬럼·슬라이드 패널을
//   먼저 열었고(지금은 /inspections/calendar로 redirect), 판정 대부분을 `status==='planned'`로
//   걸러 세고 있었다. 점검확정 폐지(마이그 161·162)로 그 enum 값 자체가 사라져 필터가 늘 공집합이
//   되므로 **어느 쪽으로 고쳐도 초록**이 되는 상태였다.
//
//   버린 단언과 이유:
//    · 「확정해지 → planned + 확정일 초기화」·「확정 유지 / 확정해지 후 전체 재계산」 B안 팝업
//      → 계약 자체가 폐지됐다(actions.ts:713 — 확정은 기계 계산값이라 보호할 사람 결정이 없다).
//        지금은 미시작 전건이 기준일을 **자동 동행**하고, 팝업은 「저장하면 이렇게 바뀝니다」
//        미리보기 하나로 바뀌었다.
//    · 「전체 planned 예정일 재계산」의 planned 필터 → 미시작 판정은 제품과 같은 축인
//      **`inspection_id === null`**로 바꿨다(_resetPlanItemsForCustomer:825가 그렇게 판정한다).
//    · 점검유형 종합→작동 동기화(TS-ANCHOR-8·11) → 기산일 축이 아니라 유형 전파 축이다.
//      등재된 `test-reconcile-endstate`·`test-jonghap-parity`가 최종 상태로 이미 덮는다.
//
//   산식(며칠에 앉는가 · 영업일 보정 · 달을 안 벗어남)은 순수·등재된 `test-plan-anchor-axis`가
//   덮는다. 여기서 중복으로 다시 계산하지 않고, **화면에서 고친 값이 DB까지 갔는가**만 본다.
//
// 🚨 지금 이 검사는 **15/2 빨강이고, 두 빨강은 검사 부패가 아니라 제품 결함이다**(2026-09-13 실측).
//   `customers/actions.ts` `_resetPlanItemsForCustomer`가 재계산 대상을
//   `.in('status', ['planned', 'confirmed'])`로 고른다. 그런데 마이그 161·162가 enum에서
//   'planned'를 없앴으므로 이 질의는 **22P02로 통째로 거절**된다("invalid input value for enum
//   plan_item_status"). 코드가 그 error를 안 보고 `if (!items) return`으로 조용히 빠져나가서,
//   **점검일자를 고쳐도 계획 항목이 한 건도 안 움직인다.** 같은 파일 :408에는 이미
//   「enum에서 값이 빠져 문자열로 남기면 쿼리가 죽는다」고 적고 고쳐 둔 자리가 있다 — 여기만 남았다.
//   최악인 점: 저장 전 미리보기(planReconcile)는 **다른 함수**라 「이렇게 바뀝니다」를 정확히
//   보여준다. 사용자는 보여준 대로 됐다고 믿는다.
//   ⚠ `['confirmed']` 한 곳만 고치면 이 검사는 17/0이 된다(2026-09-13 확인). 제품을 고치기 전에는
//     test-all에 등재하지 말 것 — 회귀 게이트가 상시 빨강이면 진짜 회귀가 그 안에 묻힌다.
//
// 실행: npx tsx scripts/test-anchor.mts   (로컬 dev + 스테이징 DB)
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const TAG = `ZAN${SUF}`
const EMAIL = `anchor.${SUF}@e2e.test`

const Y = new Date(Date.now() + 9 * 3600_000).getUTCFullYear()
const ANCHOR0 = `${Y}-03-10`   // 초기 기산일 — '일'이 10일
const ANCHOR1 = `${Y}-03-22`   // 바꿀 기산일 — '일'이 22일(달은 그대로 두고 일만 옮긴다)
const OPEN_M = 11              // 미시작 항목이 앉은 달
const STARTED_M = 12           // 이미 시작한 항목이 앉은 달
const OPEN_D0 = `${Y}-${OPEN_M}-10`
const STARTED_D0 = `${Y}-${STARTED_M}-10`

let userId = ''
let custId = ''
let openItem = '', startedItem = '', inspId = ''
const plansCreated: Array<{ id: string; created: boolean }> = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

type Item = {
  id: string; status: string; planned_date: string | null; scheduled_date: string | null
  inspection_id: string | null; step1_date: string | null
}
async function getItem(id: string): Promise<Item> {
  const { data } = await raw.from('inspection_plan_items')
    .select('id, status, planned_date, scheduled_date, inspection_id, step1_date').eq('id', id).single()
  return data as Item
}
async function getAnchor(): Promise<string | null> {
  const { data } = await raw.from('customers').select('plan_anchor_date').eq('id', custId).single()
  return (data as { plan_anchor_date: string | null }).plan_anchor_date
}
/** RSC 갱신·서버 액션은 늦게 끝난다 — 고정 대기로 판정하면 오탐이 난다 */
async function waitUntil(fn: () => Promise<boolean>, ms = 20000) {
  const start = Date.now()
  while (Date.now() - start < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 700)) }
  return false
}

try {
  userId = await mkUser({ email: EMAIL, name: `기산일${SUF}`, employeeId: `AN-${SUF}`, role: 'admin' })
  // 사용승인일을 **비워 둔다** — 그래야 기산점 해석(resolveAnchor)이 점검일자를 고르고,
  // 이 검사가 고치는 칸이 실제 기산점이 된다(manual 플래그 유무와 무관하게 성립).
  custId = await mkCustomer({
    customer_name: `${TAG}빌딩`, inspection_type: '작동', inspection_category: '소방안전관리',
    inspection_sub_type: '작동', created_by: userId, assigned_employee_id: userId,
    plan_anchor_date: ANCHOR0, use_approval_date: null,
    address: '경기 양평군 테스트로 1', fire_station: '양평소방서', notes: `${TAG} 비고`,
  })

  const mkItem = async (month: number, date: string, started: boolean) => {
    const plan = await ensurePlan(Y, month, userId); plansCreated.push(plan)
    const { data, error } = await raw.from('inspection_plan_items').insert({
      plan_id: plan.id, customer_id: custId, sequence_num: 1,
      inspection_type: '작동', inspection_sub_type: '작동', plan_type: 'monthly',
      // 전건 confirmed로 태어난다 — 'planned'는 마이그 161·162로 enum에서 사라졌다(넣으면 22P02).
      // 미시작 판정은 status가 아니라 inspection_id가 한다.
      status: 'confirmed', planned_date: date, scheduled_date: date, step1_date: date,
      assigned_employee_id: userId,
    }).select('id').single()
    if (error) throw new Error(`계획 항목 시드 실패(${month}월): ${error.message}`)
    const id = (data as { id: string }).id
    if (started) {
      const { data: insp, error: iErr } = await raw.from('inspections').insert({
        customer_id: custId, sequence_num: 1, inspection_type: '작동',
        status: 'in_progress', inspection_start_date: date,
        assigned_employee_id: userId, created_by: userId,
      }).select('id').single()
      if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
      inspId = (insp as { id: string }).id
      await raw.from('inspection_plan_items').update({ inspection_id: inspId }).eq('id', id)
    }
    return id
  }
  openItem = await mkItem(OPEN_M, OPEN_D0, false)
  startedItem = await mkItem(STARTED_M, STARTED_D0, true)

  // 공허 통과 방지 — 아래 단언들이 「행이 없어서 참」이 되지 않게 전제를 먼저 못박는다
  const o0 = await getItem(openItem), s0 = await getItem(startedItem)
  check('전제: 미시작 항목이 심겼다(inspection_id 없음)', o0.inspection_id === null && o0.planned_date === OPEN_D0)
  check('전제: 이미 시작한 항목이 심겼다(inspection_id 있음)', !!s0.inspection_id && s0.planned_date === STARTED_D0)

  const l = await launch(); browser = l.browser
  const page: Page = l.page
  page.setDefaultTimeout(20000)
  await login(page, EMAIL, PW)

  const openDetail = async () => {
    await page.goto(`${BASE}/customers/${custId}`)
    await page.locator('#cf-plan').waitFor()
  }
  // 저장 버튼은 기본정보 폼 안의 것으로 특정한다 — 탭 셸이 다른 패널도 함께 렌더한다
  const infoForm = () => page.locator('form', { has: page.locator('#cf-plan') })
  const setAnchor = async (v: string) => {
    await page.locator('#cf-plan').fill(v)
    await page.waitForTimeout(200)
    await infoForm().getByRole('button', { name: '저장', exact: true }).click()
  }
  const previewTitle = page.locator('text=저장하면 이렇게 바뀝니다')

  // ══ [1] 저장 전 미리보기 → [취소]하면 아무것도 안 바뀐다 ═══════════════════════
  //   음성 짝이다. [2]의 「바뀐다」만 재면 **늘 재계산하는** 구현도 초록이다 —
  //   그러면 실수로 연 칸을 그냥 닫기만 해도 전 고객의 일정이 흔들린다.
  //   (목록 인라인 편집 쪽 미리보기는 등재된 _probe-inline-preview가 본다. 여기는
  //    고객 상세 폼 경로 — previewAckRef를 쓰는 다른 배선이다.)
  console.log('\n[1] 미리보기 → 취소')
  await openDetail()
  await setAnchor(ANCHOR1)
  await previewTitle.waitFor()
  check('기산일을 고치면 저장 전에 미리보기가 뜬다', await previewTitle.count() > 0)
  await page.getByRole('button', { name: /취소 \(변경하지 않음\)/ }).click()
  await page.waitForTimeout(2500)
  check('[음성] 취소 — 고객의 점검일자가 그대로다', await getAnchor() === ANCHOR0, String(await getAnchor()))
  check('[음성] 취소 — 미시작 항목의 예정일도 그대로다', (await getItem(openItem)).planned_date === OPEN_D0)

  // ══ [2] [이대로 저장] → 미시작만 동행, 시작된 건 불가침 ═══════════════════════
  console.log('\n[2] 이대로 저장 → 재계산')
  await openDetail()
  await setAnchor(ANCHOR1)
  await previewTitle.waitFor()
  await page.getByRole('button', { name: '이대로 저장' }).click()
  const moved = await waitUntil(async () => (await getItem(openItem)).planned_date !== OPEN_D0)
  check('고객의 점검일자가 저장됐다', await getAnchor() === ANCHOR1, String(await getAnchor()))

  const o1 = await getItem(openItem)
  const day = Number((o1.planned_date ?? '0000-00-00').slice(8))
  check('★ 미시작 항목의 예정일이 새 기산일의 「일」로 재계산됐다(영업일 보정 포함)',
    moved && (o1.planned_date ?? '').startsWith(`${Y}-${OPEN_M}-`) && day >= 22 && day <= 26,
    String(o1.planned_date))
  check('예정일과 확정일이 함께 움직인다 — 점검일자=점검확정일(2026-09-12)',
    o1.scheduled_date === o1.planned_date, `${o1.scheduled_date} / ${o1.planned_date}`)
  check('단계 마감일은 비워진다 — 시작 시점에 다시 잰다', o1.step1_date === null, String(o1.step1_date))
  check('달은 안 옮긴다 — 항목이 속한 (연,월) plan은 그대로', (o1.planned_date ?? '').slice(0, 7) === `${Y}-${OPEN_M}`)

  const s1 = await getItem(startedItem)
  check('⭐ [음성] 이미 시작한 항목은 한 칸도 안 움직인다(수행한 점검의 날짜를 뒤에서 고치지 않는다)',
    s1.planned_date === STARTED_D0 && s1.scheduled_date === STARTED_D0, JSON.stringify(s1))
  check('⭐ [음성] 시작한 항목의 단계 마감일도 지워지지 않는다', s1.step1_date === STARTED_D0, String(s1.step1_date))

  // ══ [3] 변경 이력 — 실제로 바뀐 한 칸만 남는다 ═══════════════════════════════
  //   폼이 전 필드를 늘 함께 보내므로, 비교 없이 기록하면 「주소·계약일도 바뀜」이라는
  //   허위 이력이 매 저장마다 쌓인다.
  console.log('\n[3] 변경 이력')
  // ⚠ 이력 기록은 저장 액션의 **맨 끝**이다 — 재계산·자리 재배치(reconcileSpecialSlots)가
  //   먼저 끝나야 도달한다. [2]에서 예정일이 바뀐 것만 보고 곧장 읽으면 아직 안 실려 있어
  //   빈 배열이 나온다(실측: 같은 리비전에서 있다/없다가 갈렸다). 도착할 때까지 기다린다.
  const readChanges = async () => {
    const { data } = await raw.from('activity_logs')
      .select('metadata').eq('entity_id', custId).eq('action', 'customer_field_changed')
      .order('created_at', { ascending: false }).limit(1)
    return ((data?.[0] as { metadata: { changes: Array<{ field: string }> } } | undefined)?.metadata?.changes ?? [])
  }
  await waitUntil(async () => (await readChanges()).length > 0, 30000)
  const changes = await readChanges()
  check('전제: 변경 이력이 남았다', changes.length > 0)
  check('[음성] 실제로 바뀐 plan_anchor_date 1건만 — 허위 이력 없음',
    changes.length === 1 && changes[0].field === 'plan_anchor_date', JSON.stringify(changes))

  // ══ [4] 비우기 거부 — 기산점은 필수값 ══════════════════════════════════════
  //   "지우면 폴백 복귀" 설계는 2026-07-14에 폐기됐다. 비우면 계획을 아예 못 세운다.
  console.log('\n[4] 비우기 거부')
  await openDetail()
  await setAnchor('')
  await page.waitForTimeout(2000)
  check('비우고 저장하면 화면이 막는다', await page.getByText('점검일자는 필수입니다', { exact: false }).count() > 0)
  check('[음성] 비우기 시도 뒤에도 DB 값은 그대로다', await getAnchor() === ANCHOR1, String(await getAnchor()))
  check('[음성] 비우기 시도가 계획을 흔들지 않았다',
    (await getItem(openItem)).planned_date === o1.planned_date)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) await cleanupCustomer(custId)
  for (const p of plansCreated) if (p.created) await raw.from('inspection_plans').delete().eq('id', p.id)
  // 자리 재배치(reconcileSpecialSlots)가 내년치 월 헤더를 스스로 만든다 — 내 계정이 만든 것만 걷는다
  // (남이 이미 갖고 있던 헤더는 created_by가 달라 걸리지 않는다). 항목을 지운 뒤라 비어 있다.
  if (userId) await raw.from('inspection_plans').delete().eq('created_by', userId)
  if (userId) await delUser(userId)
  void inspId; void startedItem
}
summary()
