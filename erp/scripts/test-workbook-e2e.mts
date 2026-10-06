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
import { DONOR_TOC_BODY_CELLS } from '../src/lib/xlsx-donors.ts'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `workbook.${SUF}@e2e.test`
let userId = '', custId = '', inspId = '', bldId = ''
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
  // Phase 5(S10): 기저 26 + 목차 + 기타(상시) — 설비 미등록 고객은 설비 시트가 전부 빠진다.
  // 2026-10-06(231e3f7c): 다수동 탭 2장(다수동·다수동일때)은 입력값이 없으면 빠진다 — 1동 고객이라 26
  check('26시트(기저 26 − 다수동 2 + 목차 + 기타)', wb.SheetNames.length === 26, `${wb.SheetNames.length}`)
  check('1동 고객 — 다수동·다수동일때 탭 없음', !wb.SheetNames.includes('다수동') && !wb.SheetNames.includes('다수동일때'))
  check('상시 시트 동봉 — 기타·목 차', wb.SheetNames.includes('기타') && wb.SheetNames.includes('목 차'))
  check('미설치 설비 시트 부재 — 소·자탐1', !wb.SheetNames.includes('소') && !wb.SheetNames.includes('자탐1'))
  check('비다중 고객 — 다중1·2 부재', !wb.SheetNames.includes('다중1') && !wb.SheetNames.includes('다중2'))
  const v = (s: string, c: string) => String((wb.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '')
  const [toc1, toc2] = DONOR_TOC_BODY_CELLS
  check('목차 재작성 — 첫 칸 = 기타 제목', v('목 차', toc1).startsWith('31.'), v('목 차', toc1))
  check('목차 재작성 — 둘째 칸 공란', v('목 차', toc2) === '', v('목 차', toc2))
  // 기저 '목차'는 도너 '목 차'의 복제본 — 한쪽만 고치면 한 파일에 서로 다른 목차 두 장이 된다
  check('기저 목차도 같은 목록(표본 22항목 소거)',
    v('목차', toc1) === v('목 차', toc1) && v('목차', toc2) === '' && !v('목차', 'A4').includes('스프링클러'),
    `${v('목차', toc1)} | A4=${v('목차', 'A4')}`)
  check('개요!B14 = 고객명(허브 주입)', v('개요', 'B14') === `워크북검증사${SUF}`, v('개요', 'B14'))
  check('공문!B8 = 고객명(폐포 전파 실주행)', v('공문', 'B8') === `워크북검증사${SUF}`, v('공문', 'B8'))
  check('개요!D14 = 관할소방서', v('개요', 'D14') === '양평', v('개요', 'D14'))
  check('실고객 표본 흔적 없음', !JSON.stringify(wb.Sheets['개요']).includes('정내과의원'))
  // S7-1·2 + S3-5 2차 — 별지 9호 조립(assembleReport9) 실주행 배선
  check('보고서!A2 점검 구분 — 작동 √', v('보고서', 'A2').startsWith('[√] 작동점검'), v('보고서', 'A2').slice(0, 30))
  // 2026-10-06(마이그 181): 주된 점검인력 = 회사 대표자(배정 무관 — 점검 생성 트리거가 '주된' 참여자로 넣는다).
  //   이름을 박지 않고 회사정보에서 읽는다 — 대표자가 바뀌어도 이 검사가 따라간다
  const { data: cp } = await raw.from('company_profile').select('representative').order('id').limit(1).maybeSingle()
  const rep = String((cp as { representative?: string } | null)?.representative ?? '').trim()
  check('보고서!C17 주된 점검인력 = 회사 대표자(담당 직원 아님)', !!rep && v('보고서', 'C17') === rep && v('보고서', 'C17') !== `워크북${SUF}`,
    `${v('보고서', 'C17')} (대표자 ${rep})`)
  // 정보 시트 12칸 — **실주행 배선** 축. 단위 검사(test-xlsx-anchors [7]·test-xlsx-inject)는
  // 픽스처를 쓰므로, assembleReport9가 정말 이 필드들을 실어 오는지는 여기서만 증명된다.
  // 이 고객은 건축물 구조·보험 정보가 없으므로 전부 ☐ + 빈 슬롯이 정답 — 표본 답이 남으면 붉어진다
  check('정보!B19 건축물구조 — 표본 [√]철근콘크리트구조 소거',
    v('정보', 'B19').includes('[  ]철근콘크리트구조') && !v('정보', 'B19').includes('[√]'), v('정보', 'B19'))
  check('정보!B21 계단 — 표본 ( 1 개소 ) 소거', !v('정보', 'B21').includes('( 1 개소 )'), v('정보', 'B21'))
  check('정보!B23 주차장 — 표본 [√]옥외 소거', !v('정보', 'B23').includes('[√]옥외'), v('정보', 'B23'))
  check('정보!B13 화재보험 — 3줄 유지·표본 2024년 소거',
    v('정보', 'B13').split('\n').length === 3 && !v('정보', 'B13').includes('2024년'),
    JSON.stringify(v('정보', 'B13').slice(0, 40)))
  check('정보!B8 선임구분 — 표본 [√]소방안전관리자수첩 소거',
    !v('정보', 'B8').includes('[√]소방안전관리자수첩'), v('정보', 'B8'))
  // 다수동일때(2·3·4동) — 종전엔 빈 서식으로 덮어 √ 0개를 봤다. 2026-10-06부터 1동이면 시트째 빠진다(위 단언).
  //   시트가 없는데 칸 √를 세면 공허 통과라 그 단언은 지웠다 — 칸 검사는 test-multi-building-form9(2동 이상)가 한다

  console.log('[4] 설치 설비 반영(S10-2) — 소화기구 등록 후 재다운로드')
  const { data: bldIns, error: bldErr } = await raw.from('buildings').insert({
    customer_id: custId, building_name: `본관${SUF}`, created_by: userId,
  }).select('id').single()
  if (bldErr) throw new Error(`건물 생성 실패: ${bldErr.message}`)
  bldId = bldIns!.id
  const { error: facErr } = await raw.from('fire_facilities').insert({
    building_id: bldId, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })
  if (facErr) throw new Error(`설비 등록 실패: ${facErr.message}`)
  const res2 = await page.request.get(`${BASE}/inspections/${inspId}/workbook`)
  const wb2 = XLSX.read(new Uint8Array(await res2.body()))
  const v2 = (s: string, c: string) => String((wb2.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '')
  check('설치 설비 시트 동봉 — 소', wb2.SheetNames.includes('소'), wb2.SheetNames.filter(n => !wb.SheetNames.includes(n)).join(','))
  check('27시트(+소화기구 1면)', wb2.SheetNames.length === 27, `${wb2.SheetNames.length}`)
  check('목차 — 첫 칸 소화기구·둘째 칸 기타', v2('목 차', toc1).startsWith('1.') && v2('목 차', toc2).startsWith('31.'),
    `${v2('목 차', toc1)} | ${v2('목 차', toc2)}`)
  check('여전히 미설치 시트 부재 — 자탐1', !wb2.SheetNames.includes('자탐1'))
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspections').delete().eq('id', inspId)
  if (bldId) {
    await raw.from('fire_facilities').delete().eq('building_id', bldId)
    await raw.from('buildings').delete().eq('id', bldId)
  }
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
