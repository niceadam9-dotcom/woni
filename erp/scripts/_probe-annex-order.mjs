// 구 14.md #16(2026-08-11) 트리 순서 프로브 → **소방계획서_34(2026-08-29)로 축 전환**.
//
// 종전 축: 좌측 트리·모바일 드롭다운에서 '보관·이력'이 '별지 서식'보다 위인가.
// 그 결정은 소멸했다 — 별지 서식이 트리에서 나가 최상위 [별지서식] 탭이 됐기 때문이다
// (Json_Rule 규칙 5 action=moved). 순서 단언은 성립할 수 없다.
//
// 새 축: ①별지가 트리에서 **완전히** 사라졌는가(D34-2 — 안내 문구도 없다)
//        ②보관·이력이 본문 다음 마지막 그룹인가 ③트리 이동은 그대로 동작하는가.
// 파일을 지우지 않고 축만 옮긴다 — 지우면 '별지가 트리에 되살아났다'를 아무도 안 본다.
import { check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, BASE } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-annex-order@test.local'
let userId, customerId, browser
try {
  userId = await mkUser({ email: EMAIL, name: '별지순서프로브', employeeId: 'E2E-AXO' })
  customerId = await mkCustomer({ customer_name: '별지순서프로브사', address: '서울 중구 세종대로 110', created_by: userId })
  const l = await launch(); browser = l.browser
  const { page } = l
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${customerId}?tab=plan`)
  await page.waitForSelector('text=계획서 정보')

  // ── ① 데스크톱 좌측 트리 — 별지 흔적 0 ──
  const aside = page.locator('aside', { hasText: '소방계획서 본문' }).first()
  const asideText = await aside.innerText()
  const iBody = asideText.indexOf('소방계획서 본문')
  const iArchive = asideText.indexOf('보관·이력')
  check('트리 — 본문이 최상단', iBody >= 0 && iBody < iArchive, `body=${iBody} archive=${iArchive}`)
  check('트리 — 보관·이력이 본문 다음(마지막 그룹)', iArchive > iBody, `archive=${iArchive}`)
  check('트리 — 📑 별지 서식 그룹 머리 없음', !asideText.includes('별지 서식'), asideText.replace(/\s+/g, ' ').slice(0, 200))
  check('트리 — [data-plan-node="annex"] 0개', (await page.locator('[data-plan-node="annex"]').count()) === 0)
  const btnLabels = await aside.locator('button').allInnerTexts()
  check('트리 버튼 — 회차별 작성·조회 버튼 없음',
    btnLabels.findIndex(t => t.includes('회차별 작성·조회')) === -1, JSON.stringify(btnLabels))

  // ── ② 모바일 드롭다운(NAV_ALL)에서도 별지 option이 사라졌는가 ──
  await page.setViewportSize({ width: 480, height: 900 })
  await page.waitForSelector('select[data-plan-nav]', { timeout: 10000 })
  const opts = await page.locator('select[data-plan-nav] option').allInnerTexts()
  check('모바일 드롭다운 — 보관함·개정이력이 마지막 option',
    opts.findIndex(t => t.includes('보관함·개정이력')) === opts.length - 1, JSON.stringify(opts))
  check('모바일 드롭다운 — 별지 option 없음',
    opts.findIndex(t => t.includes('별지')) === -1, JSON.stringify(opts))

  // ── ③ 트리 이동 동작 회귀 — 별지가 빠져도 나머지 노드는 그대로 ──
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.click('button:has-text("보관함·개정이력")')
  await page.waitForSelector('text=개정이력')
  check('보관함 노드 클릭 → 개정이력 렌더', true)

  // ── ④ 별지 본체는 최상위 탭에서 뜬다 (이관처 확인 — 사슬을 여기서 잇는다) ──
  await page.goto(`${BASE}/customers/${customerId}?tab=annex`)
  await page.waitForSelector('text=별지는 입력한 데이터로 자동 생성됩니다', { timeout: 20000 })
  const activeTab = (await page.locator('[role=tab][aria-selected="true"]').first().innerText()).replace(/\s+/g, '')
  check('[별지서식] 탭에서 별지 본체 렌더 + 그 탭이 활성', activeTab.includes('별지서식'), activeTab)
} catch (e) {
  check('프로브 실행', false, String(e))
} finally {
  if (browser) await browser.close()
  await cleanupCustomer(customerId)
  await delUser(userId)
  summary()
}
