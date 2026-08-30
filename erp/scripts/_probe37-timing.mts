/** 소방계획서_37 S4-5 진단 — **수리 전에 관측한다**.
 *
 *  지금까지 두 번 틀렸다: networkidle을 추측으로 골랐다가 반증됐고, waitForResponse도
 *  추측으로 넣었다가 네 조건이 전부 44로 붙어 판별을 못 했다. 둘 다 **무엇을 기다려야
 *  하는지 모른 채 대기 방식만 바꾼** 탓이다.
 *
 *  그래서 이 프로브는 고치지 않는다. 클릭 이후를 **초 단위로 촬영**만 한다:
 *    · POST(서버 액션)가 실제로 나가는가 · 언제 응답하는가
 *    · 12px 노드 수가 시간에 따라 어떻게 차오르는가 (= 언제 '완성'되는가)
 *    · 완성 시점이 POST 응답과 인과적으로 붙어 있는가
 *
 *  실행: npx tsx scripts/_probe37-timing.mts
 */
import { BASE, check, summary, launch, login, mkUser, delUser, raw } from './_e2e-helpers.mjs'

const SAMPLE = `(() => {
  let twelve = 0;
  for (const el of document.querySelectorAll('body *')) {
    let own = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { own = true; break }
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (getComputedStyle(el).fontSize === '12px') twelve++;
  }
  return { twelve, defect: (document.body.innerText.match(/불량 \\d+건/g) || []).length };
})()`

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
const URL = `${BASE}/customers/${custId}?tab=plan&form=1.4`
console.log(`대상 고객 ${custId}\n`)

const email = `s37tim_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S37 타이밍', employeeId: `S37T${Date.now() % 100000}` })
const { browser, page } = await launch()

/** 한 번의 관측: 열고 → 클릭 → 8초간 0.5초 간격으로 촬영. POST는 별도로 기록. */
async function observe(label: string, fresh: boolean) {
  const posts: Array<{ t: number; url: string; status: number }> = []
  let t0 = 0
  const onResp = (r: any) => {
    if (r.request().method() !== 'POST') return
    posts.push({ t: t0 ? Date.now() - t0 : -1, url: r.url().slice(-60), status: r.status() })
  }
  const ctx = fresh
    ? await browser.newContext({ viewport: { width: 1600, height: 1000 }, storageState: authState })
    : page.context()
  const p = fresh ? await ctx.newPage() : page
  p.setDefaultTimeout(45000)
  p.on('response', onResp)
  try {
    await p.goto(URL, { waitUntil: 'networkidle' })
    await p.waitForSelector('[data-testid^="form14-ledger-"]', { timeout: 30000 })
    await p.evaluate('document.fonts.ready').catch(() => {})

    t0 = Date.now()
    await p.evaluate(`(() => {
      const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
      if (els.length) els[0].click(); })()`)

    const curve: string[] = []
    for (let i = 1; i <= 16; i++) {
      await p.waitForTimeout(500)
      const s: any = await p.evaluate(SAMPLE)
      curve.push(`${i * 500}ms:${s.twelve}${s.defect ? '*' : ''}`)
    }
    console.log(`── ${label} ──`)
    console.log(`  12px 추이  ${curve.join(' ')}`)
    console.log(`  POST       ${posts.length ? posts.map(x => `+${x.t}ms(${x.status})`).join(' ') : '**없음**'}`)
    const last = curve[curve.length - 1]
    return { curve, posts, final: Number(last.split(':')[1].replace('*', '')), hadPost: posts.length > 0 }
  } finally {
    p.off('response', onResp)
    if (fresh) await ctx.close().catch(() => {})
  }
}

let authState: any = null
try {
  await page.setViewportSize({ width: 1600, height: 1000 })
  page.setDefaultTimeout(45000)
  await login(page, email)
  authState = await page.context().storageState()

  const reused = await observe('재사용 페이지 (종전 프로브가 53을 얻던 조건)', false)
  const freshA = await observe('새 컨텍스트 (2×2 하니스가 44에 붙던 조건)', true)

  console.log('')
  check('POST(서버 액션)가 두 조건 모두에서 실제로 발생한다',
    reused.hadPost && freshA.hadPost,
    `재사용 ${reused.posts.length}건 / 새컨텍스트 ${freshA.posts.length}건 — 0건이면 fetchInspected가 아예 안 불린 것이다`)
  check('두 조건의 최종 도달값이 같다 (컨텍스트가 결과를 바꾸지 않는다)',
    reused.final === freshA.final,
    `재사용 ${reused.final} vs 새컨텍스트 ${freshA.final} — 다르면 하니스가 대조를 못 만든 이유가 여기다`)
  const settleIdx = reused.curve.findIndex((c, i, arr) =>
    i >= 2 && arr.slice(i - 2, i + 1).every(x => x.split(':')[1] === c.split(':')[1]))
  console.log(`\n재사용 조건 정착 시점 ≈ ${settleIdx >= 0 ? (settleIdx + 1) * 500 + 'ms' : '8초 내 미정착'}`)
} catch (e: any) {
  check('프로브 실행', false, e?.message ?? String(e))
} finally {
  await browser.close().catch(() => {})
  await delUser(u).catch(() => {})
}
summary()
