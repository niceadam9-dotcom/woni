/** 지점(책갈피 QR) 실주행 (통합 실행계획 C4 — QR 절 3단계, 마이그 178 — dev 서버 + 스테이징 필요)
 *  실행: npx tsx scripts/test-tag-points-e2e.mts
 *
 *   [1] 고객 [공통] 1.4 지점 패널 — 추가(시트 STD-15·STD-01 체크) → 행·코드 표시
 *   [2] /t/{code} → 지점 카드 — 라벨·위치·시트 버튼이 **진행 중 회차**의 sheet 딥링크로
 *   [3] 회차 없는 고객의 지점 → 「진행 중 점검 회차가 없습니다」(딥링크 없음)
 *   [4] /t?q=앞6자 → 지점 단독이면 카드로 바로
 *   [5] 라벨 route ?format=html — 지점 이름·코드 실림(개체 라벨과 같은 격자)
 *   [6] 삭제 → 목록 비고 /t/{code}는 「등록되지 않은 코드」
 *   [7] 과잉 등록 가드 문구·개체 QR와 다른 카드(개체 tag-card와 testid 구분) */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, check, summary } from './_e2e-helpers.mjs'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `points.${SUF}@e2e.test`
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
let userId = '', custA = '', custB = '', inspId = '', bldId = ''
let browser: import('playwright').Browser | null = null

const pointsOf = async (cid: string) =>
  ((await raw.from('equipment_points').select('id, tag_code, label, sheet_codes').eq('customer_id', cid)).data ?? []) as Array<{ id: string; tag_code: string; label: string; sheet_codes: string[] }>

try {
  userId = await mkUser({ email: EMAIL, name: `지점${SUF}`, employeeId: `PT-${SUF}`, role: 'employee' })
  custA = await mkCustomer({ customer_name: `지점검증사${SUF}`, created_by: userId, address: '경기도 양평군 검증면 3', fire_station: '양평' })
  custB = await mkCustomer({ customer_name: `지점회차없음${SUF}`, created_by: userId, address: '경기도 양평군 검증면 4', fire_station: '양평' })
  const { data: bld } = await raw.from('buildings').insert({ customer_id: custA, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  bldId = (bld as { id: string } | null)?.id ?? ''
  const { data: insp, error } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', plan_type: 'special_작동', sequence_num: 1,
    inspection_start_date: today, inspection_end_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspId = insp!.id

  const l = await launch(); browser = l.browser
  const page: Page = l.page
  await login(page, EMAIL, PW)

  console.log('[1] 지점 패널 — 추가')
  await page.goto(`${BASE}/customers/${custA}?tab=facilities&form=1.4`)
  await page.getByTestId('point-panel').scrollIntoViewIfNeeded()
  check('과잉 등록 가드 문구', await page.getByTestId('point-panel').innerText().then(t => t.includes('회차마다 가는 자리')))
  await page.getByTestId('point-add-open').click()
  await page.getByTestId('point-add-label').fill(`수신기(방재실)${SUF}`)
  const sheetsBox = page.getByTestId('point-add-sheets')
  await sheetsBox.locator('label', { hasText: 'STD-15' }).locator('input').check()
  await sheetsBox.locator('label', { hasText: 'STD-01' }).locator('input').check()
  await page.getByTestId('point-add-submit').click()
  await page.getByTestId('point-msg').waitFor()
  const ptsA = await pointsOf(custA)
  check('행 1 · 코드 자동 발급 · 시트 2', ptsA.length === 1 && /^[0-9A-Z]{8}$/.test(ptsA[0].tag_code ?? '') && ptsA[0].sheet_codes.length === 2, JSON.stringify(ptsA))
  check('목록에 행·코드 표시', await page.getByTestId('point-list').innerText().then(t => t.includes(`수신기(방재실)${SUF}`) && t.includes(ptsA[0].tag_code.slice(0, 6))))
  const code = ptsA[0].tag_code

  console.log('[2] /t/{code} → 지점 카드 · 점검표 딥링크')
  await page.goto(`${BASE}/t/${code}`)
  await page.getByTestId('tag-point-card').waitFor()
  check('지점 라벨 표시', await page.getByTestId('tag-point-label').innerText().then(t => t.includes(`수신기(방재실)${SUF}`)))
  const links = page.getByTestId('tag-point-sheet-link')
  check('시트 버튼 2개', await links.count() === 2)
  const href = await links.first().getAttribute('href') ?? ''
  check('진행 중 회차의 sheet 딥링크', href.startsWith(`/inspections/${inspId}/sheet?sheet=STD-`), href)
  check('개체 카드가 아니다(tag-card 없음)', await page.getByTestId('tag-card').count() === 0)

  console.log('[3] 회차 없는 고객')
  const { error: pbErr } = await raw.from('equipment_points').insert({ customer_id: custB, label: `펌프실${SUF}`, sheet_codes: ['STD-02'], tag_code: 'ZZ' + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[ILOU]/g, 'X') })
  if (pbErr) throw new Error(`지점 B 생성 실패: ${pbErr.message}`)
  const ptsB = await pointsOf(custB)
  await page.goto(`${BASE}/t/${ptsB[0].tag_code}`)
  await page.getByTestId('tag-point-card').waitFor()
  check('「진행 중 회차 없음」 안내 · 딥링크 0', await page.getByTestId('tag-point-no-inspection').count() === 1 && await page.getByTestId('tag-point-sheet-link').count() === 0)

  console.log('[4] 수기 조회')
  await page.goto(`${BASE}/t?q=${code.slice(0, 6)}`)
  await page.getByTestId('tag-point-card').waitFor()
  check('앞 6자 → 지점 카드로', page.url().endsWith(`/t/${code}`), page.url())

  console.log('[5] 라벨 route')
  const res = await page.request.get(`${BASE}/customers/${custA}/equipment-point-labels?format=html`)
  check('라벨 HTML 200', res.status() === 200, String(res.status()))
  const html = await res.text()
  check('지점 이름·코드 앞6자 실림', html.includes(`수신기(방재실)${SUF}`) && html.includes(code.slice(0, 6)))
  check('QR 페이로드 /t/{code}', html.includes(`data-tag="${code}"`))

  console.log('[6] 삭제')
  await page.goto(`${BASE}/customers/${custA}?tab=facilities&form=1.4`)
  await page.getByTestId('point-panel').scrollIntoViewIfNeeded()
  page.once('dialog', d => void d.accept())
  await page.getByTestId('point-delete').click()
  await page.getByTestId('point-empty').waitFor()
  check('DB에서 삭제', (await pointsOf(custA)).length === 0)
  await page.goto(`${BASE}/t/${code}`)
  check('지운 코드는 미등록 카드', await page.getByTestId('tag-unknown').isVisible({ timeout: 15000 }).catch(() => false) || (await page.getByTestId('tag-unknown').waitFor().then(() => true)))
} finally {
  if (browser) await browser.close()
  await raw.from('equipment_points').delete().in('customer_id', [custA, custB].filter(Boolean))
  if (inspId) { await raw.from('inspection_steps').delete().eq('inspection_id', inspId); await raw.from('inspections').delete().eq('id', inspId) }
  if (bldId) await raw.from('buildings').delete().eq('id', bldId)
  if (custA) await cleanupCustomer(custA)
  if (custB) await cleanupCustomer(custB)
  if (userId) await delUser(userId)
}
summary()
