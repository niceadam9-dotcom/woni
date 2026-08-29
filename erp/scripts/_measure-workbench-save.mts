// 소방계획서_36 S1-2·S1-3·S1-4 — 점검 작업대 저장 지연 **대조군** 실측 (소스 무변경 상태에서 돌린다)
//
// 왜 새 스크립트인가: _measure-sheet-save.mts는 **점검표 드로어**만 잰다. 그 경로는 2026-08-15에
// 이미 고쳐져 1.2s다(sheet-actions.ts:354-360). 이번에 고칠 경로 — 불량표 셀 blur·④⑥ [기록]·업로드 —
// 는 **한 번도 측정된 적이 없다**. 대조군 없이 "빨라졌다"고 말하면 그 주장은 무효다(D-1).
//
// 재는 것 (셋 다 blur/클릭 한 순간을 t0으로 공유한다):
//   ⓐ 셀 blur → 행에 '저장됨' 표시            = 서버 액션 왕복 + 로컬 반영
//   ⓑ 셀 blur → 칸 제목 '이행계획 N/M' 증가   = **router.refresh()가 상세 전체를 다시 그려야 끝난다**
//   ⓒ ⑥ [기록] 클릭 → 버튼 재활성            = startTransition 종료(= refresh 포함, isPending)
//   ⓓ 업로드·삭제 1회씩 (희소 경로임을 수치로 확정 — 우선순위 근거, S1-4)
// ⓑ-ⓐ 가 곧 "지금 지우려는 지연"이다.
//
// 실행: npx tsx scripts/_measure-workbench-save.mts   (로컬 dev :3000 + 스테이징 DB)
// E2E 전용 고객·점검을 만들고 끝나면 지운다 — 실데이터 무오염.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'wb-save-perf-e2e@erp-test.com'
const D1 = 'ZZ측정불량A'   // 라벨로 칸을 찾으므로 이름이 곧 셀렉터다
const D2 = 'ZZ측정불량B'
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** 1×1 투명 PNG — 업로드 경로만 재면 되므로 내용은 최소로 (디스크 I/O 없이 버퍼로 넘긴다) */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64')

try {
  userId = await mkUser({ email: EMAIL, name: '작업대측정E2E', employeeId: 'E2E-WBS' })
  cust = await mkCustomer({ customer_name: 'ZZ작업대측정E2E고객', created_by: userId })
  {
    // plan_type special_작동 — ⑤⑥이 열리는 조합(test-date-range.mts와 같은 픽스처)
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-07-01', status: 'in_progress',
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  {
    // 불량 2건 — 분모를 2로 두면 칸 제목이 0/2 → 1/2로 **한 칸만** 움직여 판정이 명확하다
    const { error } = await raw.from('inspection_defects').insert([
      { inspection_id: insp, defect_code: 'A-01', defect_name: D1, severity: '보통' },
      { inspection_id: insp, defect_code: 'A-02', defect_name: D2, severity: '보통' },
    ])
    if (error) throw new Error(`불량 생성 실패: ${error.message}`)
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  await page.setViewportSize({ width: 1600, height: 1000 })
  // dev 콜드 컴파일이 라우트당 수십 초다(실측 2026-08-30: /login 47s). 헬퍼 기본값 15s로는
  // 측정 전에 죽는다 — **대기 상한만** 늘린다. 측정값은 Date.now() 차이라 상한과 무관하다.
  page.setDefaultTimeout(120000)
  await login(page, EMAIL)

  // ── S1-3: 서버 액션 POST 왕복 단독값 (_measure-sheet-save.mts:36-46 이식)
  //    이 값이 작으면 병목은 DB가 아니라 그 뒤의 RSC 재렌더라는 뜻이다.
  const actionMs: number[] = []
  const started = new Map<string, number>()
  page.on('request', (r: { method(): string; headers(): Record<string, string>; url(): string }) => {
    if (r.method() === 'POST' && r.headers()['next-action']) started.set(r.url() + r.headers()['next-action'], Date.now())
  })
  page.on('response', (r: { request(): { method(): string; headers(): Record<string, string>; url(): string } }) => {
    const req = r.request()
    if (req.method() === 'POST' && req.headers()['next-action']) {
      const k = req.url() + req.headers()['next-action']
      const t0 = started.get(k)
      if (t0) { actionMs.push(Date.now() - t0); started.delete(k) }
    }
  })

  /* ══ ⑤ 불량표 — ⓐ·ⓑ ══════════════════════════════════════════════ */
  await page.goto(`${BASE}/inspections/${insp}?step=5`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const planBox = page.getByLabel(`${D1} 조치 계획`)
  await planBox.waitFor({ state: 'visible', timeout: 30000 })

  // 착수 전 칸 제목이 0/2인지 확인 — 여기가 흔들리면 ⓑ 측정 자체가 무의미하다
  const titleBefore = await page.getByText(/이행계획 \d+\/\d+/).first().textContent()
  console.log(`\n── ⑤ 불량표 (대조군)  칸 제목 착수값: ${titleBefore?.trim()}`)

  actionMs.length = 0
  await planBox.fill('조치 계획 실측 입력')
  const t0 = Date.now()
  await planBox.blur()   // 서술 칸은 blur에서 commit된다(defect-grid.tsx:139)

  // ⓐ 행에 '저장됨'
  await page.locator('[data-defect-row]').filter({ hasText: D1 }).getByText('저장됨').first()
    .waitFor({ state: 'visible', timeout: 60000 })
  const tSaved = Date.now() - t0

  // ⓑ 칸 제목이 서버 값으로 갱신 — router.refresh()가 끝나야 온다
  await page.getByText('이행계획 1/2').first().waitFor({ state: 'visible', timeout: 90000 })
  const tTitle = Date.now() - t0

  console.log(`   ⓐ 셀 blur → '저장됨'        ${tSaved}ms`)
  console.log(`   ⓑ 셀 blur → 칸 제목 1/2     ${tTitle}ms`)
  console.log(`   ⓑ-ⓐ (재렌더 대기분)         ${tTitle - tSaved}ms   ← 이번에 지우려는 지연`)
  console.log(`   액션POST 단독                ${actionMs.join('/') || '-'}ms   (S1-3: DB가 병목이 아님)`)
  await page.waitForTimeout(2000)   // 잔여 refresh 렌더 정리

  // 두 번째 셀도 — 표를 채워 나갈 때 셀마다 같은 값이 반복되는지(누적 체감의 정체)
  actionMs.length = 0
  const planBox2 = page.getByLabel(`${D2} 조치 계획`)
  await planBox2.fill('조치 계획 실측 입력 2')
  const t0b = Date.now()
  await planBox2.blur()
  await page.locator('[data-defect-row]').filter({ hasText: D2 }).getByText('저장됨').first()
    .waitFor({ state: 'visible', timeout: 60000 })
  const tSaved2 = Date.now() - t0b
  await page.getByText('이행계획 2/2').first().waitFor({ state: 'visible', timeout: 90000 })
  const tTitle2 = Date.now() - t0b
  console.log(`   [2번째 셀] ⓐ ${tSaved2}ms · ⓑ ${tTitle2}ms · 액션POST ${actionMs.join('/') || '-'}ms`)
  await page.waitForTimeout(2000)

  /* ══ ⑥ [기록] — ⓒ ════════════════════════════════════════════════ */
  await page.goto(`${BASE}/inspections/${insp}?step=6`)
  await page.waitForLoadState('networkidle').catch(() => {})
  // 그 칸의 직계 span이 라벨인 div만 고른다 — 화면에 YYYY-MM-DD 입력이 여럿이라 전역 선택은 못 쓴다
  const recRow = page.locator('div:has(> span:text-is("이행완료 제출일"))').last()
  const recBtn = recRow.getByRole('button', { name: '기록', exact: true })
  await recBtn.waitFor({ state: 'visible', timeout: 30000 })
  await recRow.getByPlaceholder('YYYY-MM-DD').first().fill('2026-07-20')

  actionMs.length = 0
  const t0c = Date.now()
  await recBtn.click()
  // 액션 응답 = 선반영 문구(justSubmitted). 전환 종료 = 버튼 재활성(isPending 해제)
  await page.getByText('제출일 2026-07-20 기록됨').first().waitFor({ state: 'visible', timeout: 60000 })
  const tMsg = Date.now() - t0c
  await recBtn.waitFor({ state: 'visible', timeout: 5000 })
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '기록')
      return b ? !(b as HTMLButtonElement).disabled : false
    }, { timeout: 90000 })
  const tIdle = Date.now() - t0c
  console.log(`\n── ⑥ 제출일 [기록] (대조군)`)
  console.log(`   ⓒ-1 클릭 → 기록됨 문구      ${tMsg}ms   (선반영이 가리는 구간)`)
  console.log(`   ⓒ-2 클릭 → 버튼 재활성      ${tIdle}ms   ← startTransition 안의 refresh(F-3)`)
  console.log(`   액션POST 단독                ${actionMs.join('/') || '-'}ms`)
  await page.waitForTimeout(2000)

  /* ══ ② 업로드·삭제 — ⓓ (S1-4: 희소 경로 확인) ════════════════════ */
  await page.goto(`${BASE}/inspections/${insp}?step=2`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const fileIn = page.locator('input[type=file]').first()
  await fileIn.waitFor({ state: 'attached', timeout: 30000 })

  actionMs.length = 0
  const t0u = Date.now()
  await fileIn.setInputFiles({ name: 'zz-measure.png', mimeType: 'image/png', buffer: PNG })
  await page.getByText('배치확인서 업로드됨').first().waitFor({ state: 'visible', timeout: 90000 })
  const tUpMsg = Date.now() - t0u
  // 삭제 버튼은 **서버 props(data.certFile)**로만 뜬다 — 이게 곧 refresh 완료 시점이다
  await page.getByTestId('cert-delete').waitFor({ state: 'visible', timeout: 90000 })
  const tUpIdle = Date.now() - t0u
  console.log(`\n── ② 업로드·삭제 (S1-4 · 희소 경로)`)
  console.log(`   업로드 → 문구               ${tUpMsg}ms`)
  console.log(`   업로드 → 파일칩(서버 반영)  ${tUpIdle}ms`)
  console.log(`   액션POST 단독                ${actionMs.join('/') || '-'}ms`)
  await page.waitForTimeout(1500)

  page.on('dialog', (d: { accept(): Promise<void> }) => { void d.accept() })
  actionMs.length = 0
  const t0d = Date.now()
  await page.getByTestId('cert-delete').click()
  await page.getByText('배치확인서 파일을 삭제했습니다').first().waitFor({ state: 'visible', timeout: 90000 })
  const tDelMsg = Date.now() - t0d
  await page.getByTestId('cert-delete').waitFor({ state: 'detached', timeout: 90000 })
  const tDelIdle = Date.now() - t0d
  console.log(`   삭제 → 문구                 ${tDelMsg}ms`)
  console.log(`   삭제 → 칩 소멸(서버 반영)   ${tDelIdle}ms`)
  console.log(`   액션POST 단독                ${actionMs.join('/') || '-'}ms`)

  console.log(`\n══ 대조군 요약 (소스 무변경) ══`)
  console.log(`   불량표 셀:  ⓐ ${tSaved}/${tSaved2}ms · ⓑ ${tTitle}/${tTitle2}ms`)
  console.log(`   ⑥ [기록]:   문구 ${tMsg}ms · 재활성 ${tIdle}ms`)
  console.log(`   업로드:     ${tUpIdle}ms · 삭제: ${tDelIdle}ms`)
  console.log(`   S4-1 예산 후보 = 관측 최댓값 × 0.5 = ${Math.round(Math.max(tTitle, tTitle2, tIdle) * 0.5)}ms`)
} finally {
  if (browser) await browser.close()
  if (insp) {
    await raw.from('inspection_defects').delete().eq('inspection_id', insp)
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', insp)
  }
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
}
