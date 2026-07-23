// 소방계획서_5 S4 E2E — §7-A 제출 현황판(R14) + 구 화면 리다이렉트(R14-c/d) + §7-B 정산 탭(R15-b)
// 실행: npx tsx scripts/test-report-s4.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'report-s4-e2e@erp-test.com'
let userId = ''
let custA = ''
let inspA = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const NAME_A = '보고서S4자체점검'

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '보고서S4E2E', employeeId: 'E2E-S4' })
  custA = await mkCustomer({ customer_name: NAME_A, created_by: userId, inspection_type: '작동', inspection_sub_type: '작동' })
  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-2), inspection_end_date: kstShift(-2),
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`점검 생성 실패: ${eA.message}`)
  inspA = iA!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── R14-a/b: 제출 현황판 ──
  await page.goto(`${BASE}/reports?form=submissions`)
  await page.waitForSelector('h2:has-text("제출 현황")')
  check('R14-a 제출 현황판 렌더', true)
  check('R14-b 숫자 요약 스트립 — 9호 미제출', await page.isVisible('text=9호 미제출'))
  check('R14-b 숫자 요약 스트립 — 배치확인서 누락', await page.isVisible('text=배치확인서 누락'))
  check('R14-b 숫자 요약 스트립 — 기한 초과', await page.isVisible('text=기한 초과'))
  check('R14-a 표 헤더(제출 D-day)', await page.isVisible('text=제출 (D-day)'))
  check('R14-a 테스트 고객 행 표시', await page.isVisible(`text=${NAME_A}`))

  // ── R14-c: 구 현황 화면 리다이렉트 ──
  await page.goto(`${BASE}/inspection-reports/status`)
  await page.waitForURL(u => u.pathname === '/reports' && u.search.includes('form=submissions'))
  check('R14-c 보고서 제출현황 → 제출 현황판 리다이렉트', true)

  await page.goto(`${BASE}/action-plans/status`)
  await page.waitForURL(u => u.pathname === '/reports' && u.search.includes('form=submissions'))
  check('R14-c 이행계획 제출현황 → 제출 현황판 리다이렉트', true)

  // ── R14-d: 이행계획서 등록 폐지 → 점검 목록 ──
  await page.goto(`${BASE}/action-plans`)
  await page.waitForURL(u => u.pathname === '/inspections')
  check('R14-d 이행계획서 등록 → 점검 업무 리다이렉트', true)

  // ── R15-b: 정산현황 [월별 대장] 탭 흡수 ──
  await page.goto(`${BASE}/billing/status`)
  await page.waitForSelector('a:has-text("월별 대장")')
  check('R15-b 정산현황 — 월별 대장 탭', await page.isVisible('a:has-text("월별 대장")'))
  check('R15-b 정산현황 — 청구·수금 현황 탭', await page.isVisible('a:has-text("청구·수금 현황")'))
  await page.goto(`${BASE}/billing/annual`)
  await page.waitForSelector('a:has-text("청구·수금 현황")')
  check('R15-b 월별 대장 화면 — 정산현황 탭 병치', true)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custA) {
    const { data: allInsps } = await raw.from('inspections').select('id').eq('customer_id', custA)
    for (const i of (allInsps ?? []) as Array<{ id: string }>) {
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
      await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', i.id)
    }
    await cleanupCustomer(custA)
  }
  if (userId) await delUser(userId)
}
summary()
