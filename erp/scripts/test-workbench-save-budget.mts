// 소방계획서_36 S4-1 — 작업대 저장 속도 **회귀 예산** 단언
//
// 예산은 임의 상수가 아니다. S1 대조군(소스 무변경)에서 **관측된 최댓값 × 0.5**다:
//   S1 실측 2026-08-30 — 셀 blur → 칸 제목 갱신: 1번째 6,635ms · 2번째 21,918ms
//   → 예산 = 21,918 × 0.5 = 10,959ms
// 이 값을 넘으면 로컬 집계 미러(S3-5)가 풀려 **셀마다 상세 전체를 다시 그리던 상태로
// 되돌아간 것**이다. S3 이후 실측은 1,399/1,446ms라 여유가 7배 이상이다 —
// 느슨해 보이지만 이 게이트의 목적은 '옛 동작으로의 복귀'를 잡는 것이지 미세 성능이 아니다.
//
// ⚠ 반드시 **연속 2셀**을 잰다(F-11): 종전 결함은 셀마다 누적되는 종류라
//    1회 저장만 재면 표를 채워 나갈 때의 실제 고통을 못 막는다.
//
// 실행: npx tsx scripts/test-workbench-save-budget.mts   (로컬 dev :3000 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

/** S1 관측 최댓값(21,918ms) × 0.5 — 근거는 소방계획서_36.md §4-A */
const BUDGET_MS = 10959

const EMAIL = 'wb-save-budget@erp-test.com'
const D1 = 'ZZ예산불량A'
const D2 = 'ZZ예산불량B'
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '저장예산E2E', employeeId: 'E2E-BGT' })
  cust = await mkCustomer({ customer_name: 'ZZ저장예산E2E고객', created_by: userId })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-07-01', status: 'in_progress',
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  const { error: dErr } = await raw.from('inspection_defects').insert([
    { inspection_id: insp, defect_code: 'A-01', defect_name: D1, severity: '보통' },
    { inspection_id: insp, defect_code: 'A-02', defect_name: D2, severity: '보통' },
  ])
  if (dErr) throw new Error(`불량 생성 실패: ${dErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByLabel(`${D1} 조치 계획`).waitFor({ state: 'visible' })

  /** 셀 blur → 칸 제목이 want로 바뀔 때까지 */
  async function measure(label: string, name: string, text: string, want: string) {
    const box = page.getByLabel(`${name} 조치 계획`)
    await box.fill(text)
    const t0 = Date.now()
    await box.blur()
    await page.getByText(want).first().waitFor({ state: 'visible', timeout: BUDGET_MS * 3 })
    const ms = Date.now() - t0
    check(`${label} — ${ms}ms ≤ 예산 ${BUDGET_MS}ms`, ms <= BUDGET_MS,
      `${ms}ms · 넘었다면 로컬 집계 미러(S3-5)가 풀려 셀마다 상세를 다시 그리는 상태로 돌아간 것`)
    return ms
  }

  const m1 = await measure('1번째 셀 blur→칸 제목', D1, '차단기 교체', '이행계획 1/2')
  await page.waitForTimeout(1200)
  const m2 = await measure('2번째 셀 blur→칸 제목', D2, '배관 보수', '이행계획 2/2')

  // F-11 — 누적 악화 자체를 축으로 고정한다. 종전에는 2번째가 1번째의 3~5배였다.
  // 배수로 보면 절대 속도가 흔들려도(dev 서버 편차) 이 성질만은 지킬 수 있다.
  check(`2번째 셀이 1번째의 3배를 넘지 않는다 (누적 악화 방지)`, m2 <= m1 * 3,
    `1번째 ${m1}ms · 2번째 ${m2}ms — 넘으면 재렌더가 서버를 점유해 줄 서던 옛 양상이다`)
  console.log(`\n  실측: 1번째 ${m1}ms · 2번째 ${m2}ms (예산 ${BUDGET_MS}ms)`)
} catch (e) {
  check(`예외: ${(e as Error).message}`, false)
  console.log((e as Error).stack)
} finally {
  if (browser) await browser.close()
  if (insp) {
    await raw.from('inspection_defects').delete().eq('inspection_id', insp)
    await raw.from('inspection_steps').delete().eq('inspection_id', insp)
    await raw.from('inspections').delete().eq('id', insp)
  }
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
  summary('작업대 저장 예산(소방계획서_36 S4-1)')
}
