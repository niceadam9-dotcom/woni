// 9-6e UI E2E — 안전시설등(다중이용업소) 시트: 점검 상세 목록 노출·항목 로드·구분 그룹·응답 저장
// 실행: npx tsx scripts/test-mu-sheet.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

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

  // 응답 저장 → 보드 시트 합계(MU 키). 23 개편으로 시트 전체 [전체 정상 ○]은 없고
  // 머더(구분) 단위 [○ 모두 · {구분}] 버튼뿐이다(Q-17) — 구분 5개를 전부 눌러 16건을 채운다
  const bulkO = page.locator('[data-bulk-o]')
  const nBulk = await bulkO.count()
  for (let i = 0; i < nBulk; i++) await bulkO.nth(i).click()
  // 소방계획서_28(`9b43cc0`)에서 드로어가 자동저장으로 바뀌어 [저장] 버튼이 없어졌다.
  // 종전 `click('[data-testid="sheet-drawer"] button:has-text("저장")')`은 15초 타임아웃으로 죽었다.
  // bulkO는 항목마다 onResult → setResult를 부르고, ○는 훅 계약 ①에 걸리지 않아 자동저장이 예약된다
  // (sheet-item-editor.tsx:156-161 · use-sheet-autosave.ts:86). 눌러야 할 버튼이 없으므로 **결과를 기다린다**.
  // 종전에는 '설비 목록 버튼이 다시 나타남'을 저장 완료 신호로 썼다. 점검표가 마스터-디테일이 되면서
  // 목록(레일)이 선택 중에도 사라지지 않아 그 대기가 **즉시 통과**한다 — 저장 전에 DB를 읽어 0건이 나왔다.
  // 화면 전환이 아니라 **결과 자체**를 기다린다.
  const resp: Array<{ item_code: string; result: string }> = await pollDb(async () => {
    const { data } = await raw.from('inspection_sheet_responses')
      .select('item_code, result').eq('inspection_id', inspId).like('item_code', 'MU-%')
    return (data ?? []).length === 16 ? data : null
  }, 20000) ?? []
  check('응답 16건 저장(전체 O)', resp.length === 16 && resp.every(r => r.result === 'O'), String(resp.length))
  // 종전 '시트 버튼 뱃지' → 23 개편의 보드 시트 합계(data-sheet-count). G-9 오버레이라 저장 직후 즉시 갱신
  const badgeOk = await page.waitForSelector('section:has-text("안전시설등") [data-sheet-count="16/16"]', { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('보드 시트 합계 16/16 표시(MU 키)', badgeOk)

  // R13-d 인라인 불량 등록 — 행에서 ✕ → 메모 → [등록] (항목 입력부는 회차 트리와 공용 컴포넌트)
  // 23 개편: 저장 후 드로어가 닫히지 않고 유지되므로 다시 열 필요가 없다
  //
  // 🔴 여기서 자동저장 완료를 **일부러 기다리지 않는다** — 이 구간이 flush 경합의 회귀 검사다.
  //    DB에 16행이 보여도 훅의 run() 루프는 아직 살아 있을 수 있다. 그 상태에서 [등록]을 누르면
  //    종전 flush()는 `running.current`에 막혀 기다리지 않고 큐만 남긴 채 반환했고, 뒤이어 도는
  //    루프가 delta를 다시 계산해 **memo 없는 X**로 덮어썼다(수리 전 실측: `{"result":"X","memo":null}`).
  //    2026-08-25 수리로 flush가 진행 중 저장을 실제로 await한다(use-debounced-autosave.ts:47-52).
  //    ⚠ 여기에 `waitSaved` 류의 대기를 넣으면 경합을 피해 가 **재발해도 영원히 초록**이 된다.
  await page.waitForSelector('text=소화기 또는 자동확산소화기')
  // ⚠ 셀렉터는 **드로어 안으로 한정**한다(test-sheet-mother-drawer.mts:176-188과 같은 규약).
  // 종전엔 page 전역이라 왼쪽 보드의 행·다른 [등록] 버튼을 집을 수 있었고, 실제로 memo=null로 붉었다.
  const drawer = '[data-testid="sheet-drawer"]'
  const firstRow = page.locator(`${drawer} div.border-b:has(span:text-matches("^MU-"))`).first()
  const inlineCode = ((await firstRow.locator('span').first().textContent()) ?? '').trim()
  await firstRow.locator('button:has-text("✕")').click()
  const memoInput = page.locator(`${drawer} input[placeholder="불량 메모 (선택)"]`)
  await memoInput.waitFor()
  check('✕ 클릭 → 인라인 메모칸 노출', true)
  await memoInput.fill('인라인 등록 검증')
  await page.click(`${drawer} button:has-text("등록")`)
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
