/** 소방계획서_37 S4-5 — 1.4-specs 채집 플레이크의 **원인 증명 + 수리안 검증**.
 *
 *  가설: 패널을 연 뒤의 고정 대기 1800ms 안에 fetchInspected()(서버 액션
 *  getInspectedFacilityCodesAction)가 못 끝나면, 그 응답이 그리는 배지가 통째로 빠진 채
 *  채집된다 — 「× 불량 N건」·「⚠ 점검함·제원 미입력 N곳」·시트별 진행도.
 *
 *  ⚠ 플레이크는 서버 부하에 좌우돼 "그냥 여러 번 돌려보기"로는 판정이 안 된다(실제로
 *  dev 재기동 뒤엔 4회 연속 재현되지 않았다). 그래서 **원인을 인위적으로 주입**한다 —
 *  서버 액션 응답만 3500ms 늦춘다(1800ms보다 확실히 크게).
 *
 *  판정 구조(2×2). 대조군이 없으면 '새 대기가 좋다'는 말이 공허하다:
 *    ① 지연 없음 + 구 대기(1800ms)  → 완전해야 한다 (평소엔 멀쩡하다 = 검사가 항진명제가 아님)
 *    ② 지연 주입 + 구 대기          → **불완전해야 한다** (가설 입증. 여기가 초록이면 가설이 틀린 것)
 *    ③ 지연 주입 + 새 대기(networkidle) → 완전해야 한다 (수리안이 실제로 고친다)
 *    ④ 지연 없음 + 새 대기          → 완전해야 한다 (수리안이 평소를 망가뜨리지 않는다)
 *
 *  실행: npx tsx scripts/_probe37-flake.mts
 */
import { BASE, check, summary, launch, login, mkUser, delUser, raw } from './_e2e-helpers.mjs'

/** 항등 검사와 **같은 축**으로 잰다 — COLLECT의 12px 계수(직접 텍스트 보유 + 렌더된 것만).
 *  절대값 '완전=53'을 박지 않는다(데이터가 바뀌면 거짓이 된다). 조건 간 **상대 비교**로 판정한다. */
const MARKERS = `(() => {
  let twelve = 0;
  for (const el of document.querySelectorAll('body *')) {
    let own = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { own = true; break }
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (getComputedStyle(el).fontSize === '12px') twelve++;
  }
  const t = document.body.innerText;
  return {
    twelve,
    defect: (t.match(/불량 \\d+건/g) || []).length,
    panelOpen: !!document.querySelector('[data-spec-panel][data-fs-boost]'),
    rowtables: document.querySelectorAll('[data-testid^="rowtable-"]').length,
  };
})()`
const BOOST_OFF = `[data-fs-boost]{--fs-scale:1!important}`

const { data: facRows } = await raw.from('fire_facilities')
  .select('building_id, installed').eq('installed', true).limit(5000)
const byBld = new Map<string, number>()
for (const r of facRows ?? []) byBld.set(r.building_id, (byBld.get(r.building_id) ?? 0) + 1)
const { data: blds } = await raw.from('buildings').select('id, customer_id')
  .in('id', [...byBld.keys()].slice(0, 200))
const { data: plans } = await raw.from('fire_plans').select('customer_id')
const planSet = new Set((plans ?? []).map(p => p.customer_id))
const ranked = (blds ?? []).map(b => ({ cust: b.customer_id, n: byBld.get(b.id) ?? 0 }))
  .filter(x => planSet.has(x.cust)).sort((a, b) => b.n - a.n)
const custId = ranked[0]?.cust
console.log(`대상 고객 ${custId} (설치 설비 ${ranked[0]?.n}개)\n`)

const email = `s37flake_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S37 플레이크', employeeId: `S37F${Date.now() % 100000}` })
const { browser, page } = await launch()

/** 서버 액션(POST)만 늦춘다. GET(문서·정적)은 그대로 둬야 페이지가 정상 로드된다. */
async function armDelay(p: any, ms: number) {
  await p.route('**/customers/**', async (route: any) => {
    if (route.request().method() === 'POST') {
      await new Promise(r => setTimeout(r, ms))
    }
    return route.continue()
  })
}

/** 서버 액션 응답 대기 — **클릭 전에 등록해야 한다**(클릭 후 등록하면 이미 끝난 응답을 놓친다). */
const actionResponse = (p: any) =>
  p.waitForResponse((r: any) => r.request().method() === 'POST' && r.url().includes('/customers/'),
    { timeout: 30000 }).catch(() => null)

async function measure(label: string, delayMs: number, strategy: 'old' | 'new') {
  // ⚠ 새 컨텍스트를 쓰지 않는다. 그렇게 했더니 네 조건이 전부 44로 붙어 **하니스가 대조를
  //   못 만들었다**. _probe37-timing.mts로 재보니 컨텍스트는 결과를 안 바꾼다(양쪽 동일) —
  //   붙었던 진짜 이유는 그때 metric이 12px 계수였고 BOOST_OFF 없이는 패널이 13.8px라
  //   패널 밖 노드만 세고 있었기 때문이다. 지금 metric은 **불량 배지 수**(글꼴 무관)다.
  const p = page
  try {
    await p.unroute('**/customers/**').catch(() => {})
    // ⚠ networkidle로 연다. domcontentloaded로 열었더니 **하이드레이션 전 클릭이 조용히
    //   무시돼** 패널이 열리지도 않았고 대조군까지 0이 나왔다(가설 검증이 무의미해질 뻔).
    // ⚠ 지연은 **로드 뒤**에 무장한다. 내비게이션 전에 걸면 goto의 networkidle이 안 끝난다.
    await p.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
    await p.waitForSelector('[data-testid^="form14-ledger-"]', { timeout: 30000 })
    await p.addStyleTag({ content: BOOST_OFF })
    await p.evaluate('document.fonts.ready').catch(() => {})
    if (delayMs > 0) await armDelay(p, delayMs)

    // 수리안은 응답 대기를 **클릭 전에** 등록한다. 클릭 후 등록은 이미 끝난 응답을 놓친다.
    const waiter = strategy === 'new' ? actionResponse(p) : null
    await p.evaluate(`(() => {
      const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
      if (els.length) els[0].click(); })()`)

    if (strategy === 'old') {
      await p.waitForTimeout(1800)                    // 현행 — 고정 대기
    } else {
      await waiter                                    // 수리안 — 서버 액션 응답까지
      await p.waitForTimeout(400)                     // 응답 → 리렌더 1프레임
    }
    const m: any = await p.evaluate(MARKERS)
    console.log(`  ${label.padEnd(26)} 12px ${String(m.twelve).padStart(3)} · 불량배지 ${String(m.defect).padStart(2)}` +
                ` · rowtable ${m.rowtables} · 패널 ${m.panelOpen ? 'O' : 'X'}`)
    return m
  } finally {
    // ⚠ 잠들어 있는 route 핸들러를 남긴 채 unroute 하면 프로세스가 통째로 죽는다
    //   (앞선 세 번의 실행이 전부 두 번째 측정 직후 여기서 끝났다). 먼저 배수한다.
    if (delayMs > 0) await p.waitForTimeout(delayMs + 800).catch(() => {})
    await p.unroute('**/customers/**').catch(() => {})
  }
}

let authState: any = null
try {
  await page.setViewportSize({ width: 1600, height: 1000 })
  page.setDefaultTimeout(60000)
  await login(page, email)
  authState = await page.context().storageState()   // 측정마다 새 컨텍스트를 쓰므로 로그인 상태를 넘긴다

  // ⚠ 순서는 ③부터다. 앞선 실행에서 ③ 직전에 프로세스가 죽어 **가장 중요한 수치를 못 건졌다** —
  //   부분 출력이라도 핵심부터 남도록 측정 순서를 뒤집는다.
  console.log('── 측정 ──')
  const c = await measure('③ 지연3500 + 새 대기', 3500, 'new')
  const b = await measure('② 지연3500 + 구 대기', 3500, 'old')
  const a = await measure('① 지연없음 + 구 대기', 0, 'old')
  const d = await measure('④ 지연없음 + 새 대기', 0, 'new')
  console.log('')

  // 판정은 **불량 배지 수**로 한다 — 서버 액션 응답이 그리는 것이라 '도착했는가'의 직접 지표이고
  // 글꼴 배율과 무관하다. 12px 계수는 보조로만 본다(BOOST_OFF 유무에 좌우된다).
  check('0 실험 성립 — 네 조건 모두 패널이 열리고 rowtable이 그려졌다 (항진 차단)',
    [a, b, c, d].every(m => m.panelOpen && m.rowtables > 0),
    JSON.stringify([a, b, c, d].map(m => `${m.panelOpen ? 'O' : 'X'}/${m.rowtables}`)))
  check('① 평소엔 구 대기(1800ms)도 완전하다 — 실험이 성립한다(배지가 애초에 있다)',
    a.defect > 0, `배지 ${a.defect}개 — 0이면 이 고객엔 배지가 없어 대조 자체가 불가`)
  check('② 지연을 주입하면 구 대기가 **놓친다** (원인 입증)',
    b.defect === 0 && b.defect < a.defect, `지연없음 ${a.defect} → 지연 ${b.defect}`)
  check('③ 같은 지연에서 새 대기(클릭 전 등록한 waitForResponse)는 회복한다 — **수리안이 고친다**',
    c.defect === a.defect && c.defect > b.defect, `구 ${b.defect} → 새 ${c.defect} (기준 ${a.defect})`)
  check('④ 새 대기가 평소를 망가뜨리지 않는다', d.defect === a.defect, `${d.defect} vs 기준 ${a.defect}`)
  check('보조 — 12px 계수도 같은 방향으로 움직인다',
    b.twelve < a.twelve && c.twelve === a.twelve, `① ${a.twelve} · ② ${b.twelve} · ③ ${c.twelve} · ④ ${d.twelve}`)
} catch (e: any) {
  check('프로브 실행', false, e?.message ?? String(e))
} finally {
  await page.unroute('**/customers/**').catch(() => {})
  await browser.close().catch(() => {})
  await delUser(u).catch(() => {})
}
summary()
