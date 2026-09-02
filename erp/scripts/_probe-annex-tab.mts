// 소방계획서_34 S7-3/S7-5 — 별지 서식 최상위 탭 승격 프로브 (2026-08-29)
//
// 이 프로브가 붙들고 있는 것 4가지. 어느 하나도 기존 스위트가 보지 않는다:
//   ① 탭이 실재하고 **소방계획서 바로 오른쪽**인가 (순서가 바뀌면 nth 기반 셀렉터가 조용히 어긋난다)
//   ② 구 딥링크 ?tab=plan&form=annex 가 여전히 별지서식 탭으로 해석되는가
//      → page.tsx의 정규화 3줄을 누가 지우면 **여기만** 빨강이 된다. 사용자 북마크와 프로브 11종의 생명줄.
//   ③ 소방계획서 트리에 별지 노드가 되살아나지 않았는가 (되살아나면 회차 조회가 이중으로 돈다)
//   ④ **지연 마운트** — 기본정보 탭만 열었을 때 별지 회차 조회 서버액션이 돌지 않는가
//      → lazyKeys 배선이 끊기면 증상이 '고객 상세가 좀 느려졌다'뿐이라 아무도 못 알아챈다.
//
// 실행: npx tsx scripts/_probe-annex-tab.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-tab-e2e@erp-test.com'
let userId = ''
let custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

async function tabLabels(page: Awaited<ReturnType<typeof launch>>['page']): Promise<string[]> {
  return page.locator('[role=tab]').allInnerTexts()
    .then((xs: string[]) => xs.map(x => x.replace(/\s+/g, '')))
}
async function activeTab(page: Awaited<ReturnType<typeof launch>>['page']): Promise<string> {
  return page.locator('[role=tab][aria-selected="true"]').first().innerText()
    .then((v: string) => v.replace(/\s+/g, '')).catch(() => '(없음)')
}

try {
  userId = await mkUser({ email: EMAIL, name: '별지탭프로브', employeeId: 'E2E-ANXT' })
  custId = await mkCustomer({ customer_name: '별지탭프로브고객', address: '경기 양평군 테스트로 34', created_by: userId })
  // 회차가 있어야 별지 화면이 카드를 그린다 — 지연 마운트 판정에 쓰는 서버액션도 회차 조회다
  const { error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  })
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ══ ① 탭 실재 + 순서 ═══════════════════════════════════════════════════════
  await page.goto(`${BASE}/customers/${custId}?tab=info`)
  await page.waitForSelector('h1', { timeout: 30000 })
  const labels = await tabLabels(page)
  const iPlan = labels.findIndex(t => t.includes('소방계획서'))
  const iAnnex = labels.findIndex(t => t.includes('별지서식'))
  check('① [별지서식] 탭 실재', iAnnex >= 0, JSON.stringify(labels))
  check('① [소방계획서] 바로 오른쪽', iPlan >= 0 && iAnnex === iPlan + 1, `plan=${iPlan} annex=${iAnnex}`)
  // 라벨 겹침 금지 — '소방계획서 별지' 류로 바꾸면 has-text("소방계획서")가 두 탭을 잡는다
  check('① 라벨이 서로 부분문자열이 아니다(셀렉터 충돌 방지)',
    !labels[iAnnex]?.includes('소방계획서'), String(labels[iAnnex]))
  check('① 진입 탭은 여전히 기본정보 (별지가 랜딩을 뺏지 않았다)',
    (await activeTab(page)).includes('기본정보'), await activeTab(page))

  // ══ ④ 지연 마운트 ═════════════════════════════════════════════════════════
  // ⚠ 판정 축은 **DOM 존재**다. 서버액션 POST를 세는 방식은 못 쓴다 —
  //   getCustomerRoundsAction과 소방계획서 탭의 다른 액션이 본문이 똑같이 `["custId"]`라
  //   구별이 안 된다(2026-08-29 _diag-annex-lazy로 실측: tab=info에서 무관한 액션 1건이
  //   그 필터에 걸려 멀쩡한 구현을 빨강으로 만들었다).
  //   탭 셸은 패널을 hidden으로만 감추므로, 마운트됐다면 **숨어 있어도 DOM에 있다**.
  //   즉 count===0 은 '안 보인다'가 아니라 '아예 안 만들어졌다'는 뜻이다.
  await page.goto(`${BASE}/customers/${custId}?tab=info`)
  await page.waitForSelector('h1', { timeout: 30000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1500)
  const idleMarker = await page.locator('text=사용승인일 기준으로 ERP가 자동 판정').count()
  const idlePanel = (await page.locator('[role=tabpanel]').nth(iAnnex).innerHTML().catch(() => '')).length
  check('④ 기본정보 탭에서 별지 패널이 DOM에 없다 (지연 마운트)', idleMarker === 0 && idlePanel === 0,
    `마커=${idleMarker} 패널길이=${idlePanel}`)
  await page.locator('[role=tab]').filter({ hasText: '별지서식' }).first().click()
  await page.waitForSelector('text=사용승인일 기준으로 ERP가 자동 판정', { timeout: 25000 })
  const afterMarker = await page.locator('text=사용승인일 기준으로 ERP가 자동 판정').count()
  check('④ (대조군) 탭을 누르면 패널이 생긴다 — 위 검사가 항진명제가 아님', afterMarker > 0, `마커=${afterMarker}`)
  check('④ 탭 클릭 → [별지서식] 활성', (await activeTab(page)).includes('별지서식'), await activeTab(page))
  // 한 번 방문한 뒤에는 마운트를 유지한다(입력 상태 유지 계약) — 다른 탭으로 옮겨도 DOM에 남아야 한다
  await page.locator('[role=tab]').filter({ hasText: '기본정보' }).first().click()
  await page.waitForTimeout(600)
  check('④ 방문 후에는 다른 탭으로 옮겨도 패널이 유지된다 (unmount 아님)',
    (await page.locator('text=사용승인일 기준으로 ERP가 자동 판정').count()) > 0)

  // ══ fullWidth — 별지 탭에서 우측 요약 패널이 접히는가 ══════════════════════
  // 빠지면 별지가 max-w-3xl에 갇히고 회차 카드·미리보기 레이아웃이 무너진다
  const summaryOnAnnex = await page.locator('text=최근 점검일').count()
    .catch(() => 0)
  check('fullWidth — 별지 탭에서 우측 요약 패널 접힘', summaryOnAnnex === 0, `실측 ${summaryOnAnnex}개`)

  // ══ ② 구 딥링크 하위호환 (정규화 존치 가드) ═════════════════════════════════
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=annex`)
  await page.waitForSelector('h1', { timeout: 30000 })
  check('② 구 딥링크 ?tab=plan&form=annex → [별지서식] 탭',
    (await activeTab(page)).includes('별지서식'), await activeTab(page))
  check('② 그 화면에 별지 본체가 실제로 떠 있다',
    await page.locator('text=사용승인일 기준으로 ERP가 자동 판정').first()
      .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false))

  // ══ ③ 소방계획서 트리에 별지 노드 부재 + 트리 축 보존 ═══════════════════════
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`)
  await page.waitForSelector('h1', { timeout: 30000 })
  check('③ 소방계획서 탭 활성', (await activeTab(page)).includes('소방계획서'), await activeTab(page))
  const annexNodes = await page.locator('[data-plan-node="annex"]').count()
  check('③ 트리에 [data-plan-node="annex"] 0개', annexNodes === 0, `count=${annexNodes}`)
  // 트리 선택 축 자체는 살아 있어야 한다 — 이게 죽으면 위 단언이 항진명제가 된다
  const sel = await page.locator('[data-plan-node][aria-current="true"]').first()
    .getAttribute('data-plan-node').catch(() => null)
  check('③ (대조군) form=1.4 딥링크는 여전히 노드 1.4를 선택', sel === '1.4', String(sel))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
