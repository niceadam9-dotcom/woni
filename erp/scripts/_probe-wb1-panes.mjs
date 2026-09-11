/** ① 점검표 2칸 전환 — 실화면 실측(2026-09-11 사용자 지시).
 *
 *  순수 함수·소스 단언은 `_probe-pane-width.mts`가 본다. 여기서 볼 것은 **브라우저가 실제로 그린
 *  결과**다: 칸이 둘인가, 종전보다 넓어졌는가, 참여자가 ①에서 빠지고 ②에 남았는가.
 *  ⚠ 격리 워크트리 dev(기본 3101)에 대고 돈다 — 공유 트리 dev(3000)는 20커밋 낡아 이 변경이 없다.
 *    `TEST_BASE_URL`로 바꿀 수 있다.
 */
import { chromium } from 'playwright'
import { raw, check, summary, mkUser, delUser, PW } from './_e2e-helpers.mjs'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3101'
const EMAIL = 'wb1panes-probe@erp-test.com'

/* 표본 둘을 **따로** 잡는다 — ①의 계약이 두 갈래이기 때문이다:
   자체점검은 ②가 있어 참여자가 거기 남고, 월간·일반은 ②가 없어 참여자가 화면에서 사라진다.
   한 갈래만 보면 "사라져도 되는가"라는 이번 결정의 핵심이 검증되지 않는다. */
/* 🚨 **다른 세션의 E2E 임시 회차를 표본으로 잡으면 안 된다.** 첫 실행에서 `created_at desc`로
   고른 건이 조회와 화면 로드 **사이에** 지워져 404가 났다(그 세션의 cleanup이 돌았다).
   실고객만 쓰고(`TEST-E2E` 제외), 오래된 것부터 고른다 — 오래된 실데이터가 가장 안 지워진다. */
const { data: testCust } = await raw.from('customers').select('id').like('customer_code', 'TEST-E2E%')
const testIds = new Set((testCust ?? []).map(c => c.id))
const { data: defRows } = await raw.from('inspection_defects').select('inspection_id').limit(1000)
const withDefects = [...new Set((defRows ?? []).map(r => r.inspection_id))]
const { data: spAll } = await raw.from('inspections')
  .select('id, plan_type, customer_id').in('id', withDefects).like('plan_type', 'special%')
  .order('created_at', { ascending: true })
const { data: moAll } = await raw.from('inspections')
  .select('id, plan_type, customer_id').eq('plan_type', 'monthly')
  .order('created_at', { ascending: true }).limit(50)
const sp = (spAll ?? []).find(r => !testIds.has(r.customer_id))
const mo = (moAll ?? []).find(r => !testIds.has(r.customer_id))
if (!sp) { console.error('❌ 불량 있는 실(非E2E) 자체점검 표본 없음 — 공허 통과시키지 않는다'); process.exit(1) }
if (!mo) { console.error('❌ 실(非E2E) 월간 표본 없음 — 공허 통과시키지 않는다'); process.exit(1) }
console.log(`  [표본] 자체점검 ${sp.id} · 월간 ${mo.id}`)

let uid = null
const browser = await chromium.launch()
try {
  uid = await mkUser({ email: EMAIL, name: '①칸프로브', employeeId: 'WB1-PROBE' })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(25000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 40000 })

  /** ① 화면을 열고 칸 기하를 잰다 */
  async function openChecklist(id, label) {
    // ⚠ 격리 dev는 첫 진입이 **콜드 컴파일**이라 25초 기본값으로는 못 기다린다(첫 실행에서 타임아웃).
    //   `commit`으로 응답만 받고, 실제 준비는 아래 셀렉터가 기다린다.
    await page.goto(`${BASE}/inspections/${id}?step=1`, { waitUntil: 'commit', timeout: 180000 })
    await page.waitForSelector('[data-testid="workbench-panes"]', { timeout: 180000 })
    await page.waitForTimeout(2500)
    const g = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="workbench-panes"]')
      const panes = [...grid.children].filter(el => el.getBoundingClientRect().width > 0)
      return {
        cols: getComputedStyle(grid).gridTemplateColumns,
        widths: panes.map(p => Math.round(p.getBoundingClientRect().width)),
        titles: panes.map(p => (p.querySelector('div')?.textContent ?? '').trim().slice(0, 24)),
      }
    })
    console.log(`  [실측 ${label}] 칸 ${g.widths.length}개 · 폭 ${g.widths.join(' / ')} · 제목 ${JSON.stringify(g.titles)}`)
    return g
  }

  // ── 자체점검 ──
  const g1 = await openChecklist(sp.id, '자체점검 ①')
  check('자체점검 ① — 칸이 2개다', g1.widths.length === 2, `${g1.widths.length}개`)
  check('자체점검 ① — 첫째 칸이 더 넓다(점검표가 주 작업면)', g1.widths[0] > g1.widths[1],
    `${g1.widths[0]} vs ${g1.widths[1]}`)
  // 🎯 「화면을 크게 쓴다」의 실체 — 칸 하나가 사라진 만큼 둘 다 넓어져야 한다.
  //    종전 3칸 normal [1.15,1,1]에서 첫째 칸이 가지던 비율이 1.15/3.15 = 36.5%다.
  const total1 = g1.widths[0] + g1.widths[1]
  check('🎯 자체점검 ① — 첫째 칸이 종전 3칸 시절 비율(36.5%)보다 넓다',
    g1.widths[0] / total1 > 0.365, `${Math.round(g1.widths[0] / total1 * 1000) / 10}%`)
  check('자체점검 ① — 참여자 카드가 없다(②로 일원화)',
    (await page.locator('text=점검 참여자').count()) === 0)
  check('자체점검 ① — [재방문 안내] 버튼은 살아 있다',
    (await page.locator('[data-testid="workbench-adhoc-sms"]').count()) === 1)
  // 음성 대조 — 없앤 것들이 정말 없는가
  check('자체점검 ① — [별지 4호 생성] 버튼이 없다',
    (await page.locator('button:has-text("별지 4호 생성")').count()) === 0)

  // ② 로 넘어가면 참여자가 **거기 있다** — 사라진 게 아니라 옮겨진 것임을 같은 화면 안에서 증명
  await page.click('[data-testid="workbench-stepbar"] button[data-step="cert"]')
  await page.waitForSelector('[data-testid="workbench-stepbar"] button[data-step="cert"][aria-current="step"]', { timeout: 25000 })
  await page.waitForTimeout(1500)
  check('🎯 자체점검 ② — 참여자 카드가 거기 있다(사라진 게 아니라 일원화)',
    (await page.locator('text=점검 참여자').count()) >= 1)

  // ── 월간·일반 (②가 없는 갈래) ──
  const g2 = await openChecklist(mo.id, '월간 ①')
  check('월간 ① — 칸이 2개다', g2.widths.length === 2, `${g2.widths.length}개`)
  check('월간 ① — 단계가 ① 하나뿐이다(②가 없다는 전제 실측)',
    (await page.locator('[data-testid="workbench-stepbar"] button[data-step]').count()) === 1)
  check('월간 ① — [재방문 안내] 버튼이 여기에도 살아 있다',
    (await page.locator('[data-testid="workbench-adhoc-sms"]').count()) === 1)
  // 🚨 이 건에서는 참여자가 **화면에서 사라진다**. 그게 의도다(외관점검표가 보조 인력을 인쇄하지
  //    않으므로 입력해도 나갈 데가 없던 칸) — 의도임을 단언으로 박아 둔다. 담당자 이름은 머리가 말한다.
  check('🚨 월간 ① — 참여자 카드가 없다(의도 — 외관점검표는 보조 인력을 인쇄하지 않는다)',
    (await page.locator('text=점검 참여자').count()) === 0)
  check('  · 대신 담당자 이름은 페이지 머리가 말한다',
    (await page.locator('text=/담당 |담당 미배정/').count()) >= 1)

  await page.goto(`${BASE}/inspections/${sp.id}?step=1`, { waitUntil: 'commit', timeout: 180000 })
  await page.waitForSelector('[data-testid="workbench-panes"]', { timeout: 180000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'scripts/_shot-wb1-2panes.png' })
  console.log('  [산출] scripts/_shot-wb1-2panes.png')
} finally {
  await browser.close()
  await delUser(uid)
}
summary()
