// 키보드 트리·탭 이동 프로브 (2026-09-21 사용자 요청)
// 붙드는 것 3가지:
//   ① 소방계획서 좌측 트리 — ↑↓←→가 이웃 노드로 선택·포커스를 옮긴다 (aria-current 축)
//   ② 공통 탭 트리(tab-form-tree)도 같은 조작감 — 1.1 ↔ 1.4
//   ③ 최상위 탭 바 — ←/→가 이웃 탭을 활성화하고, 그 순서가
//      공통 → 보고서 → 소방계획서 → 회차 (2026-09-21 사용자 지정)임을 이동 자체로 증명
//   ④ roving tabindex — 선택된 노드/탭만 Tab 대상이라 **Tab 1번**에 상세로 빠져나온다
//      (종전 실측 13번). 이게 끊기면 증상이 '키보드가 좀 불편하다'뿐이라 아무도 신고하지 않는다.
//   ⑤ Enter=상세 진입 / ESC=트리 복귀 왕복, Home·End=첫·마지막 노드
//   ⑥ 미저장 확인창의 키보드 — 포커스가 창 **안**으로 들어가고, ESC로 닫히고, Tab이 창 밖으로
//      새지 않는다. 셋 다 2026-09-21 실측으로 잡은 결함이라 대조군 없이 단언만 두면 회귀를 놓친다.
// 실행: npx tsx scripts/_probe-tree-keyboard.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'tree-kbd-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '키보드트리프로브', employeeId: 'E2E-KBDT' })
  custId = await mkCustomer({ customer_name: '키보드트리프로브고객', address: '경기 양평군 테스트로 51', created_by: userId })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  const curNode = () => page.locator('[role=tabpanel]:not([hidden]) aside [data-plan-node][aria-current="true"]')
    .first().getAttribute('data-plan-node').catch(() => null)
  const activeTab = () => page.locator('[role=tab][aria-selected="true"]').first().innerText()
    .then((v: string) => v.replace(/\s+/g, '')).catch(() => '(없음)')

  // ══ ① 소방계획서 트리 ↑↓←→ ═══════════════════════════════════════════════
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.5`)
  await page.waitForSelector('[data-plan-node="1.5"][aria-current="true"]', { timeout: 30000 })
  await page.locator('[data-plan-node="1.5"]').click()   // 포커스를 트리에 둔다
  await page.keyboard.press('ArrowDown')
  check('① ↓: 1.5 → 1.6', (await curNode()) === '1.6', String(await curNode()))
  await page.keyboard.press('ArrowUp')
  check('① ↑: 1.6 → 1.5', (await curNode()) === '1.5', String(await curNode()))
  await page.keyboard.press('ArrowRight')
  check('① →: 1.5 → 1.6 (좌우도 같은 축)', (await curNode()) === '1.6', String(await curNode()))
  await page.keyboard.press('ArrowLeft')
  check('① ←: 1.6 → 1.5', (await curNode()) === '1.5', String(await curNode()))
  // 연타 — 포커스가 함께 이동해야 끊기지 않는다 (1.5→1.6→1.7→1.8)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  check('① 연타 ↓×3: 1.5 → 1.8 (포커스 동반 이동)', (await curNode()) === '1.8', String(await curNode()))
  // 딥링크 동기화 — select()를 태웠다는 증거 (URL ?form=)
  check('① URL ?form= 동기화', page.url().includes('form=1.8'), page.url())

  // ══ ② 공통 탭 트리 (tab-form-tree) ═══════════════════════════════════════
  await page.goto(`${BASE}/customers/${custId}?tab=facilities&form=1.1`)
  await page.waitForSelector('[role=tabpanel]:not([hidden]) [data-plan-node="1.1"]', { timeout: 30000 })
  await page.locator('[role=tabpanel]:not([hidden]) [data-plan-node="1.1"]').click()
  await page.keyboard.press('ArrowDown')
  check('② 공통 트리 ↓: 1.1 → 1.4', (await curNode()) === '1.4', String(await curNode()))
  await page.keyboard.press('ArrowUp')
  check('② 공통 트리 ↑: 1.4 → 1.1', (await curNode()) === '1.1', String(await curNode()))

  // ══ ③ 탭 바 ←/→ + 새 순서 ═══════════════════════════════════════════════
  // 공통에서 →를 세 번 — 보고서 → 소방계획서 → 회차 순으로 지나가야 한다(순서 증명이 이동 그 자체)
  await page.locator('[role=tab]').filter({ hasText: '공통' }).first().click()
  await page.keyboard.press('ArrowRight')
  check('③ →: 공통 → 보고서', (await activeTab()).startsWith('보고서'), await activeTab())
  await page.keyboard.press('ArrowRight')
  check('③ →: 보고서 → 소방계획서', (await activeTab()).includes('소방계획서'), await activeTab())
  await page.keyboard.press('ArrowRight')
  check('③ →: 소방계획서 → 회차 (2026-09-21 새 순서)', (await activeTab()).startsWith('회차'), await activeTab())
  await page.keyboard.press('ArrowLeft')
  check('③ ←: 회차 → 소방계획서', (await activeTab()).includes('소방계획서'), await activeTab())
  await page.keyboard.press('Home')
  check('③ Home: 첫 탭(기본정보)', (await activeTab()).includes('기본정보'), await activeTab())

  // ══ ④ roving tabindex — Tab 1번에 트리를 빠져나온다 ═══════════════════════
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.2`)
  await page.waitForSelector('[data-plan-node="1.2"][aria-current="true"]', { timeout: 30000 })
  const tabbable = await page.locator('[role=tabpanel]:not([hidden]) aside [data-plan-node]:not([tabindex="-1"])').count()
  check('④ 트리에서 Tab 대상인 노드는 선택된 1개뿐', tabbable === 1, `${tabbable}개`)
  await page.locator('[data-plan-node="1.2"]').focus()
  await page.keyboard.press('Tab')
  const leftTree = await page.evaluate(() => !document.activeElement?.closest('aside'))
  check('④ Tab 1번으로 트리를 벗어난다 (종전 실측 13번)', leftTree,
    await page.evaluate(() => document.activeElement?.tagName ?? '(없음)'))
  const tabbableTabs = await page.locator('[role=tab]:not([tabindex="-1"])').count()
  check('④ 탭 바에서 Tab 대상인 탭은 활성 1개뿐', tabbableTabs === 1, `${tabbableTabs}개`)

  // ══ ⑤ Enter=진입 / ESC=복귀 / Home·End ════════════════════════════════════
  await page.locator('[data-plan-node="1.2"]').focus()
  await page.keyboard.press('Enter')
  const inDetail = await page.evaluate(() =>
    !!document.activeElement?.closest('[data-detail-panel]') && !document.activeElement?.closest('aside'))
  check('⑤ Enter: 트리 → 상세 패널로 포커스 진입', inDetail,
    await page.evaluate(() => `${document.activeElement?.tagName} "${(document.activeElement?.textContent ?? '').trim().slice(0, 25)}"`))
  await page.keyboard.press('Escape')
  const backOnNode = await page.evaluate(() => document.activeElement?.getAttribute('data-plan-node'))
  check('⑤ ESC: 상세 → 선택 노드로 복귀', backOnNode === '1.2', String(backOnNode))
  await page.keyboard.press('End')
  check('⑤ End: 마지막 노드(archive)', (await curNode()) === 'archive', String(await curNode()))
  await page.keyboard.press('Home')
  check('⑤ Home: 첫 노드(1.2)', (await curNode()) === '1.2', String(await curNode()))

  // ══ ⑥ 미저장 확인창의 키보드 ═══════════════════════════════════════════════
  // 입력칸이 실재하는 서식에서만 성립한다 — 없는 화면에서 재면 dirty가 안 걸려 공허하게 초록이 된다
  const INPUT = '[role=tabpanel]:not([hidden]) :is(input:not([type=hidden]):not([readonly]), textarea):visible'
  let dirtyNode = ''
  for (const f of ['1.7', '1.8', '1.11', 'ch2']) {
    await page.goto(`${BASE}/customers/${custId}?tab=plan&form=${f}`)
    await page.waitForSelector(`[data-plan-node="${f}"][aria-current="true"]`, { timeout: 30000 })
    await page.waitForTimeout(800)
    if (await page.locator(INPUT).count() > 0) { dirtyNode = f; break }
  }
  check('⑥ (전제) 입력칸이 있는 서식을 찾았다 — 없으면 아래 단언이 공허하다', dirtyNode !== '', dirtyNode)
  if (dirtyNode) {
    await page.locator(INPUT).first().click()
    await page.locator(INPUT).first().type('키보드검사')
    await page.waitForTimeout(400)
    await page.locator(`[data-plan-node="${dirtyNode}"]`).focus()
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(600)
    check('⑥ (전제) 미저장이라 확인창이 떴다',
      (await page.locator('[data-unsaved-dialog]').count()) === 1)
    check('⑥ 포커스가 확인창 **안**에 있다 (종전: 창 뒤 트리에 남았다)',
      await page.evaluate(() => !!document.activeElement?.closest('[data-unsaved-dialog]')),
      await page.evaluate(() => `${document.activeElement?.tagName} "${(document.activeElement?.textContent ?? '').trim().slice(0, 20)}"`))
    // 이동이 보류됐으니 선택도 포커스도 앞서 나가면 안 된다
    check('⑥ 보류 중에는 선택이 움직이지 않는다', (await curNode()) === dirtyNode, String(await curNode()))
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    check('⑥ Tab이 창 밖으로 새지 않는다 (포커스 트랩)',
      await page.evaluate(() => !!document.activeElement?.closest('[data-unsaved-dialog]')),
      await page.evaluate(() => `${document.activeElement?.tagName} "${(document.activeElement?.textContent ?? '').trim().slice(0, 20)}"`))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    check('⑥ ESC로 확인창이 닫힌다 (종전: 안 닫혔다)',
      (await page.locator('[data-unsaved-dialog]').count()) === 0)
    check('⑥ ESC 후 포커스가 원래 노드로 돌아온다',
      (await page.evaluate(() => document.activeElement?.getAttribute('data-plan-node'))) === dirtyNode,
      String(await page.evaluate(() => document.activeElement?.getAttribute('data-plan-node'))))

    // 확인창에서 [이동]을 고르면 포커스가 **목적지 노드**를 따라와야 한다.
    // 이게 없으면 창이 사라지면서 포커스가 body로 떨어져, 키보드 사용자는 이동 직후 갈 곳을 잃는다.
    // (applySelect가 포커스를 옮기는 이유 — 키 핸들러에서 옮기면 이 경로를 못 탄다)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(500)
    await page.locator('[data-testid=unsaved-nav-discard]').click()
    await page.waitForTimeout(700)
    const landed = await page.evaluate(() => document.activeElement?.getAttribute('data-plan-node'))
    check('⑥ [이동] 후 포커스가 목적지 노드를 따라온다 (body로 떨어지지 않는다)',
      landed !== null && landed !== dirtyNode, `포커스=${landed} 선택=${await curNode()}`)
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
