// 9-6e UI E2E — 안전시설등(다중이용업소) 시트: 점검 상세 목록 노출·항목 로드·구분 그룹·응답 저장
// 실행: npx tsx scripts/test-mu-sheet.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'mu-sheet-e2e@erp-test.com'
let userId = ''
let custId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: 'MU시트E2E', employeeId: 'E2E-MUS' })
  custId = await mkCustomer({ customer_name: 'MU시트E2E고객', created_by: userId })
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: '2026-07-01', status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = insp!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/inspections/${inspId}`)
  await page.waitForSelector('button:has-text("안전시설등(다중이용업소)")')
  check('시트 목록에 안전시설등 버튼', true)
  await page.click('button:has-text("안전시설등(다중이용업소)")')
  await page.waitForSelector('text=소화기 또는 자동확산소화기')
  check('16항목 로드', (await page.locator('text=MU-0').count()) >= 16)
  check('구분 그룹 헤더(피난구조설비)', await page.isVisible('text=피난구조설비'))

  // 응답 저장 → respondedCounts 뱃지(MU 키)
  await page.click('button:has-text("전체 정상 ○")')
  await page.click('button:has-text("취소") + button:has-text("저장")')
  await page.waitForSelector('button:has-text("안전시설등(다중이용업소)")')
  const { data: resp } = await raw.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', inspId).like('item_code', 'MU-%')
  check('응답 16건 저장(전체 O)', (resp ?? []).length === 16 && (resp ?? []).every(r => r.result === 'O'), String((resp ?? []).length))
  const badgeOk = await page.waitForSelector('button:has-text("안전시설등(다중이용업소)") >> text=16', { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('응답수 뱃지 16 표시(MU 키)', badgeOk)

  // R13-d 인라인 불량 등록 — 행에서 ✕ → 메모 → [등록] (항목 입력부는 회차 트리와 공용 컴포넌트)
  await page.click('button:has-text("안전시설등(다중이용업소)")')
  await page.waitForSelector('text=소화기 또는 자동확산소화기')
  const firstRow = page.locator('div.border-b:has(span:text-matches("^MU-"))').first()
  const inlineCode = ((await firstRow.locator('span').first().textContent()) ?? '').trim()
  await firstRow.locator('button:has-text("✕")').click()
  await page.waitForSelector('input[placeholder="불량 메모 (선택)"]')
  check('✕ 클릭 → 인라인 메모칸 노출', true)
  await page.fill('input[placeholder="불량 메모 (선택)"]', '인라인 등록 검증')
  await page.click('button:has-text("등록")')
  await page.waitForSelector('text=불량(✕) 저장')
  const { data: xr } = await raw.from('inspection_sheet_responses')
    .select('result, memo').eq('inspection_id', inspId).eq('item_code', inlineCode).single()
  check('인라인 등록 — X·메모 저장', xr?.result === 'X' && xr?.memo === '인라인 등록 검증', JSON.stringify(xr))
  const { data: dfs } = await raw.from('inspection_defects')
    .select('defect_code').eq('inspection_id', inspId).eq('defect_code', inlineCode)
  check('인라인 등록 — 불량내역 자동 등록', (dfs ?? []).length === 1, JSON.stringify(dfs))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  }
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
