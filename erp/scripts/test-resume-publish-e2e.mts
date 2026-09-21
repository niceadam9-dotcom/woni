// 복귀 발행(E2E) — 「엑셀 받으려다 점검표 입력하러 간」 뒤를 문다 (2026-09-21 사용자 요청)
//
// 종전 결함: 회차 카드 [엑셀] → 미입력 가드 팝업 → [확인]으로 점검표 화면에 **전체 이동**하는
// 순간 「엑셀을 받으려던 것」이 통째로 사라졌다. 입력을 마치고 돌아와도 사용자가 같은 버튼을
// **다시** 눌러야 했다.
//
// 이 검사가 무는 것은 단위검사(test-pending-doc-intent)가 **원리적으로 못 무는** 것들이다:
//   ㄱ) 쪽지가 **전체 페이지 이동을 건너 살아남는가**(sessionStorage 실측)
//   ㄴ) 돌아왔을 때 **[엑셀]을 누르지 않았는데** 발행이 일어나는가 ← 사용자가 요구한 바로 그것
//   ㄷ) ★ 제스처 없는 `a.click()`이 브라우저에 **실제로 먹히는가** — 코드로는 알 수 없고
//       막히더라도 조용하다. 폴백 배너를 넣은 이유가 이것이라, 여기서 실측해 둬야 한다.
//   ㄹ) ★ **음성 축**: 쪽지 없이 들어온 회차 탭은 **아무것도 발행하지 않는가**(유령 발행 0)
//   ㅁ) ★ one-shot: 소비한 뒤 새로고침하면 **다시 발행되지 않는가**
//
// 규칙 층(TTL·부서진 쪽지·남의 회차 보존)은 test-pending-doc-intent가 덮는다 — 중복하지 않는다.
//
// 실행: npx tsx scripts/test-resume-publish-e2e.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'resume-publish-e2e@erp-test.com'
let userId = ''
let customerId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
const INSTALLED = '소화기구 및 자동소화장치'
/** 쪽지의 저장소 키 — 제품과 같은 문자열이어야 한다(lib/pending-doc-intent) */
const KEY = 'erp.pendingDoc'

try {
  userId = await mkUser({ email: EMAIL, name: '복귀발행E2E', employeeId: 'E2E-RSM' })
  customerId = await mkCustomer({ customer_name: '복귀발행E2E고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert({
    building_id: bld!.id, category: '소화설비', facility_code: INSTALLED, installed: true,
  })
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  // 응답을 **하나도 넣지 않는다** — 그래야 가드가 선다(이 검사의 전제)
  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id').eq('version', 'v2025').ilike('sheet_name', '%소화기구%').limit(1).maybeSingle()
  const { data: sItems } = await raw.from('inspection_sheet_items')
    .select('item_code, comprehensive_only').eq('sheet_id', sheet!.id)
  const opCodes = [...new Set(((sItems ?? []) as Array<{ item_code: string; comprehensive_only: boolean }>)
    .filter(i => !i.comprehensive_only).map(i => i.item_code))]
  check('시드 — 작동 범위 항목 존재', opCodes.length >= 2, `${opCodes.length}개`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  // 🚨 dev 콜드 컴파일 방어 — 이 시나리오는 `?tab=annex`와 `/inspections/{id}/sheet`를 **처음**
  //    밟는다. 갓 띄운 dev 서버에서 두 라우트의 첫 컴파일이 각각 15초(헬퍼 기본값)를 넘겨
  //    **제품이 멀쩡한데 빨강**이 됐다(2026-09-21 실측 — 첫 goto 1회, 가드 클릭 후 이동 1회).
  //    이 저장소가 반복해 밟은 「계측기 탓 거짓 빨강」이라 여기서 못박는다.
  //    ⚠ 판정 완화가 아니다 — 늘리는 것은 **컴파일 대기**이고, 단언의 기대값은 그대로다.
  page.setDefaultTimeout(60_000)
  page.setDefaultNavigationTimeout(60_000)
  const dialogs: string[] = []
  let dialogAction: 'accept' | 'dismiss' = 'accept'
  page.on('dialog', async d => { dialogs.push(d.message()); await (dialogAction === 'accept' ? d.accept() : d.dismiss()) })
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await login(page, EMAIL)

  const ANNEX = `${BASE}/customers/${customerId}?tab=annex`
  const noteOf = () => page.evaluate((k: string) => window.sessionStorage.getItem(k), KEY)

  // ── ① 음성 축 먼저 — 쪽지 없이 들어온 회차 탭은 아무것도 발행하지 않는다 ──
  //    이걸 뒤에 두면 앞선 시나리오가 남긴 상태에 오염된다. **깨끗한 첫 방문**에서 물어야 한다.
  await page.goto(ANNEX)
  await page.waitForSelector('text=입력된 점검표에서 자동 생성', { timeout: 30000 })
  check('★ 음성 — 쪽지 없이 들어오면 배너 없음',
    (await page.locator('[data-testid="round-resume-banner"]').count()) === 0)
  check('★ 음성 — 쪽지 없이 들어오면 발행 시도 없음',
    (await page.locator('[data-testid="round-workbook-msg"]').count()) === 0)
  check('음성 — 저장소도 비어 있다', (await noteOf()) === null, String(await noteOf()))

  // ── ② 가드가 보낸다 + 쪽지가 이동을 건너 살아남는다 ──
  dialogs.length = 0
  dialogAction = 'accept'
  await page.locator('[data-testid="round-workbook-download"]').first().click()
  await page.waitForURL(u => u.pathname === `/inspections/${inspId}/sheet`, { timeout: 30000 })
  check('가드 팝업이 섰다', dialogs.length === 1, `${dialogs.length}건`)
  check('팝업이 「돌아오면 이어서 발행」을 약속한다',
    (dialogs[0] ?? '').includes('돌아오면 이어서 발행'), dialogs[0] ?? '')
  check('[확인]이 점검표 화면으로 보냈다', page.url().includes(`/inspections/${inspId}/sheet`), page.url())

  const note = await noteOf()
  check('★ 쪽지가 전체 이동을 건너 살아남았다', note !== null, '쪽지가 없다 — 이동 중 유실')
  let parsed: { inspectionId?: string; kind?: string } = {}
  try { parsed = JSON.parse(note ?? '{}') } catch { /* 아래 단언이 잡는다 */ }
  check('쪽지가 이 회차를 가리킨다', parsed.inspectionId === inspId, `${parsed.inspectionId}`)
  check('쪽지가 「엑셀」 의도를 담았다', parsed.kind === 'xlsx', `${parsed.kind}`)

  // ── ③ 보조 버튼 — 돌아가지 않고도 받을 수 있다(왕복 자체를 없애는 길) ──
  //    ⚠ 이름은 `WORKBOOK_LABEL` 한 벌을 따른다(2026-09-21 사용자 지시 · test-workbook-label).
  //      그래서 여기서 무는 건 **글씨**가 아니라 「그 버튼이 이 화면에 있는가」다 —
  //      글씨를 물면 이름이 바뀔 때 제품이 멀쩡한데 빨강이 되고, 그러면 규약이 두 곳에 박힌다.
  check('점검표 화면에 [보고서 엑셀] 버튼이 있다',
    (await page.locator('[data-testid="workbook-xlsx"]').count()) === 1,
    `${await page.locator('[data-testid="workbook-xlsx"]').count()}개`)

  // ── ④ 입력을 마치고 **뒤로가기**로 돌아온다 → 누르지 않았는데 발행돼야 한다 ──
  for (const code of opCodes) {
    await raw.from('inspection_sheet_responses').insert({ inspection_id: inspId, item_code: code, result: 'O' })
  }
  // 내려받기를 **클릭 전에** 걸어 둔다 — 복귀 직후 자동으로 떨어지므로 뒤에 걸면 놓친다
  const dl = page.waitForEvent('download', { timeout: 40000 }).catch(() => null)
  dialogAction = 'accept'   // 이탈 확인(클라이언트는 아직 미입력으로 안다)이 뜨면 수락
  await page.locator('[data-testid="sheet-entry-back"]').click()
  await page.waitForURL(u => u.pathname === `/customers/${customerId}`, { timeout: 30000 })
  await page.waitForSelector('[data-testid="round-resume-banner"]', { timeout: 30000 }).catch(() => null)

  check('★★ 복귀 배너가 떴다 — 쪽지가 소비됐다',
    (await page.locator('[data-testid="round-resume-banner"]').count()) === 1)
  check('배너가 [지금 받기] 보장 경로를 준다',
    (await page.locator('[data-testid="round-resume-xlsx"]').count()) === 1)
  check('★★ 쪽지는 소비 즉시 사라졌다(one-shot)', (await noteOf()) === null, String(await noteOf()))

  // ★★★ 이 검사의 과녁 — [엑셀]을 **누르지 않았는데** 발행이 일어났는가
  await page.waitForSelector('[data-testid="round-workbook-msg"]', { timeout: 30000 }).catch(() => null)
  const msg = await page.locator('[data-testid="round-workbook-msg"]').first().innerText().catch(() => '')
  check('★★★ 클릭 없이 발행이 실행됐다', msg.length > 0, '발행 흔적(round-workbook-msg)이 없다')
  check('★★★ 발행이 성공했다', msg.includes('받았습니다'), `실제 메시지: ${msg.slice(0, 300)}`)

  const got = await dl
  // 제스처 없는 내려받기가 실제로 먹히는가 — 막히면 여기만 빨갛고 배너가 사용자를 구한다.
  // ⚠ 이 단언이 빨강이면 **기능이 망가진 게 아니라** 폴백 경로로 떨어진 것이다. 구분해서 읽을 것.
  check('★★★ 제스처 없는 자동 내려받기가 실제로 떨어졌다', got !== null,
    '브라우저가 막았다 — 배너 [지금 받기]가 보장 경로로 남는다')
  if (got) check('내려받은 파일이 xlsx다', /\.xlsx$/.test(got.suggestedFilename()), got.suggestedFilename())

  // ── ⑤ one-shot 실증 — 새로고침해도 다시 발행되지 않는다 (유령 발행 0) ──
  await page.goto(ANNEX)
  await page.waitForSelector('text=입력된 점검표에서 자동 생성', { timeout: 30000 })
  check('★★ 새로고침해도 배너가 다시 뜨지 않는다',
    (await page.locator('[data-testid="round-resume-banner"]').count()) === 0)
  check('★★ 새로고침해도 재발행되지 않는다(유령 발행 0)',
    (await page.locator('[data-testid="round-workbook-msg"]').count()) === 0)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  }
  if (customerId) {
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', customerId)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
}
summary()
