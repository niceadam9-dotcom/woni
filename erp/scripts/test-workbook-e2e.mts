/** 갑지 워크북 다운로드 실주행 (소방계획서_27 S6-5 — dev 서버 필요)
 *  실행: npx tsx scripts/test-workbook-e2e.mts
 *
 *  라우트는 공개 엔드포인트라(소방계획서_17 교훈) 인증·권한·실바이트까지 실제로 태워 본다:
 *  ① 비로그인 401 ② 로그인 후 200 + xlsx MIME ③ 받은 바이트가 실제로 열리고 26시트
 *  ④ 주입 값(고객명)이 개요·공문 양쪽에 실려 있다(폐포 전파의 실주행 확인) */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, check, summary } from './_e2e-helpers.mjs'
import * as XLSX from 'xlsx'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `workbook.${SUF}@e2e.test`
let userId = '', custId = '', inspId = ''
let browser: import('playwright').Browser | null = null

try {
  userId = await mkUser({ email: EMAIL, name: `워크북${SUF}`, employeeId: `WB-${SUF}`, role: 'admin' })
  custId = await mkCustomer({
    customer_name: `워크북검증사${SUF}`, created_by: userId,
    address: '경기도 양평군 검증면 실주행로 27', fire_station: '양평',
  })
  // year는 생성열 — 넣으면 non-DEFAULT 오류(2026-08-21 실측)
  const { data: insp, error } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', plan_type: 'special_작동', sequence_num: 1,
    inspection_start_date: '2026-08-20', inspection_end_date: '2026-08-21',
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspId = insp!.id

  const l = await launch(); browser = l.browser
  const page: Page = l.page

  console.log('[1] 비로그인 접근')
  // proxy.ts가 미인증을 /login으로 리다이렉트한다(Next16 Proxy 규약) — 따라가면 로그인 화면 200이
  // 나와 차단 여부를 못 본다. 리다이렉트를 멈추고 3xx(프록시 차단) 또는 401(라우트 자체 가드)을 본다
  const anon = await page.request.get(`${BASE}/inspections/${inspId}/workbook`, { maxRedirects: 0 })
  check('비로그인 차단(3xx 리다이렉트 또는 401)', anon.status() === 401 || (anon.status() >= 300 && anon.status() < 400),
    `status=${anon.status()}`)

  console.log('[2] 로그인 후 다운로드')
  await login(page, EMAIL)
  const res = await page.request.get(`${BASE}/inspections/${inspId}/workbook`)
  check('200 응답', res.status() === 200, `status=${res.status()}`)
  check('xlsx MIME', (res.headers()['content-type'] ?? '').includes('spreadsheetml'),
    res.headers()['content-type'])
  const body = await res.body()
  check('실바이트(1MB 이상 · PK 시그니처)', body.length > 1_000_000 && body[0] === 0x50 && body[1] === 0x4b,
    `${(body.length / 1024).toFixed(0)}KB`)

  console.log('[3] 받은 파일이 실제로 열린다')
  const wb = XLSX.read(new Uint8Array(body))
  check('26시트', wb.SheetNames.length === 26, `${wb.SheetNames.length}`)
  const v = (s: string, c: string) => String((wb.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '')
  check('개요!B14 = 고객명(허브 주입)', v('개요', 'B14') === `워크북검증사${SUF}`, v('개요', 'B14'))
  check('공문!B8 = 고객명(폐포 전파 실주행)', v('공문', 'B8') === `워크북검증사${SUF}`, v('공문', 'B8'))
  check('개요!D14 = 관할소방서', v('개요', 'D14') === '양평', v('개요', 'D14'))
  check('실고객 표본 흔적 없음', !JSON.stringify(wb.Sheets['개요']).includes('정내과의원'))
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspections').delete().eq('id', inspId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
