// 소방계획서_5 S2 E2E — 보고서 센터 첫 화면(⓪ IA·① 문서 현황·④ 최근 문서·⑦ 누락) + 대시보드 위젯(R0-9) + Ctrl+K(R0-4)
// 실행: npx tsx scripts/test-report-center.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'report-center-e2e@erp-test.com'
let userId = ''
let custA = ''  // 자체점검(작동) — 9호 미생성·배치확인서 미업로드
let custB = ''  // 일반관리 — 외관점검표
let inspA = ''
let inspB = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const NAME_A = '보고서센터E2E자체점검'
const NAME_B = '보고서센터E2E일반관리'

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '보고서센터E2E', employeeId: 'E2E-RC' })
  custA = await mkCustomer({ customer_name: NAME_A, created_by: userId, inspection_type: '작동', inspection_sub_type: '작동' })
  custB = await mkCustomer({ customer_name: NAME_B, created_by: userId, inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: null })

  // custA — 자체점검 완료(종료 12일 전 → 별지 9호 미제출·D-3 기한), cert·9호 없음
  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-12), inspection_end_date: kstShift(-12),
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`자체점검 생성 실패: ${eA.message}`)
  inspA = iA!.id

  // custB — 일반관리 완료(외관점검표 대상)
  const { data: iB, error: eB } = await raw.from('inspections').insert({
    customer_id: custB, inspection_type: '일반관리', sequence_num: 1,
    inspection_start_date: kstShift(-3), inspection_end_date: kstShift(-3),
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eB) throw new Error(`일반관리 생성 실패: ${eB.message}`)
  inspB = iB!.id

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) ⓪ 보고서 센터 첫 화면 (검색이 시작·오늘 할 일 우선) ──
  await page.goto(`${BASE}/reports`)
  await page.waitForSelector('h1:has-text("보고서 센터")')
  const searchSel = 'input[placeholder*="고객명을 검색하세요"]'
  check('⓪ 검색창 1개 렌더(R1-a·R1-c)', (await page.locator(searchSel).count()) === 1)
  check('⓪ 서식 카드(소방계획서)', await page.isVisible('text=소방계획서'))
  check('④ 최근 문서 섹션 렌더(R5)', await page.isVisible('h2:has-text("최근 문서")'))

  // ── 2) 행동 자동완성 검색 → 문서 현황 열기 (R0-3) ──
  await page.fill(searchSel, NAME_A)
  await page.waitForSelector(`text=${NAME_A} — 문서 현황 열기`)
  check('R0-3 자동완성 — 문서 현황 열기 후보', true)
  check('R0-3 자동완성 — 배치확인서 미업로드 행동 후보', await page.isVisible('text=미업로드'))
  await page.click(`button:has-text("${NAME_A} — 문서 현황 열기")`)

  // ── 3) ① 고객 문서 현황 (R2) — 자체점검 ──
  await page.waitForSelector(`h2:has-text("${NAME_A}")`)
  check('① 문서 현황 펼침(R2)', true)
  check('R2-d URL 동기화(?form=docs&cust=)', page.url().includes('form=docs') && page.url().includes(`cust=${custA}`))
  check('R2-c 요약 게이지', await page.isVisible('text=필요 문서'))
  check('① 소방계획서 행', await page.isVisible('text=소방계획서'))
  check('① 실시결과 보고서(9호) 미생성 + 바로 생성', await page.isVisible('text=실시결과 보고서 (9호)') && await page.isVisible('button:has-text("바로 생성")'))
  check('① 배치확인서 미업로드 + 업로드 버튼(R2-b)', await page.isVisible('text=배치확인서') && await page.isVisible('button:has-text("업로드")'))
  check('R1-b 최근 조회 칩 기억', await page.isVisible(`button:has-text("${NAME_A}")`))

  // ── 4) 일반관리 문서 현황 — 외관점검표·소방계획서 해당없음 ──
  await page.goto(`${BASE}/reports?form=docs&cust=${custB}`)
  await page.waitForSelector(`h2:has-text("${NAME_B}")`)
  check('일반관리 — 소방계획서 해당없음(자동 전환)', await page.isVisible('text=해당없음 — 일반관리는 작성 대상 아님'))
  check('일반관리 — 외관점검표 행', await page.isVisible('text=외관점검표'))

  // ── 5) 대시보드 문서 할 일 위젯 (R0-9) ──
  await page.goto(`${BASE}/dashboard`)
  await page.waitForSelector('h2:has-text("문서 할 일")')
  check('R0-9 대시보드 문서 할 일 위젯 렌더', true)
  check('R0-9 위젯 → 보고서 센터 링크', await page.isVisible('a[href="/reports"]:has-text("보고서 센터")'))

  // ── 6) Ctrl+K 전역 팔레트 (R0-4) ──
  await page.keyboard.press('Control+k')
  await page.waitForSelector('input[placeholder*="문서 확인·생성·업로드"]')
  check('R0-4 Ctrl+K 팔레트 오픈', true)
  await page.fill('input[placeholder*="문서 확인·생성·업로드"]', NAME_A)
  await page.waitForSelector(`text=${NAME_A} — 문서 현황 열기`)
  check('R0-4 팔레트 검색 = 같은 행동 자동완성', true)
  await page.keyboard.press('Escape')
  await page.waitForSelector('input[placeholder*="문서 확인·생성·업로드"]', { state: 'detached' })
  check('R0-4 Esc 닫기', true)

  // ── 7) 헤더 트리거 → 팔레트 → 고객 선택 시 문서 현황 이동 ──
  await page.click('button[aria-label="문서 검색 (Ctrl+K)"]')
  await page.fill('input[placeholder*="문서 확인·생성·업로드"]', NAME_A)
  await page.click(`button:has-text("${NAME_A} — 문서 현황 열기")`)
  await page.waitForURL(u => u.pathname === '/reports' && u.search.includes(`cust=${custA}`))
  check('R0-4 팔레트 → 문서 현황 이동', true)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const cid of [custA, custB]) {
    if (!cid) continue
    const { data: allInsps } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of (allInsps ?? []) as Array<{ id: string }>) {
      await raw.from('notifications').delete().eq('reference_id', i.id)
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
      await raw.from('inspection_reports').delete().eq('inspection_id', i.id)
      const { data: files } = await raw.storage.from('fire-plans').list(`${cid}/inspections/${i.id}`)
      const paths = ((files ?? []) as Array<{ name: string }>).map(o => `${cid}/inspections/${i.id}/${o.name}`)
      if (paths.length) await raw.storage.from('fire-plans').remove(paths)
    }
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
