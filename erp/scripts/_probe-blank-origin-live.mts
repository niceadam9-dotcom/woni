/** 4단계 원격 입력처 링크 실화면 실측 (2026-09-18)
 *
 *  `CellOrigin`은 단위 검사(전수·차분)로 증명했지만 **사용자가 실제로 누르는 화면**은
 *  아직 안 봤다. 1.12 절의 빈칸 보고에 1.15 칸이 뜨면 그 입력처는 1.10이라
 *  「입력: 1.10 자체점검」 링크가 붙고, 눌렀을 때 실제로 그 절이 열려야 한다.
 *
 *  🚨 `process.exit` 금지(finally를 건너뛴다) · 데이터는 **읽기만** 한다.
 *  실행: npx tsx scripts/_probe-blank-origin-live.mts   (localhost:3000)
 */
import { launch, login, raw, mkUser, delUser } from './_e2e-helpers.mjs'

const BASE = 'http://localhost:3000'
const EMAIL = 'e2e-blank-origin@test.local'
let ctx: Awaited<ReturnType<typeof launch>> | null = null
let userId: string | null = null
let ok = true
const check = (name: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : '🚨 FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!pass) ok = false
}

try {
  const { data: cust } = await raw.from('customers').select('id, customer_name').eq('is_active', true).limit(1).single()
  const customerId = (cust as { id: string }).id
  console.log(`대상: ${(cust as { customer_name: string }).customer_name}`)

  userId = await mkUser({ email: EMAIL, name: '빈칸링크E2E', employeeId: 'E2E-BLNK' })
  ctx = await launch()
  const page = ctx.page
  await login(page, EMAIL)

  // 1.12 절(1.12.1·1.13·1.14.1·1.14.2·1.15 담당)에서 빈칸 보고를 연다
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=1.12`)
  const panel = page.locator('[data-testid="plan-blank-report"]')
  await panel.waitFor({ timeout: 20000 })
  check('빈칸 보고 패널이 이 절에 뜬다', await panel.isVisible())

  await page.locator('[data-testid="plan-blank-toggle"]').click()
  // 상세는 서버 액션으로 조회한다 — 「계산 중…」이 끝나고 목록이 붙을 때까지 기다린다
  await page.locator('[data-testid="blank-origin-link"]').first().waitFor({ timeout: 30000 })

  const links = page.locator('[data-testid="blank-origin-link"]')
  const n = await links.count()
  const texts = await links.allInnerTexts()
  const uniq = [...new Set(texts.map(t => t.trim()))]
  check('원격 입력처 링크가 붙는다', n > 0, `${n}개 · ${uniq.slice(0, 4).join(' / ')}`)
  check('링크가 「입력: <절 이름>」 꼴이다', uniq.every(t => t.startsWith('입력:')), uniq[0])
  /* 🎯 이 절(1.12)이 아닌 다른 절로만 보낸다 — 같은 절이면 링크를 안 단다(소음 방지) */
  check('자기 절(1.12~1.15 기록부)로 보내는 링크는 없다',
    !uniq.some(t => t.includes('1.12~1.15')), uniq.join(' / '))

  const href = await links.first().getAttribute('href')
  check('href가 목차 딥링크 어휘다', !!href && href.startsWith('?tab=plan&form='), href ?? '(없음)')

  /* 🚨 해시를 먼저 떼고 읽는다 — `URLSearchParams('...form=1.10#c-1.10.4')`는 해시까지
   *   form 값으로 읽어 「기대 1.10#c-1.10.4」가 된다(첫 실행이 그래서 거짓 빨강이었다:
   *   제품이 아니라 계측기가 틀렸다). 해시는 카드 앵커라 별도로 확인한다. */
  const [hrefQuery, hrefHash] = href!.split('#')
  const wantForm = new URLSearchParams(hrefQuery.slice(1)).get('form')

  await links.first().click()
  await page.waitForLoadState('networkidle')
  const url = new URL(page.url())
  check('누르면 그 절이 열린다', url.searchParams.get('form') === wantForm,
    `form=${url.searchParams.get('form')} (기대 ${wantForm})`)
  check('카드 앵커 해시가 URL에 실린다', !hrefHash || url.hash === `#${hrefHash}`,
    `${url.hash || '(없음)'} (기대 #${hrefHash ?? ''})`)

  console.log(`\n${ok ? '✅ 4단계 원격 링크가 실화면에서 동작한다' : '🚨 실화면에서 갈라졌다'}`)
  process.exitCode = ok ? 0 : 1
} finally {
  if (userId) await delUser(userId)
  await ctx?.browser.close()
}
