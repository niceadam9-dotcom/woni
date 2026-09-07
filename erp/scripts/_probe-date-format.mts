/** 갑지 산출물의 **날짜 표기 형식 전수 대조**(2026-09-07 사용자 지적 — 한 문서에 두 형식이 섞였다).
 *
 *  판정 축: 워크북 전 시트를 훑어 '날짜처럼 보이는 문자열'을 뽑고 형식별로 분류한다.
 *  기대: 기간 표기는 전부 `YYYY년 M월 D일 ~ YYYY년 M월 D일` 하나뿐 —
 *        `YYYY.MM.DD 부터 ~ 까지`가 **0건**이어야 한다(생년월일 점 표기는 별개 축이라 제외).
 *
 *  ⚠ 개수만 세면 안 된다 — 대조군(생년월일)이 살아 있는지 함께 본다. 전건 0이면 그건
 *     '통일됐다'가 아니라 '워크북이 비었다'일 수 있다.
 *
 *  실행: npx tsx scripts/_probe-date-format.mts   (dev 서버 필요)
 */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, check, summary } from './_e2e-helpers.mjs'
import * as XLSX from 'xlsx'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `datefmt.${SUF}@e2e.test`
let userId = '', custId = '', inspId = ''
let browser: import('playwright').Browser | null = null

/** 기간 표기 두 형식 — 이 프로브의 판정 대상 */
const DOTS_PERIOD = /\d{4}\.\d{2}\.\d{2}\s*부터\s*~/          // 구 형식(없어야 한다)
const KOR_PERIOD = /\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*~\s*\d{4}년\s*\d{1,2}월\s*\d{1,2}일/   // 목표 형식

try {
  userId = await mkUser({ email: EMAIL, name: `날짜${SUF}`, employeeId: `DF-${SUF}`, role: 'admin' })
  custId = await mkCustomer({
    customer_name: `날짜형식${SUF}`, created_by: userId,
    address: '경기도 양평군 강상면 강남로 27', fire_station: '양평',
  })
  const { data: insp, error } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', plan_type: 'special_작동', sequence_num: 1,
    inspection_start_date: '2026-07-23', inspection_end_date: '2026-07-23',
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspId = insp!.id

  const l = await launch(); browser = l.browser
  const page: Page = l.page
  await login(page, EMAIL)
  const res = await page.request.get(`${BASE}/inspections/${inspId}/workbook`)
  check('워크북 200 응답', res.status() === 200, `status=${res.status()}`)
  const buf = Buffer.from(await res.body())
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false })

  // ── 전 시트에서 날짜성 문자열 수집 ──
  const dots: Array<{ sheet: string; cell: string; v: string }> = []
  const kor: Array<{ sheet: string; cell: string; v: string }> = []
  const birthDots: Array<{ sheet: string; cell: string; v: string }> = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    for (const [cell, obj] of Object.entries(ws)) {
      if (cell.startsWith('!')) continue
      const v = (obj as { v?: unknown }).v
      if (typeof v !== 'string') continue
      if (DOTS_PERIOD.test(v)) dots.push({ sheet: name, cell, v })
      else if (KOR_PERIOD.test(v)) kor.push({ sheet: name, cell, v })
      // 생년월일류 — 기간이 아닌 단독 점 표기(대조군: 이건 살아 있어야 정상)
      else if (/^\d{4}\.\d{2}\.\d{2}$/.test(v.trim())) birthDots.push({ sheet: name, cell, v })
    }
  }

  console.log(`\n[수집] 구 기간형식 ${dots.length} · 신 기간형식 ${kor.length} · 단독 점표기(생년월일) ${birthDots.length}`)
  for (const d of dots) console.log(`  🔴 ${d.sheet}!${d.cell} = ${d.v}`)
  for (const k of kor) console.log(`  ✅ ${k.sheet}!${k.cell} = ${k.v}`)
  for (const b of birthDots) console.log(`  · (대조군) ${b.sheet}!${b.cell} = ${b.v}`)

  // ── 판정 ──
  // ① 검출기 생존 — 신 형식이 0이면 아래 '구 형식 0건'은 공허 통과다(워크북이 비었을 뿐)
  check('검출기 생존 — 목표 형식이 1건 이상 실재', kor.length > 0,
    `kor=${kor.length} (0이면 워크북 조립 실패를 의심할 것)`)
  // ② 본 판정 — 구 형식 전멸
  check('구 형식(YYYY.MM.DD 부터 ~ 까지) 0건', dots.length === 0,
    dots.map(d => `${d.sheet}!${d.cell}=${d.v}`).join(' / '))
  // ③ 원천 칸 — 개요!E1(주된 점검인력 참여일)이 목표 형식인가
  const e1 = (wb.Sheets['개요']?.['E1'] as { v?: unknown } | undefined)?.v
  check('개요!E1(주된 참여일) 목표 형식', typeof e1 === 'string' && KOR_PERIOD.test(e1), `E1=${String(e1)}`)
  // ④ 주된 vs 보조 형식 일치 — 사용자가 실제로 본 증상(나란한 두 줄이 서로 달랐다)
  const e2 = (wb.Sheets['개요']?.['E2'] as { v?: unknown } | undefined)?.v
  const bothKor = typeof e1 === 'string' && typeof e2 === 'string' && KOR_PERIOD.test(e1) && KOR_PERIOD.test(e2)
  check('개요!E1·E2(주된·보조) 같은 형식', bothKor || e2 == null || String(e2).trim() === '',
    `E1=${String(e1)} / E2=${String(e2)}`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspections').delete().eq('id', inspId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
