/** 자체점검기록표(별표 5) + 건물 QR 실주행 (통합 실행계획 C4 — QR 절 4단계, 마이그 179 — dev 서버 + 스테이징 필요)
 *  실행: npx tsx scripts/test-record-card-e2e.mts
 *
 *   [0] 작업대 ④ 칸에 기록표 링크(정적)
 *   [1] /inspections/{id}/record-card?format=html — 활성 건물마다 1쪽(비활성 제외)·제목·주소
 *   [2] 활성 건물에 QR 코드 자동 발급(8자)·쪽마다 data-tag·svg — 재요청에도 같은 코드(재발급 없음)
 *   [3] 점검구분 체크(작동 ■·종합 빈칸) · 점검기간 날짜꼴
 *   [4] 불량사항 — 코드 1-A(소화)·15-A(경보)만 ■, 없음은 빈칸 · 정비기간(불량 조치계획 자동값)
 *   [5] 불량 0건 회차 — 「없음」만 ■ · 정비기간 빈칸
 *   [6] /t/{건물코드} → 건물 카드: 건물명·고객·회차 목록(진행 중) — 개체·지점 카드가 아니다
 *   [7] 비로그인 → 401 아닌 307 /login?next=(/t) · 라우트는 401 */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, PW, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, check, summary } from './_e2e-helpers.mjs'
import { readFileSync } from 'fs'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `rcard.${SUF}@e2e.test`
let userId = '', custA = '', custB = '', inspA = '', inspB = ''
const bld: string[] = []
let browser: import('playwright').Browser | null = null

try {
  console.log('[0] 작업대 링크(정적)')
  const wb = readFileSync('src/components/inspections/inspection-workbench.tsx', 'utf8')
  check('record-card-link가 ④ 칸에 있다', wb.includes('record-card-link') && wb.includes('/record-card'))

  userId = await mkUser({ email: EMAIL, name: `기록표${SUF}`, employeeId: `RC-${SUF}`, role: 'employee' })
  custA = await mkCustomer({ customer_name: `기록표검증사${SUF}`, created_by: userId, address: '경기도 양평군 검증면 5', fire_station: '양평' })
  custB = await mkCustomer({ customer_name: `기록표무불량${SUF}`, created_by: userId, address: '경기도 양평군 검증면 6', fire_station: '양평' })
  for (const [name, active] of [['본관', true], ['별관', true], ['폐쇄동', false]] as const) {
    const { data, error } = await raw.from('buildings').insert({ customer_id: custA, building_name: name, address: `경기도 양평군 ${name}길 1`, is_active: active, created_by: userId }).select('id').single()
    if (error) throw new Error(`건물 생성 실패: ${error.message}`)
    bld.push((data as { id: string }).id)
  }
  const mkInsp = async (cid: string) => {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cid, inspection_type: '작동', plan_type: 'special_작동', sequence_num: 1,
      inspection_start_date: '2026-09-01', inspection_end_date: '2026-09-02',
      status: 'in_progress', assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    return (data as { id: string }).id
  }
  inspA = await mkInsp(custA)
  inspB = await mkInsp(custB)
  const { error: dErr } = await raw.from('inspection_defects').insert([
    { inspection_id: inspA, defect_code: '1-A-008', defect_name: '소화기 압력 미달', severity: '보통', action_start: '2026-10-05', action_end: '2026-10-12' },
    { inspection_id: inspA, defect_code: '15-A-003', defect_name: '감지기 미작동', severity: '보통', action_start: '2026-10-05', action_end: '2026-10-12' },
  ])
  if (dErr) throw new Error(`불량 생성 실패: ${dErr.message}`)

  const l = await launch(); browser = l.browser
  const page: Page = l.page

  console.log('[7] 비로그인')
  // proxy가 라우트 전에 /login 307 — 라우트 자체 401은 proxy 뒤 2차 방어(직접 때릴 일이 없다)
  const anonRoute = await page.request.get(`${BASE}/inspections/${inspA}/record-card?format=html`, { maxRedirects: 0 })
  const anonLoc = anonRoute.headers()['location'] ?? ''
  check('비로그인 → /login(next 없음 — /t 전용 범위)', anonRoute.status() >= 300 && anonRoute.status() < 400 && anonLoc.includes('/login') && !anonLoc.includes('next='), `${anonRoute.status()} ${anonLoc}`)

  await login(page, EMAIL, PW)
  console.log('[1]~[4] 기록표 HTML')
  const res = await page.request.get(`${BASE}/inspections/${inspA}/record-card?format=html`)
  check('200 html', res.status() === 200 && (res.headers()['content-type'] ?? '').includes('text/html'), String(res.status()))
  const html = await res.text()
  check('제목', html.includes('소방시설등 자체점검기록표'))
  check('활성 건물 2쪽(본관·별관)·비활성 제외', html.includes('본관') && html.includes('별관') && !html.includes('폐쇄동'))
  check('건물 주소 실림', html.includes('본관길 1') && html.includes('별관길 1'))
  const { data: bRows } = await raw.from('buildings').select('id, building_name, tag_code').in('id', bld)
  const codes = new Map(((bRows ?? []) as Array<{ building_name: string; tag_code: string | null }>).map(b => [b.building_name, b.tag_code]))
  check('활성 건물 코드 발급(8자)·비활성 미발급', /^[0-9A-Z]{8}$/.test(codes.get('본관') ?? '') && /^[0-9A-Z]{8}$/.test(codes.get('별관') ?? '') && !codes.get('폐쇄동'), JSON.stringify([...codes]))
  check('쪽마다 QR(data-tag·svg)', html.includes(`data-tag="${codes.get('본관')}"`) && html.includes(`data-tag="${codes.get('별관')}"`) && html.includes('<svg'))
  check('점검구분 — 작동 ■·종합 빈칸', html.includes('[■]</span> 작동점검') && !html.includes('[■]</span> 종합점검'))
  check('점검기간 날짜', html.includes('2026년 09월 01일') && html.includes('2026년 09월 02일'))
  check('불량사항 — 소화·경보만 ■', html.includes('[■]</span> 소화설비') && html.includes('[■]</span> 경보설비')
    && !html.includes('[■]</span> 피난구조설비') && !html.includes('[■]</span> 없음'))
  check('정비기간(조치계획 자동값)', html.includes('2026년 10월 05일') && html.includes('2026년 10월 12일'))
  const res2 = await page.request.get(`${BASE}/inspections/${inspA}/record-card?format=html`)
  const html2 = await res2.text()
  check('재요청에도 같은 코드(재발급 없음)', html2.includes(`data-tag="${codes.get('본관')}"`))

  console.log('[5] 불량 0건 회차')
  const resB = await page.request.get(`${BASE}/inspections/${inspB}/record-card?format=html`)
  const htmlB = await resB.text()
  check('「없음」만 ■', htmlB.includes('[■]</span> 없음') && !htmlB.includes('[■]</span> 소화설비'))
  check('정비기간 빈칸 꼴', !htmlB.includes('2026년 10월 05일'))
  check('건물 없는 고객 — 1쪽·QR 없음 고지', decodeURIComponent(resB.headers()['x-record-card-missing'] ?? '').includes('활성 건물이 없어'))

  console.log('[6] /t/{건물코드} 건물 카드')
  await page.goto(`${BASE}/t/${codes.get('본관')}`)
  await page.getByTestId('tag-building-card').waitFor()
  check('건물명', await page.getByTestId('tag-building-name').innerText().then(t => t.includes('본관')))
  check('회차 목록에 진행 중 1건', await page.getByTestId('tag-building-inspections').innerText().then(t => t.includes('2026년 1차') && t.includes('진행 중')))
  check('개체·지점 카드가 아니다', await page.getByTestId('tag-card').count() === 0 && await page.getByTestId('tag-point-card').count() === 0)
} finally {
  if (browser) await browser.close()
  for (const i of [inspA, inspB].filter(Boolean)) {
    await raw.from('inspection_defects').delete().eq('inspection_id', i)
    await raw.from('inspection_steps').delete().eq('inspection_id', i)
    await raw.from('annex_inputs').delete().eq('inspection_id', i)
    await raw.from('inspections').delete().eq('id', i)
  }
  if (bld.length) await raw.from('buildings').delete().in('id', bld)
  if (custA) await cleanupCustomer(custA)
  if (custB) await cleanupCustomer(custB)
  if (userId) await delUser(userId)
}
summary()
