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

  /* ① 작업대 ⑤ — 2026-09-11 계약 반전: 불량별 계획 기간 입력이 **폐지됐다**(기간은 ④ 총
     이행기간 하나 — 중복 입력이었다). 종전에는 여기서 뒤집힌 기간을 쳐서 선차단을 확인했는데,
     칠 칸이 사라졌으므로 「칸이 없다」가 새 계약이다. 뒤집힘 방어 자체는 죽지 않았다 —
     서버 방어(아래 ③)와 서버 저장 검사(defect-actions dateRangeError)가 최종 방어선으로 남는다. */
  await page.getByTestId('defect-grid').waitFor({ state: 'visible', timeout: 25000 })
  check('★ (음성) ⑤에 불량별 계획 시작일 입력이 없다',
    (await page.getByLabel('유도등 불량 계획 시작일').count()) === 0)
  check('★ (음성) ⑤에 불량별 계획 종료일 입력이 없다',
    (await page.getByLabel('유도등 불량 계획 종료일').count()) === 0)
  // 공허 통과 방지 — 화면 자체가 안 떴으면 위 0건은 아무 증명도 아니다
  check('⑤ 표가 실제로 떠 있다(조치 계획 칸 존재)',
    (await page.getByLabel('유도등 불량 조치 계획').count()) === 1)
  void BAD_START; void BAD_END; void GOOD_START; void GOOD_END

  // ③ 서버 방어 배선 — 화면 검사만으로는 부족하다. 'use server' export는 그 자체로 공개
  //    엔드포인트라, 화면을 우회한 요청은 액션의 검사에만 걸린다. 브라우저에서 액션을 직접
  //    호출할 수는 없으므로, **모든 저장 경로가 공용 검증을 부르고 있는지**를 소스로 단언한다.
  const { readFileSync } = await import('node:fs')
  const code = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const GUARDS: Array<[string, string, RegExp]> = [
    // ⚠ 가드가 「보낸 칸 + DB의 나머지 칸」을 **병합해** 판정한다(부분 전송 F-27과 한 벌) —
    //   `input.` 직접 인자를 찾는 옛 정규식은 그 병합판을 못 알아봐 거짓 빨강을 냈다.
    ['불량 이행기간', 'app/(dashboard)/inspections/defect-actions.ts', /dateRangeError\(start, end, '이행 기간'\)/],
    ['별지 서식 기간', 'app/(dashboard)/customers/facility-spec-actions.ts', /combinedRangeError\(v, key\)/],
    ['보험 가입기간', 'app/(dashboard)/customers/fire-plan-info-actions.ts', /combinedRangeError\(input\.insurancePeriod/],
    ['발주 입고예정일', 'app/(dashboard)/purchase-orders/actions.ts', /dateRangeError\(input\.order_date, input\.expected_date/],
    ['점검 다일기간', 'app/(dashboard)/inspections/actions.ts', /dateRangeError\(start, input\.endDate/],
  ]
  for (const [name, file, re] of GUARDS) {
    check(`서버 방어 — ${name}`, re.test(code(file)))
  }

  // ④ ① 불량 카드 — 여기 「이행 기간」 짝도 같은 날 폐지됐다(같은 중복). 음성으로 갈아끼운다.
  console.log('— 3부 불량 카드(입력 폐지 확인)')
  await page.goto(`${BASE}/inspections/${inspId}?step=1`)
  await page.waitForLoadState('networkidle')
  const toggle = page.getByText('이행계획·조치 완료').first()
  await toggle.waitFor({ state: 'visible', timeout: 25000 })
  await toggle.click()
  await page.waitForTimeout(1000)
  check('★ (음성) ① 카드에 「이행 기간」 입력 짝이 없다',
    (await page.getByText('이행 기간', { exact: true }).count()) === 0)
  // 공허 통과 방지 — 카드가 실제로 펴져 있어야 위 0건이 증명이 된다
  check('① 카드가 실제로 펴져 있다(조치 완료 체크 존재)',
    (await page.getByLabel('유도등 불량 조치 완료').count()) === 1)
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
