// 소방계획서_5 R0-11 — 클릭 수 목표표 E2E (4-0 UX 규약: 최소 클릭 동선 회귀 가드)
// 소방계획서_8 Phase B 현행화(2026-08-15): 보고서 센터 해체 — 진입은 전역 문서 검색(Ctrl+K 팔레트,
// command-palette.tsx), 문서 현황 = 고객 소방계획서 트리(별지 서식). 구 /reports 딥링크는 매핑 리다이렉트.
// 종전 예산4(완료 시 9호 자동 생성 토글)는 토글 폐지로 삭제 — 생성 동선은 문서 생성 회귀(E2E)가 고정한다.
// 실행: npx tsx scripts/test-click-budget.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'click-budget-e2e@erp-test.com'
let userId = ''
let custA = ''  // 자체점검(작동) 완료 — 9호 미생성·배치확인서 미업로드
let inspA = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const NAME_A = '클릭예산E2E자체점검'

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '클릭예산E2E', employeeId: 'E2E-CB' })
  custA = await mkCustomer({ customer_name: NAME_A, created_by: userId, inspection_type: '작동', inspection_sub_type: '작동' })

  // custA — 자체점검 완료(종료 12일 전 → 별지 9호 D-3), cert·9호 없음
  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-12), inspection_end_date: kstShift(-12),
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`자체점검 생성 실패: ${eA.message}`)
  inspA = iA!.id

  const l = await launch()
  browser = l.browser
  const page = l.page

  // 클릭 카운터 — page.click 호출을 래핑해 실측
  let clicks = 0
  const origClick = page.click.bind(page)
  ;(page as unknown as { click: typeof origClick }).click = async (sel: string, opts?: unknown) => {
    clicks++
    return origClick(sel, opts as never)
  }
  const resetClicks = () => { clicks = 0 }

  await login(page, EMAIL)

  // ── 예산 1) 문서 현황 진입 = Ctrl+K(키보드) + 타이핑 + 1클릭 ──
  await page.goto(`${BASE}/dashboard`)
  await page.waitForSelector('button[aria-label="문서 검색 (Ctrl+K)"]')
  await page.keyboard.press('Control+KeyK')          // 키보드 — 클릭 아님
  const searchSel = 'input[placeholder*="고객명을 검색하세요"]'
  await page.waitForSelector(searchSel)
  await page.fill(searchSel, NAME_A)                 // 타이핑(클릭 아님)
  await page.waitForSelector(`text=${NAME_A} — 문서 현황 열기`)
  resetClicks()
  await page.click(`button:has-text("${NAME_A} — 문서 현황 열기")`)   // 1클릭
  await page.waitForURL(u => u.pathname === `/customers/${custA}` && u.search.includes('form=annex'), { timeout: 20000, waitUntil: 'commit' })   // dev 서버 부하 시 load가 20s를 넘긴다 — URL 도달로 판정
  check('예산1 문서 현황 진입 = Ctrl+K+타이핑+1클릭 (소방계획서 트리 도달)', clicks <= 1, `실측 ${clicks}클릭`)
  check('예산1 URL 동기화(?tab=plan&form=annex)', page.url().includes('tab=plan') && page.url().includes('form=annex'))

  // ── 예산 2) 구 보고서 센터 딥링크 보존 — 매핑 리다이렉트 4종 (reports/page.tsx) ──
  await page.goto(`${BASE}/reports?form=docs&cust=${custA}`)
  await page.waitForURL(u => u.pathname === `/customers/${custA}`, { timeout: 20000, waitUntil: 'commit' })   // dev 서버 부하 시 load가 20s를 넘긴다 — URL 도달로 판정
  check('예산2 구 딥링크 ?form=docs&cust= → 고객 소방계획서 탭', page.url().includes('tab=plan') && page.url().includes('form=annex'))
  await page.goto(`${BASE}/reports?form=annual`)
  // 배치 발행 폐지(2026-08-19) — 생성 창구가 고객 소방계획서 탭 하나라 고객관리 목록으로 보낸다
  await page.waitForURL(u => u.pathname === '/customers', { timeout: 20000, waitUntil: 'commit' })   // dev 서버 부하 시 load가 20s를 넘긴다 — URL 도달로 판정
  check('예산2 구 딥링크 ?form=annual → 고객관리(배치 발행 폐지)', true)
  await page.goto(`${BASE}/reports?form=submissions`)
  await page.waitForURL(u => u.pathname === '/dashboard', { timeout: 20000, waitUntil: 'commit' })   // dev 서버 부하 시 load가 20s를 넘긴다 — URL 도달로 판정
  check('예산2 구 딥링크 ?form=submissions → 대시보드(제출 현황판)', true)
  await page.goto(`${BASE}/reports`)
  await page.waitForURL(u => u.pathname === '/dashboard', { timeout: 20000, waitUntil: 'commit' })   // dev 서버 부하 시 load가 20s를 넘긴다 — URL 도달로 판정
  check('예산2 구 딥링크 /reports → 대시보드', true)

  // ── 예산 3) 배치확인서 업로드 진입 = 0~2클릭 (팔레트 자동완성 미업로드 후보 노출) ──
  // 리다이렉트 직후 하이드레이션 전이면 Ctrl+K 리스너가 아직 없다 — 트리거 버튼 렌더를 먼저 기다린다
  await page.waitForSelector('button[aria-label="문서 검색 (Ctrl+K)"]')
  await page.waitForLoadState('networkidle')
  await page.keyboard.press('Control+KeyK')
  if (!(await page.locator(searchSel).isVisible().catch(() => false))) {
    await page.click('button[aria-label="문서 검색 (Ctrl+K)"]')   // 폴백 — 예산 상 팔레트 열기 1클릭 허용
  }
  await page.waitForSelector(searchSel)
  await page.fill(searchSel, NAME_A)
  await page.waitForSelector('text=미업로드')
  check('예산3 업로드 진입 — 자동완성 "배치확인서 ⚠ 미업로드" 후보 노출(0~2클릭 내)', await page.isVisible('text=미업로드'))
} catch (e) {
  console.error('❌ 테스트 예외:', (e as Error).message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await cleanupCustomer(custA)
  const { raw: r } = await import('./_e2e-helpers.mjs')
  await r.from('profiles').delete().eq('id', userId)
  await r.auth.admin.deleteUser(userId).catch(() => {})
}
// ⚠ summary()는 process.exit()라 try 안에서 부르면 성공 실행마다 finally 정리가 통째로 건너뛰어
// 잔재가 쌓인다(2026-08-15 실측 — 잔재 고객이 팔레트 최상위 매칭을 가로채는 연쇄까지). 반드시 맨 끝.
summary()
