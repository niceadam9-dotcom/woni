// 기간(시작~종료) 검증 E2E — 종료일이 시작일보다 앞서면 저장되지 않는다
// 실행: npx tsx scripts/test-date-range.mts   (로컬 dev + 스테이징 DB)
//
// 종전 결함(2026-08-19 사용자 보고): 불량 이행기간에 2026-08-20 ~ 2026-08-18을 넣어도 조용히 저장됐다.
// 1부는 순수 규칙(DB 불필요), 2부는 **서버 액션을 실제로 통과시켜 DB를 읽어** 확인한다 —
// 화면 검사만 고정하면 액션이 곧 공개 엔드포인트라 그대로 뚫린다('use server' 규약).
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import rangeMod from '../src/lib/date-range.ts'

const { isEndBeforeStart, dateRangeError, combinedRangeError } =
  rangeMod as unknown as typeof import('../src/lib/date-range.ts')

const EMAIL = 'date-range-e2e@erp-test.com'
let userId = '', custId = '', inspId = '', defectId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

console.log('— 1부 순수 규칙')
{
  check('뒤집힘을 잡는다', isEndBeforeStart('2026-08-20', '2026-08-18') === true)
  check('정상 순서는 통과', isEndBeforeStart('2026-08-18', '2026-08-20') === false)
  // 하루짜리 이행·1일 점검이 정상 업무다 — 같은 날을 막으면 멀쩡한 입력이 거부된다
  check('같은 날은 허용', isEndBeforeStart('2026-08-18', '2026-08-18') === false)
  // 한쪽만 채운 상태를 막으면 타이핑 자체가 불가능해진다
  check('시작만 있으면 통과', isEndBeforeStart('2026-08-20', '') === false)
  check('종료만 있으면 통과', isEndBeforeStart('', '2026-08-18') === false)
  check('null·undefined 통과', isEndBeforeStart(null, undefined) === false)
  // 미완성 형식은 각 칸의 형식 검증이 잡는다 — 여기서 잡으면 오류가 두 번 뜬다
  check('미완성 형식은 통과', isEndBeforeStart('2026-08', '2026-08-18') === false)
  check('연도 넘김도 정확', isEndBeforeStart('2027-01-01', '2026-12-31') === true)

  check('메시지에 라벨이 붙는다',
    dateRangeError('2026-08-20', '2026-08-18', '이행 기간')?.startsWith('이행 기간:') === true)
  check('정상이면 null', dateRangeError('2026-08-18', '2026-08-20', '이행 기간') === null)

  check('합친 문자열 뒤집힘', combinedRangeError('2026-08-20 ~ 2026-08-18') !== null)
  check('합친 문자열 정상', combinedRangeError('2026-08-18 ~ 2026-08-20') === null)
  // 과거 행에는 자유 텍스트가 들어 있다 — 형태가 안 맞으면 건드리지 않는다
  check('자유 텍스트는 통과', combinedRangeError('1년 단위 자동갱신') === null)
  check('빈 값 통과', combinedRangeError('') === null)
}

try {
  console.log('— 2부 서버 액션이 실제로 막는가')
  userId = await mkUser({ email: EMAIL, name: '기간검증E2E', employeeId: 'E2E-DRG' })
  custId = await mkCustomer({ customer_name: `ZZ기간검증${Math.random().toString(36).slice(2, 6)}`, created_by: userId })
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-2), status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id
  const { data: df, error: dErr } = await raw.from('inspection_defects').insert({
    inspection_id: inspId, defect_code: 'A-01', defect_name: '유도등 불량', severity: '보통',
  }).select('id').single()
  if (dErr) throw new Error(`불량 생성 실패: ${dErr.message}`)
  defectId = df!.id

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspId}?step=5`)
  await page.waitForLoadState('networkidle')

  const BAD_START = kstShift(3), BAD_END = kstShift(1)
  const GOOD_START = kstShift(1), GOOD_END = kstShift(3)

  // ① 작업대 ⑤ 불량 표에서 뒤집힌 기간 입력 → 저장 안 됨 + 오류 노출
  const startBox = page.getByLabel('유도등 불량 계획 시작일')
  const endBox = page.getByLabel('유도등 불량 계획 종료일')
  await startBox.waitFor({ state: 'visible', timeout: 25000 })
  await startBox.fill(BAD_START)
  await page.waitForTimeout(800)
  await endBox.fill(BAD_END)
  await page.waitForTimeout(2000)

  const shownErr = await page.getByText('종료일이 시작일보다 빠를 수 없습니다').count()
  check('작업대 표 — 뒤집힌 기간에 오류 문구가 뜬다', shownErr > 0)
  check('종료일 칸이 오류 표시(aria-invalid)', await endBox.getAttribute('aria-invalid') === 'true')

  const { data: afterBad } = await raw.from('inspection_defects')
    .select('action_start, action_end').eq('id', defectId).single()
  const ab = afterBad as { action_start: string | null; action_end: string | null }
  check('★ 뒤집힌 기간이 DB에 저장되지 않았다', ab.action_end !== BAD_END || ab.action_start !== BAD_START,
    `start=${ab.action_start} end=${ab.action_end}`)

  // ② 정상 순서로 고치면 저장된다 — 막기만 하고 못 쓰게 되면 안 된다.
  //    이 표는 저장 성공 시 router.refresh()로 재렌더되므로 고정 대기가 아니라 DB를 폴링한다
  //    (고정 대기는 RSC 커밋 타이밍에 따라 흔들린다 — project_e2e_flake_patterns).
  await startBox.fill(GOOD_START)
  await page.waitForTimeout(1200)
  await endBox.fill(GOOD_END)
  let ag: { action_start: string | null; action_end: string | null } = { action_start: null, action_end: null }
  for (let i = 0; i < 20; i++) {
    const { data } = await raw.from('inspection_defects')
      .select('action_start, action_end').eq('id', defectId).single()
    ag = data as typeof ag
    if (ag.action_start === GOOD_START && ag.action_end === GOOD_END) break
    await new Promise(r => setTimeout(r, 700))
  }
  check('정상 순서는 그대로 저장된다', ag.action_start === GOOD_START && ag.action_end === GOOD_END,
    `start=${ag.action_start} end=${ag.action_end}`)
  check('오류 문구가 사라진다', await page.getByText('종료일이 시작일보다 빠를 수 없습니다').count() === 0)

  // ③ 서버 방어 배선 — 화면 검사만으로는 부족하다. 'use server' export는 그 자체로 공개
  //    엔드포인트라, 화면을 우회한 요청은 액션의 검사에만 걸린다. 브라우저에서 액션을 직접
  //    호출할 수는 없으므로, **모든 저장 경로가 공용 검증을 부르고 있는지**를 소스로 단언한다.
  const { readFileSync } = await import('node:fs')
  const code = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const GUARDS: Array<[string, string, RegExp]> = [
    ['불량 이행기간', 'app/(dashboard)/inspections/defect-actions.ts', /dateRangeError\(input\.actionStart, input\.actionEnd/],
    ['별지 서식 기간', 'app/(dashboard)/customers/facility-spec-actions.ts', /combinedRangeError\(v, key\)/],
    ['보험 가입기간', 'app/(dashboard)/customers/fire-plan-info-actions.ts', /combinedRangeError\(input\.insurancePeriod/],
    ['발주 입고예정일', 'app/(dashboard)/purchase-orders/actions.ts', /dateRangeError\(input\.order_date, input\.expected_date/],
    ['점검 다일기간', 'app/(dashboard)/inspections/actions.ts', /dateRangeError\(start, input\.endDate/],
  ]
  for (const [name, file, re] of GUARDS) {
    check(`서버 방어 — ${name}`, re.test(code(file)))
  }

  // ④ 사용자가 실제로 보고한 자리 — ① 불량 카드(작업대 표와 다른 컴포넌트)
  console.log('— 3부 불량 카드(사용자 보고 화면)')
  await raw.from('inspection_defects').update({ action_start: null, action_end: null }).eq('id', defectId)
  await page.goto(`${BASE}/inspections/${inspId}?step=1`)
  await page.waitForLoadState('networkidle')
  const toggle = page.getByText('이행계획·조치 완료').first()
  await toggle.waitFor({ state: 'visible', timeout: 25000 })
  await toggle.click()
  await page.waitForTimeout(1000)
  // '이행 기간' 라벨의 형제 두 칸만 — 같은 페이지에 다일기간·조치완료일 등 다른 날짜칸이 있다
  const cardBoxes = page.getByText('이행 기간', { exact: true }).locator('xpath=..')
    .locator('input[placeholder="YYYY-MM-DD"]')
  await cardBoxes.nth(0).fill(BAD_START)
  await page.waitForTimeout(400)
  await cardBoxes.nth(1).fill(BAD_END)
  await page.waitForTimeout(1000)
  check('불량 카드 — 뒤집힘 오류 노출',
    await page.locator('[data-testid="defect-range-error"]').count() > 0)
  // 같은 카드 안의 [저장]만 — 페이지에는 점검표 등 다른 [저장]도 있다
  const cardSave = page.locator('[data-testid="defect-range-error"]')
    .locator('xpath=ancestor::div[1]').getByRole('button', { name: '저장', exact: true }).first()
  check('불량 카드 — [저장] 버튼이 잠긴다', await cardSave.isDisabled())
  const { data: stillNull } = await raw.from('inspection_defects')
    .select('action_start, action_end').eq('id', defectId).single()
  const sn = stillNull as { action_start: string | null; action_end: string | null }
  check('불량 카드 — DB에 그대로 반영되지 않았다', !sn.action_start && !sn.action_end,
    `start=${sn.action_start} end=${sn.action_end}`)
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspId)
  }
  await cleanupCustomer(custId)
  await delUser(userId)
}

summary()
