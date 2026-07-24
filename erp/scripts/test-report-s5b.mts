// 소방계획서_5 후순위 4건 E2E — R3-a(준비 n/4 칩·팝오버) + R10-c(현황판 배치확인서 인라인 업로드) + R15-c(문서 현황 딥링크)
// 실행: npx tsx scripts/test-report-s5b.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'report-s5b-e2e@erp-test.com'
let userId = ''
let custA = ''
let inspA = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null
const NAME_A = '후순위검증자체점검'

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '후순위검증E2E', employeeId: 'E2E-S5B' })
  custA = await mkCustomer({ customer_name: NAME_A, created_by: userId, inspection_type: '작동', inspection_sub_type: '작동', address: '서울시 강남구 후순위로 99' })

  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-10), inspection_end_date: kstShift(-10),
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`점검 생성 실패: ${eA.message}`)
  inspA = iA!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── R3-a: report9 모드 목록에서 준비 n/4 칩 + 팝오버 (batch readiness 쿼리가 500 없이 동작하는지 포함) ──
  await page.goto(`${BASE}/reports?form=report9&q=${encodeURIComponent(NAME_A)}`)
  await page.waitForSelector(`text=${NAME_A}`, { timeout: 15000 })
  const prepChip = page.locator('button', { hasText: /준비 \d\/4/ }).first()
  check('R3-a 준비 n/4 칩 렌더', await prepChip.isVisible())
  await prepChip.click()
  await page.waitForTimeout(300)
  // 인력·점검표는 없으므로(assigned는 있으나 점검표 응답 없음) 팝오버에 부족 항목 노출
  const popover = page.locator('text=별지 9호 준비').first()
  check('R3-a 팝오버 — 준비 상세', await popover.isVisible())
  check('R3-a 팝오버 — 점검표 응답 부족 표시', await page.locator('text=③ 점검표 응답').first().isVisible())

  // ── R10-c: 제출 현황판 배치확인서 누락 셀 인라인 [업로드] 버튼 ──
  await page.goto(`${BASE}/reports?form=submissions`)
  await page.waitForSelector('text=제출 현황', { timeout: 15000 })
  // 완료·cert 없는 자체점검 행 → 배치확인서 셀에 업로드 버튼
  const uploadBtn = page.locator('button', { hasText: '업로드' }).first()
  check('R10-c 배치확인서 인라인 [업로드] 버튼', await uploadBtn.isVisible())

  // ── R15-c: 점검대장 행 문서 현황 딥링크 ──
  await page.goto(`${BASE}/inspection-ledger`)
  await page.waitForSelector(`text=${NAME_A}`, { timeout: 15000 })
  const ledgerDoc = page.locator(`a[href="/reports?form=docs&cust=${custA}"]`).first()
  check('R15-c 점검대장 — 문서 현황 딥링크', await ledgerDoc.count() > 0)
} catch (e) {
  check(`치명적 오류: ${(e as Error).message}`, false)
} finally {
  if (browser) await browser.close()
  if (custA) await cleanupCustomer(custA)
  if (userId) { try { await delUser(userId) } catch { /* noop */ } }
  summary()
}
