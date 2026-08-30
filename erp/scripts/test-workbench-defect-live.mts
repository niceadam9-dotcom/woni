// 소방계획서_36 S4-2·S4-3 — 불량표 입력이 **새로고침 없이** 칸 제목에 반영되는가
//
// 이 검사가 지키는 것(위험 ①): S3에서 셀당 router.refresh()를 걷어낼 때
// 미리보기(watch 키)만 갱신되고 **칸 제목·스텝바가 굳는** 상태로 빠지기 쉽다.
// 사용자에게는 "데이터가 갈라진 것처럼" 보이는 최악의 형태다.
//
// ⚠ **S3 착수 전에 작성해 현행 코드에서 초록임을 먼저 확인한다**(대조군 테스트).
//    지금 초록이어야 나중에 붉어진 것이 'S3가 깬 것'이라고 말할 수 있다.
//
// S4-3: 화면만 앞서가지 않았는지 — reload 후 표시와 DB를 함께 대조한다.
//
// 실행: npx tsx scripts/test-workbench-defect-live.mts   (로컬 dev :3000 + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'wb-defect-live@erp-test.com'
const D1 = 'ZZ실시간불량A'
const D2 = 'ZZ실시간불량B'
const PLAN_TEXT = '차단기 교체 후 재시험'
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '불량실시간E2E', employeeId: 'E2E-DFL' })
  cust = await mkCustomer({ customer_name: 'ZZ불량실시간E2E고객', created_by: userId })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-07-01', status: 'in_progress',
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  // 분모를 2로 두면 제목이 0/2 → 1/2로 **한 칸만** 움직여 판정이 명확하다
  const { error: dErr } = await raw.from('inspection_defects').insert([
    { inspection_id: insp, defect_code: 'A-01', defect_name: D1, severity: '보통' },
    { inspection_id: insp, defect_code: 'A-02', defect_name: D2, severity: '보통' },
  ])
  if (dErr) throw new Error(`불량 생성 실패: ${dErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(120000)   // dev 콜드 컴파일 대비 — 상한만 늘린다
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  await page.waitForLoadState('networkidle').catch(() => {})

  const planBox = page.getByLabel(`${D1} 조치 계획`)
  await planBox.waitFor({ state: 'visible' })

  // ── 착수 상태: 아무것도 입력하지 않았으니 0/2
  check('1-1 착수 시 칸 제목 이행계획 0/2', await page.getByText('이행계획 0/2').count() > 0,
    (await page.locator('body').innerText()).match(/이행계획 \d+\/\d+/)?.[0] ?? '(없음)')

  // ── ★ 핵심: 입력 → blur → **새로고침 없이** 제목이 1/2로
  await planBox.fill(PLAN_TEXT)
  await planBox.blur()

  // ⚠ '저장됨' 칩은 4초 뒤 스스로 사라진다(defect-grid.tsx의 setTimeout). 제목 갱신을 다 기다린
  //    **뒤에** 확인하면 이미 없다 — 실제로 그렇게 짜서 헛 실패를 봤다. 폴링 중에 관측한다.
  const row1 = page.locator('[data-defect-row]').filter({ hasText: D1 })
  let live = false, sawSaved = false
  for (let i = 0; i < 120; i++) {          // 최대 60초 — 예산이 아니라 '되긴 되는가'를 본다(예산은 S4-1)
    if (!sawSaved && await row1.getByText('저장됨').count() > 0) sawSaved = true
    if (await page.getByText('이행계획 1/2').count() > 0) { live = true; break }
    await page.waitForTimeout(500)
  }
  check('★ 2-1 새로고침 없이 칸 제목이 1/2로 갱신된다', live,
    (await page.locator('body').innerText()).match(/이행계획 \d+\/\d+/)?.[0] ?? '(없음)')

  // 행 자체의 저장 표시도 함께 — 제목만 보면 '저장은 됐는데 집계가 굳은' 경우와 구별이 안 된다
  check('2-2 해당 행에 저장됨 표시가 떴다(과도 표시)', sawSaved)

  // ── S4-3: 화면만 앞서가지 않았는가 — DB와 reload 후 표시를 함께 본다
  const { data: dbRow } = await raw.from('inspection_defects')
    .select('action_plan').eq('inspection_id', insp).eq('defect_name', D1).single()
  check('★ 3-1 DB에 실제로 저장됐다(화면 선반영 아님)',
    (dbRow as { action_plan: string | null } | null)?.action_plan === PLAN_TEXT,
    String((dbRow as { action_plan: string | null } | null)?.action_plan))

  await page.reload()
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByLabel(`${D1} 조치 계획`).waitFor({ state: 'visible' })
  check('3-2 새로고침 후에도 1/2 유지', await page.getByText('이행계획 1/2').count() > 0,
    (await page.locator('body').innerText()).match(/이행계획 \d+\/\d+/)?.[0] ?? '(없음)')
  check('3-3 새로고침 후 입력값 보존',
    (await page.getByLabel(`${D1} 조치 계획`).inputValue()) === PLAN_TEXT)

  // ── 두 번째 셀도 — 표를 채워 나갈 때 집계가 계속 따라오는가(누적 축, F-11)
  const planBox2 = page.getByLabel(`${D2} 조치 계획`)
  await planBox2.fill('배관 보수')
  await planBox2.blur()
  let live2 = false
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500)
    if (await page.getByText('이행계획 2/2').count() > 0) { live2 = true; break }
  }
  check('★ 4-1 두 번째 셀도 새로고침 없이 2/2로', live2,
    (await page.locator('body').innerText()).match(/이행계획 \d+\/\d+/)?.[0] ?? '(없음)')
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
  summary('불량표 실시간 집계(소방계획서_36 S4-2)')
}
