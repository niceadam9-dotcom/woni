// 소방계획서_29 S1-8 — 개인별 화면 테마 E2E
//
// 보는 것: ①설정 카드에서 다크 선택 → <html>.dark + DB 정본 + 쿠키 3축 일치
// ②재로그인해도 유지(쿠키를 지워도 로그인이 DB에서 복원) ③계정 간 격리(A 다크 ≠ B 라이트)
// ④로그아웃이 쿠키를 지운다(공용 PC) ⑤일반직원에게도 카드·토글 노출(S4-3 전 사용자 공개, 2026-08-28)
//
// ⚠ 선행: 마이그레이션 151(profiles.theme)이 대상 DB에 적용돼 있어야 한다.
//   시드 검사가 이를 먼저 단언한다 — 미적용이면 첫 check가 원인을 말하고 멈춘다.
//
// 실행: npx tsx scripts/test-theme-settings.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL_A = 'theme-e2e-admin@erp-test.com'
const EMAIL_B = 'theme-e2e-staff@erp-test.com'
let adminId = ''
let staffId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const htmlIsDark = (page: { evaluate: (fn: () => boolean) => Promise<boolean> }) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'))

try {
  // ── 0) 시드 — 151 적용 단언 (없는 컬럼은 조용한 0행이 되므로 error 축으로 명시 판정) ──
  {
    const { error } = await raw.from('profiles').select('theme').limit(1)
    check('시드 — 마이그레이션 151(profiles.theme) 적용됨', !error, error?.message ?? 'ok')
    if (error) throw new Error('151 미적용 — 이후 검사는 의미 없음')
  }

  adminId = await mkUser({ email: EMAIL_A, name: '테마E2E관리자', employeeId: 'E2E-THA' })
  staffId = await mkUser({ email: EMAIL_B, name: '테마E2E직원', employeeId: 'E2E-THB', role: 'employee' })

  const l = await launch()
  browser = l.browser
  const page = l.page

  // ── 1) 관리자 — 설정 카드에서 다크 선택 → DOM·DB·쿠키 3축 ──
  await login(page, EMAIL_A)
  await page.goto(`${BASE}/settings`)
  await page.waitForSelector('[data-testid="theme-settings-card"]')
  check('관리자 — 화면 테마 카드 노출', true)
  check('초기 상태 — html에 dark 없음(기본 화이트)', !(await htmlIsDark(page)))

  await page.click('[data-testid="theme-option-dark"]')
  await page.waitForSelector('[data-testid="theme-saved"]', { timeout: 15000 })
  check('다크 선택 — 즉시 <html>.dark', await htmlIsDark(page))

  const { data: rowA } = await raw.from('profiles').select('theme').eq('id', adminId).single()
  check('다크 선택 — DB 정본 theme=dark', (rowA as { theme?: string } | null)?.theme === 'dark')

  const cookies1 = await page.context().cookies(BASE)
  const themeCookie = cookies1.find(c => c.name === 'erp-theme')
  check('다크 선택 — 쿠키 erp-theme=dark', themeCookie?.value === 'dark', JSON.stringify(themeCookie ?? null))
  check('쿠키는 httpOnly가 아니다(인라인 스크립트가 읽어야 함)', themeCookie?.httpOnly === false)

  // ── 2) 새로고침 — 인라인 스크립트가 쿠키로 첫 페인트부터 다크 ──
  await page.reload()
  await page.waitForSelector('[data-testid="theme-settings-card"]')
  check('새로고침 후에도 dark 유지(인라인 스크립트)', await htmlIsDark(page))

  // ── 3) 쿠키 유실 → 로그인이 DB에서 복원 (S1-4) ──
  await page.context().clearCookies()
  await login(page, EMAIL_A)
  const cookies2 = await page.context().cookies(BASE)
  check('재로그인 — 쿠키가 DB 정본(dark)에서 복원', cookies2.find(c => c.name === 'erp-theme')?.value === 'dark')
  await page.goto(`${BASE}/settings`)
  await page.waitForSelector('[data-testid="theme-settings-card"]')
  check('재로그인 — 화면도 dark', await htmlIsDark(page))

  // ── 4) 로그아웃 — 쿠키 삭제(공용 PC) ──
  await page.click('[aria-label="로그아웃"]')
  await page.waitForURL(u => u.pathname.includes('/login'), { timeout: 15000 })
  const cookies3 = await page.context().cookies(BASE)
  check('로그아웃 — erp-theme 쿠키 제거', !cookies3.find(c => c.name === 'erp-theme'),
    JSON.stringify(cookies3.filter(c => c.name === 'erp-theme')))

  // ── 5) 계정 간 격리 — B(일반직원)는 라이트 그대로 + 카드·토글 노출(S4-3 전 사용자 공개) ──
  const l2 = await launch()
  try {
    const p2 = l2.page
    await login(p2, EMAIL_B)
    await p2.goto(`${BASE}/settings`)
    await p2.waitForSelector('text=알림 설정')
    check('직원 — A의 다크에 안 물든다(격리)', !(await htmlIsDark(p2)))
    check('직원 — 테마 카드 노출(S4-3 전 사용자)', (await p2.locator('[data-testid="theme-settings-card"]').count()) === 1)
    check('직원 — 헤더 토글 노출(S4-3 전 사용자)', (await p2.locator('[data-testid="header-theme-toggle"]').count()) === 1)
    const { data: rowB } = await raw.from('profiles').select('theme').eq('id', staffId).single()
    check('직원 — DB 정본은 light', (rowB as { theme?: string } | null)?.theme === 'light')
  } finally { await l2.browser.close() }

  // ── 6) 헤더 토글 왕복 — 다크→화이트 되돌리기(같은 액션 재사용) ──
  await login(page, EMAIL_A)
  await page.waitForSelector('[data-testid="header-theme-toggle"]')
  check('관리자 — 헤더 토글 노출', true)
  check('토글 전 — dark(3에서 복원된 상태)', await htmlIsDark(page))
  await page.click('[data-testid="header-theme-toggle"]')
  await page.waitForTimeout(1500)
  check('토글 — 화이트로 전환', !(await htmlIsDark(page)))
  const { data: rowA2 } = await raw.from('profiles').select('theme').eq('id', adminId).single()
  check('토글 — DB 정본도 light', (rowA2 as { theme?: string } | null)?.theme === 'light')

} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (adminId) await delUser(adminId)
  if (staffId) await delUser(staffId)
}
summary('개인별 화면 테마(소방계획서_29 S1)')
