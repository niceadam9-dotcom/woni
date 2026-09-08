/** 소방계획서_44 E2E (S5-2) — 확정 자리를 옮긴 뒤 **두 화면이 같은 값을 말하는가**.
 *
 *  ① 소방계획서 1.10 「전년도 업무 실시사항」에서 확정 → 저장
 *  ② DB: fire_plan_forms.sections.annexStatus 에 **연도축 없이 한 벌로** 남는가 (annex_inputs 아님, D-6)
 *  ③ 재로드 복원 (aria-pressed)
 *  ④ 별지 9호 작성 패널 1단 요약이 그 값을 그대로 비추는가 — 화면 두 개가 갈라지지 않는다
 *  ⑤ 별지 9호 ③계층에는 그 6칸이 **없다**(되살아나면 확정 창구가 둘이 된다)
 *
 *  실행: npx tsx scripts/_probe-44-e2e.mts   (로컬 dev 서버 + 스테이징 DB)
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'prev-duty-probe@erp-test.com'
let userId = ''
let customerId = ''
let inspectionId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '전년도실적프로브', employeeId: 'E2E-PYD' })
  customerId = await mkCustomer({ customer_name: '전년도실적프로브고객', address: '경기 양평군 테스트로 3', created_by: userId })
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-2), inspection_end_date: kstShift(-2),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id, year').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspectionId = insp!.id
  const prevYear = String((insp!.year as number) - 1)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── ① 1.10 블록에서 확정 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.10`)
  const block = page.locator('#c-1\\.10-prev')
  await block.waitFor({ timeout: 60000 })
  const opGroup = block.locator('[role="group"][aria-label="자체점검 작동"]')
  const eduGroup = block.locator('[role="group"][aria-label="소방안전교육"]')
  const writtenGroup = block.locator('[role="group"][aria-label="소방계획서 작성"]')
  await opGroup.waitFor({ timeout: 30000 })   // 자동 판정 로드 완료 신호

  // D-6 — 확정에는 연도가 없다. 다만 **자동 판정의 기준 연도**는 밝혀야 한다
  // (안 밝히면 무엇과 비교해 고르는지 알 수 없고, 연도를 저장한다고 오해할 여지도 남는다).
  const blockText = await block.innerText()
  check('① 자동 판정 기준 연도를 밝힌다', blockText.includes(`${prevYear}년 실적`), blockText.slice(0, 200))
  check('① 확정에 연도축이 없음을 화면이 말한다', blockText.includes('연도가 없어'), blockText.slice(0, 200))
  check('① 초기 상태는 자동 판정(둘 다 해제)',
    (await opGroup.locator('button', { hasText: '실시' }).first().getAttribute('aria-pressed')) === 'false')

  await opGroup.locator('button', { hasText: '미실시' }).click()
  await eduGroup.locator('button', { hasText: '실시' }).first().click()
  await writtenGroup.locator('button', { hasText: '작성' }).first().click()
  await page.click('text=서식 1.10 저장')
  await page.locator('text=서식 1.10 저장됨').waitFor({ timeout: 30000 })

  // ── ② 저장 위치·연도 키 ──
  let sec: Record<string, unknown> = {}
  for (let i = 0; i < 30; i++) {
    const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
    sec = ((data?.sections ?? {}) as Record<string, unknown>)
    if (sec.annexStatus) break
    await new Promise(r => setTimeout(r, 500))
  }
  const st = (sec.annexStatus ?? {}) as { prevYear?: Record<string, string>; plan?: Record<string, string> }
  check('② 소방계획서 서식에 저장된다 (annexStatus)', !!sec.annexStatus, JSON.stringify(st))
  check('② 연도 키 없이 한 벌로 남는다 (D-6)', st.prevYear?.op === '미실시', JSON.stringify(st.prevYear))
  check('② 교육 실시도 같은 한 벌에', st.prevYear?.edu === '실시')
  check('② 연도(4자리)를 키로 쓰지 않는다',
    !Object.keys(st.prevYear ?? {}).some(k => /^\d{4}$/.test(k)), JSON.stringify(st.prevYear))
  check('② 작성 여부는 연도축 없이 plan에', st.plan?.written === '작성')
  const { data: ai } = await raw.from('annex_inputs')
    .select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'report9').maybeSingle()
  check('② 점검 건(annex_inputs)에는 안 쓴다', !((ai?.fields ?? {}) as Record<string, string>).prevOpDone)

  // ── ③ 재로드 복원 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.10`)
  await opGroup.waitFor({ timeout: 60000 })
  check('③ 재로드 후 aria-pressed 유지 (미실시)',
    (await opGroup.locator('button', { hasText: '미실시' }).getAttribute('aria-pressed')) === 'true')

  // ── ④·⑤ 별지 9호 패널 ──
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  await page.click('[data-testid="workbench-stepbar"] button[data-step="submit9"]')
  // ④는 **작업대 인라인 고유값 칸**이 표면이다(슬라이드 패널이 아니다 — R6-6).
  const p9 = page.locator('[data-annex-fields="report9"]')
  await p9.waitFor({ timeout: 60000 })
  await p9.locator(`text=전년도(${prevYear}년) 실시사항`).waitFor({ timeout: 30000 })
  const p9Text = await p9.innerText()
  check('④ 작업대가 확정 사실을 말한다', p9Text.includes('소방계획서 1.10에서 확정됨'), p9Text.slice(0, 300))
  const href = await p9.locator('a', { hasText: '1.10에서 확정' }).getAttribute('href')
  check('④ 확정 자리로 가는 길이 있다(1.10 딥링크)',
    !!href && href.includes(`/customers/${customerId}`) && href.includes('form=1.10'), String(href))
  // ⑤ 확정 창구가 둘이 되면 안 된다 — 6칸이 ③계층에 되살아났는지 라벨로 본다
  check('⑤ ③계층에 전년도 확정 칸이 되살아나지 않았다',
    !/소방안전교육|자체점검\(전년도\)|보관 여부/.test(p9Text), p9Text.slice(0, 300))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspectionId) await raw.from('annex_inputs').delete().eq('inspection_id', inspectionId)
  if (customerId) await raw.from('fire_plan_forms').delete().eq('customer_id', customerId)
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
}

summary()
