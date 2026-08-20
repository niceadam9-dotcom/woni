/** ④ 문서 칩 = 조회 스위치 (2026-08-20) — 칩을 누르면 3칸이 그 문서로 바뀐다.
 *  실행: node scripts/_probe-annex-doc-chips.mjs   (dev 서버 필요)
 *
 *  종전: 칩 하나하나가 곧 [생성]이고 3칸은 별지 9호 고정 → 별지 4호·공문·표지는 만들어봐야 내용을 알았다.
 *  지금: 칩=선택, 3칸=그 문서의 (고유값)+미리보기+생성.
 *
 *  검증 축
 *    ① 칩 5종이 뜨고 기본 선택은 별지 9호
 *    ② 칩을 누르면 3칸 제목·미리보기가 그 문서로 바뀐다 (5종 전부)
 *    ③ 고유값이 있는 서식(9호·공문·위임장)만 입력 칸이 뜨고, 없는 것(4호·표지)은 미리보기만
 *    ④ [생성]이 3칸 안에 있다 (칩에는 없다)
 *    ⑤ 전제 미충족이어도 [생성]은 눌리는 상태다 (규약: 막지 않는다)
 *    ⑥ 폐지한 [위임장 보기] 칩이 사라졌다
 */
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'doc-chips@erp-test.com'
let userId = '', cust = '', insp = '', browser = null

const CHIPS = [
  { type: 'report9', label: '별지 9호', fields: true },
  { type: 'report4', label: '별지 4호', fields: false },
  { type: 'official', label: '공문', fields: true },
  { type: 'delegation', label: '위임장', fields: true },
  { type: 'cover', label: '표지', fields: false },
]

try {
  userId = await mkUser({ email: EMAIL, name: '문서칩프로브', employeeId: 'DCH-1', role: 'admin' })
  cust = await mkCustomer({
    customer_name: 'PROBE문서칩고객', address: '경기 양평군 문서칩로 1', created_by: userId,
    fire_station: '양평소방서', use_approval_date: '2020-03-02', building_grade: '2급',
  })
  await raw.from('customer_contacts').insert({ customer_id: cust, role: '대표', name: '홍대표', phone: '01011112222' })
  await raw.from('buildings').insert({
    customer_id: cust, building_name: '본관', is_active: true, created_by: userId,
    purpose: '업무시설', total_area: 1234, building_area: 400, permit_date: '2019-01-10',
  })
  const Y = new Date(Date.now() + 9 * 3600_000).getFullYear()
  const { data: ins, error } = await raw.from('inspections').insert({
    customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: `${Y}-08-03`, inspection_end_date: `${Y}-08-04`, inspection_days: 2,
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  insp = ins.id

  const l = await launch(); browser = l.browser
  const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${insp}?step=4`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const chips = page.locator('[data-testid="annex-doc-chips"]')
  await chips.waitFor({ timeout: 60000 })

  // ── ① 칩 구성·기본 선택 ──
  for (const c of CHIPS) {
    check(`① 칩 [${c.label}]`, await page.locator(`[data-doc-chip="${c.type}"]`).count() > 0, '')
  }
  check('① 기본 선택은 별지 9호',
    await page.locator('[data-doc-chip="report9"]').getAttribute('aria-pressed') === 'true', '')
  // ⑥ 폐지 확인 — 칩이 조회를 겸하므로 별도 [위임장 보기]는 없어야 한다
  check('⑥ [위임장 보기] 버튼 폐지', await page.locator('button:has-text("위임장 보기")').count() === 0, '')

  // ── ②③④ 칩을 눌러 3칸이 따라오는가 ──
  for (const c of CHIPS) {
    await page.locator(`[data-doc-chip="${c.type}"]`).click()
    // 선택 표시
    const pressed = await page.locator(`[data-doc-chip="${c.type}"]`).getAttribute('aria-pressed')
    check(`② [${c.label}] 선택 표시`, pressed === 'true', String(pressed))
    // 3칸 iframe이 그 문서로 — 제목이 문서명을 담는다
    const frame = page.locator(`iframe[title*="${c.label}"]`).first()
    const ok = await frame.waitFor({ timeout: 90000 }).then(() => true).catch(() => false)
    check(`② [${c.label}] 3칸 미리보기 렌더`, ok, '')
    if (ok) {
      let html = ''
      for (let i = 0; i < 40 && !html; i++) {
        html = (await frame.getAttribute('srcdoc')) ?? ''
        if (!html) await page.waitForTimeout(500)
      }
      check(`② [${c.label}] 미리보기 본문이 비어 있지 않다`, html.length > 500, `${html.length}자`)
    }
    // ③ 고유값 칸 유무 — AnnexFields는 로딩 중 '고유값 불러오는 중…'만 그리므로 기다렸다 판정한다
    const fieldsLoc = page.locator(`[data-annex-fields="${c.type}"]`)
    if (c.fields) await fieldsLoc.waitFor({ timeout: 30000 }).catch(() => {})
    const hasFields = await fieldsLoc.count() > 0
    check(`③ [${c.label}] 고유값 칸 ${c.fields ? '있음' : '없음'}`, hasFields === c.fields,
      `실제 ${hasFields}${c.fields && !hasFields ? ' — 30초 대기 후에도 없음' : ''}`)
    // ④ 생성 버튼이 3칸 안에 있다
    check(`④ [${c.label}] 3칸에 [생성]`, await page.locator('[data-testid="annex-generate"]').count() > 0, '')
  }

  // ── ⑤ 전제 미충족이어도 생성은 막지 않는다 (규약 유지) ──
  const prereqWarn = await page.locator('text=/⚠/').count()
  const genDisabled = await page.locator('[data-testid="annex-generate"]').first().isDisabled()
  check('⑤ 전제 ⚠가 있어도 [생성]은 활성 (막지 않는 규약)', !genDisabled, `⚠ ${prereqWarn}개 / disabled=${genDisabled}`)

  // ── 칩에는 생성 동작이 남아 있지 않다 (조회 전용) ──
  await page.locator('[data-doc-chip="cover"]').click()
  await page.waitForTimeout(800)
  const { data: jobs } = await raw.from('fire_plan_gen_jobs').select('id').eq('inspection_id', insp)
  check('칩 클릭만으로는 생성이 일어나지 않는다', (jobs ?? []).length === 0, `잡 ${(jobs ?? []).length}건`)
} catch (e) {
  console.error('프로브 중단:', e?.message ?? e)
  check('프로브가 끝까지 진행됨', false, String(e?.message ?? e))
} finally {
  if (browser) await browser.close()
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
  const { data: left } = await raw.from('customers').select('id').eq('customer_name', 'PROBE문서칩고객')
  console.log(`[정리] 잔존 고객 ${(left ?? []).length}건`)
  summary()
}
