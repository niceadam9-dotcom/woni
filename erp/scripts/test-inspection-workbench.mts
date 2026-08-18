// 소방계획서_21 R6-12 — 한 화면 작업대 E2E
// 페이지 스크롤 0 · 스텝바로 ①~⑥ 전환 · ①에서 점검표와 불량 동시 노출 ·
// 불량 표 편집 → ⑤ 10호 미리보기 갱신 + 생성물 파일 수 불변 · 좁은 뷰포트 세로 폴백 · 월간 건은 ① 하나
// 실행: npx tsx scripts/test-inspection-workbench.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = `workbench-${Date.now().toString(36)}@erp-test.com`
let userId = '', custA = '', custB = '', inspA = '', inspB = '', defectId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** main(스크롤 컨테이너)에 넘치는 스크롤이 없는지 — 페이지가 아니라 칸이 스크롤해야 한다 */
const mainOverflow = (page: { evaluate: (fn: string) => Promise<number> }) =>
  page.evaluate(`(() => { const m = document.querySelector('main'); return m ? m.scrollHeight - m.clientHeight : -1 })()`)

try {
  userId = await mkUser({ email: EMAIL, name: '작업대E2E', employeeId: `E2E-WB-${Date.now().toString(36)}` })
  custA = await mkCustomer({ customer_name: '작업대E2E자체', created_by: userId })
  custB = await mkCustomer({ customer_name: '작업대E2E정기', created_by: userId })

  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-10), inspection_end_date: kstShift(-10),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`자체점검 생성 실패: ${eA.message}`)
  inspA = iA!.id

  const { data: iB, error: eB } = await raw.from('inspections').insert({
    customer_id: custB, inspection_type: '작동', sequence_num: 1, plan_type: 'monthly',
    inspection_start_date: kstShift(0), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eB) throw new Error(`정기점검 생성 실패: ${eB.message}`)
  inspB = iB!.id

  // 불량 1건 — ⑤⑥ 활성 조건
  const { data: df, error: eD } = await raw.from('inspection_defects').insert({
    inspection_id: inspA, defect_name: '작업대E2E불량', severity: '보통',
  }).select('id').single()
  if (eD) throw new Error(`불량 생성 실패: ${eD.message}`)
  defectId = df!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  await login(page, EMAIL)

  // ── 1) 가로 스텝바 + 뷰포트 고정 ──
  await page.goto(`${BASE}/inspections/${inspA}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  check('작업대 렌더 — 가로 스텝바', true)
  const stepBtns = await page.locator('[data-testid="workbench-stepbar"] button').count()
  check('스텝바 6단계(R6-1)', stepBtns === 6, `${stepBtns}개`)
  check('세로 아코디언 제거 — 문서 타임라인 헤딩 없음', !(await page.isVisible('h2:text-is("문서 타임라인")')))

  const over = await mainOverflow(page)
  check('페이지 스크롤 0(R6-9)', over <= 1, `main 넘침 ${over}px`)

  // 칸 안쪽은 스크롤한다 — 고정이 곧 내용 잘림이 아니어야 한다
  const paneScrollable = await page.evaluate(`(() => {
    const p = document.querySelectorAll('[data-testid="workbench-panes"] > section')
    return Array.from(p).every(el => getComputedStyle(el).overflowY === 'auto')
  })()`)
  check('칸별 세로 스크롤(overflow-y:auto)', paneScrollable === true)

  // ── 2) ①에서 점검표와 불량이 동시에 (R6-3) ──
  check('① 점검표 칸', await page.isVisible('text=점검표 입력'))
  check('① 불량 칸 동시 노출', await page.isVisible('text=불량 내역 1건'))

  // ── 3) 스텝바로 ①~⑥ 전환 (R6-2) ──
  const go = async (step: string, expectText: string) => {
    await page.click(`[data-testid="workbench-stepbar"] button[data-step="${step}"]`)
    await page.waitForSelector(`text=${expectText}`, { timeout: 30000 })
  }
  await go('cert', '배치확인서 업로드')
  check('② 전환 — 배치확인서 칸', true)
  // R0-6 드롭존 — 업로드 슬롯은 파일을 끌어다 놓을 수 있어야 한다
  check('② 업로드 슬롯 = 드롭존(R0-6)',
    await page.isVisible('div[title="클릭 또는 파일을 이 칸에 끌어다 놓으세요"]'))
  await go('ownerReport', '수신 정보')
  check('③ 전환 — 수신 정보 칸', true)
  await go('submit9', '제출 전제')
  check('④ 전환 — 제출 전제 칸', true)
  const inlineOk = await page.waitForSelector('[data-annex-fields="report9"]', { timeout: 60000 })
    .then(() => true).catch(() => false)
  check('④ 고유값 인라인(R6-6) — 슬라이드 패널 아님', inlineOk)
  check('④ 3단 작성 패널 미사용', (await page.locator('[data-annex-panel]').count()) === 0)
  // R5-8 기산 근거 — 기한을 보는 자리에서 왜 그 날짜인지 보이고 거기서 고칠 수 있어야 한다
  check('④ 기산 근거 표시(R5-8)', await page.isVisible('text=/기산: 종료일/'))
  check('④ 기산일 인라인 수정 진입점', await page.isVisible('button:has-text("종료일 고치기")'))
  const over4 = await mainOverflow(page)
  check('④에서도 페이지 스크롤 0', over4 <= 1, `main 넘침 ${over4}px`)

  await go('repair', '이행계획')
  check('⑤ 전환 — 불량 표(R6-7)', await page.isVisible('[data-testid="defect-grid"]'))

  // ── 4) 불량 표 편집 → DB 반영 + 10호 미리보기 갱신, 생성물 파일 수 불변 (R6-4·R6-8) ──
  const { data: filesBefore } = await raw.storage.from('fire-plans').list(`${custA}/inspections/${inspA}`)
  const beforeCount = (filesBefore ?? []).length

  await page.waitForSelector('iframe[title="별지 10호 미리보기"]', { timeout: 60000 })
  const planCell = page.locator(`[data-defect-row="${defectId}"] textarea`).first()
  await planCell.fill('E2E 이행계획 — 밸브 교체')
  await page.locator(`[data-defect-row="${defectId}"] input[placeholder="YYYY-MM-DD"]`).first().fill(kstShift(1))
  await page.click('text=이행계획')  // blur
  await page.waitForSelector(`[data-defect-row="${defectId}"] >> text=저장됨`, { timeout: 30000 })

  // 칸마다 저장이 따로 날아간다 — 마지막 칸의 왕복까지 기다린다
  let dRow: { action_plan?: string; action_start?: string } | null = null
  for (let i = 0; i < 20; i++) {
    const { data } = await raw.from('inspection_defects')
      .select('action_plan, action_start').eq('id', defectId).maybeSingle()
    dRow = data as typeof dRow
    if (dRow?.action_plan && dRow?.action_start) break
    await new Promise(r => setTimeout(r, 500))
  }
  check('표 편집 저장 — action_plan DB 반영', dRow?.action_plan === 'E2E 이행계획 — 밸브 교체', JSON.stringify(dRow))
  check('표 편집 저장 — 계획 시작일 DB 반영', dRow?.action_start === kstShift(1), JSON.stringify(dRow))

  // 미리보기는 디바운스 후 다시 그려진다 — 내용에 방금 넣은 계획이 실려야 한다
  const previewHasPlan = await page.waitForFunction(`(() => {
    const f = document.querySelector('iframe[title="별지 10호 미리보기"]')
    return !!f && (f.getAttribute('srcdoc') || '').includes('밸브 교체')
  })()`, undefined, { timeout: 60000 }).then(() => true).catch(() => false)
  check('⑤ 10호 미리보기 갱신(R6-4)', previewHasPlan)

  const { data: filesAfter } = await raw.storage.from('fire-plans').list(`${custA}/inspections/${inspA}`)
  check('미리보기는 파일을 만들지 않는다(Gotenberg 미호출)', (filesAfter ?? []).length === beforeCount,
    `${beforeCount} → ${(filesAfter ?? []).length}`)

  await go('submit11', '이행완료')
  const prev11 = await page.waitForSelector('iframe[title="별지 11호 미리보기"]', { timeout: 60000 })
    .then(() => true).catch(() => false)
  check('⑥ 전환 — 11호 미리보기(R6-5)', prev11)

  // ── 5) 월간 건 = ① 하나 (R6-11) ──
  await page.goto(`${BASE}/inspections/${inspB}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  const monthlySteps = await page.locator('[data-testid="workbench-stepbar"] button').count()
  check('월간 — 스텝바 ① 하나(R6-11)', monthlySteps === 1, `${monthlySteps}개`)
  check('월간 — 보고 절차 안내 문구', await page.isVisible('text=보고 의무 없음'))

  // ── 6) 좁은 뷰포트 세로 폴백 (R6-10) ──
  await page.setViewportSize({ width: 430, height: 860 })
  await page.goto(`${BASE}/inspections/${inspA}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="workbench-panes"]')
  const cols = await page.evaluate(`(() => {
    const el = document.querySelector('[data-testid="workbench-panes"]')
    return el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : -1
  })()`)
  check('모바일 — 3칸이 1열로 폴백(R6-10)', cols === 1, `${cols}열`)
  const lockedOnMobile = await page.evaluate(`(() => {
    const el = document.querySelector('main > div')
    return el ? getComputedStyle(el).overflow : ''
  })()`)
  check('모바일 — 뷰포트 고정 해제(세로로 흐름)', lockedOnMobile !== 'hidden', String(lockedOnMobile))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const cid of [custA, custB]) {
    if (!cid) continue
    const { data: allInsps } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of (allInsps ?? []) as Array<{ id: string }>) {
      await raw.from('notifications').delete().eq('reference_id', i.id)
      await raw.from('report_deliveries').delete().eq('inspection_id', i.id)
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
      await raw.from('inspection_sheet_responses').delete().eq('inspection_id', i.id)
      await raw.from('inspection_reports').delete().eq('inspection_id', i.id)
      await raw.from('inspection_participants').delete().eq('inspection_id', i.id)
      await raw.from('annex_inputs').delete().eq('inspection_id', i.id)
      const { data: files } = await raw.storage.from('fire-plans').list(`${cid}/inspections/${i.id}`)
      const paths = ((files ?? []) as Array<{ name: string }>).map(o => `${cid}/inspections/${i.id}/${o.name}`)
      if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    }
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
