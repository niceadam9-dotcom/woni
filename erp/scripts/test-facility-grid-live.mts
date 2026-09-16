/**
 * 시설현황 격자 — **실화면 왕복** (2026-09-16 신설)
 *
 * 순수 검사(`test-facility-status`)는 규칙과 배선을 묻는다. 여기는 그 위 층 —
 * **사람이 격자에 적은 값이 DB를 거쳐 서식 1.1 상자로 돌아오는가**를 실제 브라우저로 본다.
 *
 * 🚨 이 축이 필요한 이유: 이 저장소는 「구조 검사 50/50 초록인데 저장이 전멸」을 겪었다
 *   (`'use server'`에서 타입 재수출 → tsc 0인데 런타임 500). 격리 E2E만이 그걸 잡았다.
 *
 * 판정 축 넷:
 *   [1] 격자가 그려지는가 — 승강기 3 · 주차장(옥내/옥외 + 자주식/기계식 4) · 계단 4
 *   [2] 입력 → 저장 → **DB에 종류별로 들어가고 합계가 파생되는가**(직통+피난)
 *   [3] 되읽기 — 새로고침 후 상자·숫자가 그대로인가
 *   [4] **비우기** — 계단을 지우면 DB가 null이 되는가(옛 합계가 남으면 안 된다)
 *
 * 실행: TEST_BASE_URL=http://localhost:3101 npx tsx scripts/test-facility-grid-live.mts
 */
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, BASE } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-facility-grid@test.local'
let userId: string | null = null
let custId: string | null = null
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** 저장이 **끝날 때까지** 기다린다 — 고정 sleep으로 때우지 않는다.
 *
 *  🚨 dev 서버는 서버 액션을 **처음 부를 때 컴파일**한다. 3초 고정으로 뒀더니 첫 저장만
 *    늦어 「저장이 전멸」한 것처럼 보였고(값은 그 뒤에 멀쩡히 들어왔다), 엉뚱한 단언이
 *    빨개졌다. 기다릴 것은 시간이 아니라 **조건**이다. */
async function pollDb(
  want: (r: Record<string, number | null>) => boolean, ms = 25000,
): Promise<Record<string, number | null>> {
  const t0 = Date.now()
  let last: Record<string, number | null> = {}
  while (Date.now() - t0 < ms) {
    last = await bld()
    if (want(last)) return last
    await new Promise(r => setTimeout(r, 500))
  }
  return last   // 실패해도 마지막 값을 돌려준다 — 단언이 그 값을 근거로 빨개져야 한다
}

/** DB가 실제로 무엇을 들고 있는지 — 화면 말고 컬럼에게 묻는다 */
async function bld(): Promise<Record<string, number | null>> {
  const { data, error } = await raw.from('buildings')
    .select('stairs_count, stair_direct_count, stair_escape_count, stair_special_count, stair_outdoor_count, elevator_count, parking_summary')
    .eq('customer_id', custId!).limit(1).maybeSingle()
  if (error) throw new Error(`건물 조회 실패(${error.code}): ${error.message}`)
  return (data ?? {}) as never
}

try {
  userId = await mkUser({ email: EMAIL, name: '격자검사', employeeId: 'E2E-FG' })
  custId = await mkCustomer({ customer_name: '시설현황격자검사', address: '경기도 양평군 양평읍 1', created_by: userId })
  const { data: b, error: bErr } = await raw.from('buildings').insert({
    customer_id: custId, building_name: '격자동', address: '경기도 양평군 양평읍 1',
    permit_date: '2010-03-04', is_active: true, created_by: userId,
  }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  const bldId = (b as { id: string }).id

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${custId}?tab=buildings`)

  // 폼을 연다 — 격자는 편집 폼 안에 있다
  const grid = page.locator('[data-testid="facility-status-grid"]')
  if (await grid.count() === 0) {
    await page.locator('button:has-text("수정")').first().click().catch(() => {})
  }
  await grid.first().waitFor({ state: 'visible', timeout: 20000 })

  console.log('\n[1] 격자가 서식 1.1 모양으로 그려지는가')
  const txt = (await grid.first().innerText()).replace(/\s+/g, ' ')
  check('승강기 3종이 한 줄에 있다', ['승용', '비상용', '피난용'].every(s => txt.includes(s)), txt.slice(0, 80))
  check('계단 4종이 있다', ['특별피난계단', '직통계단', '피난계단', '옥외계단'].every(s => txt.includes(s)))
  check('주차장 옥내·옥외와 자주식·기계식이 있다',
    txt.includes('옥내') && txt.includes('옥외') && txt.includes('자주식') && txt.includes('기계식'))
  check('전기차충전소 칸이 있다(서식 1.1 13행 셋째 칸)', txt.includes('전기차충전소'))
  /* 🚨 음성 — 「옥내·기계식」 칩은 없어져야 한다(대수칸과 같은 뜻을 두 벌로 받던 자리) */
  check('★ 「옥내·기계식」 칩이 없다(중복 입력구 제거)', !txt.includes('옥내·기계식'), txt.slice(0, 120))
  /* 🚨 **계약을 뒤집었다**(2026-09-16 사용자 요청). 종전엔 「접혀 있다」를 못박았는데,
   *   그 근거였던 실측(지하·지상·옥상 0건)은 「안 쓰인다」가 아니라 **「넣기 어려웠다」**의
   *   결과일 수 있다. 입력을 쉽게 하는 것이 이 작업의 목적이라 **기본 펼침**으로 바꿨다.
   *   낡은 단언을 지우지 않고 **반대 방향으로 갈아끼운다** — 그래야 누가 다시 접었을 때 빨개진다. */
  check('★ 별지 9호 전용 구분이 펼쳐져 있다(한 번 더 안 눌러도 넣을 수 있다)',
    txt.includes('옥내·필로티') && txt.includes('옥내·지하'), txt.slice(0, 160))
  /* ⚠ 그래도 **인쇄처는 구분되어야** 한다 — 펼치는 것과 섞어 놓는 것은 다르다 */
  check('★ 그 무리가 자기 인쇄처를 밝힌다(서식 1.1 칸과 섞이지 않는다)',
    txt.includes('별지 9호 2쪽') && /에만/.test(txt), txt.slice(0, 200))

  console.log('\n[2] 입력 → 저장 → DB (종류별 + 합계 파생)')
  const num = (label: string) => page.getByLabel(label, { exact: true })

  /* 🚨 **저장 버튼이 페이지에 5개**다 — 탭 셸이 전 탭을 동시에 마운트하기 때문이다.
   *   보이는 건 하나뿐이라 `.first()`로도 맞긴 하지만, 의도를 코드에 적어 둔다:
   *   **격자와 같은 폼 안의** 버튼을 누른다. */
  const saveBtn = grid.first()
    .locator('xpath=ancestor::div[.//button[normalize-space()="저장"]][1]')
    .locator('button:has-text("저장")').first()

  /* 🚨 **채우자마자 누르면 안 된다.** `save()`는 클릭 시점 렌더의 `form`을 읽으므로, React가
   *   상태를 반영하기 전에 누르면 **직전 값(빈 칸)으로 저장**된다. 실제로 이 검사가 그렇게
   *   「저장이 전멸」한 것처럼 보였다 — 제품이 아니라 계측기가 틀렸다.
   *   고정 sleep으로 때우지 않는다(느린 날 엉뚱한 항목이 빨개진다). 상태가 반영된
   *   **독립 증거**를 기다린다: 개소를 적으면 그 종류의 상자가 켜진다.
   *   ⚠ 기다리는 대상은 **글자 모양(`☑`)이 아니라 뜻**이다 — 상자와 라벨이 다른 `span`이라
   *     텍스트 매칭은 안 걸리고, 무엇보다 기호를 바꾸면 검사가 조용히 멈춘다.
   *     `BoxCount`가 내는 `aria-label="직통계단 설치|미설치"`가 그 뜻을 그대로 말한다. */
  const settle = async (kind: string, on = true) => {
    await grid.first().locator(`[aria-label="${kind} ${on ? '설치' : '미설치'}"]`)
      .first().waitFor({ state: 'visible', timeout: 5000 })
  }

  await num('직통계단 개소').fill('2')
  await num('피난계단 개소').fill('1')
  await num('특별피난계단 개소').fill('3')
  await num('옥외계단 개소').fill('0')          // 0 = 미설치. 상자가 켜지면 안 된다
  await num('승용 대').fill('4')
  for (const k of ['직통계단', '피난계단', '특별피난계단', '승용']) await settle(k)
  check('★ 옥외계단은 0이라 상자가 안 켜진다(입력 시점)',
    await grid.first().locator('[aria-label="옥외계단 미설치"]').count() === 1)
  await saveBtn.click()
  const d1 = await pollDb(r => r.stair_direct_count != null)
  check('직통 2 · 피난 1 · 특별 3이 종류별로 저장된다',
    d1.stair_direct_count === 2 && d1.stair_escape_count === 1 && d1.stair_special_count === 3, JSON.stringify(d1))
  check("★ 옥외계단 '0'은 0으로 저장된다(모르는 값 아님)", d1.stair_outdoor_count === 0, String(d1.stair_outdoor_count))
  check('★ 합계가 직통+피난 = 3으로 파생된다(손입력 아님)', d1.stairs_count === 3, String(d1.stairs_count))
  check('승강기도 같은 격자에서 저장된다', d1.elevator_count === 4, String(d1.elevator_count))

  console.log('\n[3] 되읽기 — 새로고침해도 그대로인가')
  await page.reload()
  // 저장에 성공하면 폼이 닫힌다 — 닫혀 있으면 다시 열고 본다(닫힘 자체는 저장 성공의 방증)
  if (!(await grid.first().isVisible().catch(() => false))) {
    await page.locator('button:has-text("수정")').first().click().catch(() => {})
  }
  await grid.first().waitFor({ state: 'visible', timeout: 20000 })
  const lit = async (kind: string, on: boolean) =>
    await grid.first().locator(`[aria-label="${kind} ${on ? '설치' : '미설치'}"]`).count() === 1
  check('직통계단 상자가 켜져 있다', await lit('직통계단', true))
  check('특별피난계단 상자도 켜져 있다', await lit('특별피난계단', true))
  check('★ 옥외계단 상자는 꺼져 있다(0개소)', await lit('옥외계단', false))
  check('개소가 되읽힌다', await num('직통계단 개소').inputValue() === '2')

  console.log('\n[4] 비우기 — 지우면 정말 비는가')
  /* 🚨 이 축이 내 실제 결함을 잡았다. `?? undefined`로 보내면 저장 액션이 「안 건드림」으로 읽어
   *   계단을 다 지워도 **옛 합계가 DB에 남는다**(별지 9호가 유령 개소를 계속 인쇄한다).
   *
   *  ⚠ **전제를 먼저 단언한다.** 값이 애초에 안 들어가 있으면 「지웠더니 null」은 공허 통과다 —
   *    이 검사가 실제로 그렇게 초록이었다(저장이 한 건도 안 되던 판에 [4]만 통과했다). */
  const pre = await bld()
  check('전제: 지우기 전에 값이 들어 있다(공허 통과 방지)',
    pre.stair_direct_count === 2 && pre.stairs_count === 3, JSON.stringify(pre))
  const saveBtn2 = grid.first()
    .locator('xpath=ancestor::div[.//button[normalize-space()="저장"]][1]')
    .locator('button:has-text("저장")').first()
  for (const k of ['직통계단', '피난계단', '특별피난계단', '옥외계단']) await num(`${k} 개소`).fill('')
  // 비우면 상자가 꺼진다 — 그게 상태 반영의 증거다(여기서도 고정 sleep에 기대지 않는다)
  for (const k of ['직통계단', '피난계단', '특별피난계단']) await settle(k, false)
  await saveBtn2.click()
  const d2 = await pollDb(r => r.stair_direct_count == null)
  check('★ 계단 4종이 전부 null이 된다', [d2.stair_direct_count, d2.stair_escape_count, d2.stair_special_count, d2.stair_outdoor_count].every(v => v === null), JSON.stringify(d2))
  check('★ 합계도 null이 된다(유령 개소 금지)', d2.stairs_count === null, String(d2.stairs_count))
  check('형제 칸은 안 건드린다(과잉 제거 아님)', d2.elevator_count === 4, String(d2.elevator_count))

  void bldId
} finally {
  await browser?.close().catch(() => {})
  await cleanupCustomer(custId!)
  await delUser(userId!)
}
summary()
