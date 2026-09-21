// 한 바퀴 — 달력 → 설비 확인 → 점검표 입력 → 달력 (2026-09-21 A·B·E)
//
// 왜 생겼나(운주빌딩 실측): 대장 0건인 고객의 ① [점검표 입력]을 누르면 점검표로 직행했고,
// 대장이 비어 있으니 설치 필터가 자동 해제돼 **v2025 시트 33개가 전부** 펼쳐졌다.
// 사용자는 자기 건물에 없는 설비까지 훑게 되고, 「무엇을 점검해야 하는지」를 화면이 말해주지 않았다.
// 게다가 복귀 고리가 **두 군데서 끊겨** 있었다:
//   · 점검표 → 1.4 링크가 `from`을 자기 경로로 **하드코딩** → 달력 출처가 버려진다
//   · 점검표 뒤로가기 기본값이 점검 상세 → 달력으로 돌아갈 길이 없다
//
// 이 검사가 지키는 것 — **한 바퀴가 닫히는가**:
//   A 대장 미확인이면 ① 링크가 **설비 확인**으로 간다(확인됐으면 점검표로)
//   B 1.4에 **전진 버튼**이 있고, 받은 복귀 경로를 점검표에 넘긴다
//   E 점검표가 출처를 **릴레이**하고, [입력 완료]로 출발지(달력)에 돌아온다
//
// ⚠ 화면 구동이 아니라 **링크 계약**으로 판정한다 — 달력 UI는 그 달에 자체점검이 있어야 열리고
//   표본이 흔들린다(2차에서 실제로 겪었다). 대신 세 화면을 **실제로 탐색**해 고리를 확인한다.
//
// 실행: npx tsx scripts/test-inspection-one-lap.mts   (로컬 dev + 스테이징 DB)
import { stepInputLink } from '../src/lib/inspection-step-links'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'one-lap@erp-test.com'
let userId = ''
const custIds: string[] = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(d: number): string {
  const t = new Date(Date.now() + 9 * 3600_000)
  t.setDate(t.getDate() + d)
  return t.toISOString().split('T')[0]
}

/** 고객 + 건물 1동(확인일 지정 가능) + 진행 중 자체점검 회차. 대장 행은 **넣지 않는다**(운주빌딩 상태). */
async function fixture(name: string, verified: boolean) {
  const customerId = await mkCustomer({ customer_name: name, created_by: userId, inspection_type: '종합' })
  custIds.push(customerId)
  const { data: bld } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId,
    ...(verified ? { facilities_verified_at: new Date().toISOString() } : {}),
  }).select('id').single()
  const { data: ins, error } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`회차 생성 실패: ${error.message}`)
  return { customerId, inspectionId: ins!.id as string, buildingId: bld!.id as string }
}

try {
  // ── A 순수 함수 축 — ① 목적지가 대장 상태로 갈린다 ────────────────────────
  {
    const unv = stepInputLink('I1', 1, { facilitiesUnverified: true })
    const ok = stepInputLink('I1', 1, { facilitiesUnverified: false })
    check('★ A 미확인 → 설비 확인 화면으로', unv?.href === '/inspections/I1/facilities', unv?.href)
    check('A 라벨이 순서를 말한다', unv?.label === '설비 확인 → 점검표', unv?.label)
    check('★ A 확인됨 → 점검표로(종전 그대로)', ok?.href === '/inspections/I1/sheet?sheet=auto', ok?.href)
    check('A 인자를 안 주면 종전 동작', stepInputLink('I1', 1)?.href === '/inspections/I1/sheet?sheet=auto')
    // 🚨 ①만 갈린다 — ②~⑥은 대장과 무관하다(넓히면 엉뚱한 단계가 설비 화면으로 간다)
    check('🚨 A ②~⑥은 영향받지 않는다',
      [2, 3, 4, 6].every(n => stepInputLink('I1', n, { facilitiesUnverified: true })?.href === `/inspections/I1?step=${n}`))
  }

  userId = await mkUser({ email: EMAIL, name: '한바퀴', employeeId: 'E2E-ONELAP' })
  const unv = await fixture('한바퀴미확인E2E', false)
  const ver = await fixture('한바퀴확인E2E', true)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  const CAL = '/inspections/calendar?probe=onelap'

  // ── B 1.4 화면 — 전진 버튼이 있고 복귀 경로를 넘긴다 ────────────────────
  await page.goto(`${BASE}/inspections/${unv.inspectionId}/facilities?from=${encodeURIComponent(CAL)}`)
  const toSheet = page.locator('[data-testid="facilities-to-sheet"]')
  await toSheet.waitFor({ timeout: 60000 })
  check('★ B 1.4에 전진 버튼이 있다', await toSheet.isVisible())
  check('B 「① 설비 확인 → ② 점검표 입력」 띠가 있다',
    await page.locator('[data-testid="facilities-stepband"]').count() > 0)
  const toSheetHref = (await toSheet.getAttribute('href')) ?? ''
  check('★ B 전진 버튼이 **받은 복귀 경로를 넘긴다**',
    toSheetHref.includes(`/inspections/${unv.inspectionId}/sheet`)
    && decodeURIComponent(toSheetHref).includes(CAL), toSheetHref)
  check('B 뒤로가기는 받은 경로 그대로', (await page.locator('[data-testid="facilities-back"]').getAttribute('href')) === CAL)

  // ── E 점검표 — 출처 릴레이 · 완료 버튼 · 귀소처 ─────────────────────────
  await toSheet.click()
  await page.waitForSelector('[data-testid="sheet-entry-back"]', { timeout: 60000 })
  check('E 1.4 → 점검표로 이어진다', page.url().includes('/sheet'), page.url())
  check('★ E 점검표 뒤로가기가 **달력**을 가리킨다(출처 보존)',
    (await page.locator('[data-testid="sheet-entry-back"]').getAttribute('href')) === CAL,
    String(await page.locator('[data-testid="sheet-entry-back"]').getAttribute('href')))

  /* ★ E-1 — 문자열 모양이 아니라 **걸어서** 확인한다.
     `from`이 두 겹으로 인코딩되므로(바깥 1.4 링크 + 안쪽 점검표 자기 from) 한 겹만 벗겨
     비교하면 멀쩡한 링크를 빨갛게 본다 — 실제로 그렇게 한 번 속았다.
     고리가 닫혔는지는 **왕복해 보면** 애매함이 없다: 점검표 → 1.4 → (뒤로) → 점검표 → (뒤로) → 달력. */
  const toFac = page.locator('[data-testid="sheet-entry-to-facilities"]')
  check('E-1 표본 — 미확인이라 1.4 링크가 떠 있다', (await toFac.count()) > 0)
  if (await toFac.count()) {
    await toFac.click()
    await page.waitForSelector('[data-testid="facilities-back"]', { timeout: 60000 })
    check('E-1 점검표 → 1.4로 간다', page.url().includes('/facilities'), page.url())
    await page.locator('[data-testid="facilities-back"]').click()
    await page.waitForSelector('[data-testid="sheet-entry-back"]', { timeout: 60000 })
    check('E-1 1.4 → 점검표로 돌아온다', page.url().includes('/sheet'), page.url())
    check('★ E-1 그 점검표가 **아직 달력을 기억한다**(종전엔 여기서 출처가 끊겼다)',
      (await page.locator('[data-testid="sheet-entry-back"]').getAttribute('href')) === CAL,
      String(await page.locator('[data-testid="sheet-entry-back"]').getAttribute('href')))
  }

  const done = page.locator('[data-testid="sheet-entry-done"]')
  await done.waitFor({ timeout: 20000 })
  check('★ E-3 [입력 완료] 버튼이 있다', await done.isVisible())
  check('E-3 완료 버튼도 같은 귀소처', (await done.getAttribute('href')) === CAL, String(await done.getAttribute('href')))
  await done.click()
  await page.waitForURL(u => u.pathname === '/inspections/calendar', { timeout: 30000 })
  check('★ 한 바퀴가 닫힌다 — 달력으로 돌아왔다(보던 달 유지)', page.url().includes('probe=onelap'), page.url())

  // ── E-2 출처가 없을 때의 귀소처 — 점검 상세가 아니라 달력 ──────────────
  await page.goto(`${BASE}/inspections/${ver.inspectionId}/sheet`)
  await page.waitForSelector('[data-testid="sheet-entry-back"]', { timeout: 60000 })
  check('★ E-2 from 없으면 점검 달력으로(종전 점검 상세)',
    (await page.locator('[data-testid="sheet-entry-back"]').getAttribute('href')) === '/inspections/calendar',
    String(await page.locator('[data-testid="sheet-entry-back"]').getAttribute('href')))
  check('E-2 확인된 고객은 1.4 경고가 없다',
    (await page.locator('[data-testid="sheet-entry-facility-unverified"]').count()) === 0)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const cid of custIds) {
    const { data: insps } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of insps ?? []) {
      await raw.from('inspection_sheet_responses').delete().eq('inspection_id', i.id)
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
    }
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', cid)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
