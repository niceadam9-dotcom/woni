// 소방계획서_40 — 소방시설(1.4) ↔ 점검표 왕래 E2E
//
// 이 화면의 존재 이유는 **점검표를 입력하다 설치 누락을 발견했을 때 대장까지 돌아가지 않고
// 1클릭으로 고치고 제자리로 돌아오는 것**이다. 그래서 이 검사의 중심은 링크가 그려지는지가
// 아니라 **왕복 후 설치 축이 실제로 갱신되는가**(S4-2)다 — revalidate가 안 뚫리면 사용자는
// 고쳤는데도 안 고쳐진 화면을 본다.
//
// 대조군 규약: 1.4 기본 동작(옵션 props 미지정 경로)은 test-plan-tab이 지키고 있다.
// 여기서는 **점검 귀속 마운트**만 본다.
//
// 실행: npx tsx scripts/test-facility-roundtrip.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, pollDb } from './_e2e-helpers.mjs'

const EMAIL = 'facility-rt-e2e@erp-test.com'
const EMAIL2 = 'facility-rt-other@erp-test.com'
let userId = ''
let otherId = ''
let customerId = ''
let inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** 픽스처는 _probe-40-fixture로 실측한 값이다 — 넷 다 시트가 1:1(형제 설비 없음)이라
 *  '체크한 그 설비의 시트'만 움직인다. 형제가 있는 설비(스프링클러)를 쓰면 단언이 흐려진다. */
const F_BASE = '옥내소화전설비'        // STD-02 · 설치됨 — 포커스·배지 축
const F_ADD = '연결송수관설비'         // STD-26 · 미설치 → ★ 왕복으로 설치
const F_ANNEX = '비상콘센트설비'       // STD-28 · 별관 미설치 → 다건물 union
const F_BANNER = '물분무소화설비'      // STD-06 · 미설치인데 응답 있음 → S6 배너
const F_UNCOVERED = '고체에어로졸소화설비'  // 덮는 시트가 없다(고시에 점검표 없음) → uncovered 링크

try {
  userId = await mkUser({ email: EMAIL, name: '설비왕복E2E', employeeId: 'E2E-FRT' })
  otherId = await mkUser({ email: EMAIL2, name: '비담당FRT', employeeId: 'E2E-FRT2', role: 'employee' })
  customerId = await mkCustomer({ customer_name: '설비왕복E2E고객', created_by: userId })

  const { data: b1, error: e1 } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId })
    .select('id').single()
  const { data: b2, error: e2 } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '별관', is_active: true, created_by: userId })
    .select('id').single()
  if (e1 || e2) throw new Error(`건물 생성 실패: ${e1?.message ?? ''}${e2?.message ?? ''}`)

  const { error: eFac } = await raw.from('fire_facilities').insert([
    { building_id: b1!.id, category: '소화설비', facility_code: F_BASE, installed: true },
    { building_id: b1!.id, category: '소화활동설비', facility_code: F_ADD, installed: false },
    { building_id: b1!.id, category: '소화설비', facility_code: F_BANNER, installed: false },
    { building_id: b1!.id, category: '소화설비', facility_code: F_UNCOVERED, installed: true },
    { building_id: b2!.id, category: '소화활동설비', facility_code: F_ANNEX, installed: false },
  ])
  if (eFac) throw new Error(`설비 시드 실패: ${eFac.message}`)

  const { data: ins, error: eIns } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id, year, sequence_num').single()
  if (eIns) throw new Error(`점검 생성 실패: ${eIns.message}`)
  inspId = ins!.id
  const roundLabel = `${ins!.year}년 ${ins!.sequence_num}차`

  // 시트 코드는 DB에서 받는다 — 코드를 상수로 박으면 시딩이 바뀔 때 조용히 다른 시트를 본다
  const { data: sheets, error: eSh } = await raw.from('inspection_sheets')
    .select('id, sheet_code, sheet_name').eq('version', 'v2025')
  if (eSh) throw new Error(`시트 카탈로그 조회 실패: ${eSh.message}`)
  const byName = (n: string) => (sheets ?? []).find((s: { sheet_name: string }) => s.sheet_name === n)
  const shBase = byName(F_BASE), shAdd = byName(F_ADD), shAnnex = byName(F_ANNEX), shBanner = byName(F_BANNER)
  check('시드 — 4종 시트 실재', !!shBase && !!shAdd && !!shAnnex && !!shBanner,
    `${shBase?.sheet_code}/${shAdd?.sheet_code}/${shAnnex?.sheet_code}/${shBanner?.sheet_code}`)

  // S6 배너 재료 — 대장은 미체크인데 점검표에는 ○ 응답이 있는 상태(별지에 ／로 인쇄되는 그 모순)
  const { data: bannerItems } = await raw.from('inspection_sheet_items')
    .select('item_code').eq('sheet_id', shBanner!.id).order('order_num').limit(2)
  const bannerCodes = [...new Set((bannerItems ?? []).map((i: { item_code: string }) => i.item_code))]
  check('시드 — 배너용 항목 확보', bannerCodes.length > 0, `${bannerCodes.length}개`)
  const { error: eResp } = await raw.from('inspection_sheet_responses')
    .insert(bannerCodes.map(c => ({ inspection_id: inspId, item_code: c, result: 'O', updated_by: userId })))
  if (eResp) throw new Error(`배너용 응답 삽입 실패: ${eResp.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.on('dialog', d => d.accept())
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))

  const SHEET_URL = `${BASE}/inspections/${inspId}/sheet`
  const FAC_URL = `${BASE}/inspections/${inspId}/facilities`

  /** 좌 목록에서 그 시트가 어떤 상태로 보이는가.
   *  present=행 존재([설치 설비만]이 기본 on이라 미설치·무응답이면 숨는다), warn=설치인데 응답 0(⚠). */
  async function rowState(code: string): Promise<{ present: boolean; warn: boolean; text: string }> {
    const loc = page.locator(`[data-testid="sheet-row-${code}"]`)
    if ((await loc.count()) === 0) return { present: false, warn: false, text: '(행 없음)' }
    const t = (await loc.first().textContent()) ?? ''
    return { present: true, warn: t.includes('⚠'), text: t.trim() }
  }
  /** [저장]을 누른다 — 단, **어느 [저장]인지는 화면이 정한다**.
   *
   *  설비를 체크하면 그 순간 설비 대장 패널이 자동으로 열리고(plan-form14.tsx:421-424),
   *  그 패널은 전면 오버레이라 본문 [저장]을 덮는다. 이건 결함이 아니라 기존 설계이고,
   *  덮인 자리를 패널 자체의 [저장]이 대신한다 — **같은 save()를 부른다**(B안 2026-08-08).
   *  그래서 여기서 지키는 계약은 '본문 버튼이 눌린다'가 아니라 **'저장에 손이 닿는다'**이다.
   *  못 누르면 왜 못 눌렀는지를 말하게 한다 — 그건 사용자도 저장할 수 없다는 뜻이다. */
  async function clickSave(p: typeof page): Promise<'패널' | '본문'> {
    const panel = p.locator('[data-testid="specs-save"]')
    if ((await panel.count()) > 0 && await panel.isVisible()) {
      await panel.click({ timeout: 12000 })
      return '패널'
    }
    const btn = p.locator('[data-testid="form14-save"]')
    try {
      await btn.click({ timeout: 12000 })
      return '본문'
    } catch (err) {
      const diag = await btn.evaluate((el: Element) => {
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const top = document.elementFromPoint(cx, cy)
        return {
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          viewport: { w: window.innerWidth, h: window.innerHeight },
          disabled: (el as HTMLButtonElement).disabled,
          topEl: top ? `${top.tagName}.${(top as HTMLElement).className}`.slice(0, 120) : '(없음)',
          covered: !!top && !el.contains(top) && top !== el,
        }
      }).catch(() => null)
      console.log(`  [진단] 저장 버튼 상태 ${JSON.stringify(diag)}`)
      console.log('  [진단] covered=true면 무언가가 버튼을 덮고 있다(실사용자도 못 누른다) · disabled=true면 dirty 축 · rect.y>viewport.h면 스크롤 축')
      throw err
    }
  }

  /** 건물 셀렉터 — 다건물 고객은 `building_name` 순으로 **첫 건물**이 열린다(facility-form-data.ts:32).
   *  '본관이 먼저'라고 넘겨짚으면(한글 정렬로는 별관이 먼저다) 엉뚱한 건물에 체크하고
   *  DB는 그대로인데 화면만 맞아 보이는 모순을 얻는다 — 실측으로 걸렸다. 언제나 명시 선택한다. */
  const bldSelector = 'select:has(option:text-is("본관")):has(option:text-is("별관"))'
  async function selectBuilding(label: string): Promise<void> {
    await page.locator(bldSelector).selectOption({ label })
    await page.waitForTimeout(400)
  }
  async function shownBuilding(p: typeof page): Promise<string> {
    const sel = p.locator(bldSelector)
    return await sel.locator('option:checked').first().textContent() ?? ''
  }

  /** 그 건물·설비의 대장 행 — **maybeSingle을 쓰지 않는다**.
   *  1.4 저장은 delete→insert(K-5)라 행이 겹칠 수 있는데, maybeSingle은 행이 2개면 error를 주고
   *  data는 null이 된다. data만 보면 그 중복이 '저장 안 됨'으로 둔갑한다(2026-08-21 실사고와 같은 축). */
  async function facRows(buildingId: string, code: string): Promise<{ n: number; installed: boolean | null; err: string }> {
    const { data, error } = await raw.from('fire_facilities')
      .select('installed').eq('building_id', buildingId).eq('facility_code', code)
    return { n: (data ?? []).length, installed: (data ?? [])[0]?.installed ?? null, err: error?.message ?? '' }
  }

  /** 헤더의 '필수 미입력 N건' — 설치 축이 넓어지면 함께 커져야 한다(39 카운터가 40의 갱신을 증언) */
  async function requiredBlank(): Promise<number> {
    const loc = page.locator('[data-testid="sheet-entry-required-blank"]')
    if ((await loc.count()) === 0) return 0
    const m = /필수 미입력\s*(\d+)건/.exec((await loc.first().textContent()) ?? '')
    return m ? Number(m[1]) : -1
  }

  await login(page, EMAIL)

  // ── 1) 점검표 → 소방시설 직행 (S5-1) ────────────────────────────────────────
  await page.goto(`${SHEET_URL}?sheet=${shBase!.sheet_code}`)
  await page.waitForSelector('text=점검표 입력 —')

  const beforeAdd = await rowState(shAdd!.sheet_code)
  const beforeReq = await requiredBlank()
  check('전제 — 미설치 설비는 좌 목록에 ⚠로 서 있지 않다', !beforeAdd.warn, `${F_ADD}: ${beforeAdd.text}`)

  check('S5-1 — 좌 목록에 [설비 현황(1.4) 수정] 링크', await page.isVisible('[data-testid="sheet-entry-facilities-link"]'))
  check('S5-1 — uncovered 경고에도 대장 링크', await page.isVisible('[data-testid="sheet-entry-uncovered-link"]'),
    `덮는 시트 없는 설비: ${F_UNCOVERED}`)

  await page.click('[data-testid="sheet-entry-facilities-link"]')
  await page.waitForURL(u => u.pathname.endsWith('/facilities'), { timeout: 20000 })
  const facUrl = new URL(page.url())
  check('S5-1 — 클릭 시점 URL이 ?from=으로 실린다',
    facUrl.searchParams.get('from') === `/inspections/${inspId}/sheet?sheet=${shBase!.sheet_code}`,
    facUrl.searchParams.get('from') ?? '(없음)')
  check('S5-1 — 보던 시트가 ?sheet=으로 실린다', facUrl.searchParams.get('sheet') === F_BASE,
    facUrl.searchParams.get('sheet') ?? '(없음)')

  // ── 2) 전용 페이지의 계약 (S3) ──────────────────────────────────────────────
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  check('S3-3 — 회차 라벨이 URL의 점검 건으로 결정적', await page.isVisible(`text=${roundLabel}`), roundLabel)
  check('S3-3 — 뒤로가기가 온 자리로 복귀',
    (await page.getAttribute('[data-testid="facilities-back"]', 'href')) === `/inspections/${inspId}/sheet?sheet=${shBase!.sheet_code}`,
    (await page.getAttribute('[data-testid="facilities-back"]', 'href')) ?? '(없음)')
  const focusedCls = (await page.getAttribute(`td[data-fac="${F_BASE}"]`, 'class')) ?? ''
  check('S5-1b — 보던 시트의 설비 행이 강조된다', focusedCls.includes('bg-amber-50'), focusedCls)
  const facDefaultBld = (await shownBuilding(page)).trim()

  // ── 3) ★ 왕복 — 설치 체크 → 저장 → 복귀 → 점검표 설치 축 갱신 (S4-2) ────────
  await selectBuilding('본관')
  await page.click(`[data-testid="form14-check-${F_ADD}"]`)
  check('저장 전 — 변경됨 배지', await page.isVisible('[data-testid="form14-dirty-badge"]'))
  const savedVia = await clickSave(page)
  check('★ 체크 직후에도 저장에 손이 닿는다(패널이 덮으면 패널 [저장]이 대신)', true, `저장 경로: ${savedVia} [저장]`)
  await page.waitForSelector('[data-testid="form14-clean-badge"]', { timeout: 20000 })
  const savedRow = await pollDb(async () => {
    const r = await facRows(b1!.id, F_ADD)
    return r.installed === true ? r : null
  }, 15000)
  check('저장 — DB fire_facilities.installed=true', !!savedRow, JSON.stringify(savedRow ?? await facRows(b1!.id, F_ADD)))
  const addRows = await facRows(b1!.id, F_ADD)
  check('저장 — 대장 행이 중복되지 않는다(K-5 delete→insert)', addRows.n === 1, JSON.stringify(addRows))

  // 패널이 열린 채로는 뒤로가기도 오버레이 뒤에 있다 — 사용자와 같은 순서로 닫고 나간다(Esc, :360-366)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.click('[data-testid="facilities-back"]')
  await page.waitForURL(u => u.pathname.endsWith('/sheet'), { timeout: 20000 })
  await page.waitForSelector('text=점검표 입력 —')
  const afterAdd = await rowState(shAdd!.sheet_code)
  check('★ S4-2 — 복귀한 점검표에 그 설비가 설치로 서 있다(⚠ 미입력)', afterAdd.present && afterAdd.warn,
    `${F_ADD}: ${afterAdd.text} (저장 전: ${beforeAdd.text})`)
  const afterReq = await requiredBlank()
  check('★ S4-2 — 필수 미입력 카운터가 함께 커진다', afterReq > beforeReq, `${beforeReq}건 → ${afterReq}건`)
  check('S5-1 — 복귀 후 보던 시트가 그대로 열려 있다', page.url().includes(`sheet=${shBase!.sheet_code}`), page.url())

  // ── 4) 다건물 — 별관 저장이 union으로 반영되는가 (S3-4) ─────────────────────
  await page.goto(FAC_URL)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  check('S3-4 — 건물 셀렉터는 PlanForm14 내장(신규 코드 없음)', (await page.locator(bldSelector).count()) === 1,
    `건물 select ${await page.locator(bldSelector).count()}개`)
  await selectBuilding('별관')
  await page.click(`[data-testid="form14-check-${F_ANNEX}"]`)
  await clickSave(page)
  await page.waitForSelector('[data-testid="form14-clean-badge"]', { timeout: 20000 })
  const annexSaved = await pollDb(async () => {
    const r = await facRows(b2!.id, F_ANNEX)
    return r.installed === true ? r : null
  }, 15000)
  check('다건물 — 별관 설비가 DB에 설치로 저장', !!annexSaved, JSON.stringify(annexSaved))
  await page.goto(SHEET_URL)
  await page.waitForSelector('text=점검표 입력 —')
  const annexRow = await rowState(shAnnex!.sheet_code)
  check('★ 다건물 — 별관 설비도 점검표 설치 축에 합류(union)', annexRow.present && annexRow.warn,
    `${F_ANNEX}: ${annexRow.text}`)

  // ── 4b) S1 — 두 화면이 **같은 초기값**을 본다 (헬퍼를 뽑은 이유 자체) ────────
  // 조립이 두 벌이면 여기서 갈린다: 같은 고객인데 열리는 건물이 다르면 사용자는 다른 대장을 고친다.
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('text=서식 1.4 소방시설 현황', { timeout: 30000 })
  const custDefaultBld = (await shownBuilding(page)).trim()
  check('★ S1-2 — 고객 상세와 점검 귀속 화면이 같은 건물을 연다', custDefaultBld === facDefaultBld,
    `고객 상세 "${custDefaultBld}" vs 점검 귀속 "${facDefaultBld}"`)

  // ── 5) S6 — 대장 미체크 + 점검표 응답 있음 원클릭 해소 ──────────────────────
  await page.goto(FAC_URL)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  await selectBuilding('본관')
  const banner = page.locator('[data-testid="form14-responded-not-installed"]')
  await banner.waitFor({ timeout: 20000 })
  const bannerTxt = (await banner.textContent()) ?? ''
  check('S6-1 — 배너가 그 설비를 이름으로 지목', bannerTxt.includes(F_BANNER), bannerTxt.trim().slice(0, 90))
  check('S6-1 — 어휘가 별지 생성 경고와 같은 축', bannerTxt.includes('대장 미체크인데 점검표 응답 있음'), bannerTxt.trim().slice(0, 60))

  await page.click('[data-testid="form14-check-responded"]')
  check('S6-2 — 버튼은 체크만 바꾼다(저장은 [저장] 버튼)', await page.isVisible('[data-testid="form14-dirty-badge"]'))
  // '미설치'의 DB 표현은 installed=false **또는 행 부재**다 — 저장 액션이 미설치·비고없음 행을
  // 아예 넣지 않기 때문(facilities-actions.ts:30). false만 기대하면 멀쩡한 통과가 빨강이 된다.
  const notSavedYet = await facRows(b1!.id, F_BANNER)
  check('★ S6-2 — 누른 것만으로 DB가 바뀌지 않는다', notSavedYet.installed !== true, JSON.stringify(notSavedYet))

  await clickSave(page)
  await page.waitForSelector('[data-testid="form14-clean-badge"]', { timeout: 20000 })
  const bannerSaved = await pollDb(async () => {
    const r = await facRows(b1!.id, F_BANNER)
    return r.installed === true ? r : null
  }, 15000)
  check('S6-2 — [저장] 후 DB 반영', !!bannerSaved, JSON.stringify(bannerSaved ?? await facRows(b1!.id, F_BANNER)))
  await page.goto(FAC_URL)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  await selectBuilding('본관')

  // ── 6) S5-3 — 배지는 URL의 회차를 가리키고, 복귀 경로는 이 화면이다 ─────────
  // ⚠ 배지를 **먼저** 기다린다. 배지가 서면 overview가 실려 있다는 뜻이고, 그때서야
  //   '배너 없음'이 해소의 증거가 된다 — 순서를 뒤집으면 overview 미로딩이 성공으로 통과한다(공허 통과).
  const badge = page.locator(`[data-testid="form14-result-link-${F_BASE}"]`)
  await badge.waitFor({ timeout: 20000 }).catch(() => {})
  if ((await badge.count()) === 0) {
    const autoNa = await page.locator(`[data-testid="form14-result-auto-na-${F_BASE}"]`).count()
    const rows = await facRows(b1!.id, F_BASE)
    console.log(`  [진단] 배지 부재 — 자동／ ${autoNa}개 · 대장 행 ${JSON.stringify(rows)}`)
    console.log('  [진단] 자동／가 1이면 그 설비가 미설치로 읽힌 것(대장 축) · 0이면 overview 미로딩(canInputResult 축)')
  }
  check('★ S6 — 해소 후 경고가 사라진다(overview는 실려 있다)',
    (await badge.count()) > 0 && (await banner.count()) === 0,
    `배지 ${await badge.count()}개 · 배너 ${await banner.count()}개`)
  const badgeHref = await badge.getAttribute('href').catch(() => null)
  check('S5-3 — 배지가 이 점검 건의 점검표로 간다', (badgeHref ?? '').startsWith(`/inspections/${inspId}/sheet`), badgeHref ?? '(없음)')
  check('S5-3 — 배지의 ?from=이 1.4가 아니라 이 화면(linkFrom)',
    (badgeHref ?? '').includes(encodeURIComponent(`/inspections/${inspId}/facilities`)), badgeHref ?? '(없음)')

  // ── 7) 딥링크 계약 — 이상한 값은 조용히 무시 (S3-3) ────────────────────────
  for (const bad of ['https://evil.example/x', '//evil.example/x']) {
    await page.goto(`${FAC_URL}?from=${encodeURIComponent(bad)}`)
    await page.waitForSelector('text=서식 1.4 소방시설 현황')
    check(`S3-3 — 외부 ?from= 거부(${bad.slice(0, 12)}…)`,
      (await page.getAttribute('[data-testid="facilities-back"]', 'href')) === `/inspections/${inspId}/sheet`,
      (await page.getAttribute('[data-testid="facilities-back"]', 'href')) ?? '(없음)')
  }
  await page.goto(`${FAC_URL}?fac=${encodeURIComponent('그런설비없음')}`)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  check('S3-3 — 어휘 밖 ?fac=은 포커스 없이 열린다', (await page.locator('td[data-fac].bg-amber-50').count()) === 0)

  // ── 8) 두 권한 축이 갈라진다 (S3-2 · S5-2) ──────────────────────────────────
  // 점검 건 편집권(담당자 축)이 없어도 설비 대장(고객 자산)은 고칠 수 있어야 한다.
  const l2 = await launch()
  try {
    const p2 = l2.page
    p2.on('dialog', d => d.accept())
    await login(p2, EMAIL2)
    await p2.goto(SHEET_URL)
    await p2.waitForSelector('text=점검표 입력 —')
    check('전제 — 비담당은 점검표가 보기 전용', await p2.isVisible('text=보기 전용'))
    check('S5-2 — 그래도 대장 링크는 열려 있다(권한 게이트 없음)',
      await p2.isVisible('[data-testid="sheet-entry-facilities-link"]'))

    await p2.goto(FAC_URL)
    await p2.waitForSelector('text=서식 1.4 소방시설 현황')
    await p2.click(`[data-testid="form14-check-${F_UNCOVERED}"]`)
    check('★ S3-2 — 비담당 직원도 설비 대장은 정정할 수 있다',
      await p2.isVisible('[data-testid="form14-dirty-badge"]'))
    check('S5-3 — 편집권 없는 사람에겐 결과 배지가 없다(canEdit 축)',
      (await p2.locator('[data-testid^="form14-result-link-"]').count()) === 0)
  } finally { await l2.browser.close() }

} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (customerId) await cleanupCustomer(customerId)
  if (userId) await delUser(userId)
  if (otherId) await delUser(otherId)
}
summary('소방시설↔점검표 왕래(소방계획서_40)')
