/** 점검달력 데이 패널 — 정기 여러 건 한 번에 날짜 이동 E2E (2026-08-19)
 *  실행: npx tsx scripts/test-calendar-day-bulk-move.mts   (dev 서버 localhost:3000 또는 TEST_BASE_URL)
 *
 *  왜 이 테스트가 있나 —
 *  말일에 28건이 몰린 날을 아이콘 28번 눌러 옮기던 것을 한 번에 하게 만들었다. 다중 선택은
 *  **안 보이는 걸 조용히 고치는** 사고가 나기 쉬워서, 화면 계약 네 가지를 여기서 고정한다:
 *   ① [전체]는 **지금 화면에 보이는 행만** 담는다 (고객명 검색 = 사용자가 명시한 범위)
 *   ② 과거 날짜는 **서버를 부르기 전에** 막는다 (서버가 배치 전체를 거부해 한 건도 안 옮겨진다)
 *   ③ 건별 실패를 삼키지 않는다 — "N건 이동 · M건 실패 — 이름(사유)"가 패널에 남는다
 *   ④ 이동 대상은 정기·미시작뿐 — 일반(event)·이미 시작된 건에는 체크박스가 없다
 *
 *  서버 계약(부분 실패·같은 달 제약)은 scripts/test-sms-bulk-move.mts가 이미 고정한다.
 *  여기는 **화면**이 그 계약을 제대로 쓰는지만 본다.
 *
 *  실데이터가 있는 DB에서도 돌도록 판정은 전부 **이 실행이 심은 TAG 행**으로 좁힌다
 *  (패널 고객명 검색에 TAG를 넣어 화면 자체를 좁히고 센다).
 */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, mkUser, delUser, mkCustomer, cleanupCustomer, ensurePlan, login, launch, check, summary } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `daymove.${SUF}@e2e.test`
const TAG = `ZDM${SUF}`

// KST 기준 오늘 — 이동 목표일은 오늘 이후여야 한다(서버 가드)
const now = new Date(Date.now() + 9 * 3600_000)
const Y = now.getUTCFullYear(), M = now.getUTCMonth() + 1
const curLastDay = new Date(Date.UTC(Y, M, 0)).getUTCDate()
const todayDay = now.getUTCDate()
// 같은 달 안에 '오늘 이후' 날짜가 3개 필요하다 — 없으면(월말) 다음 달로 넘겨 검사한다
const useCurrentMonth = todayDay + 3 <= curLastDay
const base = useCurrentMonth ? new Date(Date.UTC(Y, M - 1, 1)) : new Date(Date.UTC(Y, M, 1))
const PY = base.getUTCFullYear(), PM = base.getUTCMonth() + 1
// ⚠ 말일은 **검사 대상 달(PY/PM)** 기준으로 구한다 — 이번 달(8월=31) 기준을 다음 달(9월)에 쓰면
//   2026-09-31 같은 없는 날짜가 만들어지고, PostgREST가 date 파싱 실패로 질의를 통째로 거절한다
//   (소방계획서_32 F-2). 종전 코드는 그 error를 안 봐서 '공집합'으로 둔갑했다.
const lastDay = new Date(Date.UTC(PY, PM, 0)).getUTCDate()
const D = (d: number) => `${PY}-${String(PM).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const SRC = useCurrentMonth ? todayDay + 2 : 12   // 계획이 몰려 있는 날
const TGT1 = useCurrentMonth ? todayDay + 3 : 13  // 정상 이동 목표
const TGT2 = useCurrentMonth ? todayDay + 1 : 14  // 부분 실패 시나리오 목표

const userIdBox: { id: string | null } = { id: null }
const custIds: string[] = []
const plansCreated: Array<{ id: string; created: boolean }> = []
let browser: import('playwright').Browser | null = null

async function mkItem(planId: string, name: string, planType: 'monthly' | 'event', day: number) {
  const cid = await mkCustomer({ customer_name: `${TAG} ${name}`, created_by: userIdBox.id })
  custIds.push(cid)
  const { data, error } = await raw.from('inspection_plan_items').insert({
    plan_id: planId, customer_id: cid, sequence_num: 1,
    inspection_type: '작동', inspection_sub_type: '작동', plan_type: planType,
    scheduled_date: D(day), planned_date: D(day), status: 'planned',
    assigned_employee_id: null,   // 미배정은 담당자 필터와 무관하게 표시된다(달력 규칙)
  }).select('id').single()
  if (error) throw new Error(`계획 항목 생성 실패: ${error.message}`)
  return { itemId: (data as { id: string }).id, custId: cid, name: `${TAG} ${name}` }
}

async function main() {
  const l = await launch(); browser = l.browser
  const page: Page = l.page
  page.setDefaultTimeout(20000)

  userIdBox.id = await mkUser({ email: EMAIL, name: `데이이동${SUF}`, employeeId: `DM-${SUF}`, role: 'admin' })
  const plan = await ensurePlan(PY, PM, userIdBox.id); plansCreated.push(plan)

  // 정기 5건(이동 가능) + 정기 1건(이미 시작) + 일반 1건 — 모두 같은 날
  const movables = []
  for (let i = 1; i <= 5; i++) movables.push(await mkItem(plan.id, `정기${i}`, 'monthly', SRC))
  const started = await mkItem(plan.id, '시작됨', 'monthly', SRC)
  const eventItem = await mkItem(plan.id, '일반건', 'event', SRC)

  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: started.custId, sequence_num: 1, inspection_type: '작동',
    status: 'in_progress', inspection_start_date: D(SRC),
    assigned_employee_id: userIdBox.id, created_by: userIdBox.id,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  await raw.from('inspection_plan_items').update({ inspection_id: (insp as { id: string }).id }).eq('id', started.itemId)

  // 계획이 하나도 없는 날 — [날짜 이동] 미노출 확인용 (실데이터가 있는 DB에서도 성립하게 DB로 고른다)
  const { data: monthRows, error: mErr } = await raw.from('inspection_plan_items')
    .select('scheduled_date').gte('scheduled_date', D(1)).lte('scheduled_date', D(lastDay))
  // error를 함께 본다 — 안 보면 질의 거절이 '그 달엔 계획이 하나도 없다'로 둔갑해
  // emptyDay=1이 되고, 실제로는 계획이 있는 날을 '빈 날'로 골라 엉뚱한 곳에서 실패한다
  if (mErr) throw new Error(`월 계획 조회 실패: ${mErr.message}`)
  const busy = new Set(((monthRows ?? []) as Array<{ scheduled_date: string }>).map(r => r.scheduled_date))
  let emptyDay = 0
  for (let d = 1; d <= lastDay; d++) if (!busy.has(D(d))) { emptyDay = d; break }

  await login(page, EMAIL, PW)

  const openCalendar = async () => {
    await page.goto(`${BASE}/inspections/calendar`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(600)
    if (!useCurrentMonth) { await page.click('button[title="다음"]'); await page.waitForTimeout(500) }
  }
  // 날짜 라벨은 0 채움("01")이고 앞뒤 달 셀도 같은 숫자를 쓴다 → 현재 달 셀(:not(.rbc-off-range))에서만 고른다
  const openDay = async (day: number) => {
    await page.locator('.rbc-date-cell:not(.rbc-off-range) button[title="이 날짜의 전체 일정 보기"]',
      { hasText: new RegExp(`^0*${day}$`) }).first().click()
    await page.waitForTimeout(400)
  }
  const toggle = page.getByTestId('day-move-toggle')
  const bar = page.getByTestId('day-move-bar')
  const checks = page.getByTestId('day-move-check')
  const result = page.getByTestId('day-move-result')
  const search = page.locator('input[placeholder="고객명 검색..."]')
  const setSearch = async (v: string) => { await search.fill(v); await page.waitForTimeout(400) }
  /** 히든 date 입력에 값을 넣는다 — showPicker()는 스크립트로 못 연다 */
  const pickDate = async (iso: string) => {
    await page.getByTestId('day-move-pick-input').evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, iso)
    await page.waitForTimeout(500)
  }
  const barText = async () => (await bar.textContent()) ?? ''
  /** RSC 갱신(router.refresh)은 늦게 도착한다 — 고정 대기로 판정하면 오탐이 난다 */
  const waitUntil = async (fn: () => Promise<boolean>, ms = 15000) => {
    const start = Date.now()
    while (Date.now() - start < ms) { if (await fn()) return true; await page.waitForTimeout(500) }
    return false
  }

  console.log(`\n[셋업] ${TAG} · ${D(SRC)} → ${D(TGT1)} / ${D(TGT2)} · 빈 날 ${emptyDay || '(없음)'}`)

  console.log('\n[1] 토글 노출')
  await openCalendar()
  if (emptyDay) {
    await openDay(emptyDay)
    check('1-1 이동 대상이 없는 날엔 [날짜 이동]이 없다', await toggle.count() === 0)
    await page.locator('div.fixed.top-0.right-0 button').first().click()   // 패널 닫기(X)
    await page.waitForTimeout(300)
  } else {
    console.log('  (이 달에 빈 날이 없어 1-1은 건너뜀)')
  }
  await openDay(SRC)
  check('1-2 계획이 있는 날엔 [날짜 이동] 노출', await toggle.isVisible())
  check('1-3 켜기 전에는 선택 바가 없다', await bar.count() === 0)

  console.log('\n[2] 선택 모드 — 대상은 정기·미시작뿐')
  await toggle.click()
  await page.waitForTimeout(300)
  check('2-1 선택 바 노출', await bar.isVisible())
  await setSearch(TAG)   // 이 실행이 심은 7건(정기5 + 시작됨1 + 일반1)만 남긴다
  const boxCount = await checks.count()
  check('2-2 ★ 체크박스는 이동 가능한 정기 5건뿐(일반·시작됨 제외)', boxCount === 5, `${boxCount}개`)
  check('2-3 행의 개별 [날짜 이동] 아이콘은 감춰진다',
    await page.locator('button[title^="날짜 이동 — 달력"]').count() === 0)
  check('2-4 [이날 전체 완료]는 비활성',
    await page.getByRole('button', { name: /이날 전체 완료/ }).isDisabled())
  check('2-5 [날짜 선택]은 0건 선택 상태에서 비활성',
    await page.getByTestId('day-move-pick').isDisabled())

  console.log('\n[3] ★ [전체]는 보이는 행만 담는다 (고객명 검색 = 명시한 범위)')
  await setSearch(`${TAG} 정기1`)
  check('3-1 검색으로 1건만 남는다', await checks.count() === 1, `${await checks.count()}개`)
  await page.getByTestId('day-move-all').click()
  await page.waitForTimeout(200)
  check('3-2 ★ [전체]가 5건이 아니라 보이는 1건만 담는다', (await barText()).includes('1건 선택'), await barText())
  await setSearch(TAG)
  check('3-3 검색을 넓혀도 선택은 유지된다(1건 그대로)', (await barText()).includes('1건 선택'), await barText())
  await page.getByTestId('day-move-clear').click()
  await page.waitForTimeout(200)
  check('3-4 [해제]로 전부 비운다', await page.getByTestId('day-move-pick').isDisabled())

  console.log('\n[4] ★ 과거 날짜는 서버를 부르기 전에 막는다')
  await page.getByTestId('day-move-all').click()
  await page.waitForTimeout(200)
  if (useCurrentMonth && todayDay > 1) {
    let posts = 0
    const countPost = (req: { method(): string }) => { if (req.method() === 'POST') posts++ }
    page.on('request', countPost)
    await pickDate(D(1))
    check('4-1 ★ 과거 날짜 차단 문구', /지난 날짜/.test((await result.textContent()) ?? ''), (await result.textContent()) ?? '(없음)')
    check('4-2 ★ 서버 호출이 없었다(POST 0건)', posts === 0, `POST ${posts}건`)
    check('4-3 확인 팝업은 뜨지 않는다', await page.getByTestId('day-move-confirm').count() === 0)
    page.off('request', countPost)
  } else {
    console.log('  (이번 달에 과거 날짜가 없어 4번은 건너뜀 — 월초에 재실행하면 검사됨)')
  }

  console.log('\n[5] ★ 5건 중 3건만 골라 이동')
  await page.getByTestId('day-move-clear').click()
  const pickIds = movables.slice(0, 3).map(m => m.itemId)
  for (const id of pickIds) await page.locator(`[data-testid="day-move-check"][data-plan-id="${id}"]`).check()
  await page.waitForTimeout(200)
  check('5-1 3건 선택', (await barText()).includes('3건 선택'), await barText())
  await pickDate(D(TGT1))
  const dlg = page.getByTestId('day-move-confirm')
  check('5-2 확인 팝업이 뜬다', await dlg.isVisible())
  const dlgText = (await dlg.locator('xpath=../..').textContent()) ?? ''
  check('5-3 팝업에 건수 표기', /일괄 이동 \(3건\)/.test(dlgText), dlgText.slice(0, 140))
  check('5-4 팝업에 고객명 표기(눈으로 확인하고 누르게)', dlgText.includes(movables[0].name), dlgText.slice(0, 220))
  await dlg.click()
  await page.waitForTimeout(3000)
  check('5-5 ★ 결과 문구', /3건을 .*이동했습니다/.test((await result.textContent()) ?? ''), (await result.textContent()) ?? '(없음)')
  const { data: after } = await raw.from('inspection_plan_items')
    .select('id, scheduled_date').in('id', [...movables.map(m => m.itemId), started.itemId, eventItem.itemId])
  const rows = (after ?? []) as Array<{ id: string; scheduled_date: string }>
  const movedIds = rows.filter(r => r.scheduled_date === D(TGT1)).map(r => r.id)
  check('5-6 ★ DB 실측 3건만 이동', movedIds.length === 3 && pickIds.every(id => movedIds.includes(id)), `${movedIds.length}건`)
  check('5-7 ★ 이미 시작된 정기는 안 움직인다', rows.find(r => r.id === started.itemId)?.scheduled_date === D(SRC))
  check('5-8 ★ 일반(event)도 안 움직인다', rows.find(r => r.id === eventItem.itemId)?.scheduled_date === D(SRC))
  await setSearch(TAG)
  const gone = await waitUntil(async () => await checks.count() === 2)
  check('5-9 이동한 행은 그 날짜에서 사라진다(남은 정기 2건)', gone, `${await checks.count()}개`)

  console.log('\n[6] ★ 건별 실패를 삼키지 않는다')
  await page.getByTestId('day-move-all').click()
  await page.waitForTimeout(200)
  check('6-1 남은 2건 선택', (await barText()).includes('2건 선택'), await barText())
  // 화면이 들고 있는 목록을 낡게 만든다 — 다른 사람이 먼저 처리해버린 실무 상황
  await raw.from('inspection_plan_items').update({ status: 'completed' }).eq('id', movables[3].itemId)
  await pickDate(D(TGT2))
  await page.getByTestId('day-move-confirm').click()
  await page.waitForTimeout(3000)
  const txt = (await result.textContent()) ?? ''
  check('6-2 ★ "1건 이동 · 1건 실패"로 보고', /1건 이동 · 1건 실패/.test(txt), txt)
  check('6-3 ★ 실패한 고객명과 사유가 남는다', txt.includes(movables[3].name) && /완료|취소/.test(txt), txt)
  const { data: after2 } = await raw.from('inspection_plan_items')
    .select('id, scheduled_date').in('id', [movables[3].itemId, movables[4].itemId])
  const rows2 = (after2 ?? []) as Array<{ id: string; scheduled_date: string }>
  check('6-4 성공한 건만 실제로 옮겨졌다',
    rows2.find(r => r.id === movables[4].itemId)?.scheduled_date === D(TGT2)
    && rows2.find(r => r.id === movables[3].itemId)?.scheduled_date === D(SRC),
    JSON.stringify(rows2))

  console.log('\n[7] 패널을 닫으면 선택 모드가 풀린다')
  await openCalendar()
  await openDay(SRC)
  check('7-1 다시 열면 선택 모드 해제', await bar.count() === 0)
}

main()
  .catch(e => { console.error(`\n  ❌ 예외: ${(e as Error).message}\n${(e as Error).stack}`); process.exitCode = 1 })
  .finally(async () => {
    if (browser) await browser.close()
    for (const cid of custIds) { try { await cleanupCustomer(cid) } catch { /* 무시 */ } }
    for (const p of plansCreated) if (p.created) { try { await raw.from('inspection_plans').delete().eq('id', p.id) } catch { /* 무시 */ } }
    if (userIdBox.id) { try { await delUser(userIdBox.id) } catch { /* 무시 */ } }
    summary()
  })
