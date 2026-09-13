// 미배정 계획 표면화 E2E — **점검 달력** 기준 (2026-09-07 신설 → 2026-09-13 재작성)
//
// 왜 만들었나: 계획 항목은 고객의 담당을 물려받아 태어난다 — 고객이 미배정이면 계획도 미배정으로
// 남고, '누구의 일도 아닌' 채 시기가 지나간다(운영 실사례 규현빌라). 사용자 결정(자동 배정 없음)에
// 따라 **보이게만** 했다.
//
// ⚠ 2026-09-13 재작성 — 종전 판은 점검확정 화면(/inspection-plans)의 **배너 배지 + emp=unassigned
//   필터 + 셀렉트 옵션**을 봤는데, 그 화면이 폐지되며(지금은 /inspections/calendar로 redirect) 검사도
//   함께 죽었다. testid `unassigned-plan-banner`·`plans-customer-search` 계열은 소스에서 사라졌다.
//   **기능이 죽은 게 아니라 달력으로 이관됐다** — 배너·필터 축은 실제로 소멸했고, 표면화는 남았다.
//   그래서 사라진 축을 억지로 되살리지 않고, 지금 실재하는 세 표면으로 계약을 다시 건다:
//
//    ① 데이 패널 행의 빨간 「미배정」 배지 (client :1707) — **완료 건은 이력이라 제외**
//    ② 일반(event) 칩 title의 `·미배정` (client :551)
//    ③ ⭐ 담당자 필터를 걸어도 미배정은 **안 걸러진다** (client :519)
//
//   ③이 이 기능의 핵심이다. 미배정은 '누구의 담당도 아니'므로 담당자로 거르는 순간 화면에서
//   사라지는 것이 자연스러운 구현인데, 그러면 정확히 이 검사가 막으려던 상태 — 아무도 모르는 채
//   시기가 지나가는 것 — 로 돌아간다. ①②만 있으면 그 회귀가 초록으로 통과한다.
//
// 판정은 전부 **이 실행이 심은 TAG 행**으로 좁힌다(스테이징 실데이터 잡음 회피).
// 실행: npx tsx scripts/test-unassigned-surface.mts   (로컬 dev + 스테이징 DB)
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, ensurePlan } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `unassigned.${SUF}@e2e.test`
const TAG = `ZUN${SUF}`

// KST 기준 이번 달. 지연(overdue) 여부가 배지와 무관해야 하므로 날짜는 **오늘**로 고정한다 —
// 과거 날짜를 쓰면 '지연⚠' 배지가 함께 붙어 「미배정」 단언이 그 텍스트에 오염될 수 있다.
const now = new Date(Date.now() + 9 * 3600_000)
const Y = now.getUTCFullYear(), M = now.getUTCMonth() + 1, DAY = now.getUTCDate()
const D = `${Y}-${String(M).padStart(2, '0')}-${String(DAY).padStart(2, '0')}`

let userId = ''
const custIds: string[] = []
let planCreated = false
let planId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** 이름 하나로 고객+계획항목을 만든다. emp=null이면 미배정 */
async function seed(name: string, planType: 'event' | 'monthly', emp: string | null, status = 'confirmed') {
  const full = `${TAG}${name}`
  const cid = await mkCustomer({
    customer_name: full, inspection_type: '일반관리', inspection_category: '일반관리',
    inspection_sub_type: '작동', created_by: userId, assigned_employee_id: emp,
  })
  custIds.push(cid)
  const { error } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: cid, inspection_type: '일반관리',
    inspection_category: '일반관리', inspection_sub_type: '작동',
    plan_type: planType, sequence_num: 1,
    // 점검확정 폐지(마이그 161·162) 후 'planned'는 enum에서 사라졌다 — 종전 셋업 값 그대로 두면 22P02
    planned_date: D, scheduled_date: D, status, assigned_employee_id: emp,
  })
  if (error) throw new Error(`계획 항목 시드 실패(${full}): ${error.message}`)
  return full
}

try {
  userId = await mkUser({ email: EMAIL, name: `미배정${SUF}`, employeeId: `UN-${SUF}`, role: 'admin' })
  const plan = await ensurePlan(Y, M, userId)
  planId = plan.id; planCreated = plan.created

  const NAME_U = await seed('미배정일반', 'event', null)
  const NAME_A = await seed('배정일반', 'event', userId)
  const NAME_C = await seed('완료미배정', 'event', null, 'completed')
  const NAME_MU = await seed('미배정정기', 'monthly', null)

  const l = await launch(); browser = l.browser
  const page: Page = l.page
  page.setDefaultTimeout(20000)
  await login(page, EMAIL, PW)

  const openCalendar = async () => {
    await page.goto(`${BASE}/inspections/calendar`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(600)
  }
  const openDay = async () => {
    await page.locator('.rbc-date-cell:not(.rbc-off-range) button[title="이 날짜의 전체 일정 보기"]',
      { hasText: new RegExp(`^0*${DAY}$`) }).first().click()
    await page.waitForTimeout(400)
  }
  const daySearch = page.locator('input[placeholder="고객명 검색..."]')
  const setDaySearch = async (v: string) => { await daySearch.fill(v); await page.waitForTimeout(400) }
  /** 데이 패널에서 그 고객 행이 「미배정」 배지를 달고 있는가 */
  const rowHasBadge = async (name: string) => {
    const row = page.locator('div', { hasText: name })
    return await page.locator(`text=${name}`).count() > 0
      && await row.locator('span.text-red-500', { hasText: '미배정' }).count() > 0
  }

  await openCalendar()

  // ── [1] 데이 패널 「미배정」 배지 ───────────────────────────────────────────
  console.log('\n[1] 데이 패널 미배정 배지')
  await openDay()
  await setDaySearch(TAG)
  const panelRows = await page.locator('text=' + TAG).count()
  // 공허 통과 방지 — 아래 단언들이 '0행이라 참'인 상태로 초록이 되지 않게 전제를 먼저 못박는다
  check('전제: 데이 패널에 이 실행의 시드가 실렸다', panelRows >= 3, `TAG 매치 ${panelRows}건`)

  const badgeNear = async (name: string) => {
    // 행 컨테이너를 이름으로 특정하고 그 안에서만 배지를 센다 — 패널 전체에서 세면
    // 옆 행의 배지가 이 행의 것으로 둔갑한다(모든 행이 같은 패널 안에 있다)
    const row = page.locator('div.flex', { hasText: name }).last()
    return await row.locator('span:text-is("미배정")').count()
  }
  check('미배정 일반 행에 「미배정」 배지', (await badgeNear(NAME_U)) > 0)
  // 음성 짝 — 이게 없으면 "모든 행에 배지를 붙이는" 구현도 위 단언을 통과한다
  check('[음성] 배정된 행에는 배지가 없다', (await badgeNear(NAME_A)) === 0)
  // client :1707의 `!isCompleted` — 완료 건은 이력이라 미배정이어도 붙이지 않는다
  check('[음성] 완료된 미배정 행에는 배지가 없다(이력이라 제외)', (await badgeNear(NAME_C)) === 0)
  check('정기(monthly) 미배정 행에도 배지 — 계획 유형과 무관', (await badgeNear(NAME_MU)) > 0)

  // ── [2] 일반(event) 칩 title의 ·미배정 ────────────────────────────────────
  console.log('\n[2] 달력 칩 표기')
  await openCalendar()
  await page.getByTestId('cal-customer-search').fill(TAG)
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '일반', exact: true }).click()
  await page.waitForTimeout(600)
  const chipU = await page.locator(`text=${NAME_U}`).first().innerText().catch(() => '')
  const chipA = await page.locator(`text=${NAME_A}`).first().innerText().catch(() => '')
  check('미배정 칩에 ·미배정 표기', chipU.includes('·미배정'), chipU)
  check('[음성] 배정된 칩에는 ·미배정 없음', !!chipA && !chipA.includes('·미배정'), chipA)
  check('칩 라벨이 일반(작동) 형식', /일반\(작동\)/.test(chipU), chipU)

  // ── [3] ⭐ 담당자 필터를 걸어도 미배정은 남는다 (client :519) ──────────────
  console.log('\n[3] 담당자 필터와 무관하게 표시 (핵심 계약)')
  // 전 직원 [해제] = 담당자 필터를 가장 세게 건 상태. 배정된 건은 사라지고 미배정만 남아야 한다.
  await page.getByRole('button', { name: '필터' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '해제', exact: true }).click()
  await page.waitForTimeout(700)
  const uAfter = await page.locator(`text=${NAME_U}`).count()
  const aAfter = await page.locator(`text=${NAME_A}`).count()
  check('전 직원 해제 — 배정된 건은 사라진다(필터가 실제로 걸렸다는 증거)', aAfter === 0, `A=${aAfter}`)
  check('⭐ 전 직원 해제 — 미배정은 그대로 남는다', uAfter > 0, `U=${uAfter}`)
  // 되돌려도 대칭인가 — [전체]로 복구하면 배정 건이 돌아온다(단방향 사고 방지)
  // ⚠ 「전체」 버튼은 화면에 둘이다 — 계획유형 탭(전체/종합/작동/정기/일반)과 직원 필터의 [전체].
  //   `.first()`로 집으면 탭이 눌려 calMode만 바뀌고 직원 선택은 그대로다(빨강의 원인이었다).
  //   직원 필터의 것은 [해제]의 바로 앞 형제 버튼이므로 그것으로 특정한다.
  await page.locator('button:has-text("해제")').locator('xpath=preceding-sibling::button[1]').click()
  await page.waitForTimeout(700)
  check('[전체] 복구 — 배정된 건이 돌아온다', await page.locator(`text=${NAME_A}`).count() > 0)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  for (const cid of custIds) if (cid) await cleanupCustomer(cid)
  if (planCreated && planId) await raw.from('inspection_plans').delete().eq('id', planId)
  if (userId) await delUser(userId)
  if (browser) await browser.close()
}
summary()
