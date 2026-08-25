// 소방계획서_28 — 점검표 입력 전용 페이지: **동시 편집 보호** E2E
//
// 왜 이 파일이 따로 있나: 전용 페이지(A)는 주 입력 경로인데 원격 변경 감지가 없어
// 두 사람이 같은 점검을 열면 **조용히 덮어썼다**. 드로어(B)에만 있던 보호를 이식한 뒤,
// "정말 막히는가"를 코드 존재가 아니라 **브라우저 + DB 실측**으로 못 박는다.
//
// 축 4개 — 이식 전에는 ②③④가 전부 실패한다(대조군):
//   ① 편집 중이 아니면 배너 없이 조용히 최신으로 (낡은 baseline이 남으면 다음 토글이 남의 행을 지운다)
//   ② 편집 중 원격 변경 → 배너 + 자동저장 pause
//   ③ pause 동안 내 입력이 DB로 나가지 않는다 (= 덮어쓰기 차단)
//   ④ [최신 불러오기] → 원격 값이 화면에 오고 자동저장이 재개된다
//
// 실행: npx tsx scripts/test-sheet-entry-concurrent.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'sheet-conc-e2e@erp-test.com'
const EMAIL2 = 'sheet-conc-other@erp-test.com'
let userId = ''
let otherId = ''
let customerId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const F_INPUT = '소화기구 및 자동소화장치'

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** DB 실측 — 그 항목의 현재 결과(없으면 null). 화면 숫자를 화면 코드로 검산하지 않는다 */
async function dbResult(code: string): Promise<string | null> {
  const { data } = await raw.from('inspection_sheet_responses')
    .select('result').eq('inspection_id', inspId).eq('item_code', code).maybeSingle()
  return (data as { result: string } | null)?.result ?? null
}
async function waitDb(code: string, want: string | null, ms = 12000): Promise<string | null> {
  const end = Date.now() + ms
  let cur: string | null = null
  for (;;) {
    cur = await dbResult(code)
    if (cur === want || Date.now() > end) return cur
    await sleep(400)
  }
}

/** 다른 사람의 저장 — 서버 액션이 쓰는 것과 같은 컬럼 축(updated_by가 나와 달라야 에코로 안 먹힌다) */
async function remoteWrite(code: string, result: 'O' | 'X' | 'N') {
  const { error } = await raw.from('inspection_sheet_responses').upsert({
    inspection_id: inspId, item_code: code, result, month: 0,
    memo: null, updated_by: otherId, updated_at: new Date().toISOString(),
  }, { onConflict: 'inspection_id,item_code,month' })
  if (error) throw new Error(`원격 저장 실패(${code}): ${error.message}`)
}

try {
  userId = await mkUser({ email: EMAIL, name: '동시편집E2E', employeeId: 'E2E-SEC' })
  otherId = await mkUser({ email: EMAIL2, name: '원격편집자', employeeId: 'E2E-SEC2' })
  customerId = await mkCustomer({ customer_name: '동시편집E2E고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert([
    { building_id: bld!.id, category: '소화설비', facility_code: F_INPUT, installed: true },
  ])
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))

  const URL_ = `${BASE}/inspections/${inspId}/sheet?facility=${encodeURIComponent(F_INPUT)}`
  await login(page, EMAIL)
  await page.goto(URL_)
  await page.waitForSelector('text=점검표 입력 —')
  await page.waitForSelector('button:text-is("○")', { timeout: 20000 })

  // 항목 코드는 DOM에서 — 화면에 실제로 그려진 in-scope 항목이어야 클릭이 성립한다
  const codes: string[] = await page.$$eval('button[aria-label$=" O"]',
    (els: Element[]) => els.map(e => (e.getAttribute('aria-label') ?? '').replace(/ O$/, '')))
  check('항목 4개 이상 확보', codes.length >= 4, `${codes.length}개`)
  const [itemD, itemA, itemB, itemC] = codes
  console.log(`  · itemD(내 저장→원격변경)=${itemD} / itemA(✕ 편집중)=${itemA} / itemB(원격 신규)=${itemB} / itemC(차단 대상)=${itemC}`)

  const oOn = (c: string) => page.locator(`button[aria-label="${c} O"].bg-green-500`)
  const xOn = (c: string) => page.locator(`button[aria-label="${c} X"].bg-red-500`)
  const staleBanner = page.locator('[data-testid="sheet-entry-stale"]')
  check('시작 시 배너 없음', !(await staleBanner.isVisible()))

  // ── ① 편집 중이 아닐 때: 배너 없이 조용히 최신으로 ──────────────────────────────
  await page.locator(`button[aria-label="${itemD} O"]`).click()
  check('내 저장 — itemD=O 가 DB에 기록', (await waitDb(itemD, 'O')) === 'O')
  await sleep(2600)   // 내 저장 에코 창(2s)을 넘긴다 — 안 넘기면 갱신이 에코로 무시된다

  await remoteWrite(itemD, 'X')   // 다른 사람이 같은 항목을 불량으로 바꿨다
  const gotX = await xOn(itemD).waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false)
  check('★ 편집 중이 아니면 원격 변경이 화면에 조용히 반영(새로고침 없이)', gotX,
    gotX ? '' : `itemD ${itemD} 가 여전히 ○ — 낡은 baseline이 남는다(다음 토글이 남의 행을 지운다)`)
  check('★ 편집 중이 아니면 배너를 띄우지 않는다', !(await staleBanner.isVisible()))

  // ── ② 편집 중 원격 변경 → 배너 + pause ────────────────────────────────────────
  // ✕는 훅 계약 ①로 자동저장을 예약하지 않는다 → dirty가 유지되는 결정적 '편집 중' 상태
  await page.locator(`button[aria-label="${itemA} X"]`).click()
  await sleep(2500)
  check('✕는 자동저장 대상이 아니다(훅 계약 ①) — DB 무기록', (await dbResult(itemA)) === null)

  await remoteWrite(itemB, 'O')
  const gotBanner = await staleBanner.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false)
  check('★ 편집 중 원격 변경 → stale 배너', gotBanner)

  // ── ③ pause 동안 내 입력이 DB로 나가지 않는다 (덮어쓰기 차단) ──────────────────
  await page.locator(`button[aria-label="${itemC} O"]`).click()
  const paused = await page.locator('[data-testid="sheet-entry-autosave"][data-status="paused"]')
    .waitFor({ state: 'attached', timeout: 10000 }).then(() => true).catch(() => false)
  // 상세 문구도 실패하면 안 된다 — 대조군에는 이 칩 자체가 없어 getAttribute가 던진다
  const chipStatus = await page.locator('[data-testid="sheet-entry-autosave"]')
    .getAttribute('data-status', { timeout: 3000 }).catch(() => '(칩 없음)')
  check('★ 자동저장이 멈춘다 — 칩 status=paused', paused, `실제=${chipStatus}`)
  await sleep(4000)   // 디바운스(1s)를 한참 넘겨도 나가면 안 된다
  const leaked = await dbResult(itemC)
  check('★ 덮어쓰기 차단 — pause 중 입력이 DB로 새지 않는다', leaked === null, `itemC=${leaked}`)
  check('원격 변경분은 DB에 그대로', (await dbResult(itemB)) === 'O')

  // ── ④ [최신 불러오기] → 원격 값 반영 + 자동저장 재개 ──────────────────────────
  // 대조군(이식 전)에서도 나머지 축을 보고 끝내기 위해 클릭 실패를 삼키지 않고 check로 남긴다
  const clicked = await page.locator('[data-testid="sheet-entry-load-latest"]')
    .click({ timeout: 10000 }).then(() => true).catch(() => false)
  check('[최신 불러오기] 버튼이 존재한다', clicked)
  const gone = await staleBanner.waitFor({ state: 'hidden', timeout: 20000 }).then(() => true).catch(() => false)
  check('★ [최신 불러오기] 후 배너 해소', gone)
  const showsRemote = await oOn(itemB).waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
  check('★ [최신 불러오기] 후 원격 값(itemB=○)이 화면에 보인다', showsRemote)
  check('불러오기가 원격 값을 되쓰지 않는다(itemB 유지)', (await dbResult(itemB)) === 'O')
  check('불러오기 직후 큐가 옛 입력을 흘려보내지 않는다(itemC 무기록)', (await dbResult(itemC)) === null)

  await page.locator(`button[aria-label="${itemC} O"]`).click()
  check('★ 자동저장 재개 — itemC=O 가 DB에 기록', (await waitDb(itemC, 'O')) === 'O')

} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
  if (otherId) await delUser(otherId)
}
summary('점검표 입력 전용 페이지 — 동시 편집 보호(소방계획서_28)')
