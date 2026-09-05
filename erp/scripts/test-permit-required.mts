// 건축허가일 필수 E2E — 건물 폼에서 허가일 없이는 저장이 막히고, 채우면 저장된다 (2026-09-05)
// 실행: npx tsx scripts/test-permit-required.mts   (로컬 dev + 스테이징 DB)
//
// 배경: 갑지 엑셀 「정보」 시트 건축허가일 공란 사고 — buildings.permit_date가 null이면
// 개요!D20 주입이 null이라 산출물이 공란으로 인쇄된다. 입력 시점에 막는 것이 이 가드다.
// 차단(막힘)과 해제(저장됨) **양방향**을 같은 폼·같은 고객으로 검사한다 — 한 방향만 보면
// '항상 막힘'(가드 과잉)과 '항상 통과'(가드 부재)를 구별할 수 없다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'permit-required-e2e@erp-test.com'
let userId = '', custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '허가일필수E2E', employeeId: 'E2E-PMT' })
  custId = await mkCustomer({ customer_name: `ZZ허가일${Math.random().toString(36).slice(2, 6)}`, created_by: userId })

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)

  await page.goto(`${BASE}/customers/${custId}?tab=buildings`)
  await page.waitForLoadState('networkidle')

  // '건물 등록' 폼이 기본으로 열려 있지 않은 리비전 대비 — 버튼이 있으면 눌러서 연다
  const newBtn = page.getByRole('button', { name: /건물 등록/ })
  if (await newBtn.count() > 0) await newBtn.first().click()
  const permitInput = page.locator('#bf-permit-date')
  await permitInput.waitFor({ state: 'visible', timeout: 20000 })

  // ── 1. 필수 표시 ──────────────────────────────────────────────────────────
  const label = await page.locator('label', { hasText: '건축허가일' }).first().innerText()
  check('라벨에 필수 별표가 붙는다', label.includes('*'), label)

  // ── 2. 허가일 없이 저장 → 차단 ───────────────────────────────────────────
  // 건물명은 고객명으로 자동 채움이므로 그대로 저장을 시도한다
  await page.getByRole('button', { name: '저장', exact: true }).first().click()
  const errMsg = page.locator('text=건축허가일을 입력해주세요')
  await errMsg.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  check('허가일 공란 저장이 안내 문구와 함께 막힌다', await errMsg.count() > 0)
  await page.waitForTimeout(1500)
  const { count: after1 } = await raw.from('buildings').select('*', { count: 'exact', head: true }).eq('customer_id', custId)
  check('차단 시 DB에 건물이 생기지 않는다', (after1 ?? 0) === 0, `rows=${after1}`)

  // ── 3. 부분 입력(YYYY-MM)도 차단 ─────────────────────────────────────────
  await permitInput.fill('2026-07')
  await page.getByRole('button', { name: '저장', exact: true }).first().click()
  const partialMsg = page.locator('text=완성되지 않았습니다')
  await partialMsg.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  check('부분 입력 저장도 막힌다', await partialMsg.count() > 0)

  // ── 4. 허가일 채우면 저장된다 ────────────────────────────────────────────
  await permitInput.fill('2000-01-01')
  await page.getByRole('button', { name: '저장', exact: true }).first().click()
  await page.waitForTimeout(3000)
  const { data: bld } = await raw.from('buildings')
    .select('permit_date').eq('customer_id', custId).limit(1).maybeSingle()
  const saved = (bld as { permit_date: string | null } | null)?.permit_date ?? null
  check('허가일을 채우면 저장되고 값이 DB에 실린다', saved === '2000-01-01', String(saved))
} finally {
  if (browser) await browser.close()
  await cleanupCustomer(custId)
  await delUser(userId)
}

summary()
