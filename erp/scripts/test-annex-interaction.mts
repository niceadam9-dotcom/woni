// 소방계획서_8 H-7 별지 서식 상호작용 E2E — 회차 카드·작성·이어받기·전체 미리보기 실주행
// + H-5e(D-17) 9호發 진입 컨텍스트·빈칸만 보기·교차 검증 칩
// 실행: npx tsx scripts/test-annex-interaction.mts  (로컬 dev 서버 + 스테이징 DB, 112 적용 필요 — PDF 생성은 test-annex-compose가 커버)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-interact-e2e@erp-test.com'
let userId = ''
let customerId = ''
let buildingId = ''
let prevInspId = ''
let curInspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
const CUR_YEAR = Number(kstShift(-1).slice(0, 4))
const PREV_YEAR = CUR_YEAR - 1
const PREV_NOTE = 'E2E전회차비고-수신반 표시등 교체 권고'

try {
  userId = await mkUser({ email: EMAIL, name: '별지상호작용E2E', employeeId: 'E2E-ANNEXI' })
  customerId = await mkCustomer({ customer_name: '별지상호작용E2E고객', address: '경기 양평군 테스트로 88', created_by: userId })
  const { data: bld, error: bErr } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId,
  }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  buildingId = bld!.id
  // 1.4 설치(√) — 소화기구 블록이 설비 대장에서 펼침 가능해야 교차 칩 대상이 된다
  const { error: fErr } = await raw.from('fire_facilities').insert({
    building_id: buildingId, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })
  if (fErr) throw new Error(`시설 생성 실패: ${fErr.message}`)

  // 전 회차(작년, 완료) — 이어받기 원본. year는 inspection_start_date에서 생성(002 GENERATED)
  const { data: pIns, error: pErr } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: `${PREV_YEAR}-05-10`, inspection_end_date: `${PREV_YEAR}-05-10`,
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (pErr) throw new Error(`전 회차 생성 실패: ${pErr.message}`)
  prevInspId = pIns!.id
  await raw.from('annex_inputs').insert({
    inspection_id: prevInspId, annex_no: 'report9',
    fields: { reportDate: `${PREV_YEAR}-05-12`, note: PREV_NOTE },
  })

  // 현 회차(올해, 진행중)
  const { data: cIns, error: cErr } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (cErr) throw new Error(`현 회차 생성 실패: ${cErr.message}`)
  curInspId = cIns!.id

  // 점검표 응답 시드(교차 검증 칩) — v2025 소화기구 시트 첫 항목에 O 1건
  const { data: sheet } = await raw.from('inspection_sheets')
    .select('id, sheet_name').eq('version', 'v2025').ilike('sheet_name', '%소화기구%').limit(1).maybeSingle()
  if (sheet) {
    const { data: item } = await raw.from('inspection_sheet_items')
      .select('item_code').eq('sheet_id', sheet.id).order('order_num').limit(1).maybeSingle()
    if (item) {
      await raw.from('inspection_sheet_responses').insert({
        inspection_id: curInspId, item_code: item.item_code, result: 'O', updated_by: userId,
      })
    }
  }
  check('시드 — v2025 소화기구 시트·항목 존재', !!sheet, '스테이징 시트 카탈로그 확인 필요')

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 회차 카드 — 최신 즉시 펼침(D-4)·과거 아코디언·성격 배지 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=annex`)
  await page.waitForSelector(`text=${CUR_YEAR}년 1차`)
  // 소방계획서_20 S2: 완료 회차는 "지난 회차 N건" 접힘 섹션으로 내려가 처음엔 라벨이 보이지 않는다
  check('회차 카드 — 현 회차 + 지난 회차 섹션', await page.isVisible('text=지난 회차 1건'))
  check('회차 카드 — 최신 회차 자동 펼침(점검표 행)', await page.isVisible('text=점검표 입력'))
  check('회차 카드 — 성격 배지 작동(자체)', await page.isVisible('text=작동(자체)'))
  check('회차 카드 — 과거 회차는 접힘(문서 행 1세트)', (await page.locator('text=점검표 입력').count()) === 1)
  check('회차 카드 — 별지 4호 [자동] 행', await page.isVisible('text=별지 4호 점검표'))

  // 과거 회차 — 섹션 펼침 → 요약 행 클릭 시 상세 지연 로드(S2) → 문서 행 2세트
  await page.click('button:has-text("지난 회차 1건")')
  await page.waitForSelector(`text=${PREV_YEAR}년 1차`)
  check('지난 회차 섹션 — 연도 그룹·요약 행', await page.isVisible(`text=${PREV_YEAR}년 · 1건`))
  await page.click(`button:has-text("${PREV_YEAR}년 1차")`)
  await page.waitForFunction(() =>
    document.querySelectorAll('*').length > 0 &&
    [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent?.includes('점검표 입력')).length >= 2,
    undefined, { timeout: 30000 })
  check('과거 회차 지연 로드 — 문서 행 2세트', (await page.locator('text=점검표 입력').count()) === 2)

  // D-7 호버 퀵뷰는 소방계획서_20 S3에서 폐지 — 프리페치 지연화로 캐시가 비어 빈 팝업만 뜨던 기능.
  // 같은 일을 행 [보기](단일 문서 모달)가 하며, 아래 2-c에서 검증한다.
  // 카드 본문 2블록(S3) — 작업 순서가 화면에 드러나는지
  check('카드 2블록 — ① 점검표 / ② 별지 생성·확인', await page.isVisible('text=① 점검표') && await page.isVisible('text=② 별지 생성·확인'))

  // ── 2) 전체 미리보기(H-5c) — 요약 바·세로 연결 렌더·⑩⑪ 축약 ──
  await page.locator('text=🔍 전체 미리보기').first().click()
  await page.waitForSelector('text=— 전체 미리보기')
  check('전체 미리보기 — 모달 오픈', true)
  await page.waitForSelector('#fp-report9 iframe', { timeout: 45000 })
  check('전체 미리보기 — 9호 렌더(iframe)', true)
  check('전체 미리보기 — 4호 렌더(iframe)', await page.isVisible('#fp-report4 iframe'))
  check('전체 미리보기 — 배치확인서 칩(⚠없음)', await page.isVisible('text=배치확인서 ⚠없음'))
  check('전체 미리보기 — 불량 0건 ⑩⑪ 미표시', !(await page.isVisible('text=이행계획서')))
  check('전체 미리보기 — 미입력 집계 요약', await page.isVisible('text=미입력 총'))
  // 2-b) 단일 문서 모드(#13) — 칩으로 4호↔9호 전환, [전체]로 복귀
  await page.locator('div.fixed >> button:has-text("9호")').first().click()
  await page.waitForSelector('text=별지 9호 실시결과 보고서 보기')
  check('단일 보기 — 9호 칩으로 전환', true)
  check('단일 보기 — 세로 연결(4호) 미표시', (await page.locator('#fp-report4 iframe').count()) === 0)
  await page.locator('div.fixed >> button:has-text("4호")').first().click()
  await page.waitForSelector('text=별지 4호 점검표 보기')
  check('단일 보기 — 4호로 전환(모달 유지)', true)
  await page.locator('div.fixed >> button:has-text("전체")').first().click()
  await page.waitForSelector('#fp-report4 iframe')
  check('단일 보기 — [전체]로 복귀', await page.isVisible('#fp-report9 iframe'))
  await page.click('button:has-text("✕")')
  await page.waitForSelector('text=— 전체 미리보기', { state: 'detached' })

  // 2-c) 문서 행 [보기] 버튼 → 그 문서만 바로 크게 (생성 전에도)
  await page.locator('div:has(> span:text-is("실시결과 보고서 (9호)")) >> button:has-text("보기")').first().click()
  await page.waitForSelector('text=별지 9호 실시결과 보고서 보기')
  check('행 [보기] — 9호 단일 모달 오픈', true)
  await page.click('button:has-text("✕")')
  await page.locator('div:has(> span:text-is("별지 4호 점검표")) >> button:has-text("보기")').first().click()
  await page.waitForSelector('text=별지 4호 점검표 보기')
  check('행 [보기] — 4호 단일 모달 오픈', true)
  await page.click('button:has-text("✕")')

  // ── 3) 별지 9호 작성(H-5) + 전 회차 이어받기(H-5b·D-5) ──
  await page.locator('div:has(> span:text-is("실시결과 보고서 (9호)")) >> button:has-text("작성")').first().click()
  const p9 = page.locator('[data-annex-panel="report9"]')
  await p9.locator('textarea[aria-label="비고·보완 문구"]').waitFor()
  await p9.locator(`text=전 회차(${PREV_YEAR}년 1차) 입력값이 있습니다`).waitFor()
  check('이어받기 — 배너 표시(첫 작성)', true)
  await p9.locator('button:has-text("이어받기")').click()
  check('이어받기 — 서술(비고) 복사', (await p9.locator('textarea[aria-label="비고·보완 문구"]').inputValue()) === PREV_NOTE)
  check('이어받기 — 날짜류 제외(보고일 빈칸)', (await p9.locator('input[aria-label="보고일"]').inputValue()) === '')
  await p9.locator('button:has-text("저장")').click()
  await p9.locator('text=저장됨').waitFor()
  const { data: saved } = await raw.from('annex_inputs')
    .select('fields').eq('inspection_id', curInspId).eq('annex_no', 'report9').single()
  const sf = (saved?.fields ?? {}) as Record<string, string>
  check('DB — 이어받은 비고 저장·날짜 미복사', sf.note === PREV_NOTE && !sf.reportDate, JSON.stringify(sf))

  // ── 4) 9호發 설비 대장 진입(H-5e·D-17) — 링크 컨텍스트·스플릿 ON·첫 빈칸 포커스·복귀 ──
  const ledgerHref = await p9.locator('a[href*="from=report9"]').first().getAttribute('href')
  check('9호 패널 — 설비 대장 링크에 from=report9&insp=', !!ledgerHref
    && ledgerHref.includes('form=1.4') && ledgerHref.includes(`insp=${curInspId}`), ledgerHref ?? '(없음)')
  // 실제 링크 클릭(클라이언트 내비) — plan-tab-view prop-sync 경로 실주행 (goto 풀로드 공백 해소)
  await p9.locator('a[href*="from=report9"]').first().click()
  await page.waitForSelector('text=설비 대장 — 별지 3. 소방시설등의 세부현황')
  await page.waitForSelector('button:has-text("9호로 돌아가기")')
  check('9호發 — 복귀 버튼 표시', true)
  check('9호發 — 스플릿 자동 ON(미리보기 닫기 상태)', await page.isVisible('button:has-text("미리보기 닫기")'))
  check('9호發 — 우측 9호 미리보기 패널', await page.isVisible('text=⑨ 별지 9호 미리보기'))
  await page.waitForTimeout(1200) // 첫 빈칸 포커스 setTimeout 대기
  const focusedField = await page.evaluate(() =>
    document.activeElement?.closest('[data-spec-field]')?.getAttribute('data-spec-field') ?? '')
  check('9호發 — 첫 빈칸 포커스', focusedField !== '', `focused=${focusedField || '(없음)'}`)

  // 교차 검증 칩 — 점검표 응답(소화기구 O) 있는데 제원 빈칸 (액션 조회에 수 초 소요 — 대기형)
  await page.waitForSelector('text=점검함·제원 미입력', { timeout: 25000 })
  check('교차 검증 — 요약 칩(점검함·제원 미입력)', true)
  check('교차 검증 — 회차 라벨 표기', await page.isVisible(`text=${CUR_YEAR}년 1차 점검표 기준`))

  // ── 5) 빈칸만 보기(D-17) — 스냅샷 고정·채움 ✓·전체 보기 복귀 ──
  await page.click('button:has-text("빈칸만 보기")')
  await page.waitForSelector('text=남은 미입력')
  check('빈칸만 보기 — 상태 바·강제 펼침', await page.locator('[data-spec-field] input').first().isVisible())
  await page.locator('[data-spec-field] input').first().fill('E2E-3단위')
  await page.waitForSelector('text=채움 1칸')
  check('빈칸만 보기 — 채워도 목록 유지(채움 1칸)', true)
  await page.click('button:has-text("전체 보기")')
  await page.waitForSelector('text=남은 미입력', { state: 'detached' })
  check('빈칸만 보기 — 전체 보기 복귀', true)

  // ── 6) 복귀 버튼 — history back으로 별지 트리 복귀 ──
  await page.click('button:has-text("9호로 돌아가기")')
  await page.waitForURL(u => u.searchParams.get('form') === 'annex', { timeout: 10000 })
  check('복귀 — 별지 서식 화면으로 돌아감', true)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const iid of [prevInspId, curInspId]) {
    if (!iid) continue
    await raw.from('annex_inputs').delete().eq('inspection_id', iid)
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', iid)
  }
  if (customerId) {
    await raw.from('customer_facility_specs').delete().eq('customer_id', customerId)
    if (buildingId) {
      await raw.from('fire_facilities').delete().eq('building_id', buildingId)
      await raw.from('fire_facility_floors').delete().eq('building_id', buildingId)
    }
    await raw.from('buildings').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  await delUser(userId)
  summary()
}
