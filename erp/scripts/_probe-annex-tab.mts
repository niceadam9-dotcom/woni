// 소방계획서_34 S7-3/S7-5 — 별지 서식 최상위 탭 승격 프로브 (2026-08-29)
// 2026-09-20 3분리 반영: 소방계획서가 공통(1.1·1.4)/보고서(별지 전용 입력)/회차(구 별지서식=key annex)/
// 소방계획서(계획서 전용) 넷으로 갈라졌다. ?tab=plan&form=1.1·1.4 도 annex와 같은 규약으로 서버 변환된다.
// ①③의 종전 단언(annex가 plan 바로 오른쪽 · form=1.4가 트리 1.4 선택)은 그 구계약이라
// **반대 방향의 새 계약으로 갈아끼웠다**(지우지 않았다). ② 딥링크 변환 축은 문자 그대로 존치.
//
// 이 프로브가 붙들고 있는 것 4가지. 어느 하나도 기존 스위트가 보지 않는다:
//   ① 탭이 실재하고 순서가 **공통 → 보고서 → 소방계획서 → 회차**인가 (nth 기반 셀렉터의 축 —
//      2026-09-21 사용자 지시로 회차가 소방계획서 뒤로 이동. 종전 순서 단언을 갈아끼웠다)
//   ② 구 딥링크 ?tab=plan&form=annex → 회차 탭 / ?tab=plan&form=1.1·1.4 → 공통 탭(해당 노드).
//      → page.tsx의 정규화 줄을 누가 지우면 **여기만** 빨강이 된다. 사용자 북마크와 프로브 11종의 생명줄.
//   ③ 소방계획서 트리에 별지·1.4 노드가 되살아나지 않았는가 (되살아나면 조회 왕복이 이중으로 돈다)
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
  // 라벨은 「공통」(2026-09-20 사용자 확정 — 소방계획서 3분리: 공통/보고서/소방계획서, 새 공통 서식은 이 탭에 추가)
  const iFac = labels.findIndex(t => t.startsWith('공통'))
  const iReports = labels.findIndex(t => t.startsWith('보고서'))
  const iAnnex = labels.findIndex(t => t.startsWith('회차'))
  check('① [회차] 탭 실재(구 별지서식 — key annex)', iAnnex >= 0, JSON.stringify(labels))
  check('① [보고서] 탭 실재(별지 전용 입력 — 신설 key reports)', iReports >= 0, JSON.stringify(labels))
  check('① [공통] 탭 실재(1.1·1.4가 산다)', iFac >= 0, JSON.stringify(labels))
  check('① 순서: 공통 → 보고서 → 소방계획서 → 회차 (2026-09-21 사용자 지정 — 회차가 소방계획서 뒤)',
    iFac >= 0 && iReports === iFac + 1 && iPlan === iReports + 1 && iAnnex === iPlan + 1,
    `fac=${iFac} reports=${iReports} plan=${iPlan} annex=${iAnnex}`)
  // 라벨 겹침 금지 — '소방계획서 별지' 류로 바꾸면 has-text("소방계획서")가 두 탭을 잡는다.
  // '공통'도 같은 축: '소방계획서'와 서로 부분문자열이 아니어야 role=tab 셀렉터가 하나만 잡는다
  check('① 라벨이 서로 부분문자열이 아니다(셀렉터 충돌 방지)',
    !labels[iAnnex]?.includes('소방계획서') && !labels[iFac]?.includes('소방계획서')
      && !labels[iPlan]?.includes(labels[iAnnex] ?? '보고서'), `${labels[iFac]} / ${labels[iAnnex]}`)
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
  await page.locator('[role=tab]').filter({ hasText: '회차' }).first().click()
  await page.waitForSelector('text=사용승인일 기준으로 ERP가 자동 판정', { timeout: 25000 })
  const afterMarker = await page.locator('text=사용승인일 기준으로 ERP가 자동 판정').count()
  check('④ (대조군) 탭을 누르면 패널이 생긴다 — 위 검사가 항진명제가 아님', afterMarker > 0, `마커=${afterMarker}`)
  check('④ 탭 클릭 → [회차] 활성', (await activeTab(page)).includes('회차'), await activeTab(page))
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
  check('② 구 딥링크 ?tab=plan&form=annex → [회차] 탭',
    (await activeTab(page)).includes('회차'), await activeTab(page))
  check('② 그 화면에 별지 본체가 실제로 떠 있다',
    await page.locator('text=사용승인일 기준으로 ERP가 자동 판정').first()
      .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false))
  // form=1.4 변환 — annex와 같은 규약(2026-09-20 신설). 지우면 구 북마크가 조용히 1.1로 떨어진다
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`)
  await page.waitForSelector('h1', { timeout: 30000 })
  check('② 구 딥링크 ?tab=plan&form=1.4 → [공통] 탭',
    (await activeTab(page)).includes('공통'), await activeTab(page))
  // 이 프로브 고객은 건물이 없다 — PlanForm14는 그때 42종 표 대신 건물 등록 안내를 그린다.
  // 어느 쪽이든 「1.4 본체가 마운트됐다」는 증거다(빈 패널·1.1 낙하가 아니라는 것이 이 단언의 뜻)
  check('② 그 화면에 1.4 본체가 실제로 떠 있다(42종 표 또는 무건물 안내)',
    await page.locator('text=/서식 1\\.4 소방시설 현황|등록된 활성 건물이 없습니다/').first()
      .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false))

  // form=1.1 변환 — 1.1도 공통 탭 이사(3분리). 트리 노드까지 열리는지(1.1 패널 마커) 함께 묻는다
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.1`)
  await page.waitForSelector('h1', { timeout: 30000 })
  check('② 구 딥링크 ?tab=plan&form=1.1 → [공통] 탭',
    (await activeTab(page)).includes('공통'), await activeTab(page))
  check('② 그 화면에 1.1 본체(계획서 정보 폼)가 떠 있다',
    await page.locator('text=① 시설현황').first()
      .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false))

  // ══ ③ 소방계획서 트리에 별지·1.1·1.4 노드 부재 + 트리 축 보존 ═══════════════════
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.5`)
  await page.waitForSelector('h1', { timeout: 30000 })
  check('③ 소방계획서 탭 활성', (await activeTab(page)).includes('소방계획서'), await activeTab(page))
  const annexNodes = await page.locator('[data-plan-node="annex"]').count()
  check('③ 트리에 [data-plan-node="annex"] 0개', annexNodes === 0, `count=${annexNodes}`)
  const facNodes = await page.locator('[data-plan-node="1.4"]').count()
  check('③ 트리에 [data-plan-node="1.4"] 0개(이사 노드 부활 금지)', facNodes === 0, `count=${facNodes}`)
  // ⚠ 1.1은 공통 탭 트리가 같은 data-plan-node 표식을 쓴다(tab-form-tree) — 소방계획서 **트리 안**으로 좁혀 센다
  const planTree = page.locator('[role=tabpanel]:not([hidden]) aside [data-plan-node="1.1"]')
  check('③ 소방계획서 트리에 1.1 노드 0개(이사 노드 부활 금지)', (await planTree.count()) === 0)
  // 트리 선택 축 자체는 살아 있어야 한다 — 이게 죽으면 위 단언이 항진명제가 된다
  const sel = await page.locator('[data-plan-node][aria-current="true"]').first()
    .getAttribute('data-plan-node').catch(() => null)
  check('③ (대조군) form=1.5 딥링크는 노드 1.5를 선택', sel === '1.5', String(sel))
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
