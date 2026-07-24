// Victory10_entire NF-PERF-1 재측정 — 로컬 프로덕션 빌드(localhost:3000, npm start) 대상
// 진단 결과: 서버 렌더(SSR 목록 표시)는 <1.3s로 빠름. networkidle이 느린 건 Next.js <Link> 프리페치
// (행마다 링크 4~5개 × 50행 = 배경 RSC 프리페치 200여 건)가 네트워크를 계속 물기 때문 — 사용자 체감 아님.
// 따라서 기준 지표 = '목록 콘텐츠가 화면에 표시되는 시각'(SSR = domcontentloaded + 핵심 콘텐츠 selector).
// 실행: 1) npm run build  2) npm start  3) npx tsx scripts/test-nfperf1-local.mts
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'nfperf1-local-e2e@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

try {
  userId = await mkUser({ email: EMAIL, name: 'NFPERF1로컬', employeeId: 'E2E-NP1', role: 'manager' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(30000)
  await login(page, EMAIL)

  // 목록이 화면에 표시된 시각 = SSR 콘텐츠 selector가 보일 때 (프리페치 배경 트래픽 제외)
  async function measureOnce(path: string, contentSel: string) {
    const t0 = Date.now()
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.locator(contentSel).first().waitFor({ state: 'visible', timeout: 25000 })
    return Date.now() - t0
  }
  async function measure(path: string, label: string, contentSel: string) {
    await measureOnce(path, contentSel)                      // 웜업(캐시·연결)
    const runs = [await measureOnce(path, contentSel), await measureOnce(path, contentSel), await measureOnce(path, contentSel)]
    const m = median(runs)
    console.log(`  ⏱ ${label} ${path}: median ${m}ms  (runs ${runs.join('/')})  [목록 표시 시각]`)
    return m
  }

  const tCustomers = await measure('/customers', '고객관리', 'text=개사')
  const tInspections = await measure('/inspections', '점검업무', 'table')
  const tMonitor = await measure('/inspection-plans/monitor', '모니터링', 'table')

  check('고객관리 목록 표시 3초 이내', tCustomers < 3000, `${tCustomers}ms`)
  check('점검업무 목록 표시 3초 이내', tInspections < 3000, `${tInspections}ms`)
  check('모니터링 목록 표시 3초 이내', tMonitor < 3000, `${tMonitor}ms`)
  console.log(`\n요약(목록 표시 시각, 로컬 prod build, median/3): 고객=${tCustomers}ms · 점검=${tInspections}ms · 모니터=${tMonitor}ms`)
  console.log('참고: networkidle 지표(고객 6s대)는 <Link> 배경 프리페치 포함이라 사용자 체감 아님 — 목록은 위 시각에 이미 표시됨')

  summary()
} catch (e) {
  console.error('❌ 예외:', (e as Error).message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  const { raw } = await import('./_e2e-helpers.mjs')
  await raw.from('profiles').delete().eq('id', userId)
  await raw.auth.admin.deleteUser(userId).catch(() => {})
}
