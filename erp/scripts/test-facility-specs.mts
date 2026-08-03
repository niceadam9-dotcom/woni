// H-19 설비 대장 E2E — 1.4(PlanForm14) 확장: 세부 제원(별지 4호 3~7쪽=9호 4~7쪽) 입력 (소방계획서_7.md §4-A-2)
// 실행: npx tsx scripts/test-facility-specs.mts  (로컬 dev 서버 + 스테이징 DB, 112 적용 필요)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'facility-specs-e2e@erp-test.com'
let userId = ''
let customerId = ''
let buildingId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '설비대장E2E', employeeId: 'E2E-FACSPEC' })
  customerId = await mkCustomer({ customer_name: '설비대장E2E고객', address: '경기 양평군 테스트로 9', created_by: userId })
  const { data: bld, error: bErr } = await raw.from('buildings').insert({
    customer_id: customerId, building_name: '본관', is_active: true, created_by: userId,
    floors_above: 3, floors_below: 1,
  }).select('id').single()
  if (bErr) throw new Error(`건물 생성 실패: ${bErr.message}`)
  buildingId = bld.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 1.4 화면 진입 → 설비 대장 영역 노출 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  check('설비 대장 접이식 영역 노출', await page.isVisible('summary:has-text("설비 대장 — 설비 세부 제원")'))
  await page.click('summary:has-text("설비 대장 — 설비 세부 제원")')
  check('완성도 요약 게이지 (0/372)', await page.isVisible('text=제원 입력 0/372'))
  check('[입력]/[자동] 배지 안내 문구', await page.isVisible('text=이 영역이 설비 제원의 단일 원본입니다'))

  // ── 2) 미설치 블록 접힘 + 안내 ──
  await page.click('[data-spec-section="s33_water_each"] button:has-text("3-3 수계소화설비(개별사항)")')
  check('미설치 블록 — 회색 "미설치" 뱃지', await page.isVisible('[data-spec-block="indoor_hydrant"] >> text=미설치'))
  await page.click('[data-spec-block="indoor_hydrant"] button')
  check('미설치 블록 클릭 → 1.4 설치 체크 안내', await page.isVisible('text=설치 체크 후 입력할 수 있습니다'))
  check('미설치 블록 — 필드 미노출', (await page.locator('[data-spec-block="indoor_hydrant"] input').count()) === 0)

  // ── 3) 기존 1.4 √ 저장 경로 (회귀 확인) ──
  await page.click('table span:text-is("옥내소화전설비")')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.waitForSelector('text=서식 1.4 저장됨')
  const { data: facRow } = await raw.from('fire_facilities')
    .select('installed').eq('building_id', buildingId).eq('facility_code', '옥내소화전설비').single()
  check('DB fire_facilities √ 저장 (회귀)', facRow?.installed === true, JSON.stringify(facRow))
  check('층별 수량 영역 유지 (회귀)', await page.isVisible('summary:has-text("층별 수량 입력")'))

  // ── 4) √ 후 블록 펼침 가능 → 필드 입력 ──
  check('설치 후 미설치 뱃지 제거', !(await page.isVisible('[data-spec-block="indoor_hydrant"] >> text=미설치')))
  await page.click('[data-spec-block="indoor_hydrant"] button')
  await page.waitForSelector('[data-spec-block="indoor_hydrant"] input[aria-label="동명"]')
  check('설치 블록 펼침 → 필드 노출', true)
  await page.fill('[data-spec-block="indoor_hydrant"] input[aria-label="동명"]', '본관동')
  await page.selectOption('[data-spec-block="indoor_hydrant"] select[aria-label="전체층/일부층"]', '전체층')
  await page.fill('[data-spec-block="indoor_hydrant"] input[aria-label="설치개수가 가장 많은 층의 설치개수"]', '3')
  check('섹션 게이지 3/7 반영', await page.isVisible('[data-spec-section="s33_water_each"] >> text=3/7'))
  check('요약 게이지 3/372 반영', await page.isVisible('text=제원 입력 3/372'))
  check('미저장(dirty) 표시', await page.isVisible('[data-spec-section="s33_water_each"] >> text=미저장'))

  // ── 5) 섹션 저장 → DB 확인 ──
  await page.click('[data-spec-section="s33_water_each"] button:has-text("제원 저장")')
  await page.waitForSelector('text=3-3 수계소화설비(개별사항) 제원 저장됨')
  const { data: specRow } = await raw.from('customer_facility_specs')
    .select('building_id, section_key, spec').eq('customer_id', customerId).eq('section_key', 's33_water_each').single()
  const ih = (specRow?.spec as { indoor_hydrant?: Record<string, unknown> } | null)?.indoor_hydrant
  check('DB customer_facility_specs 행 (건물 축)', specRow?.building_id === buildingId, JSON.stringify(specRow))
  check('DB spec.indoor_hydrant 값 (number 변환 포함)',
    ih?.dong === '본관동' && ih?.coverage === '전체층' && ih?.max_count === 3, JSON.stringify(ih))

  // ── 6) 새로고침 후 값 유지 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.4`)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  await page.click('summary:has-text("설비 대장 — 설비 세부 제원")')
  check('새로고침 — 요약 게이지 3/372 유지', await page.isVisible('text=제원 입력 3/372'))
  await page.click('[data-spec-section="s33_water_each"] button:has-text("3-3 수계소화설비(개별사항)")')
  await page.click('[data-spec-block="indoor_hydrant"] button')
  await page.waitForSelector('[data-spec-block="indoor_hydrant"] input[aria-label="동명"]')
  check('새로고침 — 동명 유지', (await page.inputValue('[data-spec-block="indoor_hydrant"] input[aria-label="동명"]')) === '본관동')
  check('새로고침 — 전체층 유지', (await page.inputValue('[data-spec-block="indoor_hydrant"] select[aria-label="전체층/일부층"]')) === '전체층')
  check('새로고침 — 설치개수 유지', (await page.inputValue('[data-spec-block="indoor_hydrant"] input[aria-label="설치개수가 가장 많은 층의 설치개수"]')) === '3')
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
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
