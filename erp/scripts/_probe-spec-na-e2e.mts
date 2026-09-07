// 세부제원 조건부 자동 ／ — 화면·저장·집계 왕복 E2E (2026-09-07, 발단 사례 27-C-004 재현)
//
//  규현빌라 연결살수설비 14/15의 그 한 칸이다. 개방형 헤드 대상물에서 27-C-004(폐쇄형 전용)는
//  정의상 해당없음인데 사람이 매번 손으로 ／를 찍고 있었다.
//
//  ⚠ 대조군을 먼저 보인다 — 제원이 비었을 때 **잠기지 않는 것**을 단언한 뒤에 제원을 넣는다.
//     그 순서가 아니면 '원래부터 잠겨 있었다'와 구별되지 않는다(항진명제 방지).
//
// 실행: npx tsx scripts/_probe-spec-na-e2e.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'spec-na-e2e@erp-test.com'
const FAC = '연결살수설비'
const OPEN_ONLY = ['27-A-003', '27-A-011']   // 개방형 헤드 전용
const CLOSED_ONLY = ['27-C-003', '27-C-004'] // 폐쇄형 헤드 전용 — 사용자 발단 사례
let userId = ''
let customerId = ''
let buildingId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** 세부제원 갈아끼우기 — 건물 단위 행(대표) 하나로 */
async function setHeadType(v: string | null) {
  await raw.from('customer_facility_specs').delete().eq('customer_id', customerId)
  if (v === null) return
  await raw.from('customer_facility_specs').insert({
    customer_id: customerId, building_id: buildingId, section_key: 's38_activity',
    spec: { sprinkler_connect: { head_type: v } },
  })
}

try {
  userId = await mkUser({ email: EMAIL, name: '제원판정E2E', employeeId: 'E2E-SNA' })
  customerId = await mkCustomer({ customer_name: '제원판정E2E고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId })
    .select('id').single()
  buildingId = bld!.id
  await raw.from('fire_facilities').insert([
    { building_id: buildingId, category: '소화활동설비', facility_code: FAC, installed: true },
  ])
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id, sheet_code').eq('version', 'v2025').eq('sheet_name', FAC).single()
  const sheetCode = sheet!.sheet_code

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())
  await login(page, EMAIL)

  const URL_ = `${BASE}/inspections/${inspId}/sheet`
  /** 시트를 열고 (잠긴 코드 목록, 분모) 를 실측 */
  async function openAndRead(): Promise<{ locked: string[]; total: number; inputs: number }> {
    await page.goto(URL_)
    await page.waitForSelector('text=점검표 입력 —')
    await page.click(`[data-testid="sheet-row-${sheetCode}"]`)
    await page.waitForSelector('[data-outline-group]')
    await page.waitForFunction(() => document.querySelectorAll('[aria-label$=" O"]').length > 0)
    const locked = await page.$$eval('[data-spec-na]', els => els.map(e => e.getAttribute('data-spec-na')!))
    const rowTxt = (await page.locator(`[data-testid="sheet-row-${sheetCode}"]`).textContent()) ?? ''
    const m = /(\d+)\s*\/\s*(\d+)/.exec(rowTxt)
    return {
      locked, total: m ? Number(m[2]) : -1,
      inputs: await page.locator('[aria-label$=" O"]').count(),
    }
  }

  // ── ① 대조군 — 제원이 비면 아무것도 잠기지 않는다(③ 규약) ────────────────
  await setHeadType(null)
  const base = await openAndRead()
  check('① 제원 미입력 — 잠긴 항목 0(모르면 사람이 판단)', base.locked.length === 0, base.locked.join(','))
  check('① 대조군 분모 확보', base.total > 4, `총 ${base.total}`)

  // ── ② 개방형 → 폐쇄형 전용 2건만 잠긴다 ─────────────────────────────────
  await setHeadType('개방형')
  const open = await openAndRead()
  check('② 개방형 — 폐쇄형 전용 2건이 회색(／ 자동 · 제원)',
    CLOSED_ONLY.every(c => open.locked.includes(c)), open.locked.join(','))
  check('② 개방형 — 개방형 전용은 잠기지 않는다',
    OPEN_ONLY.every(c => !open.locked.includes(c)), open.locked.join(','))
  check('② 잠긴 만큼 분모가 줄었다', open.total === base.total - CLOSED_ONLY.length,
    `${open.total} (대조군 ${base.total})`)
  check('② 잠긴 행엔 ○ 버튼이 없다', open.inputs === base.inputs - CLOSED_ONLY.length,
    `${open.inputs} (대조군 ${base.inputs})`)

  // ── ③ 폐쇄형 → 정반대로 갈린다(한 방향만 보면 '늘 참'을 통과시킨다) ────────
  await setHeadType('폐쇄형')
  const closed = await openAndRead()
  check('③ 폐쇄형 — 개방형 전용 2건이 회색',
    OPEN_ONLY.every(c => closed.locked.includes(c)), closed.locked.join(','))
  check('③ 폐쇄형 — 폐쇄형 전용은 입력 대상으로 열린다',
    CLOSED_ONLY.every(c => !closed.locked.includes(c)), closed.locked.join(','))

  // ── ④ 저장 가드 — 일괄 ○가 잠긴 칸에 값을 넣지 않는다(표시만, 저장 금지) ──
  await page.click('text=설치 설비 전체 양호 ○')
  await page.waitForTimeout(2500)
  const { data: saved } = await raw.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', inspId).in('item_code', [...OPEN_ONLY, ...CLOSED_ONLY])
  const savedCodes = ((saved ?? []) as Array<{ item_code: string }>).map(r => r.item_code)
  check('④ 일괄 ○ — 잠긴 개방형 전용 2건은 DB에 저장되지 않았다',
    OPEN_ONLY.every(c => !savedCodes.includes(c)), savedCodes.join(','))
  check('④ 일괄 ○ — 열린 폐쇄형 전용 2건은 저장됐다',
    CLOSED_ONLY.every(c => savedCodes.includes(c)), savedCodes.join(','))

  // ── ⑤ 유령 입력 금지 — 이미 응답이 있으면 제원이 바뀌어도 잠그지 않는다 ────
  //    (잠가 버리면 사람이 넣은 값을 화면에서 고칠 길이 없다)
  await setHeadType('개방형')
  const after = await openAndRead()
  check('⑤ 응답이 있는 폐쇄형 전용 항목은 제원이 어긋나도 열려 있다',
    CLOSED_ONLY.every(c => !after.locked.includes(c)), after.locked.join(','))
} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  await browser?.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (customerId) {
    await raw.from('customer_facility_specs').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
  summary()
}
