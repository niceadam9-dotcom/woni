// 소방계획서 탭 E2E — 4-1 골격(§8-1) + P2 빠른 입력 모드(§1-1·§9-6①·§9-8)
// 실행: npx tsx scripts/test-plan-tab.mts  (로컬 dev 서버 + 스테이징 DB, 096·098 적용 필요)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'plan-tab-e2e@erp-test.com'
let userId = ''
let customerId = ''
let generalId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '플랜탭E2E', employeeId: 'E2E-PLANTAB' })
  customerId = await mkCustomer({ customer_name: '플랜탭E2E고객', address: '경기 양평군 테스트로 1', created_by: userId })
  generalId = await mkCustomer({
    customer_name: '플랜탭E2E일반', address: '경기 양평군 테스트로 2', created_by: userId,
    inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: null,
  })
  // 1.4 검증용 건물 (지번 미보유 — 대장 불러오기는 needAddress 경로)
  const { error: bErr } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId,
    floors_above: 3, floors_below: 1,
  })
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 기본 진입 = 1.1 일반현황 입력폼 (2026-08-06: ⚡ 빠른 입력 요약 페이지 폐기) ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.waitForSelector('text=① 시설현황')
  check('랜딩 — 1.1 일반현황 입력폼이 첫 화면', await page.isVisible('text=② 운영현황'))
  check('랜딩 — 빠른 입력 노드 폐기', !(await page.isVisible('button:has-text("⚡ 빠른 입력")')))
  check('폐기 — 필수 완성도 카드 없음', !(await page.isVisible('text=필수 완성도')))
  check('폐기 — 필요 문서 칩 없음', !(await page.isVisible('text=필요 문서')))
  check('폐기 — 보관함 요약 없음', !(await page.isVisible('text=보관함이 비어 있습니다')))
  check('폐기 — 건축물대장 불러오기 버튼 없음', !(await page.isVisible('button:has-text("건축물대장 불러오기")')))
  check('생성 바 — 누락 칩(입력처 이동) 유지', await page.isVisible('text=누락:'))
  // 생성 버튼은 보관함으로 이관됐다 (소방계획서_21 R2-11 / #2 D-1) — 생성물이 쌓이는 곳에서 생성해야
  // 결과가 그 자리에 바로 보인다. 종전 라벨 '계획서 생성 (HWP+PDF)'는 사실과도 달랐다:
  // 소방계획서_7 H-13이 한글 SDK를 걷어낸 뒤 hwp_path에 null을 넣으므로 HWP는 만들어지지 않는다.
  // (이 단언은 이관 이후 계속 실패하고 있었다 — 사라진 버튼을 찾고 있었다. 2026-08-19 정정)
  check('생성 바 — [계획서 생성] 버튼 폐지(조회는 즉석 렌더로 일원화)',
    !(await page.isVisible('button:has-text("계획서 생성")')))
  check('생성 바 — [PDF 생성](웹 템플릿) 폐기 확인', !(await page.isVisible('button:has-text("PDF 생성")')))
  // 2026-08-10: 생성 바 연도 입력칸 폐지(올해 자동) — 연도 표기는 '보고서 커버' 서식으로 이동.
  // 버튼이 사라졌으므로 '생성 바에 연도 입력칸이 없다'를 생성 바 영역 기준으로 본다
  check('생성 바 — 연도 입력칸 폐지',
    (await page.locator('div:has(> p:has-text("누락:")) input[type="number"]').count()) === 0)

  // 보관함 폐지(2026-09-02) — 조회·개정이력 노드에 즉석 조회 3버튼([현재 내용]·[인쇄]·[PDF 받기])만
  // 있고, 파일을 만들던 [개정 발행]·업로드·연차·제출 추적은 전부 사라졌다
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=archive`)
  await page.waitForSelector('button:has-text("현재 내용")')
  check('조회 — [현재 내용]·[인쇄]·[PDF 받기] 즉석 3버튼',
    await page.isVisible('button:has-text("인쇄")') && await page.isVisible('button:has-text("PDF 받기")'))
  check('폐지 — [개정 발행] 없음', !(await page.isVisible('button:has-text("개정 발행")')))
  check('폐지 — [연차] 없음', !(await page.isVisible('button:has-text("연차")')))
  check('폐지 — 제출 추적 없음', !(await page.isVisible('text=제출 추적')))
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.waitForSelector('text=① 시설현황')

  // ── 2) 송달 동의 — 1.1 ④ 섹션으로 흡수, 저장 버튼 통합(2026-08-06) ──
  check('1.1 — ④ 송달 동의 섹션 이관됨', await page.isVisible('text=자체점검 보고서 전자우편 송달 동의'))
  check('저장 통합 — ④ 섹션에 자체 저장 버튼 없음(폼 [저장]으로 통합)',
    (await page.locator('#consent-section button:has-text("저장")').count()) === 0)

  // 화재보험 라벨 — [가입] 선택 시 노출되는 4칸에 항목명·단위가 붙어 있어야 함(placeholder 의존 폐기)
  await page.click('#fp-insurance button:has-text("가입")')
  await page.waitForSelector('text=대인 가입금액')
  check('화재보험 — 라벨 노출(보험사·기간·대인/대물)',
    await page.isVisible('text=대물 가입금액') && await page.isVisible('text=가입기간'))
  // 단위는 **만원**(2026-08-24 확정). 종전 '천만원'은 별지 9호 원문에 없는 단위였다 —
  // 별지 9호 PDF·갑지 엑셀·소방계획서 서식과 **한 단위**여야 한다. `만원`은 `천만원`의 부분
  // 문자열이므로 '천만원 0건'을 함께 단언해야 옛 단위 잔재를 잡는다(포함 관계 주의)
  check('화재보험 — 금액 단위(만원) 표시', (await page.locator('text=만원').count()) >= 2)
  check('화재보험 — 옛 단위(천만원) 잔재 0', (await page.locator('text=천만원').count()) === 0)

  // ── 3) 송달 동의 + 화재보험을 1.1 [저장] 하나로 저장 (098 §9-6① · 라벨 복구분) ──
  await page.click('#consent-section button:has-text("동의")')
  await page.fill('input[placeholder="예: owner@example.com"]', 'owner@example.com')
  // 2026-08-26 — `button:text-is("저장")`은 이 화면에서 4개를 잡고 첫 매치가 소방안전관리자 패널의
  // **비활성·비가시** 저장이라 클릭이 타임아웃났다(내 1.4 변경과 무관한 선행 결함). 표적 고정.
  await page.click('[data-testid="fp-info-save"]')
  await page.waitForSelector('text=저장되었습니다')
  const { data: cRow } = await raw.from('customers')
    .select('email_delivery_consent, report_email').eq('id', customerId).single()
  check('DB 송달 동의 저장 (통합 저장 경로)', cRow?.email_delivery_consent === true && cRow?.report_email === 'owner@example.com', JSON.stringify(cRow))

  // ── 4) 트리 — 조회·개정이력 노드 진입 (구 보관함·개정이력, 2026-09-02 개칭) ──
  await page.click('button:has-text("조회·개정이력")')
  await page.waitForSelector('text=개정이력')
  check('트리 — 조회·개정이력 노드 진입', await page.isVisible('text=개정이력'))
  check('트리 — 4개 장 전부 활성', await page.isVisible('button:has-text("3장 피난계획")') && !(await page.isVisible('text=준비 중')))

  // 개정이력 저장 → fire_plan_revisions(120, 연도별 행 — 소방계획서_17).
  // 구 경로(sections.revision 단일 슬롯)는 저장할 때마다 덮어써 이력이 남지 않아 폐기됐다.
  await page.click('button:has-text("개정 추가")')
  await page.fill('input[placeholder="주요 개정내용"]', '개정 E2E 검증')
  await page.click('[data-testid="revision-save"]')   // 텍스트 셀렉터는 4개를 잡는다(위 fp-info-save 주석 참조)
  await page.waitForSelector('text=개정이력 저장됨', { timeout: 60000 })
  const { data: revRow } = await raw.from('fire_plan_revisions')
    .select('year, seq, content, source').eq('customer_id', customerId).maybeSingle()
  check('DB fire_plan_revisions 저장(수동 행)',
    revRow?.content === '개정 E2E 검증' && revRow?.source === 'manual', JSON.stringify(revRow))

  // ── P6 §1: 목차 트리 + form= 딥링크 + URL 동기화 ──
  // 소방계획서_8 D-12는 3그룹이었으나 _34(2026-08-29)가 📑 별지 서식을 최상위 [별지서식] 탭으로
  // 승격하며 **2그룹**이 됐다. 별지 노드가 트리에 없다는 것까지 함께 단언한다(되살아나면 이중 마운트).
  check('목차 트리 — 2그룹(본문·조회이력)',
    await page.isVisible('text=소방계획서 본문')
    && await page.isVisible('text=조회·개정이력'))
  check('목차 트리 — 별지 노드는 탭으로 나가서 없다',
    (await page.locator('[data-plan-node="annex"]').count()) === 0)
  await page.click('button:has-text("1.1 일반현황")')
  await page.waitForSelector('text=계획서 정보')
  check('목차 1.1 클릭 → 계획서 정보 패널', true)
  check('URL 동기화 form=1.1', page.url().includes('form=1.1'))
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&sub=ch1`)
  await page.waitForSelector('text=계획서 정보')
  check('구 딥링크 sub=ch1 → 1.1 호환', true)
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.6`)
  await page.waitForSelector('text=가스 시설')
  check('딥링크 form=1.6 직행', true)

  // ── 보고서 커버 — 본문 그룹 마지막 노드 (2026-08-10: 생성 문서 마지막 페이지 업체명·연도) ──
  await page.click('button:has-text("보고서 커버")')
  await page.waitForSelector('#cover-company')
  check('커버 — 노드 진입 + URL 동기화 form=cover', page.url().includes('form=cover'))
  check('커버 — 연도 자동값 안내(placeholder=올해)',
    (await page.getAttribute('#cover-year', 'placeholder')) === String(new Date().getFullYear()))
  await page.fill('#cover-company', '커버 E2E 업체')
  await page.fill('#cover-year', '2030')
  check('커버 — 미리보기 즉시 반영', await page.isVisible('text=[ 커버 E2E 업체 ]') && await page.isVisible('text=2030년도'))
  await page.click('button:has-text("보고서 커버 저장")')
  await page.waitForSelector('text=보고서 커버 저장됨')
  const { data: coverForm } = await raw.from('fire_plan_forms')
    .select('sections').eq('customer_id', customerId).maybeSingle()
  const rcSec = (coverForm?.sections as { reportCover?: { company?: string; year?: string } } | null)?.reportCover
  check('DB sections.reportCover 저장', rcSec?.company === '커버 E2E 업체' && rcSec?.year === '2030', JSON.stringify(rcSec))

  // ── P6-2 §3-1.1: 1.1 신규 필드 (계단·경사로·피난용승강기·대표자 구분·자격구분·교육이수일) ──
  // 계획서 정보 패널 = 요약/편집 토글·아코디언 폐기(소방계획서_10 §3-4) — 열자마자 편집 폼 바로 노출
  await page.click('button:has-text("1.1 일반현황")')
  await page.waitForSelector('button:has-text("추천값 채우기")')
  await page.waitForSelector('text=① 시설현황')
  check('1.1 섹션 카드 ①②③', await page.isVisible('text=② 운영현황') && await page.isVisible('text=③ 화재보험'))
  // 건물 축은 여전히 1.1에 있다
  const stairsInput = page.locator('div:has(> label:text-is("계단")) input')
  const evacInput = page.locator('div:has(> label:text-is("피난용승강기")) input')
  await stairsInput.fill('2')
  await evacInput.fill('1')
  // ⚠ 2026-08-30: 하이드레이션 전 fill은 DOM 값만 바꾸고 **React 상태엔 안 남는다**. 그러면 빈 값이
  //   저장되는데 저장 자체는 성공해 '저장되었습니다' 토스트가 그대로 뜨고, :151에서야 null로 드러난다 —
  //   조용히 틀린 값이 들어가는 형태라 화면만 봐선 모른다. 저장을 누르기 전에 **입력이 실제로 먹었는지**
  //   확인한다. fill은 치환이라 몇 번을 돌아도 결과가 같다.
  for (let i = 0; i < 8; i++) {
    if (await stairsInput.inputValue() === '2' && await evacInput.inputValue() === '1') break
    await stairsInput.fill('2')
    await evacInput.fill('1')
    await page.waitForTimeout(250)
  }
  await page.click('[data-testid="fp-info-save"]')   // [저장 후 다음 탭 →] 폐기(2026-08-08) — 1.1 [저장] 단일
  await page.waitForSelector('text=저장되었습니다')
  const { data: bldNew } = await raw.from('buildings').select('stairs_count, evac_elevator_count').eq('customer_id', customerId).limit(1).single()
  check('DB 1.1 신규 필드(buildings)', bldNew?.stairs_count === 2 && bldNew?.evac_elevator_count === 1, JSON.stringify(bldNew))

  // 사람 축(대표자 구분·관리자 자격구분)은 2026-08-20 `ee1d290`부터 **관계인 탭 [소방안전관리]**로
  // 이관됐다(fire-plan-info-panel.tsx:306-318 — 1.1엔 안내 링크만 남았다). 이 테스트는 이관을
  // 따라가지 않아 1.1에서 눌러 왔고, 그 셀렉터가 **다른 탭의 숨은 패널**을 잡아 resolved 된 채
  // not visible로 15초 타임아웃났다. 입력처를 따라간다 — 검증 대상은 여전히 같은 두 컬럼이다.
  await page.goto(`${BASE}/customers/${customerId}?tab=contacts`)
  await page.waitForSelector('#c-fire-safety-manager')
  await page.click('#c-fire-safety-manager div:has(> label:has-text("대표자 구분")) button:has-text("소유자")')
  await page.click('#c-fire-safety-manager div:has(> label:has-text("관리자 자격구분")) button:has-text("2급")')
  await page.click('[data-testid="fsm-save"]')
  await page.waitForSelector('text=저장됨 — 별지 9호 2쪽')
  const { data: custNew } = await raw.from('customers').select('rep_role, manager_license_grade').eq('id', customerId).single()
  check('DB 사람 축(customers) — 관계인 탭 [소방안전관리] 저장',
    custNew?.rep_role === '소유자' && custNew?.manager_license_grade === '2급', JSON.stringify(custNew))

  // 이관 회귀 — 1.1에는 입력 칸이 아니라 **안내 링크**만 있어야 한다(되돌아오면 두 곳 입력이 갈린다)
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.1`)
  await page.waitForSelector('text=① 시설현황')
  check('1.1 — 사람 축 입력칸 없음(관계인 탭으로 이관)',
    (await page.locator('#fp-manager-date label:text-is("대표자 구분")').count()) === 0)
  check('1.1 — 관계인 탭 안내 링크 유지', await page.isVisible('a:has-text("관계인 탭")'))

  // ── 4.5) 서식 1.2·1.3 (P4-①) — 프리셋·저장·DB 반영 ──
  await page.click('button:has-text("1.2 세부현황")')
  await page.waitForSelector('text=1.2.2 화재취약장소')
  check('서식 1.2 — 구역별·화재취약 카드', await page.isVisible('text=1.2.1 구역별 세부현황'))
  await page.click('button:has-text("+ 보일러실")')
  await page.click('button:has-text("서식 1.2 저장")')
  await page.waitForSelector('text=서식 1.2 저장됨')
  const { data: f12 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const hz = (f12?.sections as { hazards?: Array<{ place: string; risks: string[] }> } | null)?.hazards
  check('DB sections.hazards 저장 (보일러실 프리셋)', hz?.[0]?.place === '보일러실' && (hz?.[0]?.risks ?? []).includes('가스누출'), JSON.stringify(hz))

  await page.click('button:has-text("1.3 위치·소방차진입")')
  await page.waitForSelector('text=소방차 세부진입 계획')
  check('1.3 — 생성 삽입 사진 카드(§8-1k 이관)', await page.isVisible('text=생성 문서 삽입 사진'))
  // 2026-08-08 — [지도·사진] 전용 노드 폐지: 슬롯 UI(표지·위치도·피난안내도)가 1.3 안에서 바로 보인다
  check('1.3 안에 [지도·사진] 슬롯 카드 삽입',
    await page.isVisible('[data-testid="customer-assets"]'))
  check('1.3 슬롯 3종 라벨',
    await page.isVisible('text=표지 건물 사진') && await page.isVisible('text=위치도·약도')
    && await page.isVisible('text=피난안내도·평면도'))
  // 소방계획서_11 D-5 — 신규 사진 종류는 '기타'만(건물 전경·위치도·피난경로도 선택지 제거)
  await page.click('button:has-text("+ 사진 추가")')
  await page.waitForSelector('[data-testid="form13-photo-kind"]')
  const kindOpts = await page.$eval('[data-testid="form13-photo-kind"]',
    (el: HTMLSelectElement) => Array.from(el.options).map(o => o.value))
  check('D-5 신규 사진 종류 = 기타 단일', kindOpts.length === 1 && kindOpts[0] === 'etc', kindOpts.join(','))
  await page.click('[data-testid="form13-photo-remove"]')   // 추가한 빈 행 정리
  // 소방계획서_11 D-2 — 자동차 도로 기반 주변 현황 초안 버튼
  check('D-2 자동 문장 만들기 버튼',
    await page.isVisible('[data-testid="form13-suggest-surroundings"]'))
  // ── 소방계획서_13 — 관할 소방서 선택 시 거리·도착예상 자동완성(A안) + 조회 UI 단일화(C-1) ──
  // 조회 결과는 성공(값 기입)·미가용(403 안내)·실패(주소 없음) 어느 쪽이든 **안내가 뜨고 입력은 계속 가능**해야 한다
  const routeOutcome = '[data-testid="form13-route-msg"], [data-testid="form13-route-suggest"]'
  // B안 — 관할 소방서가 1.3의 기준점이라 최상단 독립 카드다(주변 현황 카드보다 먼저)
  check('B안 카드 ① 관할 소방서·출동 거리', await page.isVisible('text=관할 소방서·출동 거리'))
  check('B안 카드 ② 건축물 위치·주변 현황', await page.isVisible('text=건축물 위치·주변 현황'))
  const cardOrder = await page.evaluate(() => {
    const t = document.body.innerText
    return [t.indexOf('관할 소방서·출동 거리'), t.indexOf('건축물 위치·주변 현황'), t.indexOf('소방차 세부진입 계획')]
  })
  check('B안 카드 순서 ①→②→③', cardOrder[0] >= 0 && cardOrder[0] < cardOrder[1] && cardOrder[1] < cardOrder[2], cardOrder.join(','))
  const stationSel = page.locator('[data-testid="form13-station-select"]')
  check('A-1 관할 소방서 드롭다운', await stationSel.isVisible())
  const stOpts = await stationSel.evaluate((el: HTMLSelectElement) =>
    Array.from(el.options).map(o => o.value).filter(v => v && v !== '__custom__'))
  check('A-1 소방서 후보 존재(행정구역 매핑)', stOpts.length > 0, stOpts.join(','))
  await stationSel.selectOption(stOpts[0])
  const autoMsg = await page.waitForSelector(routeOutcome, { timeout: 20000 })
    .then(el => el.textContent()).catch(() => null)
  const kmVal = await page.locator('div:has(> label:text-is("거리")) input').inputValue().catch(() => '')
  check('A-2 소방서 선택 → 자동 조회 결과 반영(값 기입 또는 안내)',
    (!!autoMsg && autoMsg.trim().length > 0) || kmVal.trim() !== '', `msg=${autoMsg} km=${kmVal}`)
  check('A-2 자동 조회가 입력을 막지 않음', await page.isEditable('[data-testid="form13-surroundings"]'))
  // C-1 중복 정리 — 조회 트리거는 [경로 다시 계산] 하나, 적용 버튼([거리·시간 채우기])은 폐기
  check('C-1 [거리·시간 채우기] 폐기(적용 경로 단일화)',
    (await page.locator('[data-testid="form13-apply-distance"]').count()) === 0)
  check('C-1 구 [소방서에서 경로 가져오기] 폐기', !(await page.isVisible('button:has-text("소방서에서 경로 가져오기")')))
  check('C-1 조회 트리거 = [경로 다시 계산] 단일', await page.isVisible('[data-testid="form13-fetch-route"]'))
  await page.click('[data-testid="form13-fetch-route"]')
  const routeMsg = await page.waitForSelector(routeOutcome, { timeout: 20000 })
    .then(el => el.textContent()).catch(() => null)
  check('C-1 재계산 — 결과 안내 노출(입력 차단 없음)',
    !!routeMsg && routeMsg.trim().length > 0 && await page.isEditable('textarea[placeholder*="정문 방면"]'),
    String(routeMsg))
  await page.fill('[data-testid="form13-surroundings"]', '주변현황 E2E')
  await page.fill('input[placeholder*="정문 앞 도로"]', '정문 앞')
  // §1-2 미저장 이동 확인 — 저장 전 목차 이동 시 확인창(네이티브 confirm 아님, [저장하고 이동] 포함)
  await page.click('button:has-text("1.5 피난·방화")')
  await page.waitForSelector('[data-unsaved-dialog]', { timeout: 5000 })
  check('미저장 이동 확인 — [저장하고 이동] 버튼 제공',
    await page.isVisible('[data-testid="unsaved-nav-save"]'))
  await page.click('[data-testid="unsaved-nav-cancel"]')
  // 고정 대기(400ms)는 dev RSC 커밋이 늦으면 그냥 실패한다 — 조건 대기로 바꾼다.
  // 취소했으니 1.3에 머물러야 하고, 그 증거는 '소방차 세부진입 계획'이 다시 보이는 것이다.
  const stayed = await page.waitForSelector('text=소방차 세부진입 계획', { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('미저장 이동 확인 — 취소 시 잔류', stayed)
  await page.click('button:has-text("서식 1.3 저장")')
  await page.waitForSelector('text=서식 1.3 저장됨')
  const { data: f13 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const sec13 = f13?.sections as { location?: { surroundings: string }; fireAccess?: { entryPoint: string } } | null
  check('DB sections.location 저장', sec13?.location?.surroundings === '주변현황 E2E', JSON.stringify(sec13?.location))
  // D-2 — 1.3에서 고른 소방서가 고객 정보에 역반영되고 source가 manual로 올라간다(문서 간 불일치 제거)
  const { data: custStation } = await raw.from('customers')
    .select('fire_station, fire_station_source').eq('id', customerId).single()
  check('D-2 1.3 관할 소방서 → 고객 정보 역반영',
    (custStation?.fire_station ?? '').trim() === (sec13?.location?.fireStation ?? '').trim()
    && custStation?.fire_station_source === 'manual', JSON.stringify(custStation))
  // D-2-2(독립검증 지적) — page.tsx가 1.3의 소방서를 고객 값으로 프리필하므로, **값이 같은 저장**에
  // 역반영이 걸리면 '추정' 경고가 확인 없이 사라진다. 같은 값이면 source를 건드리지 않아야 한다.
  await raw.from('customers').update({ fire_station_source: 'estimate' }).eq('id', customerId)
  // 직전 저장의 router.refresh(RSC) 늦은 커밋이 controlled input을 되돌린다 — 값 검증 후 재입력(문서화된 플레이크 패턴)
  await page.waitForLoadState('networkidle')
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.fill('[data-testid="form13-surroundings"]', '주변현황 E2E 2차')  // 소방서는 그대로 두고 dirty만 만든다
    await page.waitForTimeout(400)
    if (await page.locator('[data-testid="form13-surroundings"]').inputValue() === '주변현황 E2E 2차') break
  }
  await page.click('button:has-text("서식 1.3 저장")')
  // '서식 1.3 저장됨' 텍스트는 1차 저장의 잔류 메시지와 구분이 안 된다(스테일 통과) — 저장 완료의 정확한
  // 신호는 미저장 save 핸들러 드레인(dirty 해제 시 등록 해제, ui/unsaved-nav). 이걸 기다려야 아래 1.5 이동이
  // 미저장 확인창에 걸리지 않는다.
  await page.waitForFunction(() => {
    const handlers: unknown[] = []
    window.dispatchEvent(new CustomEvent('erp:plan-save-collect', { detail: { handlers } }))
    return handlers.length === 0
  })
  const { data: keptSrc } = await raw.from('customers')
    .select('fire_station_source').eq('id', customerId).single()
  check('D-2 같은 값 저장은 source 유지(추정 배지 보존)',
    keptSrc?.fire_station_source === 'estimate', JSON.stringify(keptSrc))
  check('DB sections.fireAccess 저장', sec13?.fireAccess?.entryPoint === '정문 앞', JSON.stringify(sec13?.fireAccess))

  // ── 4.6) 서식 1.5·1.6·1.7 (P4-③) — 저장·DB 반영 ──
  await page.click('button:has-text("1.5 피난·방화")')
  await page.waitForSelector('text=1.5.1 피난·방화시설 일반현황')
  await page.click('button:has-text("직통계단")')
  await page.click('button:has-text("해당없음")') // 방화구획 해당없음 원클릭
  await page.click('button:has-text("서식 1.5 저장")')
  await page.waitForSelector('text=서식 1.5 저장됨')
  const { data: f15 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const ef = (f15?.sections as { evacFire?: { stairs: Record<string, string>; compartment: string } } | null)?.evacFire
  check('DB sections.evacFire 저장 (직통계단·방화구획 해당없음)', ef?.stairs?.['직통계단'] !== undefined && ef?.compartment === 'none', JSON.stringify(ef))

  await page.click('button:has-text("1.6 기타시설")')
  await page.waitForSelector('text=가스 시설')
  await page.click('button:has-text("+ LPG 프리셋")')
  await page.click('button:has-text("서식 1.6 저장")')
  await page.waitForSelector('text=서식 1.6 저장됨')
  const { data: f16 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const etc = (f16?.sections as { etcFacility?: { gas: { kind: string; shutoff: boolean } } } | null)?.etcFacility
  check('DB sections.etcFacility 저장 (LPG 프리셋)', etc?.gas?.kind === 'LPG' && etc?.gas?.shutoff === true, JSON.stringify(etc?.gas))

  await page.click('button:has-text("1.7 선임현황")')
  await page.waitForSelector('text=1.7.1 소방안전관리(보조)자 선임현황')
  // 1.7은 **보조자 전용**으로 개편됐다(plan-form17.tsx:68·100·120) — 주 선임자(관리자)는 관계인 탭이
  // 정본이라 여기선 읽기 전용으로만 보인다. 보조자가 0명이면 표에 행이 아예 없어(`rows.length === 0`
  // 안내문만 뜬다) 종전처럼 `td input`을 바로 채우면 로케이터가 굶는다. 행을 먼저 만든다.
  check('1.7 — 주 선임자는 읽기 전용(관계인 탭이 정본)', await page.isVisible('a:has-text("관계인 탭에서 수정")'))
  check('1.7 — 보조자 0명 안내', await page.isVisible('text=등록된 보조자가 없습니다'))
  await page.click('button:has-text("보조자 추가")')
  await page.locator('td input').nth(0).fill('승진소방') // 소속
  await page.locator('td input').nth(1).fill('홍보조')   // 성명
  await page.click('button:has-text("서식 1.7 저장")')
  await page.waitForSelector('text=서식 1.7 저장됨')
  const { data: f17 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const mgrs = (f17?.sections as { managers?: Array<{ role: string; affiliation: string; name: string }> } | null)?.managers
  // 구분은 '보조자' 고정이다 — 종전 기대값 '관리자'는 이 화면에서 만들 수 없는 값이 됐다
  check('DB sections.managers 저장(보조자)',
    mgrs?.[0]?.role === '보조자' && mgrs?.[0]?.affiliation === '승진소방' && mgrs?.[0]?.name === '홍보조', JSON.stringify(mgrs))

  // ── 4.65) 서식 1.10·1.11 + 2장 (P4-④) ──
  await page.click('button:has-text("1.10 자체점검")')
  await page.waitForSelector('text=1.10.1 연간 자체점검 계획')
  check('1.10 — 작동 고객은 종합점검 블록 미노출(§9-8 조건부)', !(await page.isVisible('input[type="month"] >> nth=1')))
  // §11-4 MonthField — 저장 형식은 '2026년 10월' (React 이벤트 보장 위해 evaluate 주입)
  await page.waitForLoadState('networkidle')
  await page.locator('input[type="month"]').first().evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, '2026-10')
  await page.click('button:has-text("서식 1.10 저장")')
  await page.waitForSelector('text=서식 1.10 저장됨')
  const { data: f110 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const inspSec = (f110?.sections as { inspection?: { opMonth: string }; multiUse?: { applicable: boolean } } | null)
  check('DB sections.inspection 저장', inspSec?.inspection?.opMonth === '2026년 10월' && inspSec?.multiUse?.applicable === false, JSON.stringify(inspSec?.inspection))

  await page.click('button:has-text("1.11 훈련·교육")')
  await page.waitForSelector('text=1.11.1 연간 훈련·교육 계획')
  await page.click('button:has-text("표준 패턴")')
  await page.click('button:has-text("상가형")')
  await page.click('button:has-text("서식 1.11 저장")')
  await page.waitForSelector('text=서식 1.11 저장됨')
  const { data: f111 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const tr = (f111?.sections as { training?: { eduMonths: number[]; scenarioType: string; scenario: string } } | null)?.training
  check('DB sections.training 저장 (표준 패턴 5·11월 + 상가형 시나리오)',
    JSON.stringify(tr?.eduMonths) === '[5,11]' && tr?.scenarioType === '상가형' && (tr?.scenario ?? '').includes('비상방송'), JSON.stringify({ e: tr?.eduMonths, t: tr?.scenarioType }))

  await page.click('button:has-text("2장 자위소방대")')
  await page.waitForSelector('text=2.1 자위소방대 및 초기대응체계 일반현황')
  await page.waitForLoadState('networkidle') // 직전 저장 router.refresh(RSC) 안착 — 고정 600ms로는 부족
  await page.waitForTimeout(300)
  await page.click('button:has-text("Type Ⅲ")')
  await page.locator('input[placeholder="성명"]').first().fill('김대장')
  // RSC 늦은 커밋이 controlled input을 되돌리는 경합 방어 — 값 검증 + 최대 3회 재입력.
  // ⚠ 2026-08-30: 재입력을 pressSequentially로 하면 **기존 값에 덧붙는다**. 한 번이라도 헛돌면
  //   '김대장김대장장'이 저장돼 :374의 name === '김대장'이 깨지는데, 화면엔 값이 멀쩡히 있으니
  //   앱 결함처럼 보인다(실측: 격리 진단에서 fill 직후 값이 그대로 유지돼 앱은 무죄). fill은 치환이라
  //   몇 번을 돌아도 결과가 같다 — 방어의 목적은 '다시 넣는 것'이지 '이어 붙이는 것'이 아니다.
  // ⚠ 2026-08-30(소방계획서_37 S4-3): 이 루프가 **두 가지로 깨져 있었다**. 증상은 97/1 빨강인데
  //   증거가 실행마다 뒤바뀌었다 — 어떤 날은 {type:"", rows:[김대장]}, 어떤 날은 {type:"III", rows:[]}.
  //   둘이 **동시에** 성립한 적이 없다는 게 단서였다.
  //
  //   ① 선택 판정이 죽은 hex를 봤다. 이 버튼의 선택 클래스는 `border-brand`인데(plan-ch2.tsx:88)
  //      검사는 `border-[#7b68ee]`를 찾고 있었다 — **소방계획서_29 토큰 코드모드가 지운 문자열**이다.
  //      그래서 조건이 **항상 참**이 되어 "미선택일 때만"이라는 가드가 무의미해졌고, 재시도마다
  //      Type Ⅲ를 다시 눌러 **토글로 껐다**. 이름이 한 번 헛돌면 다음 회차의 클릭이 선택을 해제해
  //      {type:""}가 저장된다. → 앱 화면을 지우는 코드모드는 **그 화면을 보는 검사도 함께 썩힌다**.
  //   ② 탈출 조건이 이름만 봤다. 이름이 들어오면 타입이 안 눌린 채로도 루프를 빠져나갔다.
  //
  //   수리: 실제 선택 클래스를 보고, **두 조건이 모두 참일 때만** 탈출한다.
  let typeOk = false, nameOk = false
  for (let attempt = 0; attempt < 4; attempt++) {
    nameOk = await page.locator('input[placeholder="성명"]').first().inputValue() === '김대장'
    typeOk = ((await page.locator('button:has-text("Type Ⅲ")').getAttribute('class')) ?? '').includes('border-brand')
    if (nameOk && typeOk) break
    if (!typeOk) await page.click('button:has-text("Type Ⅲ")')       // 토글이라 미선택일 때만
    if (!nameOk) await page.locator('input[placeholder="성명"]').first().fill('김대장')
    await page.waitForTimeout(500)
  }
  // 저장 **전에** 입력 상태를 단언한다. 이걸 안 두면 '입력이 안 된 것'과 '저장이 안 된 것'이
  // 아래 DB 검사에서 똑같은 모양으로 빨개져, 이번처럼 앱을 의심하며 시간을 쓴다.
  check('2장 입력이 저장 전에 화면에 실제로 반영됐다 (입력 실패와 저장 실패를 가른다)',
    typeOk && nameOk, `Type Ⅲ 선택=${typeOk} · 성명 입력=${nameOk}`)
  await page.click('button:has-text("2장 저장")')
  await page.waitForSelector('text=2장 저장됨')
  const { data: f2 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const bg = (f2?.sections as { brigadeGeneral?: { type: string } } | null)?.brigadeGeneral
  const { data: brigRows } = await raw.from('fire_brigade_members').select('team, name').eq('customer_id', customerId)
  check('DB brigadeGeneral(Type Ⅲ) + fire_brigade_members 저장',
    bg?.type === 'III' && (brigRows ?? []).some((r: { name: string }) => r.name === '김대장'), JSON.stringify({ bg, brigRows }))

  // ── 4.66) 3장 피난계획 (P4-⑤ + §1-2 세로 카드·앵커·단일 저장) — 딥링크 sub=ch3 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&sub=ch3`)
  await page.waitForSelector('text=3.1 피난시설 및 기타시설 일반현황')
  check('3.1 — 1.5 입력 자동 표시(방화구획 해당없음)', await page.isVisible('text=방화구획: 해당없음'))
  // §1-2: 내부 서브탭 폐기 — 3.2·3.4·3.7이 클릭 없이 동시 표시(세로 스크롤)
  // 소방계획서_11 §13-A — 3.4 피난경로도도 [지도·사진] 슬롯 단일 원천(업로드 슬롯 제거·이동 링크).
  // 2026-08-08 슬롯 UI가 1.3으로 이관돼 이동 대상이 1.3이 됐다.
  check('A 3.4 피난경로도 단일 원천 — 1.3 이동 버튼',
    await page.isVisible('[data-testid="ch3-goto-assets"]'))
  check('3장 세로 카드 — 3.4·3.7 동시 표시', await page.isVisible('text=피난유도 절차 및 피난경로')
    && await page.isVisible('text=3.7 피난 기구·유도장비 세부현황'))
  // 앵커 점프 칩 → URL 해시 동기화
  await page.click('button:has-text("3.4 유도·경로")')
  await page.waitForTimeout(400)
  check('앵커 칩 → URL #c-3.4', page.url().includes('#c-3.4'))
  await page.click('button:has-text("절차 프리셋")')
  await page.fill('input[placeholder*="1층 주차장"]', '정문 앞 공터')
  await page.click('button:has-text("해당없음")') // 3.5 피난약자 (같은 화면)
  await page.click('button:has-text("3장 저장")')
  await page.waitForSelector('text=3장 저장됨')
  const { data: f34 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const s3 = f34?.sections as { evacPlan?: { assembly: string; procedure: string }; vulnerable?: { none: boolean } } | null
  check('DB sections.evacPlan 저장 (절차 프리셋+집결지, 단일 저장)', s3?.evacPlan?.assembly === '정문 앞 공터' && (s3?.evacPlan?.procedure ?? '').includes('피난유도반'), JSON.stringify({ a: s3?.evacPlan?.assembly }))
  check('DB sections.vulnerable 저장 (해당없음, 단일 저장)', s3?.vulnerable?.none === true)

  // 어댑터(§7-3) — getFirePlanGenDefaults가 입력 섹션을 기본값으로 사용하는지 (데이터 시트 생성 경로로 검증 불가 — DB 대조로 대체)
  // zones(1.2)·hazards(1.2)·evacPlan(3.4)·brigade(2장)가 저장돼 있으므로 웹 생성 기본값에 반영됨 — 코드 대조 + 저장 검증으로 충족

  // ── 4.7) 서식 1.4 양식 재현 (P4-②b) — 체크·하위 연동·저장·DB 반영 ──
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  check('서식 1.4 — 양식 표 렌더', await page.isVisible('text=소화기구 및 자동소화장치'))
  // 소방계획서_9(a9e2df3): 설비를 체크할 때마다 '설비 대장' 우측 슬라이드 패널이 열리고,
  // 그 패널이 본문 클릭을 가로챈다. 본문(1.4 표)을 이어서 조작하려면 매번 닫아야 한다 — 낡은 체크 현행화(2026-08-07).
  const closeSpecPanel = async () => {
    await page.click('button[aria-label="닫기"]').catch(() => {})
    await page.waitForTimeout(300)
  }
  // 2026-08-26 — 클릭 의미 분리(☑=토글 / 설비명=대장 열기). 종전 `text=소화기구…`(라벨) 클릭은
  // 이제 토글이 아니라 대장 열기라 체크가 안 된다. 토글은 체크박스 표적으로 겨눈다.
  // ⚠ 2026-08-30: 클릭 직후 **대기 없이** aria-pressed를 읽으면 dev가 느린 날 붉어진다. 버튼이 보여도
  //   하이드레이션 전이면 클릭이 핸들러에 닿지 않는데, DOM은 이미 있으니 Playwright는 성공으로 본다.
  //   격리 진단에선 클릭 즉시 true였다(앱 무죄) — 그러니 여기서 필요한 건 '기다림'이지 단언 완화가 아니다.
  //   끝내 true가 아니면 그대로 실패한다: 조건은 그대로고 읽는 시점만 늦춘다.
  const fireExtBox = page.locator('[data-testid="form14-check-소화기구 및 자동소화장치"]')
  await fireExtBox.click()
  let fireExtPressed = false
  for (let i = 0; i < 20 && !fireExtPressed; i++) {
    fireExtPressed = await fireExtBox.getAttribute('aria-pressed') === 'true'
    if (!fireExtPressed) await page.waitForTimeout(250)
  }
  check('☑ 클릭 → 소화기구 체크됨', fireExtPressed)
  await closeSpecPanel()
  await page.click('button:has-text("피난사다리")')
  check('하위 체크 → 피난기구 자동 체크',
    await page.locator('[data-testid="form14-check-피난기구"]').getAttribute('aria-pressed') === 'true')
  await closeSpecPanel()

  // 회귀 방지 — 이 화면이 생긴 이유 그 자체: 체크된 설비의 이름을 눌러도 체크가 풀리지 않아야 한다.
  const evacBefore = await page.locator('[data-testid="form14-check-피난기구"]').getAttribute('aria-pressed')
  await page.click('[data-testid="form14-ledger-피난기구"]')
  const evacAfter = await page.locator('[data-testid="form14-check-피난기구"]').getAttribute('aria-pressed')
  check('설비명 클릭 → 체크 무변동', evacBefore === 'true' && evacAfter === 'true', `before=${evacBefore} after=${evacAfter}`)
  check('설비명 클릭 → 설비 대장 패널 열림', await page.isVisible('button[aria-label="닫기"]'))
  await closeSpecPanel()
  // 소방계획서_12 — 수동 [저장] 단일 규약(자동 저장 없음). U2: Ctrl+S 경로로 본문 저장
  check('U1 — 본문 수정 → 푸터 미저장 배지', await page.isVisible('[data-testid="form14-dirty-badge"]'))
  await page.keyboard.press('Control+s')
  await page.waitForSelector('text=본문 저장됨')
  check('U2 — Ctrl+S로 본문 저장', true)
  check('S1 — 저장 후 푸터 마지막 확인 갱신(router.refresh 없이)', await page.isVisible('text=마지막 확인'))
  const { data: facRows } = await raw.from('fire_facilities')
    .select('facility_code, installed').eq('installed', true)
    .in('facility_code', ['소화기구 및 자동소화장치', '피난기구', '피난사다리'])
  const facCodes = new Set((facRows ?? []).map((r: { facility_code: string }) => r.facility_code))
  check('DB fire_facilities 저장 (표준 코드)',
    facCodes.has('소화기구 및 자동소화장치') && facCodes.has('피난기구'), JSON.stringify([...facCodes]))
  // 2026-08-08 중복 입력 제거 — 피난기구 종류의 저장소는 세부제원 한 곳이다.
  // 대장 하위 체크는 fire_facilities 행을 만들지 않고 s36_evac.evac_equipment.types를 갱신한다.
  check('피난기구 종류는 fire_facilities에 행을 만들지 않는다', !facCodes.has('피난사다리'), JSON.stringify([...facCodes]))
  const { data: evacSpec } = await raw.from('customer_facility_specs')
    .select('spec').eq('customer_id', customerId).eq('section_key', 's36_evac').limit(1)
  const evacTypes = (evacSpec?.[0]?.spec?.evac_equipment?.types ?? []) as string[]
  check('대장에서 체크한 피난기구 종류 → 세부제원 types에 저장', evacTypes.includes('피난사다리'), JSON.stringify(evacTypes))

  // ── 소방계획서_12 U3 — 통합 저장: 제원만 수정해도 본문 [저장] 활성, 1클릭으로 제원까지 저장 ──
  check('U1 — 저장 후 변경 없음 배지', await page.isVisible('[data-testid="form14-clean-badge"]'))
  await page.click('button:has-text("설비 대장")')       // 푸터 버튼 → 패널 재오픈 (마지막 체크한 설비 섹션이 열려 있음)
  await page.waitForSelector('div[data-spec-field] input')
  await page.locator('div[data-spec-field] input').first().fill('E2E제원')
  await page.click('button[aria-label="닫기"]')
  await page.waitForTimeout(300)
  check('U1 — 제원 수정 → 푸터 미저장 배지(제원 N섹션)', await page.isVisible('[data-testid="form14-dirty-badge"]'))
  check('U3-1 — 제원만 수정해도 본문 [저장] 활성', await page.locator('[data-testid="form14-save"]').isEnabled())
  await page.click('[data-testid="form14-save"]')
  await page.waitForSelector('text=제원 1개 섹션 저장됨')
  const { data: specRows } = await raw.from('customer_facility_specs')
    .select('section_key').eq('customer_id', customerId)
  check('U3 — 1클릭 통합 저장 → DB customer_facility_specs', (specRows ?? []).length >= 1, JSON.stringify(specRows))

  // ── B안(2026-08-08) — 저장 버튼 단일화: 패널을 **연 채로** 저장해도 본문(1.4 표)까지 저장된다 ──
  // 종전 패널 [모두 저장]은 제원만 저장해 본문이 미저장으로 남았고, 그 결과 별지 9호 3쪽에
  // '부모 피난기구 빈칸 + 하위 종류 √' 모순이 인쇄될 수 있었다. 이 경로를 E2E가 한 번도 밟지 않아 놓쳤다.
  check('B안 — 패널 닫힘 상태에선 패널 저장 버튼이 DOM에 없다',
    (await page.locator('[data-testid="specs-save"]').count()) === 0)
  // ⚠ 3c528fc로 클릭 의미가 갈렸다 — `text=옥내소화전설비`(설비명)는 이제 **대장만 열고 토글하지
  //   않는다**. 그대로 두면 패널은 열리지만 본문이 dirty가 되지 않아 [저장]이 비활성으로 남는다
  //   (실제로 이 줄 때문에 아래 두 단언이 무너졌다). 이 검사의 의도는 '본문 체크'이므로 ☑를 겨눈다.
  await page.click('[data-testid="form14-check-옥내소화전설비"]')  // 본문 체크(= 본문만 dirty) → 패널이 함께 열린다
  await page.waitForSelector('[data-testid="specs-save"]')
  check('B안 — 패널에 통합 [저장] 단일 버튼', await page.isVisible('[data-testid="specs-save"]'))
  check('B안 — 구 [모두 저장] 버튼 폐지', (await page.locator('button:has-text("모두 저장")').count()) === 0)
  check('B안 — 본문만 수정해도 패널 [저장] 활성',
    await page.locator('[data-testid="specs-save"]').isEnabled(),
    `footer=${await page.locator('[data-testid="specs-footer-status"]').textContent().catch(() => '?')}`)
  await page.click('[data-testid="specs-save"]')          // 패널을 닫지 않고 저장
  await page.waitForSelector('text=본문 저장됨')
  const { data: e2eBld } = await raw.from('buildings').select('id').eq('customer_id', customerId).limit(1).single()
  const { data: afterPanelSave } = await raw.from('fire_facilities')
    .select('facility_code').eq('installed', true).eq('building_id', e2eBld.id).eq('facility_code', '옥내소화전설비')
  check('B안 — 패널에서 저장해도 본문(fire_facilities)이 저장된다',
    (afterPanelSave ?? []).length === 1, JSON.stringify(afterPanelSave))
  check('B안 — 저장 후 패널 푸터가 변경 없음으로',
    await page.locator('[data-testid="specs-footer-status"]').textContent()
      .then(t => (t ?? '').includes('모든 변경이 저장됐습니다')))

  // 건물·시설 탭 — 패널 이동 안내
  await page.goto(`${BASE}/customers/${customerId}?tab=buildings`)
  await page.waitForSelector('text=1.4 소방시설')
  check('건물 탭 — 시설현황 이동 안내', await page.isVisible('text=소방계획서 탭'))

  // ── 5) 일반관리 고객 — 특례 제거(소방계획서_6 W-14·W-19): 소방안전관리와 동일 취급 ──
  // 구 배너('작성 대상이 아닙니다')는 32c2ace에서 설계상 제거 — 일반관리도 소방계획서·필수 완성도 대상
  // 필수 완성도 카드는 ⚡ 빠른 입력 페이지와 함께 폐기(d05b119) — 위 36행이 부재를 단언한다.
  // 동일 취급 판정은 '일반관리도 1.1 입력폼으로 똑같이 진입하는가'로 대체한다(2026-08-07 현행화).
  await page.goto(`${BASE}/customers/${generalId}?tab=plan`)
  await page.waitForSelector('text=① 시설현황')
  check('일반관리 — 특례 배너 없음(작성 대상)', !(await page.isVisible('text=소방계획서 작성 대상이 아닙니다')))
  check('일반관리 — 1.1 입력폼 동일 진입(특례 없음)', await page.isVisible('text=② 운영현황'))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const id of [customerId, generalId]) {
    if (!id) continue
    await raw.from('fire_plan_forms').delete().eq('customer_id', id)
    await raw.from('fire_plan_revisions').delete().eq('customer_id', id)   // 120 — 남기면 고객 삭제가 막혀 계정까지 잔류한다
    await raw.from('fire_brigade_members').delete().eq('customer_id', id)
    await raw.from('customer_facility_specs').delete().eq('customer_id', id)
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', id)
    for (const bd of (blds ?? []) as Array<{ id: string }>) {
      await raw.from('fire_facilities').delete().eq('building_id', bd.id)
      await raw.from('fire_facility_floors').delete().eq('building_id', bd.id)
    }
    await raw.from('buildings').delete().eq('customer_id', id)
    await cleanupCustomer(id)
  }
  if (userId) await delUser(userId)
}
summary()
