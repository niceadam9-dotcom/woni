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

  // ── 1) 기본 진입 = 빠른 입력 모드 (P2 §1-1) ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.waitForSelector('text=필수 완성도')
  check('빠른 입력 — 필수 완성도 게이지', await page.isVisible('text=필수 완성도'))
  check('빠른 입력 — 필요 문서 칩 (소방계획서)', await page.isVisible('text=필요 문서'))
  check('빠른 입력 — 별지 9호(작동) 칩', await page.isVisible('text=별지 9호(작동)'))
  check('빠른 입력 — 누락 칩 표시', await page.isVisible('text=누락:'))
  check('빠른 입력 — 건축물대장 불러오기 버튼', await page.isVisible('button:has-text("건축물대장 불러오기")'))
  check('빠른 입력 — 송달 동의 블록', await page.isVisible('text=전자우편 송달 동의'))
  check('빠른 입력 — 보관함 요약(빈 상태)', await page.isVisible('text=보관함이 비어 있습니다'))
  check('생성 바 — [HWP 생성] 버튼', await page.isVisible('button:has-text("HWP 생성")'))

  // ── 2) 대장 불러오기 — 지번 미보유 건물은 needAddress 안내 (fail-soft 경로) ──
  await page.click('button:has-text("건축물대장 불러오기")')
  await page.waitForSelector('text=지번 정보가 없습니다')
  check('대장 불러오기 — 지번 없음 fail-soft 안내', true)

  // ── 3) 송달 동의 저장 (098 §9-6①) ──
  await page.click('button:has-text("동의")')
  await page.fill('input[placeholder="송달 이메일"]', 'owner@example.com')
  await page.click('button:has-text("저장")')
  await page.waitForSelector('text=송달 동의 저장됨')
  const { data: cRow } = await raw.from('customers')
    .select('email_delivery_consent, report_email').eq('id', customerId).single()
  check('DB 송달 동의 저장', cRow?.email_delivery_consent === true && cRow?.report_email === 'owner@example.com', JSON.stringify(cRow))

  // ── 4) [서식 전체] 토글 → 고급 모드 (4-1 골격) ──
  await page.click('button:has-text("서식 전체")')
  await page.waitForSelector('text=개정이력')
  check('고급 모드 — 개정이력·보관 기본 표시', await page.isVisible('text=개정이력'))
  check('고급 모드 — 4개 장 전부 활성', await page.isVisible('button:has-text("3장 피난계획")') && !(await page.isVisible('text=준비 중')))

  // 개정이력 입력 저장 → fire_plan_forms(096)
  await page.fill('input[placeholder*="소방계획서 작성"]', '개정 E2E 검증')
  await page.click('button:has-text("저장")')
  await page.waitForSelector('text=개정이력 입력 저장됨')
  const { data: form } = await raw.from('fire_plan_forms')
    .select('sections, updated_by').eq('customer_id', customerId).maybeSingle()
  const rev = (form?.sections as { revision?: { revisionNote?: string } } | null)?.revision
  check('DB fire_plan_forms.sections.revision 저장', rev?.revisionNote === '개정 E2E 검증', JSON.stringify(form))

  // 1장 서식 칩 + 딥링크
  await page.click('button:has-text("1장 소방안전관리계획")')
  await page.waitForSelector('text=1.1 일반현황')
  check('고급 모드 — 1.1 = 계획서 정보 패널', await page.isVisible('text=계획서 정보'))
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&sub=ch1`)
  await page.waitForSelector('text=1.1 일반현황')
  check('딥링크 sub=ch1 → 고급 모드 1장 직행', await page.isVisible('text=1.1 일반현황'))

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
  await page.fill('textarea[placeholder*="인접 건물"]', '주변현황 E2E')
  await page.fill('input[placeholder*="정문 앞 도로"]', '정문 앞')
  await page.click('button:has-text("서식 1.3 저장")')
  await page.waitForSelector('text=서식 1.3 저장됨')
  const { data: f13 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const sec13 = f13?.sections as { location?: { surroundings: string }; fireAccess?: { entryPoint: string } } | null
  check('DB sections.location 저장', sec13?.location?.surroundings === '주변현황 E2E', JSON.stringify(sec13?.location))
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
  await page.locator('td input').nth(0).fill('승진소방') // 소속
  await page.locator('td input').nth(1).fill('홍관리')   // 성명 (테스트 고객은 관계인 없음 — 자동값 빈칸)
  await page.click('button:has-text("서식 1.7 저장")')
  await page.waitForSelector('text=서식 1.7 저장됨')
  const { data: f17 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const mgrs = (f17?.sections as { managers?: Array<{ role: string; affiliation: string; name: string }> } | null)?.managers
  check('DB sections.managers 저장', mgrs?.[0]?.role === '관리자' && mgrs?.[0]?.affiliation === '승진소방' && mgrs?.[0]?.name === '홍관리', JSON.stringify(mgrs))

  // ── 4.65) 서식 1.10·1.11 + 2장 (P4-④) ──
  await page.click('button:has-text("1.10 자체점검")')
  await page.waitForSelector('text=1.10.1 연간 자체점검 계획')
  check('1.10 — 작동 고객은 종합점검 블록 미노출(§9-8 조건부)', !(await page.isVisible('text=종합 년월')))
  await page.fill('input[placeholder*="2026년 9월"]', '2026년 10월')
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
  await page.click('button:has-text("Type Ⅲ")')
  await page.locator('input[placeholder="성명"]').first().fill('김대장')
  await page.click('button:has-text("2장 저장")')
  await page.waitForSelector('text=2장 저장됨')
  const { data: f2 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const bg = (f2?.sections as { brigadeGeneral?: { type: string } } | null)?.brigadeGeneral
  const { data: brigRows } = await raw.from('fire_brigade_members').select('team, name').eq('customer_id', customerId)
  check('DB brigadeGeneral(Type Ⅲ) + fire_brigade_members 저장',
    bg?.type === 'III' && (brigRows ?? []).some((r: { name: string }) => r.name === '김대장'), JSON.stringify({ bg, brigRows }))

  // ── 4.66) 3장 피난계획 (P4-⑤) — 딥링크 sub=ch3 + 3.4 저장 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&sub=ch3`)
  await page.waitForSelector('text=3.1 피난시설 및 기타시설 일반현황')
  check('3.1 — 1.5 입력 자동 표시(방화구획 해당없음)', await page.isVisible('text=방화구획: 해당없음'))
  await page.click('button:has-text("3.4 유도·경로")')
  await page.waitForSelector('text=피난유도 절차 및 피난경로')
  await page.click('button:has-text("절차 프리셋")')
  await page.fill('input[placeholder*="1층 주차장"]', '정문 앞 공터')
  await page.click('button:has-text("서식 3.4 저장")')
  await page.waitForSelector('text=서식 3.4 저장됨')
  const { data: f34 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  const ep = (f34?.sections as { evacPlan?: { assembly: string; procedure: string } } | null)?.evacPlan
  check('DB sections.evacPlan 저장 (절차 프리셋+집결지)', ep?.assembly === '정문 앞 공터' && (ep?.procedure ?? '').includes('피난유도반'), JSON.stringify({ a: ep?.assembly }))
  await page.click('button:has-text("3.5 피난약자")')
  await page.waitForSelector('text=3.5 피난약자 현황')
  await page.click('button:has-text("해당없음")')
  await page.click('button:has-text("서식 3.5 저장")')
  await page.waitForSelector('text=서식 3.5 저장됨')
  const { data: f35 } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  check('DB sections.vulnerable 저장 (해당없음)', (f35?.sections as { vulnerable?: { none: boolean } } | null)?.vulnerable?.none === true)

  // 어댑터(§7-3) — getFirePlanGenDefaults가 입력 섹션을 기본값으로 사용하는지 (데이터 시트 생성 경로로 검증 불가 — DB 대조로 대체)
  // zones(1.2)·hazards(1.2)·evacPlan(3.4)·brigade(2장)가 저장돼 있으므로 웹 생성 기본값에 반영됨 — 코드 대조 + 저장 검증으로 충족

  // ── 4.7) 서식 1.4 양식 재현 (P4-②b) — 체크·하위 연동·저장·DB 반영 ──
  await page.click('button:has-text("1장 소방안전관리계획")')
  await page.click('button:has-text("1.4 소방시설")')
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  check('서식 1.4 — 양식 표 렌더', await page.isVisible('text=소화기구 및 자동소화장치'))
  await page.click('text=소화기구 및 자동소화장치')
  await page.click('button:has-text("피난사다리")')
  check('하위 체크 → 피난기구 자동 체크', await page.locator('div[role="button"]:has-text("피난기구")').first().textContent().then(t => t?.includes('☑') ?? false))
  await page.click('button:has-text("저장")')
  await page.waitForSelector('text=서식 1.4 저장됨')
  const { data: facRows } = await raw.from('fire_facilities')
    .select('facility_code, installed').eq('installed', true)
    .in('facility_code', ['소화기구 및 자동소화장치', '피난기구', '피난사다리'])
  const facCodes = new Set((facRows ?? []).map((r: { facility_code: string }) => r.facility_code))
  check('DB fire_facilities 저장 (표준 코드 + 하위 8종)',
    facCodes.has('소화기구 및 자동소화장치') && facCodes.has('피난기구') && facCodes.has('피난사다리'), JSON.stringify([...facCodes]))

  // 건물·시설 탭 — 패널 이동 안내
  await page.goto(`${BASE}/customers/${customerId}?tab=buildings`)
  await page.waitForSelector('text=1.4 소방시설')
  check('건물 탭 — 시설현황 이동 안내', await page.isVisible('text=소방계획서 탭'))

  // ── 5) 일반관리 고객 — 배너 + 입력 미노출 + 탭 뱃지 억제 (§9-8) ──
  await page.goto(`${BASE}/customers/${generalId}?tab=plan`)
  await page.waitForSelector('text=소방계획서 작성 대상이 아닙니다')
  check('일반관리 — 대상 아님 배너', true)
  check('일반관리 — 외관점검표 안내', await page.isVisible('text=외관점검표'))
  check('일반관리 — 생성 바 미노출', !(await page.isVisible('button:has-text("HWP 생성")')))
  check('일반관리 — 필수 완성도 미노출', !(await page.isVisible('text=필수 완성도')))
  const planTabBadge = await page.locator('a:has-text("소방계획서"), button:has-text("소방계획서")').first().textContent()
  check('일반관리 — 탭 준비율 뱃지 억제(n/n 없음)', !/\d+\/\d+/.test(planTabBadge ?? ''), `tab="${planTabBadge}"`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const id of [customerId, generalId]) {
    if (!id) continue
    await raw.from('fire_plan_forms').delete().eq('customer_id', id)
    await raw.from('fire_brigade_members').delete().eq('customer_id', id)
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
